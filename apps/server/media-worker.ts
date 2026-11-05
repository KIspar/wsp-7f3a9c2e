import {updateCurrentResult} from './current-results';
import {appendConfirmedFacts} from './fact-panel';
import {factScreens} from './image-design';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type {Asset,Attempt,LedgerEntry} from '../../packages/contracts';
import type {ProviderCredentialId,ProviderTask} from '../../packages/provider';
import type {Store} from './store';
import {createProviderService,type ProviderTransport,redactProvider} from './provider';
import {credentialVault} from './credentials';
import {assetFile,probeVideo} from './analysis-media';
import {readRemote,type RemoteReader} from './remote';
import {createToken01Service,validateToken01Item,token01Bytes} from './token01';
const now=()=>new Date().toISOString();
/** Production worker. A persisted submitting state is never retried as another paid request. */
export function createMediaWorker(store:Store,options:{transport?:ProviderTransport;remote?:RemoteReader;interval?:number;pollMs?:number}={}){
  const transport=options.transport||fetch,remote=options.remote||readRemote,provider=createProviderService(store,transport),vault=credentialVault(store.dataDir);
  const token01=createToken01Service(store,transport);
  let timer:ReturnType<typeof setInterval>|undefined,stopping=false;const running=new Map<string,Promise<unknown>>();
  const change=(id:string,patch:Partial<Attempt>)=>store.transaction(()=>{const a=store.get<Attempt>('attempt',id)!;const next={...a,...patch,revision:a.revision+1,updatedAt:now()};store.put('attempt',id,next);return next;});
  function ledger(a:Attempt){const batch=store.readBatch(a.batchId)!;const entry:LedgerEntry={id:`ledger-${a.id}`,attemptId:a.id,batchId:a.batchId,skillId:batch.skillId,modelId:a.model.id,modelName:a.model.name,points:a.billing?.cost??null,createdAt:now(),simulated:false,cost:a.billing?.cost,refunded:a.billing?.refunded,refundedAmount:a.billing?.refundedAmount,upstreamTaskId:a.upstreamTaskId,...(a.model.provider==='token01'?{unit:'元' as const}:{})};store.transaction(()=>store.db.prepare('INSERT INTO ledger(attempt_id,value) VALUES (?,?) ON CONFLICT(attempt_id) DO UPDATE SET value=excluded.value').run(a.id,JSON.stringify(entry)));}
  async function submitToken01(a:Attempt){
    const version=a.credentialVersion;let payload:unknown;
    try{
      if(!version)throw Error('请先配置 Token01 密钥');
      validateToken01Item(a);
      const quote=await token01.quote([{...a,index:1,variant:1}],version);
      if(a.reservedCost!==undefined&&quote.maximum>a.reservedCost+1e-9)throw Error('Token01 报价已上涨，请重新预览后生成');
      const urls:string[]=[];
      for(const id of a.references){const asset=store.get<Asset>('asset',id);if(!asset)throw Error('Token01 参考素材不存在');urls.push(await token01.upload(a.model.id,version,asset));}
      payload=token01.body({...a,index:1,variant:1},urls);
    }catch(e){change(a.id,{status:'failed',step:'Token01 提交前检查失败',error:(e as Error).message});return;}
    if(store.get<Attempt>('attempt',a.id)?.status!=='queued'||store.get<Attempt>('attempt',a.id)?.revision!==a.revision)return;
    change(a.id,{status:'generating',step:'正在提交真实生成请求',submittedAt:now()});
    let response:Response;
    try{response=await token01.submit(a.model.id,version!,payload);}catch{change(a.id,{status:'pending_verification',step:'提交结果待核实',error:'Token01 连接中断，可能已受理；不会自动重发付费请求'});return;}
    let raw:any;try{raw=JSON.parse((await token01Bytes(response,4*1024*1024)).toString('utf8'));}catch{/* A malformed response must never trigger another POST. */}
    const data=raw?.data||raw,id=data?.task_id??data?.id;
    if(typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id)){
      change(a.id,{status:'generating',upstreamTaskId:id,step:'Token01 生成中',error:undefined,nextPollAt:Date.now()+(options.pollMs??10000)});return;
    }
    if(!response.ok&&[400,401,403,404,422,429].includes(response.status)||response.ok&&(raw?.error||raw?.success===false||raw?.code!==undefined&&![true,'success',0,200].includes(raw.code))){
      change(a.id,{status:'failed',step:'Token01 拒绝请求',error:String(redactProvider(raw?.error?.message||raw?.message||`HTTP ${response.status}`,vault.get(a.model.id,version!))).slice(0,800)});return;
    }
    change(a.id,{status:'pending_verification',step:'提交结果待核实',error:'Token01 未返回可查询任务号，请在平台日志核实；禁止自动重新生成'});
  }
  async function submit(a:Attempt){
    if(a.model.provider==='token01'){await submitToken01(a);return;}
    const version=a.credentialVersion;if(!version){change(a.id,{status:'failed',step:'凭据缺失',error:'接单时未配置媒体模型凭据，请配置后重新预览'});return;}
    let secret:string;try{secret=vault.get(a.model.id,version);}catch{change(a.id,{status:'failed',step:'凭据不可用',error:'接单时的凭据版本不可用'});return;}
    let params:Record<string,unknown>;
    try{
      params={...a.parameters,aspect_ratio:a.parameters.aspectRatio};delete params.aspectRatio;
      if(!['tt-image','omni','gk-video-3.5'].includes(a.model.id)||a.model.provider!=='chuhe')throw Error('该模型没有真实生成适配器');
      if(a.model.id==='gk-video-3.5'&&a.references.length!==1)throw Error('GK 视频必须且只能使用一张确认首帧');
      let total=0;params.images=a.references.map(id=>{const asset=store.get<Asset>('asset',id);if(!asset||asset.type!=='image'||asset.source==='simulator')throw Error('真实生成仅接受用户上传或采集的真实图片，请更换模拟素材');const b=fs.readFileSync(assetFile(store,asset));if(b.length>10*1024*1024)throw Error('单张参考图超过供应商 10MB 限制，请压缩后上传');total+=b.length;return `data:${asset.mime};base64,${b.toString('base64')}`;});if(total>30*1024*1024)throw Error('参考图片总大小超过供应商 30MB 限制');
    }catch(e){change(a.id,{status:'failed',step:'输入校验失败',error:(e as Error).message});return;}
    if(a.reservedCost!==undefined){
      try{const {data}=await provider.balance(a.model.id as ProviderCredentialId,version);const b=data as import('../../packages/provider').ProviderBalance;
      const held=store.list<Attempt>('attempt').filter(x=>x.model.provider!=='token01'&&x.id!==a.id&&!x.simulated&&!x.upstreamTaskId&&['queued','generating','pending_verification','waiting_dependency','blocked_dependency'].includes(x.status));
      const reserved=held.reduce((n,x)=>n+(x.reservedCost||0),0),keyReserved=held.filter(x=>x.model.id===a.model.id).reduce((n,x)=>n+(x.reservedCost||0),0),remaining=b.api_key_quota.limit===0?Infinity:b.api_key_quota.remaining;
      if(remaining===undefined||Math.min(b.balance-reserved,remaining-keyReserved)+1e-9<a.reservedCost)throw Error('调度时账户或密钥算力不足，未发送生成请求');
      }catch(e){change(a.id,{status:'failed',step:'调度余额校验未通过',error:(e as Error).message});return;}
    }
    if(store.get<Attempt>('attempt',a.id)?.status!=='queued')return;
    // Commit before touching the network. A crash from this point is submission-unknown.
    change(a.id,{status:'generating',step:'正在提交真实生成请求',submittedAt:now()});
    let response:Response;
    try{response=await transport('https://api.lk888.ai/v1/media/generate',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({model:a.model.upstreamId,prompt:a.prompt,params}),redirect:'error',signal:AbortSignal.timeout(120000)});}
    catch{change(a.id,{status:'pending_verification',step:'提交结果待核实',error:'连接中断，供应商可能已受理；不会自动重发付费请求'});return;}
    const header=response.headers.get('X-Task-Id');
    let raw:Record<string,unknown>={};try{raw=await response.json();}catch{/* A task id still permits recovery. */}
    const d=(raw.data||raw) as Record<string,unknown>,id=header||d.task_id||(Array.isArray(d['任务ids'])?d['任务ids'][0]:undefined);
    if(typeof id==='string'||typeof id==='number'){change(a.id,{status:'generating',upstreamTaskId:String(id),step:'供应商生成中',error:undefined,nextPollAt:Date.now()+(options.pollMs??5000)});return;}
    if(!response.ok&&[400,401,403,404,422,429].includes(response.status)){change(a.id,{status:'failed',step:'供应商拒绝请求',error:String(redactProvider(d.message||d.error||`HTTP ${response.status}`,secret)).slice(0,800)});return;}
    change(a.id,{status:'pending_verification',step:'提交结果待核实',error:'响应未包含可核实任务号，禁止自动重发；请在全部任务中核查消费与供应商任务'});
  }
  async function save(a:Attempt){
    if(!a.resultUrl){change(a.id,{status:'failed',step:'保存失败',error:'供应商成功但未返回结果地址，请核实任务'});return;}
    try{
      const result=a.model.provider==='token01'?await token01.content(a.model.id,a.credentialVersion!,a.upstreamTaskId!):await remote(a.resultUrl,{httpsOnly:true,maxBytes:a.model.category==='video'?100*1024*1024:30*1024*1024});let ext:string,mime:string;
      if(a.model.category==='video'){
        const temp=path.join(store.dataDir,'media',`${a.id}.probe.tmp`);fs.writeFileSync(temp,result.bytes);try{const p=await probeVideo(temp,{input:false});if(p.mime!=='video/mp4')throw Error('供应商未返回 MP4 成片');if(Math.abs(p.duration-Number(a.parameters.duration))>2)throw Error('视频时长与请求不符，请核实供应商结果');ext='mp4';mime=p.mime;}finally{fs.rmSync(temp,{force:true});}
      }else{const m=await sharp(result.bytes,{limitInputPixels:80_000_000}).metadata();if(!['png','jpeg','webp'].includes(m.format||'')||!m.width||!m.height||(m.pages||1)>1)throw Error('结果不是有效静态图片');ext=m.format==='jpeg'?'jpg':m.format!;mime=`image/${m.format}`;}
      let outputBytes=result.bytes;
      const screen=store.readBatch(a.batchId)?.draft.imageDesign?.screens.find(s=>s.id===a.screenId);
      if(a.model.category==='image'&&screen&&factScreens.has(screen.type)&&screen.facts.trim()){
        const original=path.join(store.dataDir,'media',`provider-${a.id}-original.${ext}`);fs.writeFileSync(original,result.bytes);
        outputBytes=await appendConfirmedFacts(result.bytes,screen.scopeLabel?`${screen.type} · ${screen.scopeLabel}`:screen.type,screen.facts);ext='png';mime='image/png';
      }
      const id=`provider-${a.id}`,filename=`${id}.${ext}`,file=path.join(store.dataDir,'media',filename);fs.writeFileSync(file+'.tmp',outputBytes);fs.renameSync(file+'.tmp',file);
      const asset:Asset={id,url:`/media/${filename}`,type:a.model.category==='video'?'video':'image',mime,bytes:outputBytes.length,source:'provider',createdAt:now()};const next=store.transaction(()=>{store.put('asset',id,asset);const current=store.get<Attempt>('attempt',a.id)!;const next={...current,status:'completed' as const,step:'真实成品已保存',assetId:id,error:undefined,nextPollAt:a.billing?.isFinal||a.model.provider==='token01'?undefined:Date.now()+30000,revision:current.revision+1,updatedAt:now()};store.put('attempt',a.id,next);updateCurrentResult(store,next);return next;});ledger(next);
    }catch(e){change(a.id,{status:'failed',step:'保存失败',error:(e as Error).message,nextPollAt:undefined});}
  }
  async function poll(a:Attempt){
    try{
      if(a.model.provider==='token01'){
        const data=await token01.task(a.model.id,a.credentialVersion!,a.upstreamTaskId!);
        const billing={isFinal:false,unit:'元' as const,note:'最终费用及退款请在 Token01 使用日志核对'};
        if(['failure','failed','cancelled','canceled'].includes(data.status)){const next=change(a.id,{status:'failed',step:'Token01 生成失败',billing,error:data.error||'Token01 任务失败，请核对平台退款日志',nextPollAt:undefined});ledger(next);return;}
        if(['success','succeeded','completed'].includes(data.status)){
          const resultUrl=`https://www.token01.net/v1/videos/${encodeURIComponent(a.upstreamTaskId!)}/content`;
          const next=change(a.id,{status:'saving',step:'验证并下载真实成品',billing,resultUrl,error:undefined,nextPollAt:undefined});await save(next);return;
        }
        change(a.id,{step:'Token01 生成中',error:data.status==='unknown'?'Token01 状态暂不明确，继续查询；不会重新生成':undefined,nextPollAt:Date.now()+(options.pollMs??10000)});return;
      }
      const {data}=await provider.task(a.model.id as ProviderCredentialId,a.upstreamTaskId!,a.credentialVersion);const d=data as ProviderTask;
      const billing={cost:d.cost,isFinal:d.is_final&&typeof d.cost==='number',refunded:d.refunded,refundedAmount:d.refunded_amount,inputTokens:d.input_tokens,outputTokens:d.output_tokens,channelGroup:typeof d.channel_group==='string'?d.channel_group:undefined};
      if(d.state==='failed'&&d.is_final){const next=change(a.id,{status:'failed',step:'供应商生成失败',billing,error:String(d.error||'生成失败，退款状态以接口为准'),nextPollAt:billing.isFinal?undefined:Date.now()+30000});ledger(next);return;}
      if(d.state==='success'&&d.is_final){
        if(a.status==='completed'){const next=change(a.id,{billing,nextPollAt:billing.isFinal?undefined:Date.now()+30000});ledger(next);return;}
        const url=d.result_url||d.result_urls?.[0];if(!url){change(a.id,{status:'failed',step:'保存失败',billing,error:'供应商未返回成品地址',nextPollAt:undefined});return;}
        const next=change(a.id,{status:'saving',step:'验证并下载真实成品',billing,resultUrl:url,error:undefined,nextPollAt:undefined});await save(next);return;
      }
      change(a.id,{billing,step:'供应商生成中',error:undefined,nextPollAt:Date.now()+(options.pollMs??5000)});
    }catch(e){change(a.id,{error:(e as Error).message,step:a.status==='completed'?a.step:'状态查询暂不可用，稍后补查',nextPollAt:Date.now()+15000});}
  }
  function dispatch(a:Attempt,fn:()=>Promise<unknown>){if(running.has(a.id))return;const p=fn().catch(e=>{change(a.id,{status:'pending_verification',step:'任务需要核实',error:String(redactProvider((e as Error).message))});}).finally(()=>running.delete(a.id));running.set(a.id,p);}
  async function tick(){if(stopping)return;
    let all=store.list<Attempt>('attempt').filter(a=>!a.simulated);
    for(const a of all){if(running.has(a.id))continue;
      if(['waiting_dependency','blocked_dependency'].includes(a.status)){const dep=store.get<Attempt>('attempt',a.dependencyTaskId||'');if(dep?.status==='completed'&&dep.assetId)change(a.id,{status:'queued',step:'依赖素材已绑定，等待调度',references:[...new Set([...a.references,dep.assetId])]});else if(!dep||['failed','pending_verification'].includes(dep.status))change(a.id,{status:'blocked_dependency',step:'依赖任务异常，请处理后继续'});}
      if(a.upstreamTaskId&&((a.status==='generating'||a.status==='pending_verification')||['completed','failed'].includes(a.status)&&a.nextPollAt!==undefined)&&(!a.nextPollAt||a.nextPollAt<=Date.now()))dispatch(a,()=>poll(a));
      else if(a.status==='saving')dispatch(a,()=>save(a));
    }
    all=store.list<Attempt>('attempt').filter(a=>!a.simulated);
    for(const category of ['image','video'] as const){const limit=category==='image'?store.settings().imageConcurrency:store.settings().videoConcurrency;let active=all.filter(a=>a.model.category===category&&['generating','saving'].includes(a.status)).length;
      for(const a of all.filter(a=>a.model.category===category&&a.status==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(active>=limit)break;if(running.has(a.id))continue;active++;dispatch(a,()=>submit(a));}}
    await Promise.allSettled([...running.values()]);
  }
  return {tick,start(){stopping=false;for(const a of store.list<Attempt>('attempt').filter(a=>!a.simulated&&a.status==='generating'&&!a.upstreamTaskId))change(a.id,{status:'pending_verification',step:'重启后提交结果待核实',error:'上次提交可能已计费，不自动重新发送'});if(!timer)timer=setInterval(()=>void tick(),options.interval??1000);},async stop(){stopping=true;clearInterval(timer);await Promise.allSettled([...running.values()]);}};
}
