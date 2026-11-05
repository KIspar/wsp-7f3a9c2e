import type {Model} from '../../packages/contracts';
import {token01Models,type Token01GroupProfile,type Token01RoutingConfig} from '../../packages/token01';
import {credentialVault} from './credentials';
import {createToken01Service,token01VideoPricingSchema} from './token01';
import {redactProvider,type ProviderTransport} from './provider';
import type {Store} from './store';
import {fail} from './errors';
import {token01KeySlot,type SavedToken01Key} from './token01-keys';

type SavedProfile=Token01GroupProfile&{version:string};
const groupSlot=(group:string)=>'token01-group:'+group;
export function token01GroupAvailability(store:Store,model:Model){
  if(!model.token01Group)return undefined;
  const profile=store.get<SavedProfile>('token01-group',model.token01Group);
  return profile?.status==='ready'&&profile.version===credentialVault(store.dataDir).current(groupSlot(model.token01Group))&&profile.modelIds.includes(model.id);
}
export function createToken01Routing(store:Store,transport?:ProviderTransport){
  const vault=credentialVault(store.dataDir),client=createToken01Service(store,transport);
  let catalogPending:Promise<Token01RoutingConfig['models']>|undefined;
  const pending=new Map<string,Promise<Token01GroupProfile>>();
  function profiles():Token01GroupProfile[]{return store.list<SavedProfile>('token01-group').map(({version,...profile})=>({...profile,configured:!!vault.current(groupSlot(profile.group))}));}
  async function choices(fresh=false){
    const cached=store.get<{models:Token01RoutingConfig['models'];at:number;version?:number}>('token01-routing','catalog');
    if(!fresh&&cached?.version===2&&Date.now()-cached.at<5*60*1000)return cached.models;
    if(catalogPending)return catalogPending;
    catalogPending=(async()=>{
      const catalog=await client.catalog();
      const models=token01Models.map(model=>{
        const entry=catalog.data.find(row=>row.model_name===model.upstreamId);
        const pricing=token01VideoPricingSchema.safeParse(catalog.video_pricing[model.upstreamId]);
        if(entry&&!pricing.success)fail('Token01 模型分组的计费目录不完整',502);
        return {id:model.id,name:model.name,groups:entry&&pricing.success?entry.enable_groups.filter(group=>catalog.group_ratio[group]!==undefined).map(group=>{
          const ratio=catalog.group_ratio[group];
          const prices=pricing.data.tiers.filter(tier=>tier.resolution&&model.parameters.resolution.options!.includes(tier.resolution)&&!tier.excluded_groups?.includes(group)).map(tier=>{
            const special=tier.group_prices?.[group];
            return {resolution:tier.resolution!,basePrice:tier.price,price:special??tier.price*ratio,offPeakPrice:special===undefined&&tier.off_peak_price!==undefined?tier.off_peak_price*ratio:undefined,specialPrice:special!==undefined};
          });
          return {group,ratio,resolutions:prices.map(tier=>tier.resolution),prices,inputImagePrice:pricing.data.input_image_price===undefined?undefined:pricing.data.input_image_price*ratio,freeInputImages:pricing.data.free_input_images??0,offPeakWindows:entry.group_off_peak?.[group]||[],notes:entry.group_notes?.[group]||[]};
        }).filter(group=>group.resolutions.length):[]};
      }).filter(model=>model.groups.length);
      store.transaction(()=>store.put('token01-routing','catalog',{models,at:Date.now(),version:2}));return models;
    })().finally(()=>{catalogPending=undefined;});return catalogPending;
  }
  async function config(fresh=false):Promise<Token01RoutingConfig>{
    try{const models=await choices(fresh);return {models,profiles:profiles(),fetchedAt:new Date(store.get<{at:number}>('token01-routing','catalog')!.at).toISOString()};}
    catch(error){return {models:store.get<{models:Token01RoutingConfig['models']}>('token01-routing','catalog')?.models||[],profiles:profiles(),catalogError:'分组目录读取失败，请稍后刷新重试'};}
  }
  async function syncGroup(group:string){
    const slot=groupSlot(group),version=vault.current(slot)||fail('请先保存此分组的密钥');
    const pendingKey=slot+':'+version;if(pending.has(pendingKey))return pending.get(pendingKey)!;
    const request=(async()=>{
      const key=vault.get(slot,version);
      const unchanged=()=>{if(vault.current(slot)!==version)fail('分组密钥已更新，请重新同步',409);};
      try{
        const [names,models]=await Promise.all([client.modelsWithKey(key),choices()]);
        const modelIds=models.filter(model=>model.groups.some(choice=>choice.group===group)&&names.includes(model.name)).map(model=>model.id);
        unchanged();
        for(const model of store.models().filter(model=>model.token01Group===group&&!model.token01KeyId&&modelIds.includes(model.id))){
          const current=vault.current(model.id);if(!current||vault.get(model.id,current)!==key)vault.set(model.id,key);
        }
        store.transaction(()=>store.put('token01-group',group,{group,configured:true,version,status:'ready',modelIds,checkedAt:new Date().toISOString()} satisfies SavedProfile));
      }catch(error){
        unchanged();const message=String(redactProvider((error as Error).message,key));
        store.transaction(()=>store.put('token01-group',group,{group,configured:true,version,status:'error',modelIds:[],checkedAt:new Date().toISOString(),error:message} satisfies SavedProfile));
        throw Object.assign(new Error(message),{statusCode:(error as {statusCode?:number}).statusCode||502});
      }
      return profiles().find(profile=>profile.group===group)!;
    })().finally(()=>pending.delete(pendingKey));pending.set(pendingKey,request);return request;
  }
  async function saveGroup(group:string,key:string){
    if(!(await choices()).some(model=>model.groups.some(choice=>choice.group===group)))fail('当前模型目录中没有此分组');
    const version=vault.set(groupSlot(group),key);
    store.transaction(()=>store.put('token01-group',group,{group,configured:true,version,status:'idle',modelIds:[]} satisfies SavedProfile));
    return syncGroup(group);
  }
  async function route(id:string,group:string|null,revision:number,keyId?:string|null){
    // Complete remote reads before checking revision and committing local model + credential changes.
    const models=await choices();
    const model=store.models().find(model=>model.id===id&&model.provider==='token01')||fail('Token01 模型不存在',404);
    if(model.revision!==revision)fail('模型配置已变化，请刷新后重试',409);
    let slot:string;
    if(keyId){
      const key=store.get<SavedToken01Key>('token01-key',keyId);
      if(!key||key.status!=='ready'||!key.modelIds.includes(id)||key.version!==vault.current(token01KeySlot(keyId)))fail('请先同步所选 API Key 的模型权限');
      if(group&&group!==key.group)fail('所选 API Key 未标注此绑定分组');
      group=key.group||null;
      if(group&&!models.find(row=>row.id===id)?.groups.some(choice=>choice.group===group))fail('所标注分组不支持此模型，请检查 API Key 配置');
      slot=token01KeySlot(keyId);
    }else if(group){
      if(!models.find(row=>row.id===id)?.groups.some(choice=>choice.group===group))fail('该分组不支持此模型');
      const profile=profiles().find(profile=>profile.group===group);
      if(profile?.status!=='ready'||!profile.modelIds.includes(id))fail('请先在 Token01 分组密钥中保存并同步此分组');
      slot=groupSlot(group);
    }else{
      const catalog=store.get<{status:string;modelIds:string[]}>('relay-catalog','token01');
      if(catalog?.status!=='ready'||!catalog.modelIds.includes(id))fail('请先保存并同步 Token01 统一密钥');
      slot='relay-token01';
    }
    const version=vault.current(slot)||fail('所选分组密钥不可用，请重新保存');
    const key=vault.get(slot,version),current=vault.current(id);
    if(!current||vault.get(id,current)!==key)vault.set(id,key);
    const next={...model,token01Group:group||undefined,token01KeyId:keyId||undefined,revision:model.revision+1};
    store.transaction(()=>store.put('model',id,next));return next;
  }
  return {config,saveGroup,syncGroup,route};
}
