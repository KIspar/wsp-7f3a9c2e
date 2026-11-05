import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Store} from './store';
import {fail} from './errors';
import type {AnalysisService} from './analysis';
import type {AnalysisJob} from '../../packages/analysis';
import type {Asset} from '../../packages/contracts';
import {getCatalogProduct} from './catalog';
import {assetFile,sha256} from './analysis-media';
import fs from 'node:fs';
import {researchInputSchema,evidenceResultSchema,researchResultSchema,strategiesResultSchema,type ResearchInput,type ResearchDraft,type ProductResearch,type ResearchCollection,type Evidence,type ResearchStep} from '../../packages/research';
const now=()=>new Date().toISOString();
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const modelOf=(mode:ResearchInput['modelMode'],phase:'evidence'|'summary')=>mode==='tt'||mode==='hybrid'&&phase==='summary'?'tt-6.1-sol' as const:'gem-3.8-flash' as const;
export function parseResearchJson(raw:string){return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
export function researchDraft(store:Store,id:string):ResearchDraft{getCatalogProduct(store,id);return store.get<ResearchDraft>('research-draft',id)||{id,revision:0,value:researchInputSchema.parse({}),updatedAt:now()};}
export function researchEvidence(store:Store,productId:string,input:ResearchInput):Evidence[]{
 const p=getCatalogProduct(store,productId),items:Evidence[]=[{id:'product-facts',groupId:'own',kind:'product',label:'自有商品资料',text:JSON.stringify({title:p.title,confirmedSellingPoints:p.sellingPoints,parameters:p.parameters,colors:p.colors,sizes:p.sizes,price:p.salePrice,priceNote:'售价由用户填写，不以货源批发价代替'})}];
 if(!input.productImageIds.length)fail('请先选择自有商品图片');
 if(!input.groups.length||new Set(input.groups.map(g=>g.id)).size!==input.groups.length)fail('请添加有效的同行图片组');
 const image=(id:string,groupId:string,label:string)=>{const a=store.get<Asset>('asset',id);if(!a||a.type!=='image'||['simulator','example'].includes(a.source)||!fs.existsSync(assetFile(store,a)))fail('商品或同行图片缺失，请重新选择');return {id:`${groupId}:${id}`,groupId,kind:'image' as const,label,assetId:id,text:'图片可见证据，不推断材质或功效'};};
 input.productImageIds.forEach((id,i)=>items.push(image(id,'own',`自有商品图${i+1}`)));
 let complete=0;
 for(const [index,g] of input.groups.entries()){
  const distinct=new Set(g.imageIds.map(id=>{const a=store.get<Asset>('asset',id)||fail('同行图片不存在');return sha256(fs.readFileSync(assetFile(store,a)));}));
  if(distinct.size!==g.imageIds.length)fail(`同行${index+1}有重复图片，请移除重复项`);
  if(input.method==='quick'&&g.imageIds.length<3)fail(`同行${index+1}至少需要3张不同图片；不纳入时请移除此组`);
  g.imageIds.forEach((id,i)=>items.push(image(id,g.id,`同行${index+1} 图${i+1}`)));
  if(input.method==='quick'&&g.imageIds.length>=3)complete++;
  for(const id of input.method==='deep'?g.collectionIds:[]){
   const c=store.get<ResearchCollection>('research-collection',id)||fail('采集资料不存在');if(c.productId!==productId||c.groupId!==g.id)fail('采集资料不属于当前商品和同行组');
   if(!['completed','partial'].includes(c.status))fail('请先完成链接采集或补充资料');
   items.push({id:c.id,groupId:g.id,kind:'text',label:`同行${index+1} 内容与商品承接`,sourceUrl:c.url,text:JSON.stringify({title:c.title,text:c.text,productInfo:c.productInfo,warnings:c.warnings,stopReason:c.stopReason,sort:c.sort})});
   for(const m of c.media){const a=store.get<Asset>('asset',m.assetId);if(!a)fail('采集媒体缺失');items.push({...imageEvidence(a,g.id,m.label),id:`${c.id}:${m.role}:${m.assetId}`,sourceUrl:c.url,text:`素材用途：${m.role}；不是自有商品事实`});}
   c.comments.forEach(comment=>items.push({id:`${c.id}:${comment.id}`,groupId:g.id,kind:'comment',label:comment.kind==='buyer-review'?'页面商品评价':'内容互动评论',sourceUrl:c.url,text:JSON.stringify(comment)}));
   if(c.text||c.media.length||c.comments.length)complete++;
  }
 }
 if(!complete)fail(input.method==='quick'?'至少需要一家同行的3张图片':'请先采集至少一条有内容的同行链接');
 if(new Set(items.map(e=>e.id)).size!==items.length)fail('同一同行存在重复来源，请调整后分析');return items;
}
function imageEvidence(a:Asset,groupId:string,label:string):Evidence{return {id:a.id,groupId,label,kind:a.type==='video'?'video':'image',assetId:a.id,text:''};}
function pack<T>(items:T[],size:(x:T)=>number,max:number):T[][]{const chunks:T[][]=[];for(const item of items){if(size(item)>max)fail('单项资料超过分析输入限制，请精简后重试');const last=chunks.at(-1);if(!last||last.reduce((s,x)=>s+size(x),0)+size(item)>max)chunks.push([item]);else last.push(item);}return chunks;}
export function researchSteps(input:ResearchInput,evidence:Evidence[],videoModelId:'gem-3.8-flash'|'gem-4-argon'='gem-3.8-flash'):ResearchStep[]{
 const steps:ResearchStep[]=[],modelId=modelOf(input.modelMode,'evidence');
 const add=(label:string,items:Evidence[],action:ResearchStep['action']='research-evidence')=>{const text=JSON.stringify(items.map(({assetId,...e})=>({...e,...(assetId?{assetId}:{})})));if(text.length>12000)fail('单批材料过长，请精简');steps.push({id:`evidence-${steps.length}`,label,kind:'evidence',assetIds:items.flatMap(e=>e.assetId?[e.assetId]:[]),evidenceIds:items.map(e=>e.id),text,modelId,action,attempt:0});};
 for(const group of ['own',...input.groups.map(g=>g.id)]){
  const imgs=evidence.filter(e=>e.groupId===group&&e.kind==='image');for(let i=0;i<imgs.length;i+=4)add(group==='own'?`商品图片 · 第${i/4+1}批`:`同行图片 · 第${i/4+1}批`,imgs.slice(i,i+4));
  const videos=evidence.filter(e=>e.groupId===group&&e.kind==='video');for(const v of videos){if(modelId==='tt-6.1-sol')fail('TT研究暂不直接接收视频，请选择GEM/双模型或补充关键帧图片与文字');add('同行视频动态分析',[v],'reverse-video');steps[steps.length-1].modelId=videoModelId;}
  for(const chunk of pack(evidence.filter(e=>e.groupId===group&&!['image','video'].includes(e.kind)),e=>JSON.stringify(e).length,10000))add(group==='own'?'商品文字资料':'同行内容与用户反馈',chunk);
 }
 return steps;
}
export function createResearchService(store:Store,analysis:AnalysisService){
 const videoModelId=()=>typeof (analysis as {models?:unknown}).models==='function'&&analysis.models().some(m=>m.id==='gem-4-argon'&&m.enabled&&m.credentialConfigured)?'gem-4-argon' as const:'gem-3.8-flash' as const;
 const planSteps=(input:ResearchInput,evidence:Evidence[])=>researchSteps(input,evidence,videoModelId());
 const get=(id:string)=>store.get<ProductResearch>('product-research',id)||fail('商品研究不存在',404);
 const save=(j:ProductResearch)=>{j.updatedAt=now();store.put('product-research',j.id,j);};
 const facts=(j:ProductResearch)=>JSON.stringify({title:j.product.title,sellingPoints:j.product.sellingPoints,parameters:j.product.parameters,colors:j.product.colors,sizes:j.product.sizes});
 async function estimateSteps(steps:ResearchStep[]){const prices=new Map<string,Awaited<ReturnType<AnalysisService['estimate']>>>();for(const s of steps)if(!prices.has(s.modelId))prices.set(s.modelId,await analysis.estimate(s.modelId));return {estimated:steps.reduce((n,s)=>n+prices.get(s.modelId)!.estimated,0),available:Math.min(...[...prices.values()].map(p=>p.available)),prices:Object.fromEntries(prices)};}
 async function estimate(productId:string,input:ResearchInput){const evidence=researchEvidence(store,productId,input),steps=planSteps(input,evidence);const placeholder:ResearchStep={id:'summary',label:'综合洞察',kind:'summary',assetIds:[],evidenceIds:evidence.map(e=>e.id),text:'',modelId:modelOf(input.modelMode,'summary'),action:'research-summary',attempt:0};
  // Reserve one synthesis pass per evidence batch so larger source sets never hide extra calls.
  const summaries=Array.from({length:Math.max(1,steps.length)},(_,i)=>({...placeholder,id:`summary-${i}`}));const price=await estimateSteps([...steps,...summaries]);return {...price,calls:steps.length+summaries.length,evidenceCount:evidence.length};}
 async function start(productId:string,raw:unknown){const b=z.object({input:researchInputSchema,idempotencyKey:z.string().min(8).max(100),maximumCost:z.number().positive().finite(),productRevision:z.number().int()}).parse(raw),fingerprint=hash(b),old=store.list<ProductResearch>('product-research').find(j=>j.key===b.idempotencyKey);if(old){if(old.productId!==productId||old.fingerprint!==fingerprint)fail('接单凭据已用于其他研究',409);return old;}
  const p=getCatalogProduct(store,productId);if(p.revision!==b.productRevision)fail('商品已更新，请重新确认资料',409);const e=researchEvidence(store,productId,b.input),steps=planSteps(b.input,e),quote=await estimate(productId,b.input);if(quote.estimated>b.maximumCost+1e-9||quote.available<quote.estimated)fail('分析报价变化或余额不足，请重新查询',402);
  const j:ProductResearch={id:store.id('research'),workspaceId:store.currentWorkspace(),productId,key:b.idempotencyKey,fingerprint,createdAt:now(),updatedAt:now(),product:structuredClone(p),input:b.input,evidence:e,steps,status:'queued',selectedIds:[],maximumCost:b.maximumCost,estimated:quote.estimated,kind:'analysis'};return store.transaction(()=>{const existing=store.list<ProductResearch>('product-research').find(x=>x.key===b.idempotencyKey);if(existing){if(existing.productId!==productId||existing.fingerprint!==fingerprint)fail('接单凭据冲突',409);return existing;}save(j);return j;});}
 async function strategy(sourceId:string,raw:unknown){const source=get(sourceId),b=z.object({selectedIds:z.array(z.string()).min(1).max(30),maximumCost:z.number().positive().finite(),idempotencyKey:z.string().min(8).max(100)}).parse(raw);if(!source.result)fail('请先完成商品分析');if(b.selectedIds.some(id=>!source.result!.findings.some(f=>f.id===id&&f.usable)))fail('选中标签不可用于生成，请排除待核实事实');
  const fingerprint=hash({sourceId,...b}),old=store.list<ProductResearch>('product-research').find(j=>j.key===b.idempotencyKey);if(old){if(old.fingerprint!==fingerprint)fail('接单凭据冲突',409);return old;}
  const text=JSON.stringify({facts:JSON.parse(facts(source)),selected:source.result.findings.filter(f=>b.selectedIds.includes(f.id)),note:'只按所选标签组织；来源声明不升级为商品事实。每次返回一套完整方案，提示词简练但可执行。'});if(text.length>14000)fail('所选标签资料过长，请减少选择');
  const steps:ResearchStep[]=Array.from({length:3},(_,i)=>({id:`strategy-${i}`,label:`编排方案${i+1}`,kind:'strategy',action:'research-strategy',text:text+`\n这是第${i+1}套，请从${['主购买理由与日常使用','外观细节与选择帮助','独立场景与内容叙事'][i]}切入，返回且仅返回一套方案。`,assetIds:[],evidenceIds:source.evidence.map(e=>e.id),modelId:modelOf(source.input.modelMode,'summary'),attempt:0}));
  const quote=await estimateSteps(steps);if(quote.estimated>b.maximumCost+1e-9||quote.available<quote.estimated)fail('方案编排报价变化或余额不足',402);
  const j:ProductResearch={...structuredClone(source),id:store.id('research'),key:b.idempotencyKey,fingerprint,sourceResearchId:source.id,kind:'strategy',createdAt:now(),updatedAt:now(),steps,status:'queued',selectedIds:b.selectedIds,strategies:[],maximumCost:b.maximumCost,estimated:quote.estimated};delete j.error;return store.transaction(()=>{const existing=store.list<ProductResearch>('product-research').find(x=>x.key===b.idempotencyKey);if(existing){if(existing.fingerprint!==fingerprint)fail('接单凭据冲突',409);return existing;}save(j);source.selectedIds=b.selectedIds;save(source);return j;});}
 async function strategyEstimate(id:string){const j=get(id);return {...await analysis.estimate(modelOf(j.input.modelMode,'summary')),calls:3};}
 let running:Promise<void>|undefined,timer:ReturnType<typeof setInterval>|undefined,stopping=false;
 async function advance(j:ProductResearch){try{
   const step=j.steps.find(s=>!s.output);if(!step){
    if(j.kind==='analysis'&&!j.steps.some(s=>s.kind==='summary')){const batches=pack(j.steps.map(s=>({evidenceIds:s.evidenceIds,result:s.output})),x=>JSON.stringify(x).length,6500);for(const [i,batch] of batches.entries())j.steps.push({id:`summary-${i}`,label:`汇总商品洞察 · ${i+1}/${batches.length}`,kind:'summary',action:'research-summary',assetIds:[],evidenceIds:j.evidence.map(e=>e.id),text:JSON.stringify(batch),modelId:modelOf(j.input.modelMode,'summary'),attempt:0});save(j);return;}
    j.status='completed';save(j);return;
   }
   if(step.jobId){const job=analysis.job(step.jobId);if(['failed','unknown'].includes(job.status)){j.status=job.status==='unknown'?'unknown':'failed'; j.error=`${step.label}：${job.error||'分析未完成'}；已完成步骤保留。`;save(j);return;}if(job.status!=='completed')return;
    const allowed=new Set(step.evidenceIds);
    if(step.kind==='evidence'&&step.action!=='reverse-video'){const result=evidenceResultSchema.parse(parseResearchJson(job.result!));if(result.observations.some(o=>!allowed.has(o.evidenceId)))fail('模型返回了不存在的证据编号');step.output=JSON.stringify(result);}
    else if(step.kind==='summary'){const r=researchResultSchema.parse(parseResearchJson(job.result!));if(new Set(r.findings.map(f=>f.id)).size!==r.findings.length||r.findings.some(f=>f.evidenceIds.some(id=>!allowed.has(id))))fail('洞察结果的标签或证据编号无效');r.findings=r.findings.map(f=>({...f,usable:f.basis==='source'?false:f.usable}));if(JSON.stringify(r).length>7000)fail('洞察结果过长，保留原文，请主动重做精简汇总');j.result=r;step.output=JSON.stringify(r);}
    else if(step.kind==='strategy'){const r=strategiesResultSchema.parse(parseResearchJson(job.result!));if(r.strategies.some(s=>s.evidenceIds.some(id=>!allowed.has(id))))fail('方案包含不存在的证据');j.strategies=[...j.strategies||[],...r.strategies.slice(0,1)];step.output=JSON.stringify(r);}
    else step.output=JSON.stringify({evidenceIds:step.evidenceIds,videoAnalysis:job.result});
    save(j);return;
   }
   let text=step.text;if(step.kind==='summary'){const previous=j.steps.filter(s=>s.kind==='summary'&&s.output).at(-1)?.output;text=JSON.stringify({product:JSON.parse(facts(j)),previous:previous?parseResearchJson(previous):undefined,evidence:JSON.parse(step.text),instruction:'在已有洞察基础上合并本批证据；保留有依据的重要发现，精简重复，最终JSON不超过6500字符，至少包含卖点、痛点和场景。'});}
   if(text.length>16000)fail('当前分析步骤超过文本上限，请精简输入；没有截断证据');
   const quote=await analysis.estimate(step.modelId),spent=j.steps.filter(s=>s.jobId).reduce((n,s)=>{const a=analysis.job(s.jobId!);return n+(a.billing.status==='final'?a.billing.cost||0:s.reserved||0);},0);
   if(quote.estimated+spent>j.maximumCost+1e-9){j.status='paused';j.error='本轮预算不足以继续下一批，已保留结果；请重新查询预算后继续。';save(j);return;}
   store.transaction(()=>{const a=analysis.submit({action:step.action,modelId:step.modelId,maximumCost:quote.estimated,text,productName:j.product.title,assetIds:step.assetIds,idempotencyKey:`${j.id}:${step.id}:${step.attempt}`},true);step.jobId=a.id;step.reserved=quote.estimated;j.status='running';delete j.error;save(j);});
  }catch(e){j.status='failed';j.error=(e as Error).message;save(j);}}
 function refreshVerified(id:string){const j=get(id),step=j.steps.find(s=>!s.output);if(j.status==='unknown'&&step?.jobId&&['completed','failed'].includes(analysis.job(step.jobId).status)){j.status='queued';delete j.error;save(j);}return j;}
 function tick(){if(running||stopping)return;for(const j of store.list<ProductResearch>('product-research'))if(j.status==='unknown')store.withWorkspace(j.workspaceId||store.workspaceOf('product-research',j.id)||store.currentWorkspace(),()=>refreshVerified(j.id));const j=store.list<ProductResearch>('product-research').filter(j=>['queued','running'].includes(j.status)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(j)running=store.withWorkspace(j.workspaceId||store.workspaceOf('product-research',j.id)||store.currentWorkspace(),()=>advance(j)).finally(()=>{running=undefined;});}
 function retry(id:string,maximumCost:number){const j=get(id);if(j.status==='unknown')fail('提交未知不能重发，请先核实供应商结果');if(!['paused','failed'].includes(j.status))fail('当前研究无需重做');const s=j.steps.find(s=>!s.output);if(s?.jobId){const a=analysis.job(s.jobId);if(a.status==='unknown'||a.status==='submitting')fail('此步骤提交结果待核实，不能重新收费');s.attempt++;delete s.jobId;}j.maximumCost=maximumCost;j.status='queued';delete j.error;save(j);return j;}
 return {get,start,estimate,strategy,strategyEstimate,retry,refreshVerified,tick,async idle(){await running;},startWorker(){timer=setInterval(tick,750);},async stop(){stopping=true;clearInterval(timer);await running;}};
}
export type ResearchService=ReturnType<typeof createResearchService>;
export function registerResearchRoutes(app:FastifyInstance,store:Store,analysis:AnalysisService,enabled=true){
 const service=createResearchService(store,analysis),id=(r:unknown)=>z.object({id:z.string()}).parse(r).id;
 app.get('/api/catalog/products/:id/research',async r=>{const productId=id(r.params),draft=researchDraft(store,productId),jobs=store.list<ProductResearch>('product-research').filter(j=>j.productId===productId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),collections=store.list<ResearchCollection>('research-collection').filter(c=>c.productId===productId);const ids=new Set([...draft.value.productImageIds,...draft.value.groups.flatMap(g=>g.imageIds),...jobs.flatMap(j=>j.evidence.flatMap(e=>e.assetId?[e.assetId]:[])),...collections.flatMap(c=>c.media.map(m=>m.assetId))]);return {draft,jobs,collections,executions:store.list<import('../../packages/research').StrategyQuote>('research-quote').filter(q=>q.productId===productId&&q.status!=='quoted').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20),assets:store.list<Asset>('asset').filter(a=>ids.has(a.id))};});
 app.put('/api/catalog/products/:id/research/draft',async r=>{const pid=id(r.params),b=z.object({revision:z.number().int(),value:researchInputSchema}).parse(r.body);return store.transaction(()=>{const d=researchDraft(store,pid);if(d.revision!==b.revision)fail('研究草稿已更新，本地输入保留',409);const next={...d,...b,revision:d.revision+1,updatedAt:now()};store.put('research-draft',pid,next);return next;});});
 app.post('/api/catalog/products/:id/research/estimate',async r=>service.estimate(id(r.params),researchInputSchema.parse(r.body)));
 app.post('/api/catalog/products/:id/research/start',async r=>service.start(id(r.params),r.body));
 app.get('/api/research/:id',async r=>{const j=service.get(id(r.params));return {...j,analysisJobs:j.steps.flatMap(s=>s.jobId?[analysis.job(s.jobId)]:[])};});
 app.get('/api/research/:id/strategy-estimate',async r=>service.strategyEstimate(id(r.params)));
 app.post('/api/research/:id/strategies',async r=>service.strategy(id(r.params),r.body));
 app.post('/api/research/:id/retry',async r=>service.retry(id(r.params),z.object({maximumCost:z.number().finite().positive()}).parse(r.body).maximumCost));
 app.post('/api/research/:id/billing',async r=>{const j=service.get(id(r.params));for(const s of j.steps)if(s.jobId)await analysis.reconcile(s.jobId);service.refreshVerified(j.id);return {jobs:j.steps.flatMap(s=>s.jobId?[analysis.job(s.jobId)]:[])};});
 if(enabled)service.startWorker();app.addHook('onClose',()=>service.stop());return service;
}
