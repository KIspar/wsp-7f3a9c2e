import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {createToken01Keys} from '../apps/server/token01-keys';
import {createToken01Routing} from '../apps/server/token01-routing';
import {createRelayService,relayModelAvailable} from '../apps/server/relays';
import {credentialVault} from '../apps/server/credentials';
import type {ProviderTransport} from '../apps/server/provider';
import catalog from './fixtures/token01-pricing.json';
let s:Store,dir:string;
const primary='sk-primary-test-123456789012345',extra='sk-extra-test-123456789012345';
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'token01-keys-'));s=createStore(dir,process.cwd());});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
const read:ProviderTransport=async(url,init)=>url.endsWith('/api/pricing')?Response.json(catalog):Response.json({data:(String(new Headers(init.headers).get('Authorization')).includes(extra)?['MiniMax-H3','other-bound-model']:['MiniMax-H3-Fast']).map(id=>({id}))});
describe('multiple independent Token01 API keys',()=>{
 it('discovers each key independently, applies the selected key to its model and preserves it when the main key synchronizes',async()=>{
  const relay=createRelayService(s,read),keys=createToken01Keys(s,read),routing=createToken01Routing(s,read),vault=credentialVault(dir);
  relay.save('token01',primary);await relay.sync('token01');const old=vault.current('minimax-h3')!;
  const profile=await keys.add('第二把密钥',extra,'2.4折');expect(profile.modelNames).toEqual(['MiniMax-H3','other-bound-model']);expect(profile.modelIds).toEqual(['minimax-h3']);expect(JSON.stringify(keys.list())).not.toContain(extra);expect(JSON.stringify(keys.list())).not.toContain('version');
  await expect(routing.route('minimax-h3-fast',null,1,profile.id)).rejects.toThrow('模型权限');
  await routing.route('minimax-h3',null,1,profile.id);expect(vault.get('minimax-h3',vault.current('minimax-h3')!)).toBe(extra);expect(vault.get('minimax-h3',old)).toBe(primary);expect(relayModelAvailable(s,'minimax-h3')).toBe(true);
  relay.save('token01',primary);await relay.sync('token01');expect(vault.get('minimax-h3',vault.current('minimax-h3')!)).toBe(extra);expect(()=>keys.remove(profile.id)).toThrow('正在被模型使用');
  s.close();s=createStore(dir,process.cwd());expect(relayModelAvailable(s,'minimax-h3')).toBe(true);expect(createToken01Keys(s,read).list()).toHaveLength(1);
 });
 it('invalidates only the affected key after permission loss',async()=>{
  const keys=createToken01Keys(s,read),profile=await keys.add('第二把密钥',extra),routing=createToken01Routing(s,read);await routing.route('minimax-h3',null,1,profile.id);
  const denied=createToken01Keys(s,async()=>Response.json({error:{message:'denied '+extra}},{status:401}));await expect(denied.sync(profile.id)).rejects.toMatchObject({statusCode:401});expect(relayModelAvailable(s,'minimax-h3')).toBe(false);expect(JSON.stringify(denied.list())).not.toContain(extra);
 });
});
