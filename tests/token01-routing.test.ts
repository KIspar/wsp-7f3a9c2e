import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {createToken01Routing} from '../apps/server/token01-routing';
import {createRelayService,relayModelAvailable} from '../apps/server/relays';
import {createToken01Service,token01ItemPrice} from '../apps/server/token01';
import {createApp} from '../apps/server/app';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {createMediaWorker} from '../apps/server/media-worker';
import {credentialVault} from '../apps/server/credentials';
import {compilePlan} from '../apps/server/engine';
import {defaultDraft,type Attempt} from '../packages/contracts';
import type {ProviderTransport} from '../apps/server/provider';
import catalog from './fixtures/token01-pricing.json';
const groupKey='sk-group-we-test-123456789012345',defaultKey='sk-default-test-123456789012345';
let s:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'token01-routing-'));s=createStore(dir,process.cwd());});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
const transport:ProviderTransport=async url=>url.endsWith('/api/pricing')?Response.json(catalog):Response.json({data:[{id:'MiniMax-H3-Fast'},{id:'MiniMax-H3'}]});
const model=()=>s.models().find(model=>model.id==='minimax-h3-fast')!;
function draft(){return {...defaultDraft(s.skills().find(skill=>skill.id==='video-generate')!,s.models()),modelId:'minimax-h3-fast',duration:4,requirements:'测试视频',parameters:{resolution:'768p',referenceMode:'reference'}};}
describe('Token01 per-model group routing',()=>{
 it('derives supported model/group/resolution choices from the public catalog and saves no secrets in public state',async()=>{
  const routing=createToken01Routing(s,transport),config=await routing.config();
  expect(config.models.find(model=>model.id==='minimax-h3-fast')?.groups.find(group=>group.group==='default_we')).toMatchObject({resolutions:['768p','1080p']});
  await routing.saveGroup('default_we',groupKey);expect(JSON.stringify(await routing.config())).not.toContain(groupKey);expect(JSON.stringify(await routing.config())).not.toContain('version');
  await expect(routing.saveGroup('invented-group',groupKey)).rejects.toThrow('没有此分组');
 });
 it('shows multiplied and special per-resolution prices consistently with generation quotes',async()=>{
  const fixture=structuredClone(catalog) as any;
  fixture.data.find((row:any)=>row.model_name==='MiniMax-H3-Fast').group_off_peak={'1.0001折':[{start:'00:00',end:'08:00',tz:'Asia/Shanghai'}]};
  const config=await createToken01Routing(s,async()=>Response.json(fixture)).config();
  const h3=config.models.find(model=>model.id==='minimax-h3')!.groups.find(group=>group.group==='2.4折')!;
  expect(h3.prices).toEqual([{resolution:'768p',basePrice:.5,price:.12,specialPrice:false},{resolution:'2k',basePrice:.8,price:.192,specialPrice:false}]);
  expect(h3).toMatchObject({inputImagePrice:.0048,freeInputImages:5});
  const fast=config.models.find(model=>model.id==='minimax-h3-fast')!;
  expect(fast.groups.find(group=>group.group==='default_we')!.prices).toEqual([{resolution:'768p',basePrice:.6,price:.04,specialPrice:true},{resolution:'1080p',basePrice:.7,price:.06,specialPrice:true}]);
  const discount=fast.groups.find(group=>group.group==='1.0001折')!;
  expect(discount.prices[0]).toMatchObject({resolution:'480p',price:.05,specialPrice:false});
  expect(discount.prices[0].offPeakPrice).toBeCloseTo(.04,10);
  expect(discount.offPeakWindows).toEqual([{start:'00:00',end:'08:00',tz:'Asia/Shanghai'}]);
  expect(config.fetchedAt).toBeTruthy();
 });
 it('switches the actual model credential, keeps group selection across default-key sync, and restores the default route',async()=>{
  const vault=credentialVault(dir),relay=createRelayService(s,transport),routing=createToken01Routing(s,transport);
  relay.save('token01',defaultKey);await relay.sync('token01');const old=vault.current(model().id)!;
  await routing.saveGroup('default_we',groupKey);await routing.route(model().id,'default_we',model().revision);
  expect(vault.get(model().id,vault.current(model().id)!)).toBe(groupKey);expect(vault.get(model().id,old)).toBe(defaultKey);
  relay.save('token01',defaultKey);await relay.sync('token01');expect(vault.get(model().id,vault.current(model().id)!)).toBe(groupKey);expect(relayModelAvailable(s,model().id)).toBe(true);
  const item=compilePlan(s,'video-generate',draft()).items[0];expect(token01ItemPrice(item,catalog)).toMatchObject({minimum:.16,maximum:.16});
  expect(()=>token01ItemPrice({...item,parameters:{...item.parameters,resolution:'480p'}},catalog)).toThrow('没有支持');
  await routing.route(model().id,null,model().revision);expect(vault.get(model().id,vault.current(model().id)!)).toBe(defaultKey);expect(model().token01Group).toBeUndefined();
 });
 it('rejects model-group mismatches, unsynchronized routes, stale revisions and direct generation after permission loss',async()=>{
  let denied=false;const routing=createToken01Routing(s,async(url,init)=>url.endsWith('/v1/models')&&denied?Response.json({error:{message:'denied '+groupKey}},{status:401}):transport(url,init));
  await expect(routing.route(model().id,'default_we',model().revision)).rejects.toThrow('先在');
  await routing.saveGroup('default_we',groupKey);
  await expect(routing.route('minimax-h3','default_we',1)).rejects.toThrow('不支持');
  await expect(routing.route(model().id,'default_we',999)).rejects.toMatchObject({statusCode:409});
  await routing.route(model().id,'default_we',model().revision);denied=true;await expect(routing.syncGroup('default_we')).rejects.toMatchObject({statusCode:401});
  expect(relayModelAvailable(s,model().id)).toBe(false);expect(()=>compilePlan(s,'video-generate',draft())).toThrow('中转站未确认');expect(JSON.stringify(await routing.config())).not.toContain(groupKey);
 });
 it('uses the accepted group and credential snapshot for generation after a route change',async()=>{
  let paid=0;const read=vi.fn<ProviderTransport>(async(url,init)=>{
   if(url.endsWith('/api/pricing'))return Response.json(catalog);
   if(init.method==='POST'){paid++;expect(new Headers(init.headers).get('Authorization')).toBe('Bearer '+groupKey);return Response.json({id:'task_group'});}
   return Response.json({data:[{id:'MiniMax-H3-Fast'}]});
  });
  const routing=createToken01Routing(s,read),relay=createRelayService(s,read);relay.save('token01',defaultKey);await relay.sync('token01');await routing.saveGroup('default_we',groupKey);await routing.route(model().id,'default_we',model().revision);
  const d=draft(),plan=compilePlan(s,'video-generate',d),pricing=createGenerationPricing(s,read);
  const result=await pricing.admit({skillId:'video-generate',draft:d,action:'generate',expectedDraftRevision:0,planHash:plan.hash,maximumCost:.16,idempotencyKey:crypto.randomUUID()});
  const attempt=result.batch.attempts[0];expect(attempt.model.token01Group).toBe('default_we');
  await routing.route(model().id,null,model().revision);await createMediaWorker(s,{transport:read,pollMs:0}).tick();expect(paid).toBe(1);expect(s.get<Attempt>('attempt',attempt.id)?.upstreamTaskId).toBe('task_group');
  const quote=await createToken01Service(s,read).quote([{...attempt,index:1,variant:1}],attempt.credentialVersion);expect(quote.note).toContain('default_we');
 });
 it('guards route APIs with the local session and persists group choices across restart',async()=>{
  const app=await createApp(s,{worker:false,providerTransport:transport});try{
   const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token};
   expect((await app.inject({method:'PUT',url:'/api/token01/groups/credential',payload:{group:'default_we',key:groupKey}})).statusCode).toBe(403);
   expect((await app.inject({method:'PUT',url:'/api/token01/groups/credential',headers,payload:{group:'default_we',key:groupKey}})).statusCode).toBe(200);
   expect((await app.inject({method:'PUT',url:'/api/token01/models/minimax-h3-fast/route',headers,payload:{group:'default_we',revision:1}})).statusCode).toBe(200);
   expect((await app.inject('/api/bootstrap')).json().models.find((model:{id:string})=>model.id==='minimax-h3-fast')).toMatchObject({token01Group:'default_we',enabled:true});
  }finally{await app.close();}
  s.close();s=createStore(dir,process.cwd());expect(model().token01Group).toBe('default_we');expect(relayModelAvailable(s,model().id)).toBe(true);
 });
 it('rejects an old preview after a group change before any paid submission',async()=>{
  const read=vi.fn<ProviderTransport>(transport),routing=createToken01Routing(s,read),relay=createRelayService(s,read);
  relay.save('token01',defaultKey);await relay.sync('token01');const d=draft(),plan=compilePlan(s,'video-generate',d);
  await routing.saveGroup('default_we',groupKey);await routing.route(model().id,'default_we',model().revision);
  await expect(createGenerationPricing(s,read).admit({skillId:'video-generate',draft:d,action:'generate',expectedDraftRevision:0,planHash:plan.hash,maximumCost:100,idempotencyKey:crypto.randomUUID()})).rejects.toMatchObject({statusCode:409});
  expect(read.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
 });
 it('ignores delayed permissions from an older group key and keeps the latest profile available',async()=>{
  let finish!:(response:Response)=>void;
  const read:ProviderTransport=async(url,init)=>url.endsWith('/api/pricing')?Response.json(catalog):new Headers(init.headers).get('Authorization')==='Bearer '+groupKey?new Promise<Response>(resolve=>{finish=resolve;}):Response.json({data:[{id:'MiniMax-H3-Fast'}]});
  const routing=createToken01Routing(s,read);await routing.config();
  const stale=routing.saveGroup('default_we',groupKey);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await routing.saveGroup('default_we','sk-latest-group-test-123456789012345');finish(Response.json({data:[]}));await expect(stale).rejects.toMatchObject({statusCode:409});
  expect((await routing.config()).profiles).toMatchObject([{group:'default_we',status:'ready',modelIds:['minimax-h3-fast']}]);
 });
});
