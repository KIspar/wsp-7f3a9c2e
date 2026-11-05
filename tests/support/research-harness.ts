/** Isolated fixtures: synthetic local files, in-memory provider responses, no external transport. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createStore} from '../../apps/server/store';
import {createApp} from '../../apps/server/app';
import {createAnalysisService} from '../../apps/server/analysis';
import {createResearchService} from '../../apps/server/research';
import {createMediaWorker} from '../../apps/server/media-worker';
import {credentialVault} from '../../apps/server/credentials';
import type {CatalogProduct} from '../../packages/catalog';
import type {Asset,Attempt} from '../../packages/contracts';
import {researchInputSchema,type CreativeStrategy,type ProductResearch} from '../../packages/research';

export async function researchHarness(options:{workers?:boolean;directory?:string}={}){
 const dir=options.directory||fs.mkdtempSync(path.join(os.tmpdir(),'research-flow-'));
 const store=createStore(dir,process.cwd());
 const ids:string[]=[];
 for(let i=0;i<9;i++){
  const id=`flow-image-${i}`,bytes=await sharp({create:{width:320,height:400,channels:3,background:{r:30+i*23,g:70+i*11,b:120}}}).png().toBuffer();
  fs.writeFileSync(path.join(dir,'media',id+'.png'),bytes);
  store.put('asset',id,{id,url:'/media/'+id+'.png',type:'image',mime:'image/png',bytes:bytes.length,source:'upload',createdAt:new Date().toISOString()} satisfies Asset);ids.push(id);
 }
 const stamp=new Date().toISOString();
 const product:CatalogProduct={id:'research-flow-product',revision:1,title:'全流程测试 · 拼接立领外套',site:'jp0663',sourceId:'isolated-flow',sourceUrl:'https://pc.jp0663.com/detail/isolated-flow',supplier:'',itemNumber:'FLOW-001',wholesaleCost:30,salePrice:null,sellingPoints:'用户确认：立领、半开拉链。',parameters:[{name:'防水',value:'来源声明，尚未核实',origin:'source'}],colors:[],sizes:[],skus:[],postTitle:'',postBody:'',archived:false,bindings:[{id:'flow-main',assetId:ids[0],kind:'main',label:'测试商品主图',order:0}],collectionStatus:'completed',createdAt:stamp,updatedAt:stamp};
 store.put('catalog-product',product.id,product);
 const input=researchInputSchema.parse({productImageIds:[ids[0]],groups:[{id:'rival-1',imageIds:ids.slice(1,4)}]});
 const emptyInput=researchInputSchema.parse({});
 store.put('research-draft',product.id,{id:product.id,revision:0,value:emptyInput,updatedAt:stamp});
 const vault=credentialVault(dir);
 for(const id of ['tt-image','omni','gk-video-3.5'])vault.set(id,'sk-isolated-flow-no-real-key-1234567890');
 const calls:{kind:string;url:string;method:string;body?:any}[]=[];
 const control={balance:100,priceMultiplier:1,analysisFailure:'' as ''|'invalid'|'unknown'|'http400'|'invalid-evidence',billingUnavailable:false,settleUnknown:false,mediaFailure:false};
 let sequence=0;
 const replies=new Map<string,string>();
 const mediaTasks=new Map<string,{model:string;duration:number}>();
 const png=await sharp({create:{width:320,height:400,channels:3,background:'#365b82'}}).png().toBuffer();
 const video=fs.readFileSync(path.join(process.cwd(),'public/examples/demo-portrait-4.mp4'));
 function strategy(index:number):CreativeStrategy{return {name:['日常通勤','外观细节','周末场景'][index%3],angle:'围绕用户选择的立领外观安排独立叙事',evidenceIds:['product-facts'],requirements:'依据自有商品原图保留立领和拉链，未核实性能不作承诺',kit:Array.from({length:7},(_,i)=>`第${i+1}张：独立景别${i+1}，展示自有商品可见外观`),detail:[{type:'首屏主视觉',prompt:'商品完整外观与干净背景'},{type:'核心卖点图',prompt:'立领近景'},{type:'商品细节图',prompt:'半开拉链细节'}],post:Array.from({length:6},(_,i)=>`第${i+1}页：场景${i+1}与独立动作`),video:{script:'0–4秒，展示整体后近景展示拉链',prompt:'固定机位，自然光，完整短片',duration:4}};}
 const summary={summary:'测试资料支持立领与拉链的可见外观；防水没有证据，不能作为商品承诺。',findings:[{id:'collar',category:'selling',label:'立领外观',detail:'来自自有商品原图与用户说明',basis:'visible',evidenceIds:['product-facts'],usable:true},{id:'commute',category:'scene',label:'通勤场景',detail:'创意场景建议',basis:'hypothesis',evidenceIds:['product-facts'],usable:true},{id:'waterproof',category:'feature',label:'防水声明',detail:'来源声称，尚待核实',basis:'source',evidenceIds:['product-facts'],usable:true}],missing:['材质与实测尺码仍需补充']};
 async function transport(raw:string,init:RequestInit){
  const url=new URL(raw),method=init.method||'GET',body=init.body?JSON.parse(String(init.body)):undefined;
  if(url.origin!=='https://api.lk888.ai')throw Error('Unexpected network destination: '+url.origin);
  if(url.pathname.endsWith('/balance'))return Response.json({balance:control.balance,unit:'算力',api_key_quota:{limit:0,used:0}});
  if(url.pathname.endsWith('/pricing')){
   const model=url.searchParams.get('model')||'';
   return Response.json({available_for_this_key:true,channel_groups:[{group_id:'isolated',group_name:'隔离测试报价',is_active:true,in_key_whitelist:true,excluded_for_this_key:false,billing_method:'按次',base_price:(model.includes('omni')?.2:.01)*control.priceMultiplier,input_image_price:0,input_image_free_count:0,input_token_price:1*control.priceMultiplier,output_token_price:1*control.priceMultiplier,option_prices:[]}]});
  }
  if(url.pathname.endsWith('task-status')){
   if(control.billingUnavailable)return Response.json({error:'temporary'},{status:503});
   const taskId=url.searchParams.get('task_id')||'',task=mediaTasks.get(taskId);
   if(task)return Response.json({task_id:taskId,state:control.mediaFailure?'failed':'success',is_final:true,cost:control.mediaFailure?0:task.model.includes('omni')?.2:.01,refunded:control.mediaFailure,result_url:`https://fixture.invalid/${taskId}.${task.model.includes('omni')?'mp4':'png'}`});
   return Response.json({task_id:taskId,state:'success',is_final:true,cost:.001,input_tokens:200,output_tokens:100,...(control.settleUnknown?{ai_reply:replies.get(taskId)}:{})});
  }
  if(url.pathname==='/v1/media/generate'){
   calls.push({kind:'media',url:raw,method,body});const taskId='media-flow-'+(++sequence);mediaTasks.set(taskId,{model:body.model,duration:Number(body.params.duration||4)});return Response.json({task_id:taskId});
  }
  if(method!=='POST')return Response.json({message:'isolated fixture: unsupported metadata'},{status:404});
  const text=body.messages?(typeof body.messages[0].content==='string'?body.messages[0].content:body.messages[0].content[0].text):body.contents[0].parts[0].text;
 const kind=text.includes('这是第')?'strategy':text.includes('你是商品研究员')?'evidence':text.includes('你是抖音电商运营策划')?'summary':text.includes('分析所附完整视频的时间顺序与动态变化')?'video':'summary';
  calls.push({kind,url:raw,method,body});const taskId='analysis-flow-'+(++sequence);
  const headers={'X-Task-Id':taskId};
  if(control.analysisFailure==='http400')return Response.json({error:'invalid test input'},{status:400,headers});
  let output:string;
  if(control.analysisFailure==='invalid')output='not JSON';
  else if(kind==='evidence'){
   const evidenceText=text.split('用户要求 / 已知参数：')[1].split('\n素材数量：')[0],evidence=JSON.parse(evidenceText);
   output=JSON.stringify({observations:evidence.map((e:any)=>({evidenceId:control.analysisFailure==='invalid-evidence'?'invented-evidence':e.id,description:'测试证据：保留原资料身份',uncertainty:'没有材质或功效验证'}))});
  }else if(kind==='strategy')output=JSON.stringify({strategies:[strategy(Number(text.match(/这是第(\d)套/)?.[1]||'1')-1)]});
  else if(kind==='video')output='## 镜头分析\n[00:00-00:04] 主体动作：物体移动。场景：室内。构图：中央。运镜：固定。可辨识文案：无。分镜提示词：展示动作。\n## 整片提示词\n完整动态展示\n## 不确定信息\n无音轨推断';
  else output=JSON.stringify(summary);
  replies.set(taskId,output);
  if(control.analysisFailure==='unknown')return new Response('',{status:502,headers});
  return body.messages?Response.json({choices:[{message:{content:output}}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}},{headers}):Response.json({candidates:[{content:{parts:[{text:output}]}}],usageMetadata:{promptTokenCount:200,candidatesTokenCount:100,totalTokenCount:300}},{headers});
 }
 const remote=async(url:string)=>{if(!url.startsWith('https://fixture.invalid/'))throw Error('Unexpected result host');return {bytes:url.endsWith('.mp4')?video:png,mime:url.endsWith('.mp4')?'video/mp4':'image/png',url};};
 const analysis=createAnalysisService(store,transport);
 for(const id of ['gem-3.8-flash','tt-6.1-sol'] as const)analysis.configure(id,{key:'sk-isolated-analysis-no-real-key-1234567890'});
 // TT's actual verification gate is tested by analysis.test.ts; this fixture starts after that gate.
 const tt=store.get<any>('analysis-model','tt-6.1-sol');store.put('analysis-model',tt.id,{...tt,vision:{status:'passed',credentialVersion:vault.current(tt.id),reason:'isolated test prerequisite'}});
 const app=await createApp(store,{worker:!!options.workers,providerTransport:transport,analysisService:analysis,mediaRemote:remote});
 const research=createResearchService(store,analysis);
 const media=createMediaWorker(store,{transport,remote,pollMs:0});
 const token=(await app.inject('/api/bootstrap')).json().token;
 async function request(method:string,url:string,payload?:unknown,headers:Record<string,string>={}){return app.inject({method:method as any,url,headers:{'x-studio-token':token,...headers},...(payload===undefined?{}:{payload:payload as any})});}
 async function drain(id:string){for(let i=0;i<150;i++){research.tick();await research.idle();analysis.tick();await analysis.idle();const j=research.get(id);if(['completed','failed','paused','unknown'].includes(j.status))return j;}throw Error('Research did not terminate: '+JSON.stringify(research.get(id)));}
 async function analyze(mode:'gem'|'tt'|'hybrid'='gem'){
  const i={...input,modelMode:mode},q=await research.estimate(product.id,i),j=await research.start(product.id,{input:i,maximumCost:q.estimated,productRevision:product.revision,idempotencyKey:crypto.randomUUID()});return drain(j.id);
 }
 async function plan(mode:'gem'|'tt'|'hybrid'='gem'){const result=await analyze(mode);if(result.status!=='completed')throw Error(result.error);const j=await research.strategy(result.id,{selectedIds:['collar','commute'],maximumCost:1,idempotencyKey:crypto.randomUUID()});return drain(j.id);}
 async function drainMedia(){for(let i=0;i<40;i++){await media.tick();const attempts=store.list<Attempt>('attempt');if(attempts.length&&attempts.every(a=>['completed','failed','pending_verification'].includes(a.status)))return attempts;}throw Error('Media did not terminate');}
 return {dir,store,app,analysis,research,media,product,input,ids,token,control,calls,request,drain,analyze,plan,drainMedia,strategy,remote,transport,async close(){await media.stop();await research.stop();await app.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
export type ResearchHarness=Awaited<ReturnType<typeof researchHarness>>;
