import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore,type Store} from '../apps/server/store';
import {createApp} from '../apps/server/app';
import {createModelSetup} from '../apps/server/model-setup';
import {createRelayService,relayModelAvailable} from '../apps/server/relays';
import {createAnalysisService} from '../apps/server/analysis';
import {credentialVault} from '../apps/server/credentials';
import type {ProviderTransport} from '../apps/server/provider';
import type {SavedToken01Key} from '../apps/server/token01-keys';

const key='sk-model-setup-fixture-123456789012345';
let dir:string,s:Store;
const transport=vi.fn<ProviderTransport>(async(url,init)=>{
 expect(init.method).toBe('GET');
 if(url.endsWith('/key'))return Response.json({id:1,name:'test',status:1,strategy:'default',limit:0,used:0,api_edit_allowed:false,custom_groups_in_effect:false});
 if(url.includes('token01'))return Response.json({data:[{id:'MiniMax-H3'},{id:'MiniMax-H3-Fast'},{id:'not-adapted'}]});
 return Response.json({total:5,models:[{name:'tt-image-2.5',type:'image',available_for_this_key:true},{name:'omni-flash',type:'video',available_for_this_key:true},{name:'gk-video-3.5',type:'video',available_for_this_key:false},{name:'tt-6.1-sol',type:'chat',available_for_this_key:true},{name:'gem-3.8-flash',type:'chat',available_for_this_key:true}]});
});
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'model-setup-'));s=createStore(dir,process.cwd());createAnalysisService(s,transport);transport.mockClear();});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
async function connect(){const relays=createRelayService(s,transport);for(const id of ['chuhe','token01'] as const){relays.save(id,key);await relays.sync(id);}return relays;}

