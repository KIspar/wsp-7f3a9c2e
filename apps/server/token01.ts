import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {GenerationQuote,PlanItem,Asset} from '../../packages/contracts';
import {isToken01Model,token01Models,token01Origin} from '../../packages/token01';
import type {Store} from './store';
import {credentialVault} from './credentials';
import {assetFile} from './analysis-media';
import {redactProvider,type ProviderTransport} from './provider';
import {fail} from './errors';

const price=z.number().finite().nonnegative();
export const token01VideoPricingSchema=z.object({unit:z.literal('per_second'),tiers:z.array(z.object({resolution:z.string().optional(),price,off_peak_price:price.optional(),excluded_groups:z.array(z.string()).optional(),group_prices:z.record(z.string(),price).optional()})),input_image_price:price.optional(),free_input_images:price.int().optional()});
const pricingSchema=z.object({success:z.literal(true),group_ratio:z.record(z.string(),price),
  data:z.array(z.object({model_name:z.string(),enable_groups:z.array(z.string()),group_notes:z.record(z.string(),z.array(z.string())).optional(),group_off_peak:z.record(z.string(),z.array(z.object({start:z.string(),end:z.string(),tz:z.string().optional()}))).optional()})),
  // The public catalog mixes video, image, audio and token billing entries in this object.
  // Validate the selected model's per-second contract without rejecting unrelated products.
  video_pricing:z.record(z.string(),z.unknown()),
});
export type Token01Pricing=z.infer<typeof pricingSchema>;
const note='Token01 独立按人民币计费。报价覆盖公开分组及忙闲时价格；实际渠道由密钥分组决定。平台在提交时校验钱包余额，最终费用与退款请在 Token01 使用日志核对。';

export function validateToken01Item(item:Pick<PlanItem,'model'|'parameters'|'references'|'prompt'>){
  const definition=token01Models.find(m=>m.id===item.model.id);
  if(!definition||item.model.provider!=='token01'||item.model.upstreamId!==definition.upstreamId)fail('Token01 模型配置不匹配');
  const resolution=String(item.parameters.resolution),mode=String(item.parameters.referenceMode||'reference');
  if(!definition.parameters.resolution.options!.includes(resolution)||!definition.aspectRatios.includes(String(item.parameters.aspectRatio))||!definition.durations.includes(Number(item.parameters.duration)))fail('Token01 不支持所选画质、比例或时长');
  if(!['reference','first-frame','first-last-frame'].includes(mode))fail('请选择有效的 Token01 图片用途');
  if(item.references.length>9)fail('Token01 最多支持 9 张参考图片');
  if(mode==='first-frame'&&item.references.length!==1)fail('首帧模式需要且仅需要一张图片');
  if(mode==='first-last-frame'&&item.references.length!==2)fail('首尾帧模式需要两张图片，依次作为首帧、尾帧');
  if(item.prompt.length>6800)fail('Token01 提示词过长，请缩短至 6800 字符以内');
  return {resolution,mode,inputMode:item.references.length?mode:'text'};
}

