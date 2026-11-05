import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {researchHarness,type ResearchHarness} from './support/research-harness';
import {researchEvidence,researchSteps,createResearchService} from '../apps/server/research';
import {getCreativeDraft} from '../apps/server/catalog';
import {getPromotionDraft} from '../apps/server/promotion';
import type {Asset,Attempt} from '../packages/contracts';
import type {ResearchCollection,StrategyQuote} from '../packages/research';
import {createStore} from '../apps/server/store';
import {createAnalysisService} from '../apps/server/analysis';
import Fastify from 'fastify';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {registerResearchGeneration} from '../apps/server/research-generation';

let h:ResearchHarness;
beforeEach(async()=>{h=await researchHarness();});
afterEach(async()=>{await h.close();});
const config=(patch:Record<string,unknown>={})=>({purposes:['main','detail','post','video'],strategyIndex:0,imageModelId:'tt-image',videoModelId:'omni',imageRatio:'1:1',videoRatio:'9:16',duration:4,imageNoText:true,idempotencyKey:crypto.randomUUID(),...patch});
async function quote(id:string,patch:Record<string,unknown>={}){const r=await h.request('POST',`/api/research/${id}/delivery-quote`,config(patch));expect(r.statusCode,r.body).toBe(200);return r.json<StrategyQuote>();}
const draftState=()=>[getCreativeDraft(h.store,h.product.id,'main'),getCreativeDraft(h.store,h.product.id,'detail'),getPromotionDraft(h.store,h.product.id,'post','creative'),getPromotionDraft(h.store,h.product.id,'video',undefined,'direct')].map(({updatedAt,...draft})=>draft);

