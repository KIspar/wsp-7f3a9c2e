import type {Store} from './store';
import type {ProviderCredentialId} from '../../packages/provider';
import type {ProviderEnvelope,ProviderTask,UsageQuery} from '../../packages/provider';
import {credentialVault} from './credentials';
import {fail} from './errors';
import {z} from 'zod';
import {withChuheRouting} from '../../packages/chuhe-routing';
import type {ProviderKey,ProviderPricing} from '../../packages/provider';
export type ProviderTransport=(url:string,init:RequestInit)=>Promise<Response>;
const origin='https://api.lk888.ai';
const number=z.number().finite(),identifier=z.union([z.string(),number]);
const totals=z.object({cost:number.optional(),count:number.optional(),success_count:number.optional(),failed_count:number.optional(),refunded_cost:number.optional(),refunded_count:number.optional()}).passthrough();
const model=z.object({name:z.string(),type:z.string(),display_name:z.string().optional(),description:z.string().optional(),tags:z.array(z.string()).optional(),available_for_this_key:z.boolean().optional(),params:z.array(z.object({name:z.string(),label:z.string().optional(),type:z.string(),required:z.boolean().optional(),options:z.array(z.object({label:z.string().optional(),value:z.unknown()}).passthrough()).optional()}).passthrough()).optional()}).passthrough();
// Validate fields used by the UI while retaining all provider pricing/routing metadata.
const responseSchemas={
  balance:z.object({balance:number,unit:z.string(),api_key_quota:z.object({limit:number,used:number,remaining:number.optional()}).passthrough()}).passthrough(),
  key:z.object({id:identifier,name:z.string(),status:number,strategy:z.string(),limit:number,used:number,api_edit_allowed:z.boolean(),ip_whitelist:z.array(z.string()).optional()}).passthrough(),
  usage:z.object({scope:z.enum(['key','user']),unit:z.string(),from:z.string(),to:z.string(),grand_total:totals.optional(),by_model:z.array(totals.extend({model:z.string()})).optional(),records:z.array(z.object({task_id:identifier,model:z.string(),state:z.string(),cost:number.optional(),refunded:z.boolean().optional(),refunded_amount:number.optional(),created_at:z.string().optional()}).passthrough()).optional(),total:number.optional(),limit:number.optional(),offset:number.optional()}).passthrough().refine(d=>!!d.grand_total&&!!d.by_model||!!d.records&&d.total!==undefined),
  models:z.object({models:z.array(model),total:number}).passthrough(),
  model,
  pricing:z.object({channel_groups:z.array(z.object({group_id:identifier,group_name:z.string(),is_active:z.boolean(),in_key_whitelist:z.boolean().optional(),excluded_for_this_key:z.boolean().optional(),billing_method:z.string().optional(),base_price:number.optional(),min_price:number.optional(),input_token_price:number.optional(),output_token_price:number.optional(),input_image_price:number.optional(),input_image_free_count:number.optional(),option_prices:z.array(z.record(z.string(),z.unknown())).optional(),unsupported:z.array(z.string()).optional()}).passthrough())}).passthrough(),
  // The provider may add state labels over time; `is_final` is authoritative.
  task:z.object({task_id:identifier,state:z.string(),is_final:z.boolean(),model:z.string().optional(),status:z.string().optional(),progress:z.union([number,z.string()]).optional(),cost:number.optional(),refunded:z.boolean().optional(),refunded_amount:number.optional(),input_tokens:number.optional(),output_tokens:number.optional(),duration_seconds:number.optional(),result_urls:z.array(z.string()).optional(),result_url:z.string().optional(),error:z.string().nullable().optional(),ai_reply:z.string().optional()}).passthrough(),
};
// Only plain provider metadata reaches the browser. Even an unexpected plaintext echo is removed.
export function redactProvider(value:unknown,secret=''):unknown{
  if(typeof value==='string')return (secret?value.replaceAll(secret,'[密钥已隐藏]'):value).replace(/sk-[A-Za-z0-9_-]{12,}/g,'[密钥已隐藏]');
  if(Array.isArray(value))return value.map(v=>redactProvider(v,secret));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>! /^(api[_-]?key|secret|authorization|access[_-]?token|refresh[_-]?token|credential|credentials|password|key)$/i.test(name)).map(([name,v])=>[name,redactProvider(v,secret)]));
  return value;
}
export function taskSettlement(data:Record<string,unknown>){
  const state=typeof data.state==='string'?data.state.toLowerCase():'';
  const status=typeof data.status==='string'?data.status.toLowerCase():'';
  const cost=typeof data.cost==='number'||typeof data.cost==='string'&&data.cost.trim()!==''?Number(data.cost):NaN;
  const observed=[state,status].filter(Boolean);
  const successStates=['success','succeed','succeeded','completed','video_generation_completed','video_upsampling_completed','finish','finished','done'];
  const failureStates=['failed','error','video_generation_failed','video_upsampling_failed','failure','cancelled','canceled','unknown','timeout','refunding','interrupted','violation'];
  // Current API's is_final is authoritative; state/status fallbacks keep old fixtures readable.
  const terminal=typeof data.is_final==='boolean'?data.is_final:observed.some(v=>successStates.includes(v)||failureStates.includes(v));
  const number=(v:unknown)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):undefined;
  return {terminal,state:state||status,succeeded:observed.some(v=>successStates.includes(v)),failed:observed.some(v=>failureStates.includes(v)),cost:Number.isFinite(cost)&&cost>=0?cost:undefined,inputTokens:number(data.input_tokens??data.prompt_tokens),outputTokens:number(data.output_tokens??data.completion_tokens),refunded:data.refunded===true,refundedAmount:number(data.refunded_amount),errorCode:typeof data.error_code==='string'?data.error_code:undefined};
}
export function createProviderService(store:Store,transport:ProviderTransport=fetch){
  const vault=credentialVault(store.dataDir);
  async function get<T>(credentialId:ProviderCredentialId,kind:keyof typeof responseSchemas,pathname:string,params:Record<string,string>={},version?:string):Promise<ProviderEnvelope<T>>{
    const selected=version||vault.current(credentialId)||fail('该查询密钥尚未配置，请在模型配置中添加',400);
    let key:string;try{key=vault.get(credentialId,selected);}catch{fail('该版本查询凭据不可用，请检查本机私有凭据',400);}
    const url=new URL(pathname,origin);if(url.origin!==origin||!url.pathname.startsWith('/v1/skills/'))fail('查询地址不被允许');
    for(const [name,value]of Object.entries(params))if(value!=='')url.searchParams.set(name,value);
    let response:Response;
    try{response=await transport(url.href,{method:'GET',headers:{Authorization:`Bearer ${key}`,'Accept-Language':'zh-CN',Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch{fail('供应商查询暂时无法连接，请稍后手动刷新；未发送生成请求',502);}
    if(!response.ok){
      const messages:Record<number,string>={401:'供应商拒绝此密钥，请检查密钥是否有效',403:'供应商拒绝访问，请检查密钥状态、IP 白名单或接口权限',404:'供应商未找到该任务或模型',429:'查询过于频繁，请稍后重试'};
      fail(messages[response.status]||`供应商查询失败（HTTP ${response.status}）`,response.status>=400&&response.status<500?response.status:502);
    }
    let data:unknown;
    try{
      const reader=response.body?.getReader();if(!reader)throw Error();let bytes=0;const parts:Uint8Array[]=[];
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>8*1024*1024){await reader.cancel();throw Error();}parts.push(part.value);}
      data=JSON.parse(Buffer.concat(parts).toString('utf8'));
      data=responseSchemas[kind].parse(data);
    }catch{fail('供应商返回的数据格式异常或内容过大，请稍后重查',502);}
    return {credentialId,fetchedAt:new Date().toISOString(),data:redactProvider(data,key) as T};
  }
  return {
    balance:(id:ProviderCredentialId,version?:string)=>get(id,'balance','/v1/skills/balance',{},version),
    keyInfo:(id:ProviderCredentialId)=>get(id,'key','/v1/skills/key'),
    usage:(input:UsageQuery)=>{
      const params:Record<string,string>={scope:input.scope,detail:input.detail};
      if(input.start_time&&input.end_time){params.start_time=input.start_time;params.end_time=input.end_time;}else params.days=String(input.days);
      if(input.model)params.model=input.model;
      if(input.detail==='1'){params.limit=String(input.limit);params.offset=String(input.offset);}
      return get(input.credentialId,'usage','/v1/skills/usage',params);
    },
    models:(id:ProviderCredentialId,type?:string)=>get<import('../../packages/provider').ProviderModelList>(id,'models','/v1/skills/models',type?{type}:{}),
    modelDetail:(id:ProviderCredentialId,name:string)=>get(id,'model','/v1/skills/models/-',{model:name}),
    modelPricing:(id:ProviderCredentialId,name:string,status?:string,version?:string)=>get(id,'pricing','/v1/skills/models/-/pricing',{model:name,...(status?{status}:{})},version),
    routingPricing:async(id:ProviderCredentialId,name:string,version?:string)=>{
      const selected=version||vault.current(id)||fail('该查询密钥尚未配置，请在模型配置中添加',400);
      const envelope=await get<ProviderPricing>(id,'pricing','/v1/skills/models/-/pricing',{model:name},selected);
      const needsConfig=envelope.data.channel_groups.some(group=>!group.is_active&&group.in_key_whitelist===true&&group.excluded_for_this_key===false);
      const key=needsConfig?(await get<ProviderKey>(id,'key','/v1/skills/key',{},selected)).data:undefined;
      return {...envelope,data:withChuheRouting(envelope.data,key,name)};
    },
    task:(id:ProviderCredentialId,taskId:string,version?:string)=>get<ProviderTask>(id,'task','/v1/skills/task-status',{task_id:taskId},version),
  };
}
export type ProviderService=ReturnType<typeof createProviderService>;