export function token01ItemPrice(item:PlanItem,raw:unknown){
  const catalog=pricingSchema.parse(raw),{resolution,inputMode}=validateToken01Item(item);
  const model=catalog.data.find(m=>m.model_name===item.model.upstreamId),rawPricing=catalog.video_pricing[item.model.upstreamId];
  if(!model||!rawPricing)fail('Token01 当前未提供所选模型的计费规则');
  const parsed=token01VideoPricingSchema.safeParse(rawPricing);if(!parsed.success)fail('Token01 所选模型计费规则不完整，请稍后重查',502);const pricing=parsed.data;
  const tier=pricing.tiers.find(t=>t.resolution===resolution);
  if(!tier)fail('Token01 当前未提供所选分辨率的价格');
  const costs:number[]=[];
  // Fast workflow groups have different input contracts. Do not price a text-only route for images.
  const fastModes:Record<string,string[]>={default_we:['text','reference','first-frame','first-last-frame'],default_ld:['text','reference'],
    '1.0001折':['reference'],'1.00011折':['reference'],'1.000111折':['reference'],
    '1.0001111折':['first-last-frame'],'1.00011111折':['text']};
  for(const group of model.enable_groups){
    if(item.model.token01Group&&group!==item.model.token01Group)continue;
    if(tier.excluded_groups?.includes(group))continue;
    if(item.model.id==='minimax-h3-fast'&&!fastModes[group]?.includes(inputMode))continue;
    const ratio=catalog.group_ratio[group];if(ratio===undefined)continue;
    const override=tier.group_prices?.[group];
    const rates=override!==undefined?[override]:[tier.price*ratio,...(tier.off_peak_price!==undefined?[tier.off_peak_price*ratio]:[])];
    const imageCost=Math.max(0,item.references.length-(pricing.free_input_images??0))*(pricing.input_image_price??0)*ratio;
    costs.push(...rates.map(rate=>Math.ceil((rate*Number(item.parameters.duration)+imageCost-1e-10)*1e6)/1e6));
  }
  if(!costs.length)fail('Token01 没有支持这组画质与图片用途的已知线路，请调整参数并检查密钥分组');
  return {minimum:Math.min(...costs),maximum:Math.max(...costs),channels:costs.length};
}

export async function token01Bytes(response:Response,maxBytes:number){
  const reader=response.body?.getReader();if(!reader)throw Error('Token01 返回空内容');
  const parts:Uint8Array[]=[];let count=0;
  while(true){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>maxBytes){await reader.cancel();throw Error('Token01 返回内容超过大小限制');}parts.push(part.value);}
  return Buffer.concat(parts);
}

