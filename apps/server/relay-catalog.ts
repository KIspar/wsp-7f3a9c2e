import type {Store} from './store';
import {selectedCredential} from './relays';
import {credentialVault} from './credentials';
import {createProviderService,type ProviderTransport} from './provider';
import {providerCredentialIds,type ProviderKey,type ProviderModelList,type ProviderPricing} from '../../packages/provider';
import {analysisModelIds} from '../../packages/analysis';
import type {RelayCatalog,RelayCatalogModel} from '../../packages/relays';
import {fail} from './errors';
import {chuheCustomGroupsSchema,chuheChannelStatus,chuheChannelRoutable,withChuheRouting} from '../../packages/chuhe-routing';
export function createRelayCatalog(store:Store,transport:ProviderTransport=fetch){
 let cache:{signature:string;until:number;value:RelayCatalog}|undefined;
 const pending=new Map<string,Promise<RelayCatalog>>();
 async function catalog():Promise<RelayCatalog>{
  const selected=selectedCredential(store,'chuhe');if(!selected)fail('请先保存初和中转站密钥');
  if(cache?.signature===selected.signature&&cache.until>Date.now())return cache.value;
  if(pending.has(selected.signature))return pending.get(selected.signature)!;
  const vault=credentialVault(store.dataDir),key=vault.get(selected.slot,selected.version),source=providerCredentialIds.find(slot=>vault.current(slot))!;
  const client=createProviderService(store,(url,init)=>transport(url,{...init,headers:{...init.headers,Authorization:`Bearer ${key}`}}));
  const read=(async()=>{
   const [keyInfo,remote]=await Promise.all([client.keyInfo(source),client.models(source)]),info=keyInfo.data as ProviderKey,models=remote.data as ProviderModelList;
   const custom=info.custom_groups_in_effect===true;
   const parsed=chuheCustomGroupsSchema.safeParse(info.custom_groups||[]);
   if(custom&&!parsed.success)fail('初和自定义模型与分组格式异常，请重新同步',502);
   const configured=parsed.success?parsed.data:[];
   const names=custom?[...new Set(configured.map(row=>row.model))]:[...new Set(models.models.filter(row=>row.available_for_this_key!==false).map(row=>row.name))];
   const known=[...store.models().filter(row=>row.provider==='chuhe').map(row=>({upstreamId:row.upstreamId,id:row.id})),...analysisModelIds.map(id=>({id,upstreamId:id}))];
   const output:RelayCatalogModel[]=[];let cursor=0;
   await Promise.all(Array.from({length:Math.min(3,names.length)},async()=>{while(cursor<names.length){
    const index=cursor++,name=names[index],entry=models.models.find(row=>row.name===name),settings=configured.find(row=>row.model===name);
    // Preserve configured models even when prices or channel health cannot be read.
    const pricing=withChuheRouting(await client.modelPricing(source,name).then(result=>result.data as ProviderPricing).catch(()=>({channel_groups:[],available_for_this_key:false} as ProviderPricing)),info,name);
    const permitted=pricing.channel_groups.filter(group=>group.in_key_whitelist===true&&group.excluded_for_this_key===false);
    const groupIds=custom?[...new Set([...(settings?.group_ids||[]),...(settings?.force_group_ids||[]),...(settings?.groups?.map(group=>group.group_id)||[])])]:permitted.map(group=>String(group.group_id));
    const groups=groupIds.map(id=>{const saved=settings?.groups?.find(group=>group.group_id===id),live=pricing.channel_groups.find(group=>String(group.group_id)===id);const status=chuheChannelStatus(live?.is_active,saved?.status);return {id,name:saved?.group_name||live?.group_name||id,status,forced:custom&&status!=='removed'&&settings?.force_group_ids?.includes(id)===true};});
    if(!custom&&(!groups.length||pricing.available_for_this_key===false))continue;
    output[index]={id:name,name:entry?.display_name||name,upstreamId:name,category:entry?.type||'other',localId:known.find(row=>row.upstreamId===name)?.id,groups,available:pricing.available_for_this_key===true&&permitted.some(group=>chuheChannelRoutable(group)&&groupIds.includes(String(group.group_id)))};
   }}));
   if(selectedCredential(store,'chuhe')?.signature!==selected.signature)fail('初和密钥已更新，请重新同步',409);
   const value={models:output.filter(Boolean),groupCount:new Set(output.filter(Boolean).flatMap(row=>row.groups.map(group=>group.id))).size,custom,fetchedAt:new Date().toISOString()};
   cache={signature:selected.signature,until:Date.now()+15000,value};return value;
  })().finally(()=>pending.delete(selected.signature));pending.set(selected.signature,read);return read;
 }
 return {catalog};
}
