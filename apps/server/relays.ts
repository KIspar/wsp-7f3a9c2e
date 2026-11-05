import type {Store} from './store';
import {credentialVault} from './credentials';
import {createProviderService,redactProvider,type ProviderTransport} from './provider';
import {createToken01Service} from './token01';
import {providerCredentialIds,type ProviderCredentialId,type ProviderModelList,type ProviderPricing,type ProviderKey} from '../../packages/provider';
import {analysisModelIds,type AnalysisModel} from '../../packages/analysis';
import {token01ModelIds} from '../../packages/token01';
import {relayIds,type RelayId,type RelayState} from '../../packages/relays';
import {fail} from './errors';
import {token01GroupAvailability} from './token01-routing';
import {token01KeyAvailable} from './token01-keys';
import {chuheChannelRoutable,chuheCustomGroupsSchema,withChuheRouting} from '../../packages/chuhe-routing';

type SavedCatalog=Omit<RelayState,'configured'|'name'>&{signature:string};
const relayName=(id:RelayId)=>id==='token01'?'Token01':'初和中转站';
export function selectedCredential(store:Store,id:RelayId){
  const vault=credentialVault(store.dataDir),slots=id==='token01'?token01ModelIds.filter(modelId=>{const model=store.models().find(model=>model.id===modelId);return !model?.token01Group&&!model?.token01KeyId;}):providerCredentialIds;
  const slot=[`relay-${id}`,...slots].find(slot=>vault.current(slot));
  return slot?{slot,version:vault.current(slot)!,signature:slot+':'+vault.current(slot)}:undefined;
}
export function relayModelAvailable(store:Store,modelId:string):boolean|undefined{
  const model=store.models().find(model=>model.id===modelId);
  if(model?.provider==='token01'&&model.token01KeyId)return token01KeyAvailable(store,model);
  if(model?.provider==='token01'&&model.token01Group)return token01GroupAvailability(store,model);
  const id:RelayId=token01ModelIds.some(id=>id===modelId)?'token01':'chuhe';
  const catalog=store.get<SavedCatalog>('relay-catalog',id);
  // Keep legacy saved tasks/configuration readable until their first relay synchronization.
  if(!catalog)return undefined;
  return catalog.status==='ready'&&catalog.signature===selectedCredential(store,id)?.signature&&catalog.modelIds.includes(modelId);
}
export function createRelayService(store:Store,transport:ProviderTransport=fetch){
  const vault=credentialVault(store.dataDir);
  const pending=new Map<string,Promise<RelayState>>();
  function definitions(id:RelayId){return [
    ...store.models().filter(m=>m.provider===id).map(m=>({id:m.id,upstreamId:m.upstreamId,category:m.category as string})),
    ...(id==='chuhe'?analysisModelIds.map(id=>({id,upstreamId:id,category:'chat'})):[]),
  ];}
  function state(id:RelayId):RelayState{
    const selected=selectedCredential(store,id),saved=store.get<SavedCatalog>('relay-catalog',id);
    const base={id,name:relayName(id),configured:!!selected,modelIds:[],discovered:0,...(id==='token01'?{groupCredentialCount:store.list<{group:string}>('token01-group').filter(profile=>vault.current('token01-group:'+profile.group)).length}:{})};
    if(!selected)return {...base,status:'unconfigured'};
    if(!saved||saved.signature!==selected.signature)return {...base,status:'idle'};
    const {signature,...publicState}=saved;return {...base,...publicState};
  }
  function resetVision(ids:string[]){for(const model of store.list<AnalysisModel>('analysis-model'))if(ids.includes(model.id))store.put('analysis-model',model.id,{...model,revision:model.revision+1,vision:{status:'unverified',reason:'中转站密钥已更新，需要重新验证本地识图'}});}
  function save(id:RelayId,key:string){
    const ids=definitions(id).map(m=>m.id).filter(modelId=>{const model=store.models().find(model=>model.id===modelId);return id!=='token01'||!model?.token01Group&&!model?.token01KeyId;});
    vault.setMany([`relay-${id}`,...ids],key);
    store.transaction(()=>{
      resetVision(ids);
      store.put('relay-catalog',id,{id,signature:selectedCredential(store,id)!.signature,status:'idle',modelIds:[],discovered:0} satisfies SavedCatalog);
    });
    return state(id);
  }
  function sync(id:RelayId):Promise<RelayState>{
    const selected=selectedCredential(store,id);if(!selected)fail('请先保存'+relayName(id)+'密钥');
    const pendingKey=id+':'+selected.signature;if(pending.has(pendingKey))return pending.get(pendingKey)!;
    const request=(async()=>{
      const key=vault.get(selected.slot,selected.version),known=definitions(id);
      const unchanged=()=>{if(selectedCredential(store,id)?.signature!==selected.signature)fail('中转站密钥已更新，请重新同步模型',409);};
      try{
        // Reuse the selected relay credential without exposing it to the browser or paid endpoints.
        const readVault=credentialVault(store.dataDir);
        const source=id==='token01'?token01ModelIds.find(slot=>readVault.current(slot))!:providerCredentialIds.find(slot=>readVault.current(slot))!;
        // Legacy slots may hold different keys. Query with the relay's canonical key and version.
        const relayTransport:ProviderTransport=(url,init)=>transport(url,{...init,headers:{...init.headers,Authorization:`Bearer ${key}`}});
        let modelIds:string[],discovered:number;
        if(id==='token01'){
          const names=await createToken01Service(store,relayTransport).models(source);
          modelIds=known.filter(m=>names.includes(m.upstreamId)).map(m=>m.id);discovered=new Set(names).size;
        }else{
          const client=createProviderService(store,relayTransport),data=(await client.models(source as ProviderCredentialId)).data as ProviderModelList;
          const allowed=new Set(data.models.filter(m=>m.available_for_this_key===true).map(m=>m.name));
          let keyInfo:ProviderKey|undefined;
          const deniedKnown=known.filter(model=>data.models.some(remote=>remote.name===model.upstreamId&&remote.type===model.category&&remote.available_for_this_key===false));
          if(deniedKnown.length){
            keyInfo=(await client.keyInfo(source as ProviderCredentialId)).data as ProviderKey;
            const custom=chuheCustomGroupsSchema.safeParse(keyInfo.custom_groups||[]);
            if(keyInfo.custom_groups_in_effect===true&&custom.success)for(const model of deniedKnown){
              if(!custom.data.some(row=>row.model===model.upstreamId&&row.force_group_ids?.length))continue;
              const pricing=withChuheRouting((await client.modelPricing(source as ProviderCredentialId,model.upstreamId)).data as ProviderPricing,keyInfo,model.upstreamId);
              if(pricing.available_for_this_key===true&&pricing.channel_groups.some(chuheChannelRoutable))allowed.add(model.upstreamId);
            }
          }
          // Missing permission metadata is not permission. Read the model's pricing admission if needed.
          for(const model of known){const remote=data.models.find(m=>m.name===model.upstreamId&&m.type===model.category);if(remote&&remote.available_for_this_key===undefined){
            const pricing=keyInfo?withChuheRouting((await client.modelPricing(source as ProviderCredentialId,model.upstreamId)).data as ProviderPricing,keyInfo,model.upstreamId):(await client.routingPricing(source as ProviderCredentialId,model.upstreamId)).data;
            if(pricing.available_for_this_key===true&&pricing.channel_groups.some(chuheChannelRoutable))allowed.add(model.upstreamId);
          }}
          modelIds=known.filter(m=>allowed.has(m.upstreamId)&&data.models.some(r=>r.name===m.upstreamId&&r.type===m.category)).map(m=>m.id);discovered=allowed.size;
        }
        unchanged();
        // Model-specific versions remain an internal task snapshot. New tasks all inherit the relay key.
        const changed=known.map(m=>m.id).filter(slot=>{const model=store.models().find(model=>model.id===slot);return id!=='token01'||!model?.token01Group&&!model?.token01KeyId;}).filter(slot=>{const version=vault.current(slot);return !version||vault.get(slot,version)!==key;});
        if(changed.length)vault.setMany(changed,key);
        store.transaction(()=>{resetVision(changed);store.put('relay-catalog',id,{id,signature:selected.signature,status:'ready',modelIds,discovered,checkedAt:new Date().toISOString()} satisfies SavedCatalog);});
        return state(id);
      }catch(error){
        unchanged();
        const message=String(redactProvider((error as Error).message,key));
        store.transaction(()=>store.put('relay-catalog',id,{id,signature:selected.signature,status:'error',modelIds:[],discovered:0,checkedAt:new Date().toISOString(),error:message} satisfies SavedCatalog));
        throw Object.assign(new Error(message),{statusCode:(error as {statusCode?:number}).statusCode||502});
      }
    })().finally(()=>pending.delete(pendingKey));
    pending.set(pendingKey,request);return request;
  }
  return {list:()=>relayIds.map(state),save,sync};
}
