import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store';
import {getWearDraft,saveWearDraft,wearGeneration,wearContext,importWearLibrary} from './wear-context';
import {wearValueSchema,type WearValue} from '../../packages/wear';
import type {Asset} from '../../packages/contracts';
import type {createGenerationPricing} from './generation-pricing';
import {fail} from './errors';
export function registerWearRoutes(app:FastifyInstance,store:Store,generation:ReturnType<typeof createGenerationPricing>){
 const library=importWearLibrary(store);
 const scope=(params:unknown)=>z.object({scope:z.string().min(1).max(120)}).parse(params).scope;
 app.get('/api/wear/library',async()=>library);
 app.get('/api/wear/:scope/draft',async r=>getWearDraft(store,scope(r.params)));
 app.put('/api/wear/:scope/draft',async r=>{const s=scope(r.params),b=z.object({revision:z.number().int().nonnegative(),value:wearValueSchema}).parse(r.body);return store.transaction(()=>saveWearDraft(store,s,b.revision,b.value));});
 app.post('/api/wear/:scope/plan',async r=>{const s=scope(r.params),b=z.object({revision:z.number().int().nonnegative(),stage:z.enum(['model','outfit']),productRevision:z.number().int().positive().optional()}).parse(r.body),doc=getWearDraft(store,s);if(doc.revision!==b.revision)fail('草稿已更新，请重新报价',409);const c=wearContext(store,doc,b.stage);if(c.productRevision!==b.productRevision)fail('商品已更新，请保存后重新报价',409);const draft=wearGeneration(store,doc,b.stage),skillId=b.stage==='model'?'image-generate':'model-outfit';return {...await generation.plan(skillId,draft,'generate',undefined,c),draft,wearContext:c};});
 app.get('/api/wear/:scope/jobs',async r=>{const s=scope(r.params);getWearDraft(store,s);const q=z.object({page:z.coerce.number().int().min(1).default(1),stage:z.enum(['model','outfit']).optional()}).parse(r.query),page=q.page;const jobs=store.list<{batchId:string;scope:string;stage:'model'|'outfit';value:WearValue;createdAt:string}>('wear-job').filter(j=>j.scope===s);const legacy=s==='global'?store.snapshot().batches.filter(b=>b.skillId==='model-outfit'&&!b.wearContext).map(b=>({batchId:b.id,scope:s,stage:'outfit' as const,value:wearValueSchema.parse({productIds:(b.draft.inputRoles.product||[]).slice(0,6),modelAssetId:b.draft.selectedTargetIds[0]||'',requirements:b.draft.requirements,scenes:[],poses:1}),createdAt:b.createdAt,legacy:true})):[];const all=[...jobs,...legacy].filter(j=>!q.stage||j.stage===q.stage).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const items=all.slice((page-1)*20,page*20).map(j=>({...j,batch:store.readBatch(j.batchId)!})).filter(j=>j.batch);const ids=new Set(items.flatMap(j=>[...j.value.productIds,j.value.modelAssetId,...j.batch.attempts.map(a=>a.assetId)].filter(Boolean)));return {items,total:all.length,assets:store.list<Asset>('asset').filter(a=>ids.has(a.id))};});
}
