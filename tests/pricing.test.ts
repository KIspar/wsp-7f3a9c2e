import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {credentialVault} from '../apps/server/credentials';
import {priceItem,createPricingService} from '../apps/server/pricing';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {compilePlan} from '../apps/server/engine';
import {createApp} from '../apps/server/app';
import {defaultDraft,type Attempt,type Draft,type Submission} from '../packages/contracts';
import type {ProviderPricing,ProviderPriceGroup,ProviderBalance} from '../packages/provider';
import fixtures from './fixtures/media-pricing.json';
import {withChuheRouting} from '../packages/chuhe-routing';
import providerFixture from './fixtures/provider.json';

let store:Store,dir:string,balance:ProviderBalance,prices:ProviderPricing;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-price-'));store=createStore(dir,process.cwd());const vault=credentialVault(dir);vault.set('tt-image','sk-test-image-12345678901234567890');vault.set('omni','sk-test-video-12345678901234567890');balance={balance:1.71,unit:'算力',api_key_quota:{limit:0,used:0}};prices=structuredClone(fixtures['tt-image-2.5']);});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
function draft(id='image-generate'):Draft{return {...defaultDraft(store.skills().find(s=>s.id===id)!,store.models()),requirements:'商品设计',inputRoles:id==='model-outfit'?{product:['example-6-1'],targets:['example-10-1']}:{},selectedTargetIds:id==='model-outfit'?['example-10-1']:[]};}
function request(d=draft(),skillId='image-generate'):Submission{return {skillId,draft:d,action:'generate',idempotencyKey:crypto.randomUUID(),expectedDraftRevision:store.readDraft(skillId).revision,planHash:compilePlan(store,skillId,d).hash,maximumCost:10};}
function transport(){return vi.fn(async(raw:string,init:RequestInit)=>{
  expect(init.method).toBe('GET');const url=new URL(raw);
  return new Response(JSON.stringify(url.pathname.endsWith('/balance')?balance:url.searchParams.get('model')==='omni-flash'?fixtures['omni-flash']:prices));
});}
const group=(patch:Partial<ProviderPriceGroup>={}):ProviderPriceGroup=>({group_id:1,group_name:'测试线路',is_active:true,in_key_whitelist:true,excluded_for_this_key:false,billing_method:'按次',base_price:.1,input_image_price:0,input_image_free_count:0,option_prices:[],...patch});
const pricing=(g:ProviderPriceGroup[]):ProviderPricing=>({available_for_this_key:true,channel_groups:g});
const item=(parameters:Record<string,unknown>={},references:string[]=[])=>({parameters,references});
describe('supplier price calculation and admission',()=>{
  it('quotes actual eligible route range without using local manual model points',async()=>{
    const model=store.models()[0];store.put('model',model.id,{...model,points:999});
    const d=draft();d.count=3;const plan=compilePlan(store,'image-generate',d),result=await createPricingService(store,transport()).quote(plan.items);
    expect(result).toMatchObject({minimum:.1185,maximum:.2574,balance:1.71,affordable:true});expect(result.items).toHaveLength(3);expect(result.items[0].channels).toBe(2);
  });
  it('combines all option multipliers and additions; never treats a single-option final_price as a whole quote',()=>{
    const g=group({option_prices:[{param_name:'resolution',option_value:'2K',price_multiplier:2,price_addition:.01,final_price:999},{param_name:'duration',option_value:'6',price_multiplier:3,price_addition:.02,final_price:999}]});
    expect(priceItem(item({resolution:'2K',duration:6}),pricing([g]))).toMatchObject({minimum:.63,maximum:.63});
  });
  it('charges reference counts after free allowance, including a pending white background dependency',()=>{
    const p=pricing([group({input_image_price:.03,input_image_free_count:2})]);
    expect(priceItem({...item({},['a','b','c']),dependencyTaskId:'pending-white'},p).maximum).toBe(.16);
  });
  it('prices Omni duration changes and multiplies per-second prices by duration',()=>{
    expect(priceItem(item({duration:4}),fixtures['omni-flash']).maximum).toBe(.4118);
    expect(priceItem(item({duration:6}),fixtures['omni-flash']).maximum).toBe(.6177);
    expect(priceItem(item({duration:10}),fixtures['omni-flash']).maximum).toBe(1.0296);
    expect(priceItem(item({duration:6}),pricing([group({billing_method:'按秒'})])).maximum).toBe(.6);
  });
  it('excludes congestion without forced calling, excluded and unsupported routes; rejects token-based zero and unknown prices',()=>{
    expect(priceItem(item({background:'opaque'}),pricing([group(),group({group_id:2,base_price:999,is_active:false}),group({group_id:3,base_price:888,excluded_for_this_key:true})])).maximum).toBe(.1);
    expect(()=>priceItem(item({background:'transparent'}),prices)).toThrow('可用线路');
    expect(()=>priceItem(item(),pricing([group({billing_method:'按token',base_price:0})]))).toThrow('计费方式');
    expect(()=>priceItem(item(),pricing([group({base_price:undefined})]))).toThrow('计费方式');
    expect(()=>priceItem(item({resolution:'4K'}),pricing([group({capability_rules:[{effect:'reject',when:[{param:'resolution',op:'in',values:['4K']}]}]})]))).toThrow('可用线路');
  });
  it('includes a congested forced channel in the confirmed price range without authorizing excluded or removed channels',()=>{
    const p=pricing([group(),group({group_id:2,base_price:9,is_active:false}),group({group_id:3,base_price:88,is_active:false,excluded_for_this_key:true}),group({group_id:4,base_price:99,is_active:false})]);
    const key={...providerFixture.key,custom_groups_in_effect:true,custom_groups:[{model:'tt-image-2.5',group_ids:[1,2,3,4],force_group_ids:[2,3,4],groups:[{group_id:4,group_name:'removed',status:'removed'}]}]};
    expect(priceItem(item(),withChuheRouting(p,key,'tt-image-2.5'))).toMatchObject({minimum:.1,maximum:9,channels:2});
    expect(priceItem(item(),withChuheRouting(p,{...key,custom_groups_in_effect:false},'tt-image-2.5'))).toMatchObject({minimum:.1,maximum:.1,channels:1});
  });
  it('estimates before prompt/product content is complete; detail screens multiply by group count',async()=>{
    const service=createGenerationPricing(store,transport());
    const blank={...draft(),requirements:''};expect((await service.estimate('image-generate',blank,'generate')).maximum).toBe(.0858);
    await expect(service.plan('image-generate',blank,'generate')).rejects.toThrow('创作要求');
    const d=draft('detail-design');d.imageDesign!.screens=d.imageDesign!.screens.slice(0,1);d.imageDesign!.screens.push({id:'second',type:'详细规格/参数表',requirements:'',facts:''});d.imageDesign!.groupCount=2;
    const quote=await service.estimate('detail-design',d,'generate');expect(quote.items).toHaveLength(4);expect(quote.maximum).toBe(.3432);
    d.inputRoles={product:['example-6-1']};await expect(service.plan('detail-design',d,'generate')).rejects.toThrow('产品名');
  });
  it.each([0,.05])('blocks insufficient account balance %s and preserves draft/batches',async available=>{
    balance.balance=available;const service=createGenerationPricing(store,transport()),r=request();
    await expect(service.admit(r)).rejects.toMatchObject({statusCode:402});expect(store.snapshot().batches).toHaveLength(0);expect(store.readDraft('image-generate').revision).toBe(0);
  });
  it('checks key remaining quota separately and rejects missing quota or fractional rounding up',async()=>{
    const read=transport(),service=createPricingService(store,read),plan=compilePlan(store,'image-generate',draft());
    balance.api_key_quota={limit:1,used:.95,remaining:.05};expect(await service.quote(plan.items)).toMatchObject({keyRemaining:.05,available:.05,affordable:false});
    balance.api_key_quota.remaining=undefined;await expect(service.quote(plan.items)).rejects.toThrow('剩余额度');
    balance.api_key_quota={limit:0,used:0};balance.balance=.0857999;expect(await service.quote(plan.items)).toMatchObject({available:.085799,affordable:false});
  });
  it('rechecks fresh price/balance on admission, rejects increases beyond the confirmed upper bound',async()=>{
    const read=transport(),service=createGenerationPricing(store,read),r=request();r.maximumCost=.0395;
    await expect(service.admit(r)).rejects.toMatchObject({statusCode:409});expect(store.snapshot().batches).toHaveLength(0);
    r.maximumCost=.0858;const accepted=await service.admit(r);expect(accepted.batch.attempts[0].reservedCost).toBe(.0858);
    balance.balance=0;const calls=read.mock.calls.length;expect((await service.admit(r)).batch.id).toBe(accepted.batch.id);expect(read).toHaveBeenCalledTimes(calls);
    await expect(service.admit({...r,draft:{...r.draft,requirements:'不同内容'}})).rejects.toThrow('接单凭据');
  });
  it('serializes concurrent tabs and reserves queued upper bounds without double spending',async()=>{
    balance.balance=.12;const service=createGenerationPricing(store,transport());
    const [a,b]=await Promise.allSettled([service.admit(request()),service.admit(request(draft('model-outfit'),'model-outfit'))]);
    expect(a.status).toBe('fulfilled');expect(b.status).toBe('rejected');if(b.status==='rejected')expect(b.reason.statusCode).toBe(402);
    expect(store.snapshot().batches).toHaveLength(1);
  });
  it('never accepts when quote lookup fails; no paid POST or local task is created',async()=>{
    const read=vi.fn(async()=>new Response('{}',{status:502}));
    await expect(createGenerationPricing(store,read).admit(request())).rejects.toMatchObject({statusCode:502});expect(store.snapshot().batches).toHaveLength(0);
  });
  it('quotes regeneration but does not reprice a local save retry',async()=>{
    const read=transport(),service=createGenerationPricing(store,read),accepted=await service.admit(request());
    const a=accepted.batch.attempts[0];store.put('attempt',a.id,{...a,status:'completed'});balance.balance=0;
    await expect(service.retry(a.id,a.revision)).rejects.toMatchObject({statusCode:402});expect(store.list<Attempt>('attempt')).toHaveLength(1);
    store.put('attempt',a.id,{...a,status:'failed',step:'保存失败'});const before=read.mock.calls.length;
    expect((await service.retry(a.id,a.revision)).status).toBe('saving');expect(read).toHaveBeenCalledTimes(before);
  });
  it('atomically admits a successful regeneration using current model configuration and preserves historical snapshots',async()=>{
    const service=createGenerationPricing(store,transport()),accepted=await service.admit(request());
    const a=accepted.batch.attempts[0];store.put('attempt',a.id,{...a,status:'completed',model:{...a.model,provider:'simulator'}});
    const next=await service.retry(a.id,a.revision,'新提示词',.0858);
    expect(next).toMatchObject({attemptNumber:2,status:'queued',prompt:'新提示词',reservedCost:.0858,model:{provider:'chuhe'}});
    expect(store.get<Attempt>('attempt',next.id)).toEqual(next);
    expect(store.get<Attempt>('attempt',a.id)?.model.provider).toBe('simulator');
    await expect(service.retry(a.id,a.revision,undefined,.0858)).rejects.toThrow('未结束的尝试');
  });
  it('requires confirmation of the current regeneration upper bound without creating an attempt on refusal',async()=>{
    const service=createGenerationPricing(store,transport()),accepted=await service.admit(request());
    const a=accepted.batch.attempts[0];store.put('attempt',a.id,{...a,status:'completed'});
    expect((await service.retryQuote(a.id,a.revision)).maximum).toBe(.0858);
    await expect(service.retry(a.id,a.revision)).rejects.toMatchObject({statusCode:409});
    prices=pricing([group({base_price:.2})]);
    await expect(service.retry(a.id,a.revision,undefined,.0858)).rejects.toMatchObject({statusCode:409});
    expect(store.list<Attempt>('attempt')).toHaveLength(1);
    expect(store.get<Attempt>('attempt',a.id)?.status).toBe('completed');
  });
  it('does not charge an already bound dependency image twice',async()=>{
    prices=pricing([group({input_image_price:.03,input_image_free_count:0})]);
    const plan=compilePlan(store,'image-generate',draft());
    store.put('attempt','white-result',{id:'white-result',assetId:'example-6-1'});
    const quote=await createPricingService(store,transport()).quote([{...plan.items[0],references:['example-6-1'],dependencyTaskId:'white-result'}]);
    expect(quote.maximum).toBe(.13);
  });
  it('requires local session and computes the quote on the server instead of trusting browser prices',async()=>{
    const read=transport(),app=await createApp(store,{worker:false,providerTransport:read});
    try{
      expect((await app.inject({method:'POST',url:'/api/generation/estimate',payload:{}})).statusCode).toBe(403);
      const token=(await app.inject('/api/bootstrap')).json().token,headers={'x-studio-token':token};
      const estimate=await app.inject({method:'POST',url:'/api/generation/estimate',headers,payload:{skillId:'image-generate',draft:draft(),minimum:0,maximum:0}});expect(estimate.json().maximum).toBe(.0858);
      const r=request();balance.balance=0;const result=await app.inject({method:'POST',url:'/api/submit',headers,payload:{...r,quote:{affordable:true,balance:999999,maximum:0}}});expect(result.statusCode).toBe(402);expect(store.snapshot().batches).toHaveLength(0);
    }finally{await app.close();}
  });
});