export function createToken01Service(store:Store,transport:ProviderTransport=fetch){
  const vault=credentialVault(store.dataDir);
  function secret(id:string,version?:string){if(!isToken01Model(id))fail('Token01 模型不存在');const selected=version||vault.current(id)||fail('请在模型配置中添加 Token01 密钥');return vault.get(id,selected);}
  async function request(pathname:string,key?:string,init:RequestInit={}){
    if(!pathname.startsWith('/v1/')&&pathname!=='/api/pricing')fail('Token01 请求地址不被允许');
    return transport(token01Origin+pathname,{...init,method:init.method||'GET',headers:{...(key?{Authorization:`Bearer ${key}`} :{}),...init.headers},redirect:'error',signal:AbortSignal.timeout(pathname.endsWith('/content')?180000:120000)});
  }
  async function json(response:Response,key=''){
    let data:any;try{data=JSON.parse((await token01Bytes(response,4*1024*1024)).toString('utf8'));}catch{fail(`Token01 返回内容异常（HTTP ${response.status}）`,502);}
    if(!response.ok||data.error||data.success===false||data.code!==undefined&&![true,'success',0,200].includes(data.code)){
      const message=String(redactProvider(data.error?.message||data.message||`HTTP ${response.status}`,key)).slice(0,500);
      fail('Token01：'+message,response.ok?502:response.status>=400&&response.status<500?response.status:502);
    }
    return data;
  }
  async function modelsWithKey(key:string){
    const data=await json(await request('/v1/models',key),key);
    const entries=z.array(z.object({id:z.string()})).safeParse(data.data);
    if(!entries.success)fail('Token01 模型清单格式异常',502);
    return entries.data.map(m=>m.id);
  }
  const models=(id:string,version?:string)=>modelsWithKey(secret(id,version));
  async function quote(items:PlanItem[],version?:string):Promise<GenerationQuote>{
    const model=items[0]?.model;if(!model||items.some(i=>i.model.id!==model.id))fail('同一批次需使用同一 Token01 模型');
    const selected=version||vault.current(model.id)||fail('请在模型配置中添加 Token01 密钥');
    items.forEach(validateToken01Item);
    let catalog:unknown,visible:string[];
    try{[catalog,visible]=await Promise.all([request('/api/pricing').then(r=>json(r)),models(model.id,selected)]);}catch(e){if((e as {statusCode?:number}).statusCode)throw e;fail('Token01 报价或模型权限查询暂不可用，请稍后重查',502);}
    if(!visible.includes(model.upstreamId))fail('当前 Token01 密钥未开通 '+model.upstreamId);
    const rows=items.map(item=>({index:item.index,...token01ItemPrice(item,catalog)}));
    // The documented API Key endpoints do not expose an authoritative wallet amount or actual routed group.
    // Keep the unknown balance explicit; do not use the other supplier's wallet or invent a conversion.
    return {credentialVersion:selected,checkedAt:new Date().toISOString(),balance:null,keyRemaining:null,reserved:0,available:null,
      minimum:Math.ceil((rows.reduce((n,r)=>n+r.minimum,0)-1e-10)*1e6)/1e6,maximum:Math.ceil((rows.reduce((n,r)=>n+r.maximum,0)-1e-10)*1e6)/1e6,
      affordable:true,provider:'token01',unit:'元',note:model.token01Group?`Token01 分组：${model.token01Group}，使用该分组保存的密钥和公开价格。请确认密钥在平台绑定同名分组；最终费用与退款以平台使用日志为准。`:note,items:rows};
  }
  async function upload(id:string,version:string,asset:Asset){
    if(asset.type!=='image'||asset.source==='simulator')fail('Token01 仅接受真实图片素材');
    const bytes=fs.readFileSync(assetFile(store,asset));if(bytes.length>20*1024*1024)fail('Token01 单张图片不得超过 20 MiB');
    const form=new FormData();form.append('file',new Blob([bytes],{type:asset.mime}),path.basename(asset.url));
    const key=secret(id,version),data=await json(await request('/v1/uploads/images',key,{method:'POST',body:form}),key);
    let url:URL;try{url=new URL(data.url);}catch{fail('Token01 上传未返回有效图片地址',502);}
    if(url.protocol!=='https:'||url.username||url.password)fail('Token01 上传图片地址无效',502);
    return url.href;
  }
  function body(item:PlanItem,urls:string[]){
    const {resolution,mode}=validateToken01Item(item);
    const referenceText=urls.length&&mode==='reference'?'\n参考图按上传顺序对应 '+urls.map((_,i)=>`<Picture ${i+1}>`).join('、')+'。':'';
    return {model:item.model.upstreamId,prompt:item.prompt+referenceText,duration:Number(item.parameters.duration),
      ...(item.model.id==='minimax-h3-fast'?{resolution,ratio:item.parameters.aspectRatio}:{size:resolution.toUpperCase(),metadata:{parameters:{ratio:item.parameters.aspectRatio}}}),
      ...(urls.length?mode==='reference'?{reference_images:urls}:mode==='first-frame'?{first_frame_url:urls[0]}:{first_frame_url:urls[0],last_frame_url:urls[1]}:{}),
    };
  }
  const taskId=(id:string)=>{if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))fail('Token01 任务号无效');return encodeURIComponent(id);};
  return {quote,models,modelsWithKey,catalog:async()=>pricingSchema.parse(await json(await request('/api/pricing'))),upload,body,json,
    submit:(id:string,version:string,payload:unknown)=>request('/v1/video/generations',secret(id,version),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),
    async task(id:string,version:string,task:string){const key=secret(id,version);const payload=await json(await request('/v1/video/generations/'+taskId(task),key),key);const data=payload.data||payload;
      if(typeof data.status!=='string')fail('Token01 未返回有效任务状态',502);
      // Generic responses include a numeric database id alongside the public task_id.
      const publicId=data.task_id!==undefined?data.task_id:typeof data.id==='string'?data.id:undefined;
      if(publicId!==undefined&&publicId!==task)fail('Token01 返回的任务号不匹配',502);
      return {status:data.status.toLowerCase(),error:String(redactProvider(data.fail_reason||data.error?.message||'',key)).slice(0,800)};
    },
    async content(id:string,version:string,task:string){const response=await request('/v1/videos/'+taskId(task)+'/content',secret(id,version));if(!response.ok)fail(`Token01 视频下载失败（HTTP ${response.status}），可重试保存`,502);const bytes=await token01Bytes(response,100*1024*1024);if(bytes.subarray(4,8).toString()!=='ftyp')fail('Token01 下载内容不是 MP4',502);return {bytes,mime:'video/mp4',url:token01Origin+'/v1/videos/'+taskId(task)+'/content'};},
  };
}
