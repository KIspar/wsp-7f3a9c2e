import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {createRelayService,relayModelAvailable} from '../apps/server/relays';
import {credentialVault} from '../apps/server/credentials';
import {compilePlan} from '../apps/server/engine';
import {defaultDraft} from '../packages/contracts';
import {createApp} from '../apps/server/app';
import type {ProviderTransport} from '../apps/server/provider';
import providerFixture from './fixtures/provider.json';
const legacy='sk-relay-legacy-test-123456789012345',token='sk-relay-token01-test-123456789012345';
let s:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-models-'));s=createStore(dir,process.cwd());});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
describe('中转站密钥与可用模型同步',()=>{
 it('keeps one key per relay, shares it with media and analysis, and preserves old task credential versions',async()=>{
  const vault=credentialVault(dir),old=vault.set('tt-image',legacy),read=vi.fn<ProviderTransport>(async(url,init)=>{
   expect(init.method).toBe('GET');expect(init.headers).toMatchObject({Authorization:'Bearer '+(url.includes('token01')?token:legacy)});
   if(url.endsWith('/key'))return Response.json(providerFixture.key);
   return url.includes('token01')?Response.json({data:[{id:'MiniMax-H3'},{id:'unsupported-model'}]}):Response.json({total:4,models:[{name:'tt-image-2.5',type:'image',available_for_this_key:true},{name:'omni-flash',type:'video',available_for_this_key:false},{name:'tt-6.1-sol',type:'chat',available_for_this_key:true},{name:'unknown-allowed',type:'video',available_for_this_key:true}]});
  });
  const service=createRelayService(s,read);service.save('chuhe',legacy);service.save('token01',token);
  expect(vault.get('tt-image',old)).toBe(legacy);
  expect(vault.get('gem-4-argon',vault.current('gem-4-argon')!)).toBe(legacy);
  expect(vault.get('minimax-h3-fast',vault.current('minimax-h3-fast')!)).toBe(token);
  expect(await service.sync('chuhe')).toMatchObject({status:'ready',modelIds:['tt-image','tt-6.1-sol'],discovered:3});
  expect(await service.sync('token01')).toMatchObject({status:'ready',modelIds:['minimax-h3'],discovered:2});
  expect(relayModelAvailable(s,'omni')).toBe(false);expect(relayModelAvailable(s,'minimax-h3-fast')).toBe(false);
  expect(JSON.stringify(service.list())).not.toContain('sk-');expect(JSON.stringify(service.list())).not.toContain('signature');
 });
 it.each([
  {forced:true,excluded:false,status:'offline',allowed:true},
  {forced:false,excluded:false,status:'offline',allowed:false},
  {forced:true,excluded:true,status:'offline',allowed:false},
  {forced:true,excluded:false,status:'removed',allowed:false},
 ])('rechecks a catalog denial against effective forced routing %j',async row=>{
  const service=createRelayService(s,async(url,init)=>{
   expect(init.method).toBe('GET');
   if(url.endsWith('/models'))return Response.json({total:1,models:[{name:'gem-4-argon',type:'chat',available_for_this_key:false}]});
   if(url.endsWith('/key'))return Response.json({...providerFixture.key,custom_groups_in_effect:true,custom_groups:[{model:'gem-4-argon',group_ids:[11],force_group_ids:row.forced?[11]:[],groups:[{group_id:11,group_name:'test',status:row.status}]}]});
   return Response.json({available_for_this_key:false,channel_groups:[{...providerFixture.pricing.channel_groups[0],is_active:false,excluded_for_this_key:row.excluded}]});
  });
  service.save('chuhe',legacy);expect((await service.sync('chuhe')).modelIds).toEqual(row.allowed?['gem-4-argon']:[]);
  expect(relayModelAvailable(s,'gem-4-argon')).toBe(row.allowed);
 });
 it('checks explicit pricing admission when a legacy catalog omits key permissions',async()=>{
  const read=vi.fn<ProviderTransport>(async(url)=>url.endsWith('/models')?Response.json({total:3,models:[{name:'tt-image-2.5',type:'image'},{name:'omni-flash',type:'video'},{name:'gk-video-3.5',type:'video',available_for_this_key:false}]}):url.endsWith('/key')?Response.json({id:1,name:'test',status:1,strategy:'自定义',limit:0,used:0,api_edit_allowed:false,custom_groups:[],custom_groups_in_effect:true}):Response.json({available_for_this_key:true,channel_groups:[{group_id:1,group_name:'route',is_active:url.includes('tt-image-2.5'),in_key_whitelist:true,excluded_for_this_key:false}]}));
  const service=createRelayService(s,read);service.save('chuhe',legacy);expect((await service.sync('chuhe')).modelIds).toEqual(['tt-image']);expect(read).toHaveBeenCalledTimes(4);
 });
 it('clears old availability on denied or failed synchronization and persists the failure across restart',async()=>{
  let failed=false;const service=createRelayService(s,async()=>failed?Response.json({error:{message:'invalid '+token}},{status:401}):Response.json({data:[{id:'MiniMax-H3-Fast'}]}));
  service.save('token01',token);await service.sync('token01');failed=true;await expect(service.sync('token01')).rejects.toMatchObject({statusCode:401});
  expect(service.list().find(r=>r.id==='token01')).toMatchObject({status:'error',modelIds:[]});expect(JSON.stringify(service.list())).not.toContain(token);expect(relayModelAvailable(s,'minimax-h3-fast')).toBe(false);
  s.close();s=createStore(dir,process.cwd());expect(createRelayService(s).list().find(r=>r.id==='token01')?.status).toBe('error');
 });
 it('does not let a response for an old key restore stale models after a key rotation',async()=>{
  let finish!:(response:Response)=>void;const service=createRelayService(s,async()=>new Promise<Response>(resolve=>{finish=resolve;}));
  service.save('token01',token);const stale=service.sync('token01');service.save('token01','sk-relay-rotated-token-123456789012345');finish(Response.json({data:[{id:'MiniMax-H3'}]}));
  await expect(stale).rejects.toMatchObject({statusCode:409});expect(service.list().find(r=>r.id==='token01')).toMatchObject({status:'idle',modelIds:[]});
 });
 it('coalesces concurrent synchronization and preserves a user-disabled model without rotating credentials',async()=>{
  const read=vi.fn<ProviderTransport>(async()=>Response.json({data:[{id:'MiniMax-H3'}]})),service=createRelayService(s,read);service.save('token01',token);
  const vault=credentialVault(dir),version=vault.current('minimax-h3'),m=s.models().find(m=>m.id==='minimax-h3')!;s.put('model',m.id,{...m,enabled:false});
  await Promise.all([service.sync('token01'),service.sync('token01')]);expect(read).toHaveBeenCalledTimes(1);expect(vault.current('minimax-h3')).toBe(version);expect(s.models().find(row=>row.id===m.id)?.enabled).toBe(false);expect(relayModelAvailable(s,'minimax-h3')).toBe(true);
 });
 it('adopts legacy credentials once while preserving older task snapshots',async()=>{
  const vault=credentialVault(dir),old=vault.set('omni','sk-previous-task-version-123456789012345');vault.set('tt-image',legacy);
  const service=createRelayService(s,async()=>Response.json({total:1,models:[{name:'omni-flash',type:'video',available_for_this_key:true}]}));
  expect(service.list().find(r=>r.id==='chuhe')).toMatchObject({configured:true,status:'idle'});await service.sync('chuhe');expect(relayModelAvailable(s,'omni')).toBe(true);
  expect(vault.get('omni',vault.current('omni')!)).toBe(legacy);expect(vault.get('omni',old)).toBe('sk-previous-task-version-123456789012345');
 });
 it('exposes only synchronized available models to configuration and rejects unsupported direct generation',async()=>{
  const read=vi.fn<ProviderTransport>(async()=>Response.json({data:[{id:'MiniMax-H3'}]})),app=await createApp(s,{worker:false,providerTransport:read});
  try{
   const boot=(await app.inject('/api/bootstrap')).json(),headers={'x-studio-token':boot.token};
   expect((await app.inject({method:'POST',url:'/api/relays/token01/sync',payload:{}})).statusCode).toBe(403);
   expect((await app.inject({method:'PUT',url:'/api/relays/token01/credential',headers,payload:{key:token}})).json()).toMatchObject({configured:true,status:'idle',modelIds:[]});
   const response=await app.inject({method:'POST',url:'/api/relays/token01/sync',headers,payload:{}});expect(response.json()).toMatchObject({modelIds:['minimax-h3'],status:'ready'});expect(response.body).not.toContain(token);
   const models=(await app.inject('/api/bootstrap')).json().models;expect(models.find((m:{id:string})=>m.id==='minimax-h3').enabled).toBe(true);expect(models.find((m:{id:string})=>m.id==='minimax-h3-fast').enabled).toBe(false);
   const d=defaultDraft(s.skills().find(x=>x.id==='video-generate')!,s.models());d.modelId='minimax-h3-fast';d.duration=4;d.parameters={resolution:'768p',referenceMode:'reference'};d.requirements='测试';expect(()=>compilePlan(s,'video-generate',d)).toThrow('中转站未确认');expect(read.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
  }finally{await app.close();}
 });
});
