import {randomUUID} from 'node:crypto';
import type {Store} from './store';
import type {Model} from '../../packages/contracts';
import {token01Models,type Token01KeyProfile} from '../../packages/token01';
import {credentialVault} from './credentials';
import {createToken01Service} from './token01';
import {redactProvider,type ProviderTransport} from './provider';
import {fail} from './errors';
export type SavedToken01Key=Token01KeyProfile&{version:string};
export const token01KeySlot=(id:string)=>'token01-key:'+id;
export function token01KeyAvailable(store:Store,model:Model){
 const saved=store.get<SavedToken01Key>('token01-key',model.token01KeyId!);
 return saved?.status==='ready'&&saved.version===credentialVault(store.dataDir).current(token01KeySlot(saved.id))&&saved.modelIds.includes(model.id);
}
export function createToken01Keys(store:Store,transport?:ProviderTransport){
 const vault=credentialVault(store.dataDir),client=createToken01Service(store,transport),pending=new Map<string,Promise<Token01KeyProfile>>();
 const list=():Token01KeyProfile[]=>store.list<SavedToken01Key>('token01-key').map(({version,...row})=>row);
 async function sync(id:string):Promise<Token01KeyProfile>{
  const saved=store.get<SavedToken01Key>('token01-key',id)||fail('API Key 配置不存在',404),slot=token01KeySlot(id),version=vault.current(slot)||fail('API Key 未保存');
  const tag=id+':'+version;if(pending.has(tag))return pending.get(tag)!;
  const key=vault.get(slot,version);
  const unchanged=()=>{if(vault.current(slot)!==version)fail('API Key 已变化，请重新同步',409);};
  const request=(async()=>{
   try{
    const modelNames=[...new Set(await client.modelsWithKey(key))],modelIds=token01Models.filter(model=>modelNames.includes(model.upstreamId)).map(model=>model.id);unchanged();
    for(const model of store.models().filter(model=>model.token01KeyId===id&&modelIds.includes(model.id))){const current=vault.current(model.id);if(!current||vault.get(model.id,current)!==key)vault.set(model.id,key);}
    store.put('token01-key',id,{...saved,version,status:'ready',modelNames,modelIds,error:undefined,checkedAt:new Date().toISOString()} satisfies SavedToken01Key);
   }catch(error){unchanged();const message=String(redactProvider((error as Error).message,key));store.put('token01-key',id,{...saved,version,status:'error',modelNames:[],modelIds:[],error:message,checkedAt:new Date().toISOString()} satisfies SavedToken01Key);throw Object.assign(new Error(message),{statusCode:(error as {statusCode?:number}).statusCode||502});}
   return list().find(row=>row.id===id)!;
  })().finally(()=>pending.delete(tag));pending.set(tag,request);return request;
 }
 async function add(name:string,key:string,group?:string){
  if(list().length>=20)fail('最多保存 20 个附加 API Key');
  const id=randomUUID(),version=vault.set(token01KeySlot(id),key);
  store.put('token01-key',id,{id,name,group,version,status:'idle',modelNames:[],modelIds:[]} satisfies SavedToken01Key);
  return sync(id);
 }
 function remove(id:string){
  if(store.models().some(model=>model.token01KeyId===id))fail('此密钥正在被模型使用，请先切换该模型的调用密钥',409);
  if(!store.get('token01-key',id))fail('API Key 配置不存在',404);
  vault.removePrivate(token01KeySlot(id));store.transaction(()=>store.remove('token01-key',id));return {removed:true};
 }
 return {list,add,sync,remove};
}
