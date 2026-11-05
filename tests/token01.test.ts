import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {credentialVault} from '../apps/server/credentials';
import {createToken01Service,token01ItemPrice} from '../apps/server/token01';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {createMediaWorker} from '../apps/server/media-worker';
import {compilePlan,retryAttempt} from '../apps/server/engine';
import {createApp} from '../apps/server/app';
import {defaultDraft,type Attempt,type Asset,type PlanItem} from '../packages/contracts';
import {token01ModelIds,token01Models} from '../packages/token01';
import type {ProviderTransport} from '../apps/server/provider';
import catalog from './fixtures/token01-pricing.json';
let s:Store,dir:string;
const key='sk-token01-isolated-test-1234567890';
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'token01-'));s=createStore(dir,process.cwd());credentialVault(dir).setMany([...token01ModelIds],key);});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
function draft(id='minimax-h3-fast'){
 const d=defaultDraft(s.skills().find(x=>x.id==='video-generate')!,s.models()),m=s.models().find(x=>x.id===id)!;
 return {...d,modelId:id,duration:4,requirements:'阳光下的服装展示，镜头缓缓推近',parameters:Object.fromEntries(Object.entries(m.parameters).map(([k,v])=>[k,v.default??'']))};
}
function item(id='minimax-h3-fast',parameters:Record<string,unknown>={},references:string[]=[]):PlanItem{return {...compilePlan(s,'video-generate',draft(id)).items[0],parameters:{resolution:'768p',duration:5,aspectRatio:'9:16',referenceMode:'reference',...parameters},references};}
const get=(id:string)=>s.get<Attempt>('attempt',id)!;
function transport(handler?:ProviderTransport):ProviderTransport{return vi.fn(async(url,init)=>{
 expect(new URL(url).origin).toBe('https://www.token01.net');
 if(url.endsWith('/api/pricing')){expect(init.headers).not.toHaveProperty('Authorization');return Response.json(catalog);}
 expect(init.headers).toMatchObject({Authorization:`Bearer ${key}`});
 if(url.endsWith('/v1/models'))return Response.json({data:token01Models.map(m=>({id:m.upstreamId}))});
 if(handler)return handler(url,init);throw Error('Unexpected '+url);
});}
async function accept(read:ProviderTransport,d=draft()){
 const p=compilePlan(s,'video-generate',d);
 return (await createGenerationPricing(s,read).admit({skillId:'video-generate',draft:d,action:'generate',expectedDraftRevision:0,planHash:p.hash,maximumCost:100,idempotencyKey:crypto.randomUUID()})).batch.attempts[0];
}
describe('Token01 model adapter and independent billing',()=>{
 it('maps exact model names, integer durations, and independent pricing including overrides and free images',()=>{
  expect(token01Models.map(m=>m.upstreamId)).toEqual(['MiniMax-H3-Fast','MiniMax-H3']);
  expect(token01ItemPrice(item(),catalog)).toMatchObject({minimum:.2,maximum:.4});
  expect(token01ItemPrice(item('minimax-h3-fast',{resolution:'480p'}),catalog)).toMatchObject({minimum:.2,maximum:.25});
  expect(token01ItemPrice(item('minimax-h3-fast',{resolution:'1080p'}),catalog)).toMatchObject({minimum:.3,maximum:.3});
  expect(token01ItemPrice(item('minimax-h3',{},Array(7).fill('ref')),catalog)).toMatchObject({minimum:.6096,maximum:2.54});
  expect(token01ItemPrice(item('minimax-h3',{resolution:'2k'}),catalog)).toMatchObject({minimum:.96,maximum:4});
  expect(()=>token01ItemPrice(item('minimax-h3-fast',{resolution:'480p',referenceMode:'first-frame'},['a']),catalog)).toThrow('没有支持');
  expect(()=>compilePlan(s,'video-generate',{...draft(),parameters:{resolution:'768p',referenceMode:'first-last-frame'}})).toThrow('需要两张');
  expect(()=>token01ItemPrice(item('minimax-h3-fast',{duration:3}),catalog)).toThrow('不支持');
 });
 it('does not infer a wallet or spendable balance, and fails closed when the key cannot access the exact model',async()=>{
  const client=createToken01Service(s,transport());
  expect(await client.quote([item()])).toMatchObject({balance:null,available:null,keyRemaining:null,unit:'元',provider:'token01',minimum:.2,maximum:.4});
  const hidden=transport(async()=>Response.json({data:[]}));
  const noModels:ProviderTransport=(url,init)=>url.endsWith('/v1/models')?Promise.resolve(Response.json({data:[{id:'minimax-h3-fast'}]})):hidden(url,init);
  await expect(createToken01Service(s,noModels).quote([item()])).rejects.toThrow('未开通');
 });
 it('keeps legacy unified credentials, Token01 credentials and key revisions isolated',async()=>{
  const app=await createApp(s,{worker:false,providerTransport:transport()});
  try{
   const token=(await app.inject('/api/bootstrap')).json().token,headers={'x-studio-token':token};
   const before=credentialVault(dir).current('minimax-h3');
   expect((await app.inject({method:'PUT',url:'/api/credentials/unified',headers,payload:{key:'sk-legacy-test-123456789012345'}})).statusCode).toBe(200);
   const vault=credentialVault(dir),legacy=vault.current('tt-image');expect(vault.current('minimax-h3')).toBe(before);
   expect((await app.inject({method:'PUT',url:'/api/credentials/token01',headers,payload:{key}})).json()).toEqual({configured:2});
   expect(vault.current('tt-image')).toBe(legacy);expect(vault.current('minimax-h3')).not.toBe(before);
   const response=await app.inject({method:'POST',url:'/api/credentials/token01/check',headers,payload:{}});expect(response.json().models.every((m:{available:boolean})=>m.available)).toBe(true);expect(response.body).not.toContain(key);
  }finally{await app.close();}
 });
 it('maps signed uploaded images into distinct reference and frame protocols',async()=>{
  const a=s.list<Asset>('asset').find(a=>a.type==='image'&&a.source==='example')!;
  const read=transport(async(url,init)=>{expect(url).toContain('/v1/uploads/images');expect(init.body).toBeInstanceOf(FormData);expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);return Response.json({url:'https://cdn.example/signed.png?token=secret&expires=12'});});
  const client=createToken01Service(s,read),version=credentialVault(dir).current('minimax-h3')!,url=await client.upload('minimax-h3',version,a);
  expect(url).toBe('https://cdn.example/signed.png?token=secret&expires=12');
  expect(client.body(item('minimax-h3',{referenceMode:'first-last-frame'},['a','b']),[url,'https://cdn.example/end.png'])).toMatchObject({model:'MiniMax-H3',size:'768P',duration:5,metadata:{parameters:{ratio:'9:16'}},first_frame_url:url,last_frame_url:'https://cdn.example/end.png'});
  const body=client.body(item('minimax-h3-fast',{},['a']),[url]);expect(body).toMatchObject({model:'MiniMax-H3-Fast',resolution:'768p',ratio:'9:16',reference_images:[url]});expect(body).not.toHaveProperty('first_frame_url');
 });
 it('does not send a paid request if image upload is unavailable',async()=>{
  const read=transport(async(url)=>{expect(url).toContain('/v1/uploads/images');return Response.json({message:'upload unavailable'},{status:503});});
  const d=draft();d.inputRoles={references:['example-6-1']};const a=await accept(read,d),worker=createMediaWorker(s,{transport:read,pollMs:0});await worker.tick();
  expect(get(a.id)).toMatchObject({status:'failed',step:'Token01 提交前检查失败'});expect((read as ReturnType<typeof vi.fn>).mock.calls.some(([u])=>String(u).endsWith('/v1/video/generations'))).toBe(false);
 });
 it('submits once, persists the public id, ignores 100% queued progress, and downloads with the original credential',async()=>{
  let paid=0,queries=0;const bytes=fs.readFileSync('public/examples/demo-portrait-4.mp4');
  const read=transport(async(url,init)=>{
   if(init.method==='POST'){paid++;const current=s.list<Attempt>('attempt')[0];expect(current.step).toContain('提交真实');expect(current.upstreamTaskId).toBeUndefined();expect(JSON.parse(String(init.body))).toMatchObject({model:'MiniMax-H3-Fast',duration:4,resolution:'768p',ratio:'9:16'});return Response.json({id:5189,task_id:'task_public',status:'queued'},{headers:{'X-Task-Id':'internal-not-public'}});}
   expect(get(s.list<Attempt>('attempt')[0].id).upstreamTaskId).toBe('task_public');
   if(url.endsWith('/content'))return new Response(bytes,{headers:{'Content-Type':'video/mp4'}});
   queries++;return Response.json({code:'success',data:{id:5189,task_id:'task_public',status:queries===1?'QUEUED':'SUCCESS',progress:'100%',result_url:'https://malicious.example/collect-key'}});
  });
  const a=await accept(read),w=createMediaWorker(s,{transport:read,pollMs:0,remote:async()=>{throw Error('Must not use external result URL');}});await w.tick();credentialVault(dir).set('minimax-h3-fast','sk-rotated-token01-123456789012345');await w.tick();expect(get(a.id).status).toBe('generating');expect(get(a.id).assetId).toBeUndefined();await w.tick();
  expect(paid).toBe(1);expect(get(a.id)).toMatchObject({status:'completed',upstreamTaskId:'task_public',credentialVersion:a.credentialVersion,billing:{isFinal:false,unit:'元'}});expect(get(a.id).billing?.cost).toBeUndefined();expect(s.snapshot().ledger[0]).toMatchObject({unit:'元',points:null});expect(get(a.id).nextPollAt).toBeUndefined();
 });
 it.each([
  {id:5189,task_id:'task_other'},
  {id:'task_public',task_id:'task_other'},
  {id:'task_other'},
  {task_id:5189},
  {task_id:null},
 ])('rejects mismatched public task identifiers: %j',async identifiers=>{
  const client=createToken01Service(s,transport(async()=>Response.json({code:'success',data:{...identifiers,status:'SUCCESS'}})));
  await expect(client.task('minimax-h3-fast',credentialVault(dir).current('minimax-h3-fast')!,'task_public')).rejects.toThrow('任务号不匹配');
 });
 it('accepts the OpenAI public id when task_id is absent',async()=>{
  const client=createToken01Service(s,transport(async()=>Response.json({id:'task_public',status:'succeeded'})));
  await expect(client.task('minimax-h3-fast',credentialVault(dir).current('minimax-h3-fast')!,'task_public')).resolves.toMatchObject({status:'succeeded'});
 });
 it.each(['disconnect','header-only'])('never resubmits an ambiguous %s response after restart',async mode=>{
  let paid=0;const read=transport(async()=>{paid++;if(mode==='disconnect')throw Error('connection reset');return new Response('bad',{status:502,headers:{'X-Task-Id':'internal-id'}});});const a=await accept(read),w=createMediaWorker(s,{transport:read});await w.tick();expect(get(a.id).status).toBe('pending_verification');expect(get(a.id).upstreamTaskId).toBeUndefined();s.close();s=createStore(dir,process.cwd());const reopened=createMediaWorker(s,{transport:read});reopened.start();await reopened.tick();await reopened.stop();expect(paid).toBe(1);
 });
 it('retries saving without another generation and rejects non-video download content',async()=>{
  let paid=0,broken=true;const read=transport(async(url,init)=>{if(init.method==='POST'){paid++;return Response.json({id:'task_save'});}if(url.endsWith('/content'))return broken?Response.json({url:'not-a-video'}):new Response(fs.readFileSync('public/examples/demo-portrait-4.mp4'));return Response.json({code:'success',data:{status:'SUCCESS'}});});
  const a=await accept(read),w=createMediaWorker(s,{transport:read,pollMs:0});await w.tick();await w.tick();expect(get(a.id)).toMatchObject({status:'failed',step:'保存失败'});broken=false;retryAttempt(s,a.id,get(a.id).revision);await w.tick();expect(get(a.id).status).toBe('completed');expect(paid).toBe(1);
 });
 it('records terminal failure without fabricated cost or refund and redacts upstream keys',async()=>{
  const read=transport(async(_url,init)=>init.method==='POST'?Response.json({id:'task_failed'}):Response.json({code:'success',data:{status:'FAILURE',fail_reason:'invalid '+key}}));const a=await accept(read),w=createMediaWorker(s,{transport:read,pollMs:0});await w.tick();await w.tick();expect(get(a.id).status).toBe('failed');expect(get(a.id).error).not.toContain(key);expect(get(a.id).billing).toMatchObject({unit:'元',isFinal:false});expect(get(a.id).billing?.refunded).toBeUndefined();expect(get(a.id).billing?.cost).toBeUndefined();
 });
});
