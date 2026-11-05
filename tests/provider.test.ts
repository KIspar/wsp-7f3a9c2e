import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {credentialVault} from '../apps/server/credentials';
import {createProviderService,taskSettlement,redactProvider} from '../apps/server/provider';
import {createApp} from '../apps/server/app';
import {createAnalysisService} from '../apps/server/analysis';
import {providerTime,usageQuerySchema} from '../packages/provider';
import fixtures from './fixtures/provider.json';
import type {AnalysisInput} from '../packages/analysis';
import {chuheChannelRoutable} from '../packages/chuhe-routing';
const tt='sk-test-tt-12345678901234567890',gem='sk-test-gem-12345678901234567890';
let dir:string,store:Store;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-provider-'));store=createStore(dir,process.cwd());const vault=credentialVault(dir);vault.set('tt-6.1-sol',tt);vault.set('gem-3.8-flash',gem);});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
const json=(data:unknown)=>new Response(JSON.stringify(data));
function mock(){return vi.fn(async(raw:string)=>{const url=new URL(raw);const key=url.pathname.endsWith('/balance')?'balance':url.pathname.endsWith('/key')?'key':url.pathname.endsWith('/usage')?(url.searchParams.get('detail')==='1'?'records':'usage'):url.pathname.endsWith('/task-status')?'task':url.pathname.endsWith('/pricing')?'pricing':url.pathname.endsWith('/-')?'model':'models';return json(fixtures[key]);});}
describe('read-only provider queries',()=>{
 it('maps all seven queries to fixed upstream GET endpoints and isolates saved credentials',async()=>{
  const transport=mock(),s=createProviderService(store,transport);
  const responses=await Promise.all([s.balance('tt-6.1-sol'),s.keyInfo('gem-3.8-flash'),s.usage(usageQuerySchema.parse({credentialId:'tt-6.1-sol',scope:'user',days:7,detail:'1',limit:20,offset:20})),s.models('tt-6.1-sol','audio'),s.modelDetail('tt-6.1-sol','kimi/kimi-k2.7-code'),s.modelPricing('tt-6.1-sol','kimi/kimi-k2.7-code'),s.task('tt-6.1-sol','123')]);
  expect(responses).toHaveLength(7);expect(transport).toHaveBeenCalledTimes(7);
  for(const [raw,init] of transport.mock.calls as unknown as [string,RequestInit][]){const u=new URL(raw);expect(u.origin).toBe('https://api.lk888.ai');expect(init.method).toBe('GET');expect(init.redirect).toBe('error');expect((init.headers as any)['Accept-Language']).toBe('zh-CN');expect((init.headers as any).Authorization).toBe('Bearer '+(u.pathname.endsWith('/key')?gem:tt));expect(init.body).toBeUndefined();}
  const urls=transport.mock.calls.map(c=>new URL(c[0]));expect(urls[2].searchParams.get('scope')).toBe('user');expect(urls[2].searchParams.get('offset')).toBe('20');expect(urls[3].searchParams.get('type')).toBe('audio');expect(urls[4].pathname).toBe('/v1/skills/models/-');expect(urls[4].searchParams.get('model')).toBe('kimi/kimi-k2.7-code');expect(urls[5].searchParams.has('status')).toBe(false);
  expect((responses[0].data as any).api_key_quota).toEqual({limit:0,used:2.345});expect(JSON.stringify(responses)).not.toContain('sk-');
 });
 it('retains complete paused pricing, time/video/rule metadata without changing local model points',async()=>{
  const before=store.models(),s=createProviderService(store,mock());const r=await s.modelPricing('tt-6.1-sol','tt-6.1-sol');expect(r.data).toEqual(fixtures.pricing);expect(store.models()).toEqual(before);
 });
 it.each([
  {effective:true,status:'offline',excluded:false,whitelisted:true,forced:true,allowed:true},
  {effective:false,status:'offline',excluded:false,whitelisted:true,forced:true,allowed:false},
  {effective:true,status:'offline',excluded:false,whitelisted:true,forced:false,allowed:false},
  {effective:true,status:'removed',excluded:false,whitelisted:true,forced:true,allowed:false},
  {effective:true,status:'offline',excluded:true,whitelisted:true,forced:true,allowed:false},
  {effective:true,status:'offline',excluded:false,whitelisted:false,forced:true,allowed:false},
 ])('honors forced calling only from effective key configuration %j',async row=>{
  const vault=credentialVault(dir),version=vault.current('tt-6.1-sol')!;vault.set('tt-6.1-sol',gem);
  const transport=vi.fn(async(url:string,init:RequestInit)=>{
   expect(init.method).toBe('GET');expect((init.headers as Record<string,string>).Authorization).toBe('Bearer '+tt);
   return json(url.endsWith('/key')?{...fixtures.key,custom_groups_in_effect:row.effective,custom_groups:[{model:'tt-6.1-sol',group_ids:[11],force_group_ids:row.forced?[11]:[],groups:[{group_id:11,group_name:'test',status:row.status}]}]}:{available_for_this_key:false,channel_groups:[{...fixtures.pricing.channel_groups[0],is_active:false,configuredForceCall:true,in_key_whitelist:row.whitelisted,excluded_for_this_key:row.excluded}]});
  });
  const result=await createProviderService(store,transport).routingPricing('tt-6.1-sol','tt-6.1-sol',version);
  expect(chuheChannelRoutable(result.data.channel_groups[0])).toBe(row.allowed);
  expect(result.data.available_for_this_key).toBe(row.allowed);
  expect(transport.mock.calls.every(([url])=>url.endsWith('/key')||url.includes('/pricing'))).toBe(true);
 });
 it('stops routing estimates when the forced calling configuration cannot be verified',async()=>{
  const transport=vi.fn(async(url:string)=>url.endsWith('/key')?new Response('',{status:503}):json({available_for_this_key:true,channel_groups:[{...fixtures.pricing.channel_groups[0],is_active:false}]}));
  await expect(createProviderService(store,transport).routingPricing('tt-6.1-sol','tt-6.1-sol')).rejects.toThrow('供应商查询失败');
  expect(transport).toHaveBeenCalledTimes(2);
 });
 it('strips masked credentials, nested sensitive fields, and plaintext echoes',()=>{
  expect(redactProvider({api_key:tt,nested:{authorization:tt,key:gem,retained:12},text:'echo '+tt},tt)).toEqual({nested:{retained:12},text:'echo [密钥已隐藏]'});
 });
 it('uses explicit dates instead of days; summary omits detail pagination',async()=>{
  const transport=mock(),s=createProviderService(store,transport);await s.usage(usageQuerySchema.parse({credentialId:'tt-6.1-sol',start_time:'2026-10-01T00:00:00+08:00',end_time:'2026-10-30T23:59:59+08:00',model:'tt-6.1-sol'}));const u=new URL(transport.mock.calls[0][0]);expect(u.searchParams.has('days')).toBe(false);expect(u.searchParams.has('limit')).toBe(false);expect(u.searchParams.get('model')).toBe('tt-6.1-sol');
 });
 it.each([{days:31},{start_time:'2026-10-01'},{start_time:'2026-10-30',end_time:'2026-10-01'},{start_time:'2026-09-01',end_time:'2026-10-28'},{start_time:'2026-02-30',end_time:'2026-03-01'},{limit:201},{offset:-1},{scope:'all'}])('rejects invalid usage input %j',patch=>{expect(usageQuerySchema.safeParse({credentialId:'tt-6.1-sol',...patch}).success).toBe(false);});
 it('interprets local dates in Asia/Shanghai and rejects impossible times',()=>{expect(providerTime('2026-10-28')).toBe(Date.parse('2026-10-28T00:00:00+08:00'));expect(Number.isNaN(providerTime('2026-10-28T24:00:00'))).toBe(true);});
 it.each([401,403,404,429,500])('sanitizes HTTP %s without replaying or leaking the response',async status=>{const transport=vi.fn(async()=>new Response(tt,{status}));await expect(createProviderService(store,transport).balance('tt-6.1-sol')).rejects.toThrow(/供应商|查询/);expect(transport).toHaveBeenCalledTimes(1);});
 it.each(['invalid','[]','{}','{"data":{"balance":1}}','{"models":{},"total":1}'])('rejects invalid JSON or endpoint shape %s',async body=>{await expect(createProviderService(store,async()=>new Response(body)).models('tt-6.1-sol')).rejects.toThrow('格式异常');});
 it('rejects oversized data and connection failure without leaking upstream errors',async()=>{
  await expect(createProviderService(store,async()=>new Response(' '.repeat(8*1024*1024+1))).balance('tt-6.1-sol')).rejects.toThrow('内容过大');await expect(createProviderService(store,async()=>{throw Error(tt);}).balance('tt-6.1-sol')).rejects.toThrow('暂时无法连接');
 });
 it('rejects missing credentials before network, but permits read queries when analysis is disabled',async()=>{
  const transport=mock(),s=createProviderService(store,transport);fs.unlinkSync(path.join(dir,'private/credentials.json'));await expect(s.balance('tt-6.1-sol')).rejects.toThrow('尚未配置');expect(transport).not.toHaveBeenCalled();createAnalysisService(store).configure('tt-6.1-sol',{key:tt,enabled:false});await s.balance('tt-6.1-sol');expect(transport).toHaveBeenCalledTimes(1);
 });
 it('validates routes before network and retains local origin/session protection',async()=>{
  const transport=mock(),app=await createApp(store,{worker:false,providerTransport:transport});try{
   for(const url of ['/api/provider/task?credentialId=tt-6.1-sol&taskId=abc','/api/provider/models?credentialId=tt-6.1-sol&type=music','/api/provider/balance?credentialId=untrusted','/api/provider/usage?credentialId=tt-6.1-sol&days=31'])expect((await app.inject(url)).statusCode).toBe(400);
   expect(transport).not.toHaveBeenCalled();expect((await app.inject({url:'/api/provider/balance?credentialId=tt-6.1-sol',headers:{origin:'https://evil.example'}})).statusCode).toBe(403);
   const r=await app.inject('/api/provider/balance?credentialId=tt-6.1-sol&key=evil&url=https://evil.example');expect(r.statusCode).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect((transport.mock.calls as any)[0][1].headers.Authorization).toBe('Bearer '+tt);
   expect((await app.inject('/api/provider/key?credentialId=gem-3.8-flash')).body).not.toContain('api_key');expect((await app.inject({method:'POST',url:'/api/provider/key'})).statusCode).toBe(403);
  }finally{await app.close();}
 });
 it('saves one unified credential for every media and analysis model without returning it',async()=>{
  const app=await createApp(store,{worker:false});try{
   const token=(await app.inject('/api/bootstrap')).json().token;
   const response=await app.inject({method:'PUT',url:'/api/credentials/unified',headers:{'x-studio-token':token},payload:{key:'sk-unified-test-12345678901234567890'}});
   expect(response.statusCode).toBe(200);expect(response.json().configured).toBeGreaterThanOrEqual(6);expect(response.body).not.toContain('sk-unified');
   const vault=credentialVault(dir);for(const id of ['tt-image','omni','gk-video-3.5','tt-6.1-sol','gem-3.8-flash','gem-4-argon'])expect(vault.current(id)).toBeTruthy();
   expect(vault.get('gem-4-argon',vault.current('gem-4-argon')!)).toBe('sk-unified-test-12345678901234567890');
  }finally{await app.close();}
 });
 it('uses authoritative terminal state, net-zero refunded cost and unknown missing tokens',()=>{
  expect(taskSettlement({state:'success',is_final:false,cost:.5}).terminal).toBe(false);
  expect(taskSettlement({state:'failed',is_final:true,cost:0,refunded:true,refunded_amount:.5})).toMatchObject({terminal:true,cost:0,refunded:true,refundedAmount:.5,inputTokens:undefined,outputTokens:undefined});expect(taskSettlement({state:'pending',cost:null}).cost).toBeUndefined();
  expect(taskSettlement({state:'completed',status:'video_generation_completed',is_final:true}).succeeded).toBe(true);
  expect(taskSettlement({state:'error',status:'video_generation_failed',is_final:true}).failed).toBe(true);
 });
 it('recovers unknown analysis by GET ai_reply and stops once final without another paid POST',async()=>{
  let pending=true;const transport=vi.fn(async(_url:string,init:RequestInit)=>init.method==='POST'?new Response('unreadable',{status:502,headers:{'X-Task-Id':'123'}}):json({...fixtures.task,state:pending?'running':'success',is_final:!pending}));const s=createAnalysisService(store,transport);const input:AnalysisInput={action:'polish',text:'原文',productName:'商品',assetIds:[],idempotencyKey:crypto.randomUUID()};const j=s.submit(input);s.tick();await s.idle();expect(s.job(j.id).status).toBe('unknown');expect(s.job(j.id).billing.status).toBe('pending');pending=false;await s.reconcile(j.id);expect(s.job(j.id).status).toBe('completed');expect(s.job(j.id).result).toBe(fixtures.task.ai_reply);const count=transport.mock.calls.length;await s.reconcile(j.id);expect(transport).toHaveBeenCalledTimes(count);expect(transport.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(1);
 });
 it('records terminal failed refund net cost zero without losing previous result',async()=>{
  const transport=vi.fn(async(_url:string,init:RequestInit)=>init.method==='POST'?new Response(JSON.stringify({choices:[{message:{content:'已完成的候选内容'}}]}),{headers:{'X-Task-Id':'124'}}):json({...fixtures.task,state:'failed',is_final:true,cost:0,refunded:true,refunded_amount:.5,error_code:'upstream_failed'}));const s=createAnalysisService(store,transport);const j=s.submit({action:'polish',text:'原文',productName:'',assetIds:[],idempotencyKey:crypto.randomUUID()});s.tick();await s.idle();expect(s.job(j.id).result).toBe('已完成的候选内容');expect(s.job(j.id).billing).toMatchObject({status:'final',cost:0,refunded:true,refundedAmount:.5,errorCode:'upstream_failed'});
 });
});
