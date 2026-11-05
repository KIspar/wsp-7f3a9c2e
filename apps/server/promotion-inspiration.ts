import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store';
import type {AnalysisService} from './analysis';
import type {AnalysisJob} from '../../packages/analysis';
import type {PromotionDraft} from '../../packages/promotion';
import {getPromotionDraft} from './promotion';
import {getCatalogProduct} from './catalog';
import {fail} from './errors';
export type InspirationRecord={id:string;draftId:string;productId:string;jobId:string;epoch:string;createdAt:string;appliedAt?:string;undoneAt?:string;inserted?:string};
export function applyInspiration(store:Store,productId:string,id:string,revision:number,undo=false){return store.transaction(()=>{
 const d=getPromotionDraft(store,productId,'post','creative'),r=store.get<InspirationRecord>('promotion-inspiration',id)||fail('分析记录不存在',404);
 if(r.draftId!==d.id)fail('分析记录不属于当前草稿');
 // Ledger and draft update are one transaction; refresh and concurrent tabs cannot insert twice.
 if(undo?r.undoneAt:r.appliedAt)return {draft:d,inserted:r.inserted||'',changed:false};
 if(d.revision!==revision)fail('草稿已更新，请稍后重试应用；分析结果已保留',409);
 if((d.value.analysisEpoch||'initial')!==r.epoch)fail('此结果属于已提交的旧草稿，保留在分析记录中，不写入新任务',409);
 const job=store.get<AnalysisJob>('analysis-job',r.jobId)||fail('分析任务不存在');if(job.status!=='completed'||!job.result)fail('分析尚未完成');
 const text=d.value.generation.requirements,inserted=r.inserted||`\n\n参考画面建议\n${job.result.trim()}`;
 if(undo&&!text.includes(inserted))fail('建议段落已被编辑，无法安全撤销；可手动修改要求',409);
 const requirements=undo?text.replace(inserted,''):text+inserted;if(requirements.length>16000)fail('追加后超过 16000 字，结果已保留，请精简原文后应用');
 const next:PromotionDraft={...d,revision:d.revision+1,updatedAt:new Date().toISOString(),value:{...d.value,generation:{...d.value.generation,requirements}}};
 store.put('promotion-draft',d.id,next);store.put('promotion-inspiration',r.id,{...r,inserted,...(undo?{undoneAt:next.updatedAt}:{appliedAt:next.updatedAt})});return {draft:next,inserted,changed:true};
 });}
export function registerInspirationRoutes(app:FastifyInstance,store:Store,analysis:AnalysisService){
 const base='/api/catalog/products/:id/promotion-inspiration';const pid=(p:unknown)=>z.object({id:z.string()}).parse(p).id;
 app.get(base,async r=>{const id=pid(r.params),d=getPromotionDraft(store,id,'post','creative');return store.list<InspirationRecord>('promotion-inspiration').filter(x=>x.draftId===d.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(x=>{const j=analysis.job(x.jobId);return {...x,stale:x.epoch!==(d.value.analysisEpoch||'initial'),job:{id:j.id,status:j.status,result:j.result,error:j.error,modelName:j.model.name,billing:j.billing}};});});
 app.post(base,async r=>{const id=pid(r.params),b=z.object({revision:z.number().int(),idempotencyKey:z.string().min(8).max(100)}).parse(r.body);return store.transaction(()=>{
 const existing=store.get<InspirationRecord>('promotion-inspiration',b.idempotencyKey);if(existing){if(existing.productId!==id)fail('分析凭据不属于当前商品',409);return existing;}
 const d=getPromotionDraft(store,id,'post','creative');if(d.revision!==b.revision)fail('草稿已变化，请先保存后再分析',409);
 const active=store.list<InspirationRecord>('promotion-inspiration').find(x=>x.draftId===d.id&&!x.appliedAt&&['queued','preparing','submitting','unknown'].includes(analysis.job(x.jobId).status));if(active)fail('已有画面分析在处理或待核实，请查看原任务',409);
 const job=analysis.submit({action:'reference-inspiration',productName:getCatalogProduct(store,id).title,text:d.value.generation.requirements,assetIds:d.value.inspirationImages||[],idempotencyKey:b.idempotencyKey},true);
 const record:InspirationRecord={id:b.idempotencyKey,productId:id,draftId:d.id,jobId:job.id,epoch:d.value.analysisEpoch||'initial',createdAt:new Date().toISOString()};store.put('promotion-inspiration',record.id,record);return record;
 });});
 app.post(base+'/:recordId/apply',async r=>{const p=z.object({id:z.string(),recordId:z.string()}).parse(r.params),b=z.object({revision:z.number().int(),undo:z.boolean().default(false)}).parse(r.body);return applyInspiration(store,p.id,p.recordId,b.revision,b.undo);});
}