describe('permission-scoped recommended model setup',()=>{
 it('does not mistake a saved but unsynchronized key for permission',()=>{
  createRelayService(s,transport).save('chuhe',key);const preview=createModelSetup(s).preview();
  expect(preview.choices).toEqual([]);expect(preview.missing).toEqual(['image','video','chat']);expect(()=>createModelSetup(s).apply(preview.signature)).toThrow('请先连接');
 });
 it('previews without mutation and applies adapted defaults without paid requests',async()=>{
  await connect();const setup=createModelSetup(s),before=s.eventId(),calls=transport.mock.calls.length,preview=setup.preview();
  expect(preview.availableCounts).toEqual({image:1,video:3,chat:2});
  expect(preview.choices.map(row=>row.modelId)).toEqual(['tt-image','minimax-h3-fast','gem-3.8-flash']);
  expect(s.eventId()).toBe(before);expect(s.get('model-setup','global')).toBeUndefined();
  const applied=setup.apply(preview.signature);expect(applied.applied).toBe(true);
  expect(applied.settings.defaults).toEqual({image:'tt-image',video:'minimax-h3-fast',chat:'gem-3.8-flash'});
  expect(transport.mock.calls.length).toBe(calls);expect(JSON.stringify(applied)).not.toContain('sk-');expect(JSON.stringify(applied)).not.toContain('version');
  expect(s.models().find(row=>row.category==='video')?.id).toBe('minimax-h3-fast');
 });
 it('only enables the recommended choices and preserves other disabled models',async()=>{
  await connect();for(const id of ['omni','minimax-h3-fast']){const model=s.models().find(m=>m.id===id)!;s.put('model',id,{...model,enabled:false});}
  const setup=createModelSetup(s);expect(setup.apply(setup.preview().signature).applied).toBe(true);
  expect(s.models().find(m=>m.id==='minimax-h3-fast')?.enabled).toBe(true);expect(s.models().find(m=>m.id==='omni')?.enabled).toBe(false);
 });
 it('rejects stale previews after key, model or manual-default changes',async()=>{
  const relays=await connect(),setup=createModelSetup(s),old=setup.preview();relays.save('token01','sk-replaced-fixture-1234567890123');
  expect(()=>setup.apply(old.signature)).toThrow('配置已变化');
  const next=setup.preview(),model=s.models().find(m=>m.id==='tt-image')!;s.put('model',model.id,{...model,enabled:!model.enabled,revision:model.revision+1});
  expect(()=>setup.apply(next.signature)).toThrow('配置已变化');
 });
 it('preserves explicit Token01 bindings even when a different key could access that model',async()=>{
  await connect();const model=s.models().find(m=>m.id==='minimax-h3-fast')!;s.put('model',model.id,{...model,token01Group:'my-fixed-group'});
  const setup=createModelSetup(s),preview=setup.preview();expect(preview.choices.find(row=>row.role==='video')?.modelId).not.toBe(model.id);
  setup.apply(preview.signature);expect(s.models().find(m=>m.id===model.id)?.token01Group).toBe('my-fixed-group');
 });
 it('can use a verified additional key without inventing a new platform group',()=>{
  const vault=credentialVault(dir),id=randomUUID(),version=vault.set('token01-key:'+id,key);
  s.put('token01-key',id,{id,name:'视频密钥',version,status:'ready',modelNames:['MiniMax-H3-Fast'],modelIds:['minimax-h3-fast']} satisfies SavedToken01Key);
  const setup=createModelSetup(s),preview=setup.preview();expect(preview.choices.map(row=>row.modelId)).toEqual(['minimax-h3-fast']);
  setup.apply(preview.signature);expect(s.models().find(m=>m.id==='minimax-h3-fast')).toMatchObject({token01KeyId:id});expect(relayModelAvailable(s,'minimax-h3-fast')).toBe(true);
 });
 it('excludes stale additional keys and unverified group annotations',()=>{
  const vault=credentialVault(dir),id=randomUUID(),version=vault.set('token01-key:'+id,key);
  const profile={id,name:'手动分组',version,status:'ready' as const,group:'not-in-catalog',modelNames:['MiniMax-H3-Fast'],modelIds:['minimax-h3-fast']};
  s.put('token01-key',id,profile);const setup=createModelSetup(s);expect(setup.preview().choices).toEqual([]);
  s.put('token01-key',id,{...profile,group:undefined});vault.set('token01-key:'+id,'sk-rotated-fixture-12345678901234');expect(setup.preview().choices).toEqual([]);
 });
 it('inherits defaults in new drafts, keeps saved work, and shares settings across workspaces',async()=>{
  await connect();const video=s.skills().find(skill=>skill.model.category==='video')!,existing=s.readDraft(video.id);
  s.saveDraft(video.id,{...existing.value,requirements:'保留我的创作',modelId:'omni'},existing.revision);
  const setup=createModelSetup(s);setup.apply(setup.preview().signature);
  expect(s.readDraft(video.id).value).toMatchObject({modelId:'omni',requirements:'保留我的创作'});
  s.withWorkspace('brand-new',()=>{expect(setup.preview().settings.mode).toBe('recommended');expect(s.readDraft(video.id).value.modelId).toBe('minimax-h3-fast');});
  expect(setup.manual(setup.preview().settings.revision).settings.mode).toBe('manual');expect(s.readDraft(video.id).value.modelId).toBe('omni');
 });
 it('detects a disabled recommended default as needing reapplication',async()=>{
  await connect();const setup=createModelSetup(s);setup.apply(setup.preview().signature);const model=s.models().find(m=>m.id==='minimax-h3-fast')!;s.put('model',model.id,{...model,enabled:false});
  expect(setup.preview().applied).toBe(false);
 });
 it('guards apply endpoints with the normal session token and validates request shape',async()=>{
  const app=await createApp(s,{worker:false,providerTransport:transport});
  try{
   expect((await app.inject({url:'/api/model-setup'})).statusCode).toBe(200);
   expect((await app.inject({method:'POST',url:'/api/model-setup/apply',payload:{signature:'a'.repeat(64)}})).statusCode).toBe(403);
   const token=(await app.inject('/api/bootstrap')).json().token;
   expect((await app.inject({method:'POST',url:'/api/model-setup/apply',headers:{'x-studio-token':token},payload:{signature:'bad'}})).statusCode).toBe(400);
  }finally{await app.close();}
 });
});
