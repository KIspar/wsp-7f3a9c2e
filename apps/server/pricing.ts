import type {PlanItem,GenerationQuote,Attempt} from '../../packages/contracts';
import type {ProviderBalance,ProviderPricing,ProviderCredentialId} from '../../packages/provider';
import type {Store} from './store';
import {createProviderService,type ProviderTransport} from './provider';
import {fail} from './errors';
import {credentialVault} from './credentials';
import {createToken01Service} from './token01';
import {chuheChannelRoutable} from '../../packages/chuhe-routing';
export const money=(v:number)=>Math.ceil((v-1e-10)*1e6)/1e6;
function validNumber(v:unknown){return typeof v==='number'&&Number.isFinite(v)&&v>=0;}
export function priceItem(item:Pick<PlanItem,'parameters'|'references'|'dependencyTaskId'>,pricing:ProviderPricing){
 if(pricing.available_for_this_key!==true)fail('当前密钥未开通所选生成模型，请在模型配置中检查');
 const params:Record<string,unknown>={...item.parameters,aspect_ratio:item.parameters.aspectRatio,images:Array(item.references.length+(item.dependencyTaskId?1:0)).fill('reference')};
 const costs:number[]=[];
 for(const group of pricing.channel_groups){
  if(!chuheChannelRoutable(group))continue;
  if(group.supported_options&&Object.entries(group.supported_options).some(([k,options])=>!Array.isArray(options)||params[k]!==undefined&&!options.some(v=>String(v)===String(params[k]))))continue;
  let uncertain=false,rejected=false;
  for(const raw of group.capability_rules||[]){const rule=raw as {effect?:string;when?:{param:string;op:string;value?:unknown;values?:unknown[]}[]};if(rule.effect==='ignore')continue;if(rule.effect!=='reject'||!Array.isArray(rule.when)){uncertain=true;break;}
   const matches=rule.when.map(c=>{const value=params[c.param as keyof typeof params];switch(c.op){case'in':return c.values?.some(v=>String(v)===String(value));case'not_in':return !c.values?.some(v=>String(v)===String(value));case'count_gt':return Array.isArray(value)&&value.length>Number(c.value);case'count_gte':return Array.isArray(value)&&value.length>=Number(c.value);case'eq':return String(value)===String(c.value);case'neq':return String(value)!==String(c.value);default:uncertain=true;return false;}});if(matches.every(Boolean))rejected=true;
  }
  if(rejected||uncertain)continue;
  if(!['按次','按秒'].includes(group.billing_method||'')||!validNumber(group.base_price))fail('该模型的计费方式暂不能可靠预估，已阻止生成；请检查模型报价');
  let multiplier=1,addition=0;const matched=new Set<string>();
  for(const option of group.option_prices||[]){const name=String(option.param_name),selected=params[name];if(selected===undefined||String(selected)!==String(option.option_value))continue;if(matched.has(name)||!validNumber(option.price_multiplier)||!validNumber(option.price_addition))fail('供应商选项价格不完整或重复，暂不能生成');matched.add(name);multiplier*=Number(option.price_multiplier);addition+=Number(option.price_addition);}
  let cost=Number(group.base_price)*multiplier+addition;
  if(group.billing_method==='按秒'){const duration=Number(params.duration);if(!Number.isFinite(duration)||duration<=0)fail('请设置有效视频时长');cost*=duration;}
  const imageCount=(params.images as unknown[]).length;
  if(imageCount){if(!validNumber(group.input_image_price)||!validNumber(group.input_image_free_count))fail('供应商参考图计价不完整，暂不能生成');cost+=Math.max(0,imageCount-Number(group.input_image_free_count))*Number(group.input_image_price);}
  if(!validNumber(cost))fail('供应商价格异常，暂不能生成');costs.push(money(cost));
 }
 if(!costs.length)fail('当前没有支持这组参数的可用线路，请检查模型权限、画幅和分辨率');
 return {minimum:Math.min(...costs),maximum:Math.max(...costs),channels:costs.length};
}
export function createPricingService(store:Store,transport:ProviderTransport=fetch){
 const provider=createProviderService(store,transport);
 const token01=createToken01Service(store,transport);
 const vault=credentialVault(store.dataDir);
 const cache=new Map<string,{until:number;value:ProviderPricing}>(),pending=new Map<string,Promise<ProviderPricing>>();
 async function currentPricing(id:ProviderCredentialId,name:string,fresh:boolean,version:string){
  const key=id+':'+version+':'+name;const old=cache.get(key);if(!fresh&&old&&old.until>Date.now())return old.value;
  if(!fresh&&pending.has(key))return pending.get(key)!;
  const request=provider.routingPricing(id,name,version).then(envelope=>{const value=envelope.data;cache.set(key,{until:Date.now()+15000,value});return value;}).finally(()=>pending.delete(key));
  if(!fresh)pending.set(key,request);return request;
 }
 async function quote(items:PlanItem[],excludeAttemptId?:string,fresh=false):Promise<GenerationQuote>{
  if(!items.length)fail('没有可执行项目');const model=items[0].model;if(items.some(i=>i.model.id!==model.id))fail('同一批次需使用同一模型');
  if(model.provider==='token01')return token01.quote(items);
  if(!['tt-image','omni','gk-video-3.5'].includes(model.id)||model.provider!=='chuhe')fail('所选模型未接入真实生成接口');
  const id=model.id as ProviderCredentialId;
  const version=vault.current(id)||fail('生成模型密钥尚未配置，请在模型配置中检查');
  const [balanceEnvelope,pricing]=await Promise.all([provider.balance(id,version),currentPricing(id,model.upstreamId,fresh,version)]);
  const balance=balanceEnvelope.data as ProviderBalance;
  const rows=items.map(item=>{
   const dependencyAsset=item.dependencyTaskId?store.get<Attempt>('attempt',item.dependencyTaskId)?.assetId:undefined;
   const priced=dependencyAsset&&item.references.includes(dependencyAsset)?{...item,dependencyTaskId:undefined}:item;
   return {index:item.index,...priceItem(priced,pricing)};
  });
  // Hold queued and unknown submissions locally; accepted jobs are precharged upstream.
  const held=store.list<Attempt>('attempt').filter(a=>!a.simulated&&a.model?.provider!=='token01'&&a.id!==excludeAttemptId&&a.reservedCost!==undefined&&['queued','waiting_dependency','blocked_dependency','pending_verification','generating'].includes(a.status)&&!a.upstreamTaskId);
  const reserved=money(held.reduce((n,a)=>n+(a.reservedCost||0),0));
  const keyReserved=money(held.filter(a=>a.model.id===id).reduce((n,a)=>n+(a.reservedCost||0),0));
  const keyRemaining=balance.api_key_quota.limit===0?null:balance.api_key_quota.remaining;
  if(keyRemaining===undefined)fail('供应商没有返回密钥剩余额度，无法确认可用算力');
  const available=Math.max(0,Math.min(balance.balance-reserved,keyRemaining===null?Infinity:keyRemaining-keyReserved));
  const minimum=money(rows.reduce((n,r)=>n+r.minimum,0)),maximum=money(rows.reduce((n,r)=>n+r.maximum,0));
  return {credentialVersion:version,checkedAt:new Date().toISOString(),balance:balance.balance,keyRemaining,reserved,available:Math.floor((available+1e-10)*1e6)/1e6,minimum,maximum,affordable:available+1e-9>=maximum,unit:'算力',items:rows};
 }
 return {quote};
}