describe('选品之神：真实应用代码的隔离全流程',()=>{
 it.each(['gem','tt','hybrid'] as const)('完成%s资料分析、三套方案、四类成品、账本和ZIP下载',async mode=>{
  const globalDefault=h.analysis.settings().defaultModelId;
  const strategy=await h.plan(mode);expect(strategy.status,strategy.error).toBe('completed');expect(strategy.strategies).toHaveLength(3);
  const source=h.research.get(strategy.sourceResearchId!);expect(source.result!.findings.find(f=>f.id==='waterproof')!.usable).toBe(false);
  expect(source.steps.every(s=>s.output)).toBe(true);expect(h.analysis.settings().defaultModelId).toBe(globalDefault);
  const evidenceJobs=source.steps.filter(s=>s.kind==='evidence').map(s=>h.analysis.job(s.jobId!));
  expect(evidenceJobs.every(j=>j.model.id===(mode==='tt'?'tt-6.1-sol':'gem-3.8-flash'))).toBe(true);
  const before=structuredClone(draftState()),q=await quote(strategy.id);
  expect(q.items.map(i=>i.purpose)).toEqual(['main','detail','post','video']);expect(draftState()).toEqual(before);
  expect(h.calls.filter(c=>c.kind==='media')).toHaveLength(0);
  const sent=await h.request('POST',`/api/research-deliveries/${q.id}/submit`,{maximumCost:q.maximum,replaceDrafts:true});expect(sent.statusCode,sent.body).toBe(200);expect(sent.json().status).toBe('submitted');
  expect(h.store.list('research-draft-backup')).toHaveLength(4);
  const attempts=await h.drainMedia();expect(attempts).toHaveLength(17);expect(attempts.every(a=>a.status==='completed')).toBe(true);
  expect(attempts.every(a=>a.references.length===1&&a.references[0]===h.ids[0])).toBe(true);
  for(const item of sent.json<StrategyQuote>().items){
   const batch=h.store.readBatch(item.batchId!)!;expect(batch.attempts).toHaveLength({main:7,detail:3,post:6,video:1}[item.purpose]);
   const zip=await h.request('GET',`/api/batches/${batch.id}/download`);expect(zip.statusCode).toBe(200);expect(zip.rawPayload.subarray(0,2).toString()).toBe('PK');
   for(const a of batch.attempts){const asset=h.store.get<Asset>('asset',a.assetId!)!;expect(fs.existsSync(path.join(h.dir,'media',path.basename(asset.url)))).toBe(true);}
  }
  const count=h.store.list('attempt').length;
  await h.request('POST',`/api/research-deliveries/${q.id}/submit`,{maximumCost:q.maximum,replaceDrafts:true});expect(h.store.list('attempt')).toHaveLength(count);
  expect(h.calls.filter(c=>c.kind==='media')).toHaveLength(17);expect(h.store.snapshot().ledger).toHaveLength(17);
 });
 it.each([
  ['无自有图片',{productImageIds:[]}],['没有同行',{groups:[]}],['同行不足三图',{groups:[{id:'rival',imageIds:['flow-image-1','flow-image-2'],collectionIds:[]}]}],['重复同行ID',{groups:[{id:'same',imageIds:['flow-image-1','flow-image-2','flow-image-3'],collectionIds:[]},{id:'same',imageIds:['flow-image-4','flow-image-5','flow-image-6'],collectionIds:[]}]}],
 ])('%s在报价前被拒绝，不提交模型',async(_name,patch)=>{
  const r=await h.request('POST',`/api/catalog/products/${h.product.id}/research/estimate`,{...h.input,...patch});expect(r.statusCode).toBe(400);expect(h.calls).toHaveLength(0);expect(h.store.list('product-research')).toHaveLength(0);
 });
 it('按文件内容拒绝不同素材ID指向的重复同行图片',()=>{
  fs.copyFileSync(path.join(h.dir,'media',h.ids[1]+'.png'),path.join(h.dir,'media',h.ids[2]+'.png'));
  expect(()=>researchEvidence(h.store,h.product.id,h.input)).toThrow('重复图片');expect(h.calls).toHaveLength(0);
 });
 it('分批资料没有遗漏、每批至多四张图，超长单项明确拒绝',()=>{
  const input={...h.input,productImageIds:h.ids.slice(0,5),groups:[{id:'rival',imageIds:h.ids.slice(5),collectionIds:[]}]},e=researchEvidence(h.store,h.product.id,input),steps=researchSteps(input,e);
  expect(steps.every(s=>s.assetIds.length<=4)).toBe(true);expect(steps.flatMap(s=>s.evidenceIds).sort()).toEqual(e.map(v=>v.id).sort());
  expect(()=>researchSteps(input,[{id:'large',groupId:'own',kind:'text',label:'超长',text:'长'.repeat(12000)}])).toThrow('超过');
 });
 it('缺失原图、示例素材不能进入商品研究',()=>{
  fs.rmSync(path.join(h.dir,'media',h.ids[0]+'.png'));
  expect(()=>researchEvidence(h.store,h.product.id,h.input)).toThrow('缺失');
  expect(()=>researchEvidence(h.store,h.product.id,{...h.input,productImageIds:['example-6-1']})).toThrow('缺失');
 });
 it('保存revision冲突不会覆盖已保存研究资料',async()=>{
  const url=`/api/catalog/products/${h.product.id}/research/draft`;
  expect((await h.request('PUT',url,{revision:0,value:h.input})).statusCode).toBe(200);
  expect((await h.request('PUT',url,{revision:0,value:{...h.input,groups:[]}})).statusCode).toBe(409);
  expect(h.store.get<any>('research-draft',h.product.id).value).toEqual(h.input);
 });
 it('重复研究请求只接一次，改变内容复用凭据被拒绝',async()=>{
  const q=await h.research.estimate(h.product.id,h.input),body={input:h.input,maximumCost:q.estimated,productRevision:1,idempotencyKey:crypto.randomUUID()};
  const [a,b]=await Promise.all([h.research.start(h.product.id,body),h.research.start(h.product.id,body)]);expect(a.id).toBe(b.id);
  await expect(h.research.start(h.product.id,{...body,maximumCost:1})).rejects.toThrow('凭据');expect(h.store.list('product-research')).toHaveLength(1);
 });
 it('预算和余额不足在开始前拒绝，商品过期拒绝',async()=>{
  const q=await h.research.estimate(h.product.id,h.input),body={input:h.input,maximumCost:q.estimated/2,productRevision:1,idempotencyKey:crypto.randomUUID()};
  await expect(h.research.start(h.product.id,body)).rejects.toThrow('报价变化');h.control.balance=0;
  await expect(h.research.start(h.product.id,{...body,maximumCost:1})).rejects.toThrow('余额不足');
  await expect(h.research.start(h.product.id,{...body,productRevision:2})).rejects.toThrow('商品已更新');expect(h.calls).toHaveLength(0);
 });
 it('模型返回虚构证据时失败，保留原始响应并可显式重试',async()=>{
  h.control.analysisFailure='invalid-evidence';const failed=await h.analyze();expect(failed.status).toBe('failed');expect(failed.error).toContain('证据编号');
  const jobId=failed.steps[0].jobId!;expect(h.analysis.job(jobId).result).toContain('invented-evidence');
  h.control.analysisFailure='';h.research.retry(failed.id,1);const done=await h.drain(failed.id);expect(done.status,done.error).toBe('completed');expect(done.steps[0].attempt).toBe(1);
 });
 it('模型HTTP400失败不会自动重新提交',async()=>{
  h.control.analysisFailure='http400';const j=await h.analyze();expect(j.status).toBe('failed');const n=h.calls.length;
  for(let i=0;i<5;i++){h.research.tick();h.analysis.tick();await h.research.idle();await h.analysis.idle();}expect(h.calls).toHaveLength(n);
 });
 it('提交未知与重新构建研究服务均不会重发付费请求',async()=>{
  h.control.analysisFailure='unknown';h.control.billingUnavailable=true;const j=await h.analyze();expect(j.status).toBe('unknown');const n=h.calls.length;
  expect(()=>h.research.retry(j.id,1)).toThrow('不能重发');const restored=createResearchService(h.store,h.analysis);restored.tick();await restored.idle();await restored.stop();expect(h.calls).toHaveLength(n);
 });
 it('费用暂不可查不丢分析结果，补查不重新发送模型请求',async()=>{
  h.control.billingUnavailable=true;const j=await h.analyze();expect(j.status,j.error).toBe('completed');const count=h.calls.length;h.control.billingUnavailable=false;
  const r=await h.request('POST',`/api/research/${j.id}/billing`,{});expect(r.statusCode).toBe(200);expect(r.json().jobs.every((a:any)=>a.billing.status==='final')).toBe(true);expect(h.calls).toHaveLength(count);
 });
 it('预算中途变化会暂停，继续时复用已完成步骤',async()=>{
  const q=await h.research.estimate(h.product.id,h.input),j=await h.research.start(h.product.id,{input:h.input,maximumCost:q.estimated,productRevision:1,idempotencyKey:crypto.randomUUID()});
  while(!h.research.get(j.id).steps[0].output){h.research.tick();await h.research.idle();h.analysis.tick();await h.analysis.idle();}
  const first=h.research.get(j.id).steps[0].jobId;h.control.priceMultiplier=100;expect((await h.drain(j.id)).status).toBe('paused');
  expect(h.calls).toHaveLength(1);h.control.priceMultiplier=1;h.research.retry(j.id,1);expect((await h.drain(j.id)).status).toBe('completed');expect(h.research.get(j.id).steps[0].jobId).toBe(first);
 });
 it('SQLite重新打开后续跑排队步骤，完成步骤不重复发送',async()=>{
  const q=await h.research.estimate(h.product.id,h.input),j=await h.research.start(h.product.id,{input:h.input,maximumCost:q.estimated,productRevision:1,idempotencyKey:crypto.randomUUID()});
  while(!h.research.get(j.id).steps[0].output){h.research.tick();await h.research.idle();h.analysis.tick();await h.analysis.idle();}
  const first=h.research.get(j.id).steps[0].jobId,store=createStore(h.dir,process.cwd()),a=createAnalysisService(store,h.transport),r=createResearchService(store,a);
  try{for(let i=0;i<80&&r.get(j.id).status!=='completed';i++){r.tick();await r.idle();a.tick();await a.idle();}expect(r.get(j.id).status).toBe('completed');expect(r.get(j.id).steps[0].jobId).toBe(first);expect(h.calls.filter(c=>c.kind==='evidence')).toHaveLength(3);}finally{await r.stop();await a.stop();store.close();}
 });
 it('未知请求补查确认成功后可以继续研究，原步骤不重新付费',async()=>{
  h.control.analysisFailure='unknown';h.control.billingUnavailable=true;const j=await h.analyze(),first=j.steps[0].jobId!;expect(j.status).toBe('unknown');
  h.control.analysisFailure='';h.control.billingUnavailable=false;h.control.settleUnknown=true;await h.request('POST',`/api/research/${j.id}/billing`,{});
  expect(h.analysis.job(first).status).toBe('completed');const done=await h.drain(j.id);expect(done.status).toBe('completed');expect(done.steps[0].jobId).toBe(first);expect(h.calls.filter(c=>c.kind==='evidence')).toHaveLength(3);
 });
 it('跨商品复用研究接单凭据会拒绝，不能返回另一个商品的研究',async()=>{
  const q=await h.research.estimate(h.product.id,h.input),body={input:h.input,maximumCost:q.estimated,productRevision:1,idempotencyKey:crypto.randomUUID()};await h.research.start(h.product.id,body);
  const other={...h.product,id:'other-flow-product'};h.store.put('catalog-product',other.id,other);await expect(h.research.start(other.id,body)).rejects.toThrow('凭据');
 });
 it('不合法JSON保持原始输出且不产生可用洞察',async()=>{
  h.control.analysisFailure='invalid';const j=await h.analyze();expect(j.status).toBe('failed');expect(j.result).toBeUndefined();expect(h.analysis.job(j.steps[0].jobId!).result).toBe('not JSON');
 });
 it('只允许选中可用标签编排，三套策划沿用用户选择',async()=>{
  const j=await h.analyze();await expect(h.research.strategy(j.id,{selectedIds:['waterproof'],maximumCost:1,idempotencyKey:crypto.randomUUID()})).rejects.toThrow('不可用于');
  const s=await h.research.strategy(j.id,{selectedIds:['collar'],maximumCost:1,idempotencyKey:crypto.randomUUID()});expect(s.steps.every(step=>step.text.includes('立领外观')&&!step.text.includes('通勤场景'))).toBe(true);
 });
 it('报价与取消不改变制作草稿，缺少模型、错误比例／时长被拒绝',async()=>{
  const s=await h.plan(),before=structuredClone(draftState());await quote(s.id);expect(draftState()).toEqual(before);
  for(const patch of [{imageModelId:''},{imageRatio:'7:11'},{duration:119},{purposes:['main','main']}]){const r=await h.request('POST',`/api/research/${s.id}/delivery-quote`,config(patch));expect(r.statusCode,r.body).toBe(400);}
  expect(h.store.list('attempt')).toHaveLength(0);
 });
 it('整组余额不足、涨价或商品revision变化都不会安装制作草稿',async()=>{
  const s=await h.plan(),before=structuredClone(draftState()),q=await quote(s.id);h.control.balance=q.maximum-.01;
  const submit=()=>h.request('POST',`/api/research-deliveries/${q.id}/submit`,{maximumCost:q.maximum,replaceDrafts:true});
  expect((await submit()).statusCode).toBe(402);expect(draftState()).toEqual(before);
  h.control.balance=100;h.control.priceMultiplier=2;expect((await submit()).statusCode).toBe(409);expect(draftState()).toEqual(before);
  h.control.priceMultiplier=1;h.store.put('catalog-product',h.product.id,{...h.product,revision:2});expect((await submit()).statusCode).toBe(409);
  expect(h.store.list('attempt')).toHaveLength(0);expect(h.store.list('research-draft-backup')).toHaveLength(0);
 });
 it('任一制作草稿修改都使整组原子回滚',async()=>{
  const s=await h.plan(),q=await quote(s.id),draft=getCreativeDraft(h.store,h.product.id,'detail');h.store.put('catalog-draft',draft.id,{...draft,revision:draft.revision+1});const before=structuredClone(draftState());
  const r=await h.request('POST',`/api/research-deliveries/${q.id}/submit`,{maximumCost:q.maximum,replaceDrafts:true});expect(r.statusCode,r.body).toBe(409);expect(draftState()).toEqual(before);expect(h.store.list('research-draft-backup')).toHaveLength(0);
 });
 it('四类部分接单后重建路由只继续缺失项，并发提交不会重复接单',async()=>{
  const s=await h.plan(),generation=createGenerationPricing(h.store,h.transport),admit=generation.admit;let n=0;
  let release!:()=>void,signal!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{signal=resolve;});
  generation.admit=async raw=>{const current=++n;if(current===1){signal();await barrier;}if(current===2)throw Error('隔离测试：详情接单临时失败');return admit(raw);};
  let app=Fastify();registerResearchGeneration(app,h.store,generation);
  try{
   const qr=await app.inject({method:'POST',url:`/api/research/${s.id}/delivery-quote`,payload:config()});expect(qr.statusCode,qr.body).toBe(200);const q=qr.json<StrategyQuote>(),req={method:'POST' as const,url:`/api/research-deliveries/${q.id}/submit`,payload:{maximumCost:q.maximum,replaceDrafts:true}};
   const first=app.inject(req);await entered;const second=await app.inject(req);release();const responses=[await first,second];expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);const partial=responses.find(r=>r.statusCode===200)!.json<StrategyQuote>();expect(partial.status).toBe('partial');expect(partial.items.filter(i=>i.batchId)).toHaveLength(3);const accepted=partial.items.filter(i=>i.batchId).map(i=>i.batchId);
   await app.close();app=Fastify();registerResearchGeneration(app,h.store,createGenerationPricing(h.store,h.transport));const resumed=await app.inject(req);expect(resumed.statusCode,resumed.body).toBe(200);expect(resumed.json().status).toBe('submitted');expect(resumed.json<StrategyQuote>().items.filter(i=>accepted.includes(i.batchId)).map(i=>i.batchId)).toEqual(accepted);expect(h.store.list('attempt')).toHaveLength(17);expect(h.store.list('research-draft-backup')).toHaveLength(4);
  }finally{await app.close();}
 });
 it('供应商媒体生成失败保持失败及退款记录，不伪造成功文件',async()=>{
  const s=await h.plan(),q=await quote(s.id,{purposes:['main']});await h.request('POST',`/api/research-deliveries/${q.id}/submit`,{maximumCost:q.maximum,replaceDrafts:true});h.control.mediaFailure=true;
  const attempts=await h.drainMedia();expect(attempts.every(a=>a.status==='failed'&&!a.assetId&&a.billing?.refunded)).toBe(true);expect(h.store.snapshot().ledger).toHaveLength(7);
 });
});

describe('深度研究证据与视频边界',()=>{
 function collected(patch:Partial<ResearchCollection>={}){const c:ResearchCollection={id:'collection-flow',productId:h.product.id,groupId:'rival-1',url:'https://www.douyin.com/video/123456789',status:'partial',stage:'隔离采集记录',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),title:'同行外观演示',text:'演示立领与拉链细节',productInfo:'来源商品资料待核实',comments:[],media:[],warnings:['未取得商品面板'],...patch};h.store.put('research-collection',c.id,c);return {...h.input,method:'deep' as const,groups:[{id:c.groupId,imageIds:[],collectionIds:[c.id]}]};}
 it('允许没有评论的部分采集资料，缺失说明和内容来源保留',async()=>{
  const input=collected(),q=await h.research.estimate(h.product.id,input),j=await h.research.start(h.product.id,{input,maximumCost:q.estimated,productRevision:1,idempotencyKey:crypto.randomUUID()});const done=await h.drain(j.id);expect(done.status,done.error).toBe('completed');expect(done.evidence.find(e=>e.id==='collection-flow')!.text).toContain('未取得商品面板');
 });
 it.each(['queued','waiting-login','collecting','paused','failed'] as const)('拒绝未完成的%s采集记录',status=>{const input=collected({status});expect(()=>researchEvidence(h.store,h.product.id,input)).toThrow('完成链接采集');});
 it('拒绝空内容和跨商品／同行组采集资料',()=>{
  expect(()=>researchEvidence(h.store,h.product.id,collected({text:'',media:[],comments:[]}))).toThrow('有内容');
  expect(()=>researchEvidence(h.store,h.product.id,collected({productId:'other-product'}))).toThrow('不属于');
 });
 it('视频只通过GEM原生动态路径；TT明确拒绝',async()=>{
  const id='flow-video',bytes=fs.readFileSync('public/examples/demo-portrait-4.mp4');fs.writeFileSync(path.join(h.dir,'media',id+'.mp4'),bytes);h.store.put('asset',id,{id,url:'/media/'+id+'.mp4',type:'video',mime:'video/mp4',source:'collection',bytes:bytes.length,createdAt:new Date().toISOString()} satisfies Asset);
  const input=collected({media:[{assetId:id,role:'video',label:'同行完整视频'}]});expect(()=>researchSteps({...input,modelMode:'tt'},researchEvidence(h.store,h.product.id,input))).toThrow('TT研究暂不直接接收视频');
  const j=await h.research.start(h.product.id,{input,maximumCost:1,productRevision:1,idempotencyKey:crypto.randomUUID()}),done=await h.drain(j.id);expect(done.status,done.error).toBe('completed');const call=h.calls.find(c=>c.kind==='video')!;expect(call.body.contents[0].parts[1].inline_data.mime_type).toBe('video/mp4');
 });
});
