import {latestWearAttempts,type WearJob} from '../../packages/wear';
import {replicaRules} from '../../packages/product-design';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type {Store} from './store';
import {fail} from './errors';
import {getCatalogProduct,getCreativeDraft,initialCreativeDraft,workshopGeneration,workshopSkill} from './catalog';
import {assetFile} from './analysis-media';
import type {createGenerationPricing} from './generation-pricing';
import type {Asset,Attempt,Batch,CreativeContext} from '../../packages/contracts';
import type {CatalogProduct} from '../../packages/catalog';
import {promotionValueSchema,ensureCreativePostPages,performanceSchema,postModeOf,type PostMode,type PromotionDraft,type PromotionWork,type PromotionVersion,type PromotionEntry,type PromotionPerformanceRecord,type PromotionValue} from '../../packages/promotion';
import {expandPostPages,minimumPostPages,postPageRole,postTextPolicy} from '../../packages/post-plan';
const now=()=>new Date().toISOString();
const kinds={work:'promotion-work',version:'promotion-version',draft:'promotion-draft',performance:'promotion-performance'};
// A mode is an independent document; legacy drafts remain intact as the migration source.
export function getPromotionDraft(store:Store,productId:string,type:'post'|'video',mode?:PostMode,workflow?:'direct'|'reverse'|'shot-remake'):PromotionDraft{
 const legacy=store.get<PromotionDraft>(kinds.draft,`${productId}:${type}`);
 if(type==='video'){
 const chosen=workflow||legacy?.value.videoWorkflow||'direct',id=productId+':video:'+chosen,saved=store.get<PromotionDraft>(kinds.draft,id);if(saved)return saved;
 if(legacy&&(legacy.value.videoWorkflow||'direct')===chosen){const migrated={...legacy,id,value:{...legacy.value,videoWorkflow:chosen}};store.put(kinds.draft,id,migrated);return migrated;}
 const p=getCatalogProduct(store,productId),base=initialCreativeDraft(store,p,'video');
 return {...base,id,revision:0,purpose:'video',value:promotionValueSchema.parse({...base.value,videoWorkflow:chosen}),updatedAt:p.updatedAt};
 }
 const chosen=mode||(legacy?postModeOf(legacy.value):'creative'),id=type==='post'?`${productId}:post:${chosen}`:`${productId}:video`;
 const saved=store.get<PromotionDraft>(kinds.draft,id);if(saved)return saved;
 if(type==='post'&&legacy&&postModeOf(legacy.value)===chosen){
  const value=structuredClone(legacy.value);value.postMode=chosen;
  if(chosen==='replicate'&&value.benchmarkImages.length){value.selectedBenchmarkIds=[...value.benchmarkImages];value.replacementObject||='图中的同行商品';value.targetSettings=Object.fromEntries(value.benchmarkImages.map((assetId,i)=>[assetId,{outputKey:value.outputKeys[i]}]));}
  const migrated={...legacy,id,value};store.put(kinds.draft,id,migrated);return migrated;
 }
 const p=getCatalogProduct(store,productId),base=type==='post'&&(chosen==='replicate'||!!legacy)?initialCreativeDraft(store,p,type):getCreativeDraft(store,productId,type);
 const draft:PromotionDraft={...base,id,revision:0,purpose:type,value:{...structuredClone(base.value),postMode:type==='post'?chosen:undefined,benchmarkImages:[],inspirationImages:[],selectedBenchmarkIds:[],targetSettings:{},replacementObject:'',analysisEpoch:'initial',referenceSourceUrl:'',videoWorkflow:'direct',title:type==='post'&&chosen==='creative'&&!legacy?p.postTitle||'':'',body:type==='post'&&chosen==='creative'&&!legacy?p.postBody||'':'',outputKeys:base.value.outputKeys.map((_,i)=>`promotion-${productId}-${type}-${chosen}-${i+1}`)},updatedAt:p.updatedAt};
 if(type==='post'&&chosen==='creative')draft.value=ensureCreativePostPages(draft.value,i=>`promotion-${productId}-${type}-${chosen}-${i+1}`);
 return draft;
}
/** Project the selected pages once, so quote, admission, version and export share the same order. */
export function submittedPromotionValue(d:PromotionDraft):PromotionValue{
 const v=structuredClone(d.value);
 if(d.purpose==='post'&&postModeOf(v)==='creative'&&v.postTemplatePages?.length){
  const pages=expandPostPages(v.postTemplatePages,v.outputKeys.length);
  v.pageRequirements=Object.fromEntries(v.outputKeys.map((key,i)=>[key,[pages[i],v.pageRequirements[key]].filter(Boolean).join('\n')]));
  if(Object.values(v.pageRequirements).some(text=>text.length>4000))fail('模板逐页要求过长，请精简模板后重新选择；未截断内容');
  delete v.postTemplatePages; // Freeze exact page mapping in accepted versions, including later reordering.
 }
 if(d.purpose!=='post'||postModeOf(v)!=='replicate')return v;
 const refs=v.benchmarkImages||[];if(!refs.length)fail('请添加对标原图');
 if(new Set(refs).size!==refs.length||refs.length!==v.outputKeys.length)fail('同行图组应与输出位置一一对应，请重新选择对标图片');
 const selected=v.selectedBenchmarkIds??refs;if(new Set(selected).size!==selected.length||selected.some(id=>!refs.includes(id)))fail('勾选原图不属于当前对标图组');
 if(!selected.length)fail('请至少勾选一张对标原图');
 const ordered=refs.filter(id=>selected.includes(id));
 v.outputKeys=ordered.map(id=>v.targetSettings?.[id]?.outputKey||d.value.outputKeys[refs.indexOf(id)]);
 if(new Set(v.outputKeys).size!==v.outputKeys.length||v.outputKeys.some(k=>!d.value.outputKeys.includes(k)))fail('对标图片输出位置异常，请重新选择');
 v.benchmarkImages=ordered;v.selectedBenchmarkIds=ordered;v.targetSettings=Object.fromEntries(ordered.map(id=>[id,{...v.targetSettings?.[id],outputKey:v.outputKeys[ordered.indexOf(id)]}]));v.generation.count=ordered.length;
 return v;
}
export function promotionGeneration(store:Store,p:CatalogProduct,d:PromotionDraft){
 if(d.value.videoWorkflow==='shot-remake')fail('分镜复刻请从分镜任务入口提交');
 const value=submittedPromotionValue(d),g=workshopGeneration(store,p,{...d,value});if(d.purpose!=='post')return g;
 // Generic legacy references need an explicit user choice; no silent change in their meaning.
 if(g.inputRoles.reference?.length)fail('旧稿通用参考图尚未指定用途，请选择灵感参考或逐图复刻后报价');
 g.outputProductIds=undefined;g.outputReferenceIds=undefined;g.inputRoles={...g.inputRoles,reference:[]};
 if(postModeOf(value)==='creative'){
  if(g.count<minimumPostPages||value.outputKeys.length!==g.count)fail('抖音商品图文至少需要 6 张，请调整图文页数后重新报价');
  g.outputInstructions=value.outputKeys.map((key,i)=>{
   const [title,direction]=postPageRole(i,g.count);
   return `制作一组 ${g.count} 张有顺序的抖音商品图文；本次仅输出第 ${i+1} 张。\n本页职责：${title}。${direction}。\n整组节奏：${value.outputKeys.map((_,index)=>`${index+1}.${postPageRole(index,g.count)[0]}`).join(" → ")}。\n${value.generation.promptTemplate?`选用模板：${value.generation.promptTemplate.name}。遵循下方模板段落的场景、配色、构图与叙事风格；分配的页职责用于推进内容，不强行套用与模板冲突的场景。`:'根据商品卖点、适用人群、期望场景与具体参数组织内容。'}\n逐页画面规范：同组商品颜色、版型与可见细节一致，光色与视觉风格连贯；本页须有独立的信息重点、景别、角度或动作，不得把同一画面仅换文字后重复输出，不拼成多格联图。商品外观以自有图片为准，不照搬模板示例里的商品事实，不编造材质成分、尺码或效果。\n${value.pageRequirements[key]||''}\n${postTextPolicy(value.imageNoText)}`;
  });
  if(g.outputInstructions.some(s=>s.length>4000))fail('模板逐页要求过长，请精简模板后重新选择；未截断内容');
  return g;
 }
 const refs=value.benchmarkImages;
 const validate=(id:string)=>{const a=store.get<Asset>('asset',id);if(!a||a.type!=='image'||['simulator','example'].includes(a.source))fail('对标图或商品图缺失或不可用，请重新选择');};
 refs.forEach(validate);g.outputReferenceIds=refs.map(id=>[id]);
 g.outputProductIds=refs.map(id=>{const ids=value.targetSettings?.[id]?.productIds??g.inputRoles.product??[];if(!ids.length)fail('每张对标图至少需要一张商品外观依据');ids.forEach(validate);if(new Set(ids).size!==ids.length)fail('本图商品参考不能重复');return ids;});
 g.outputInstructions=value.outputKeys.map((key,i)=>{const setting=value.targetSettings?.[refs[i]],object=(setting?.replacementObject||value.replacementObject||'').trim();if(!object)fail(`请填写第 ${i+1} 张原图的替换对象`);
 const productImages=g.outputProductIds![i],all=[...new Set([...productImages,refs[i]])];if(productImages.includes(refs[i]))fail('同行对标图不能同时作为本页商品外观依据');
 return `${replicaRules(value.replicationType,value.replicationFidelity)}\n替换对象：${object}。\n${value.pageRequirements[key]||''}\n${setting?.requirements||''}\n${postTextPolicy(value.imageNoText)}\n本页共 ${all.length} 张输入图片。${productImages.map(id=>`图${all.indexOf(id)+1}是自有商品外观依据`).join('；')}；图${all.indexOf(refs[i])+1}是第${i+1}页的同行对标图，仅用于人物、构图和场景参考，不将同行商品作为目标商品。`;});
 if(g.outputInstructions.some(s=>s.length>4000))fail('逐页要求加入图片映射后过长，请精简后报价');return g;
}
export function promotionContext(store:Store,d:PromotionDraft,p:CatalogProduct):CreativeContext{return {videoWorkflow:d.purpose==='video'?d.value.videoWorkflow:undefined,postMode:d.purpose==='post'?postModeOf(d.value):undefined,productId:p.id,productRevision:p.revision,purpose:d.purpose,draftRevision:d.revision,outputKeys:submittedPromotionValue(d).outputKeys,promotionWorkId:d.value.workId||store.id('work'),promotionVersionId:store.id('version')};}
export function admitPromotion(store:Store,batch:Batch){
 const c=batch.creativeContext!;if(!c.promotionWorkId||!c.promotionVersionId)return;
 const d=getPromotionDraft(store,c.productId,c.purpose as 'post'|'video',c.postMode,c.videoWorkflow),existing=store.get<PromotionWork>(kinds.work,c.promotionWorkId);
 if(existing&&(existing.productId!==c.productId||existing.type!==c.purpose||d.value.workId!==existing.id))fail('作品不属于当前商品或类型');
 if(store.get(kinds.version,c.promotionVersionId))fail('任务已接单，请核实原请求',409);
 const work:PromotionWork=existing||{id:c.promotionWorkId,productId:c.productId,type:d.purpose,name:d.value.title||d.value.generation.requirements.slice(0,50)||'未命名作品',revision:1,createdAt:batch.createdAt,archived:false,sourceWorkId:d.value.sourceWorkId,sourceVersionId:d.value.sourceVersionId};
 store.put(kinds.work,work.id,work);
 const version:PromotionVersion={id:c.promotionVersionId,workId:work.id,createdAt:batch.createdAt,confirmed:false,legacy:false,value:submittedPromotionValue(d),batchIds:[batch.id],selection:{},media:{}};
 store.put(kinds.version,version.id,version);
 const next=structuredClone(d);next.revision++;next.updatedAt=now();next.value={...next.value,benchmarkImages:[],inspirationImages:[],selectedBenchmarkIds:[],targetSettings:{},replacementObject:'',analysisEpoch:store.id('epoch'),referenceSourceUrl:'',title:'',body:'',script:'',referenceCopy:'',referenceVideoId:undefined,workId:undefined,sourceWorkId:undefined,sourceVersionId:undefined,sourceStructure:undefined,pageRequirements:{},postTemplatePages:undefined,outputKeys:next.value.outputKeys.map(()=>store.id('page')),generation:{...next.value.generation,promptTemplate:undefined,requirements:'',outputInstructions:undefined,outputReferenceIds:undefined,outputProductIds:undefined,productContext:undefined,inputRoles:{[d.purpose==='video'?'references':'product']:d.value.generation.inputRoles[d.purpose==='video'?'references':'product']||[]}}};
 store.put(kinds.draft,next.id,next);
}
export function migratePromotions(store:Store){store.transaction(()=>{
 for(const raw of store.list<Batch>('batch')){const c=raw.creativeContext;if(!c||!['post','video'].includes(c.purpose)||c.promotionWorkId)continue;const id=`legacy-work-${raw.id}`;if(store.get(kinds.work,id))continue;
 const p=store.get<CatalogProduct>('catalog-product',c.productId);if(!p)continue;const b=store.readBatch(raw.id)!,type=c.purpose as 'post'|'video';
 const value:PromotionValue={benchmarkImages:[],referenceSourceUrl:'',videoWorkflow:'direct',generation:b.draft,outputKeys:c.outputKeys,script:'',pageRequirements:{},title:'',body:''};
 const selection:Record<string,string>={},media:Record<string,string>={};for(const binding of p.bindings.filter(x=>x.kind===type&&x.attemptId)){const a=b.attempts.find(a=>a.id===binding.attemptId);if(a?.assetId&&a.status==='completed'&&!a.simulated){selection[c.outputKeys[a.index-1]]=a.id;media[c.outputKeys[a.index-1]]=a.assetId;}}
 const complete=Object.keys(media).length===c.outputKeys.length,versionId=`legacy-version-${b.id}`;
 store.put(kinds.work,id,{id,productId:p.id,type,name:`历史${type==='post'?'图文':'视频'} · ${b.createdAt.slice(0,10)}`,revision:1,createdAt:b.createdAt,archived:false,...(complete?{confirmedVersionId:versionId}:{})} satisfies PromotionWork);
 store.put(kinds.version,versionId,{id:versionId,workId:id,createdAt:b.createdAt,confirmed:complete,legacy:true,value,batchIds:[b.id],selection,media} satisfies PromotionVersion);
 }
 });}
function work(store:Store,id:string){return store.get<PromotionWork>(kinds.work,id)||fail('作品不存在',404);}
function version(store:Store,id:string){return store.get<PromotionVersion>(kinds.version,id)||fail('作品内容不存在',404);}
export function promotionEntry(store:Store,w:PromotionWork):PromotionEntry{
 const versions=store.list<PromotionVersion>(kinds.version).filter(v=>v.workId===w.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return {work:w,versions,batches:[...new Set(versions.flatMap(v=>v.batchIds))].map(id=>store.readBatch(id)).filter((b):b is Batch=>!!b),worthyVersionIds:versions.filter(v=>store.get<{worthy:boolean}>('promotion-worthy',v.id)?.worthy).map(v=>v.id),records:store.list<PromotionPerformanceRecord>(kinds.performance).filter(r=>versions.some(v=>v.id===r.versionId))};
}
export function confirmPromotion(store:Store,id:string,input:{revision:number;versionId:string;selection:Record<string,string>;title:string;body:string;order:string[];idempotencyKey:string}){return store.transaction(()=>{
 const key=`${id}:${input.idempotencyKey}`,previous=store.get<{input:string;result:string}>('promotion-confirm',key);if(previous){if(previous.input!==JSON.stringify(input))fail('确认凭据已用于其他内容',409);return version(store,previous.result);}
 const w=work(store,id),v=version(store,input.versionId);if(w.revision!==input.revision)fail('作品已更新，请重新打开',409);if(v.workId!==w.id)fail('内容不属于该作品');
 if(input.order.length!==v.value.outputKeys.length||new Set(input.order).size!==input.order.length||input.order.some(k=>!v.value.outputKeys.includes(k)))fail('页序不完整');
 const media:Record<string,string>={},selection:Record<string,string>={};const entry=promotionEntry(store,w);
 for(const key of input.order){const attemptId=input.selection[key]||v.selection[key];const a=entry.batches.flatMap(b=>b.attempts).find(a=>a.id===attemptId);const batch=a&&entry.batches.find(b=>b.id===a.batchId);if(a&&batch&&a.status==='completed'&&a.assetId&&!a.simulated&&batch.creativeContext?.outputKeys[a.index-1]===key){const asset=store.get<Asset>('asset',a.assetId);if(!asset||['example','simulator'].includes(asset.source))fail('不能确认模拟或缺失素材');media[key]=a.assetId;selection[key]=a.id;}else if(v.confirmed&&v.media[key]&&(!attemptId||attemptId===v.selection[key])){media[key]=v.media[key];selection[key]=v.selection[key];}else fail('还有缺页或未完成结果，请先补做或等待有效结果');}
 const orderedRefs=v.value.benchmarkImages?.length?input.order.map(key=>v.value.benchmarkImages.find((id,i)=>(v.value.targetSettings?.[id]?.outputKey||v.value.outputKeys[i])===key)!):undefined;
 const next:PromotionVersion={...structuredClone(v),id:store.id('version'),confirmed:true,legacy:false,createdAt:now(),selection,media,value:{...v.value,title:input.title,body:input.body,outputKeys:input.order,...(orderedRefs?{benchmarkImages:orderedRefs,selectedBenchmarkIds:orderedRefs}:{})}};
 store.put(kinds.version,next.id,next);store.put(kinds.work,id,{...w,name:input.title||w.name,confirmedVersionId:next.id,revision:w.revision+1});store.put('promotion-confirm',key,{input:JSON.stringify(input),result:next.id});return next;
 });}
export function replicatePromotion(store:Store,sourceId:string,versionId:string,targetId:string,revision:number,replace:boolean,regenerate=false){return store.transaction(()=>{
 const w=work(store,sourceId),v=version(store,versionId);if(v.workId!==w.id||!v.confirmed)fail('请先完成作品生成');if(v.value.videoWorkflow==='shot-remake')fail('请使用分镜复刻入口创建独立任务');const p=getCatalogProduct(store,targetId),old=getPromotionDraft(store,targetId,w.type,w.type==='post'?postModeOf(v.value):undefined,w.type==='video'?v.value.videoWorkflow:undefined);if(old.revision!==revision)fail('目标草稿已变化，请重新载入',409);
 const occupied=!!(old.value.generation.requirements||old.value.title||old.value.body||old.value.script||old.value.referenceCopy||Object.keys(old.value.pageRequirements).length||old.value.referenceVideoId||old.value.benchmarkImages?.length||old.value.inspirationImages?.length||old.value.generation.inputRoles.reference?.length);if(occupied&&!replace)fail('目标商品有未提交草稿，请选择替换或取消',409);
 if(occupied)store.put('promotion-draft-backup',store.id('draft-backup'),old);
 const same=w.productId===p.id;if(regenerate&&!same)fail('重新生成只能使用原商品');const value=promotionValueSchema.parse(structuredClone(v.value)),base=initialCreativeDraft(store,p,w.type).value;
 value.workId=regenerate?w.id:undefined;value.sourceWorkId=regenerate?w.sourceWorkId:w.id;value.sourceVersionId=regenerate?w.sourceVersionId:v.id;
 if(!same){value.inspirationImages=[];value.replacementObject='';value.targetSettings=Object.fromEntries((value.benchmarkImages||[]).map((id,i)=>[id,{outputKey:value.outputKeys[i]}]));value.referenceSourceUrl='';value.sourceStructure=[`来源作品：${w.name}（仅供人工参考，非目标商品事实）`,value.title,value.body,value.generation.requirements,value.script,...value.outputKeys.map((key,i)=>`第 ${i+1} 页：${value.pageRequirements[key]||''}`)].filter(Boolean).join('\n\n');value.title='';value.body='';value.generation.productContext=undefined;value.generation.requirements='沿用来源作品的内容结构，使用当前商品重新创作。';value.referenceCopy='';value.postTemplatePages=undefined;value.referenceVideoId=undefined;value.generation.inputRoles=base.generation.inputRoles;
 // Source text is an explicit structural reference, never target product facts.
 value.script=value.script?`沿用 ${Math.max(1,(value.script.match(/\d+(?:\.\d+)?\s*[-—～~]\s*\d+/g)||[]).length)} 个镜头的结构，重新描述当前商品的开场、细节与结尾。请补充目标商品分镜。`:'';value.pageRequirements=Object.fromEntries(value.outputKeys.map((key,i)=>[key,i===0?'封面：展示目标商品与核心视觉':'内容页：使用目标商品已确认信息，重新填写本页内容']));value.generation.fields=structuredClone(base.generation.fields);
 }
 if(!regenerate){const oldKeys=value.outputKeys;value.outputKeys=oldKeys.map(()=>store.id('page'));value.pageRequirements=Object.fromEntries(oldKeys.map((k,i)=>[value.outputKeys[i],value.pageRequirements[k]||'']));if(value.targetSettings)value.targetSettings=Object.fromEntries(Object.entries(value.targetSettings).map(([id,s])=>[id,{...s,outputKey:value.outputKeys[oldKeys.indexOf(s.outputKey)]}]));}
 value.generation.count=w.type==='video'?1:value.outputKeys.length;value.analysisEpoch=store.id('epoch');value.generation.outputProductIds=undefined;value.generation.outputInstructions=undefined;value.generation.outputReferenceIds=undefined;
 const m=store.models().find(m=>m.id===value.generation.modelId&&m.enabled);if(!m)fail('来源模型不可用，请先在系统配置启用；未自动换模型');if(!m.aspectRatios.includes(value.generation.aspectRatio)||w.type==='video'&&!m.durations.includes(value.generation.duration))fail('来源参数不再被模型支持，请先调整来源修订');
 const next:PromotionDraft={...old,revision:old.revision+1,updatedAt:now(),value};store.put(kinds.draft,next.id,next);return next;
 });}
export function appendPromotionExport(store:Store,archive:archiver.Archiver,w:PromotionWork,v:PromotionVersion,prefix=''){
 if(v.workId!==w.id)fail('导出内容不属于作品');const media={...v.media};if(!v.confirmed){const entry=promotionEntry(store,w);for(const key of v.value.outputKeys){const candidates=entry.batches.filter(b=>v.batchIds.includes(b.id)).flatMap(b=>b.attempts.filter(a=>b.creativeContext?.outputKeys[a.index-1]===key&&a.status==='completed'&&!a.simulated&&a.assetId)).sort((a,b)=>b.attemptNumber-a.attemptNumber);if(candidates[0])media[key]=candidates[0].assetId!;}}
 const list=v.value.outputKeys.map((key,i)=>({key,index:i+1,assetId:media[key]||null}));for(const row of list){if(!row.assetId)continue;const a=store.get<Asset>('asset',row.assetId)||fail('导出素材缺失');archive.file(assetFile(store,a),{name:`${prefix}${String(row.index).padStart(2,'0')}${path.extname(a.url).split('?')[0]}`});}
 archive.append(`# ${v.value.title||w.name}\n\n${v.value.body|| (v.legacy?'历史文案未保存':'')}\n\n## 脚本与提示词\n\n${v.value.script}\n\n${v.value.generation.requirements}\n`,{name:prefix+'文案与脚本.md'});archive.append(JSON.stringify({work:w,version:v,pages:list,complete:list.every(x=>x.assetId)},null,2),{name:prefix+'素材清单.json'});
}
export function registerPromotionRoutes(app:FastifyInstance,store:Store,generation:ReturnType<typeof createGenerationPricing>){
 migratePromotions(store);
 const workflow=(q:unknown)=>z.object({videoWorkflow:z.enum(['direct','reverse','shot-remake']).optional()}).parse(q).videoWorkflow;
 const mode=(q:unknown)=>z.object({mode:z.enum(['creative','replicate']).optional()}).parse(q).mode;
 const pid=(r:unknown)=>z.object({id:z.string()}).parse(r).id;
 app.get('/api/catalog/products/:id/promotions',async request=>{
  const id=pid(request.params);getCatalogProduct(store,id);
  const q=z.object({page:z.coerce.number().int().min(1).default(1),type:z.enum(['all','post','video','wear']).default('all'),status:z.enum(['all','active','completed','error','worthy']).default('all'),search:z.string().max(500).default(''),cross:z.enum(['true','false']).default('false'),includeWear:z.enum(['true','false']).default('false')}).parse(request.query);
  const matches=(attempts:Attempt[],worthy=false)=>q.status==='all'||q.status==='worthy'&&worthy||q.status==='completed'&&attempts.length>0&&attempts.every(a=>a.status==='completed')||q.status==='active'&&attempts.some(a=>!['failed','completed','pending_verification'].includes(a.status))||q.status==='error'&&attempts.some(a=>['failed','pending_verification','blocked_dependency'].includes(a.status));
  const search=q.search.trim().toLocaleLowerCase();
  const entries=store.list<PromotionWork>(kinds.work).filter(w=>!w.archived&&(w.productId===id||q.cross==='true'&&q.status==='worthy')&&(q.type==='all'||w.type===q.type)).map(w=>promotionEntry(store,w)).filter(e=>{
   const allAttempts=e.batches.flatMap(b=>b.attempts),attempts=[...new Map(allAttempts.sort((a,b)=>a.attemptNumber-b.attemptNumber).map(a=>[a.itemId,a])).values()];
   return matches(attempts,e.worthyVersionIds.length>0)&&`${e.work.name} ${e.versions.map(v=>v.value.generation.requirements).join(' ')}`.toLocaleLowerCase().includes(search);
  });
  const wear=q.includeWear==='true'&&['all','wear'].includes(q.type)&&q.status!=='worthy'?store.list<Omit<WearJob,'batch'>>('wear-job').filter(j=>j.scope===id).flatMap(j=>{const batch=store.readBatch(j.batchId);return batch?[{...j,batch}]:[];}).filter(j=>matches(latestWearAttempts(j.batch))&&`${j.stage==='model'?'基准模特生成':'服饰穿戴'} ${j.value.requirements} ${j.value.scenes.join(' ')} ${j.value.customScene}`.toLocaleLowerCase().includes(search)):[];
  const rows=[...entries.map(entry=>({id:entry.work.id,createdAt:entry.work.createdAt,entry,wear:undefined as WearJob|undefined})),...wear.map(job=>({id:'wear:'+job.batchId,createdAt:job.createdAt,entry:undefined as PromotionEntry|undefined,wear:job}))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const page=rows.slice((q.page-1)*20,q.page*20),items=page.flatMap(row=>row.entry?[row.entry]:[]),wearItems=page.flatMap(row=>row.wear?[row.wear]:[]);
  const ids=new Set([...items.flatMap(e=>e.batches.flatMap(b=>b.attempts.flatMap(a=>[a.assetId,...a.references]))),...items.flatMap(e=>e.versions.flatMap(v=>Object.values(v.media))),...wearItems.flatMap(j=>[...j.value.productIds,j.value.modelAssetId,...j.batch.attempts.flatMap(a=>[a.assetId,...a.references])])]);
  return {items,total:rows.length,assets:store.list<Asset>('asset').filter(a=>ids.has(a.id)),...(q.includeWear==='true'?{wearItems,order:page.map(row=>row.id)}:{})};
 });
 app.get('/api/promotions/:id',async r=>{const entry=promotionEntry(store,work(store,pid(r.params)));const ids=new Set(entry.batches.flatMap(b=>b.attempts.flatMap(a=>[a.assetId,...a.references])).concat(entry.versions.flatMap(v=>Object.values(v.media))));return {...entry,assets:store.list<Asset>('asset').filter(a=>ids.has(a.id)),derivatives:store.list<PromotionWork>(kinds.work).filter(w=>w.sourceWorkId===entry.work.id)};});
 app.get('/api/catalog/products/:id/promotion-drafts/:type',async r=>{const p=z.object({id:z.string(),type:z.enum(['post','video'])}).parse(r.params);return getPromotionDraft(store,p.id,p.type,mode(r.query),workflow(r.query));});
 app.put('/api/catalog/products/:id/promotion-drafts/:type',async r=>{const p=z.object({id:z.string(),type:z.enum(['post','video'])}).parse(r.params),b=z.object({revision:z.number().int(),value:promotionValueSchema}).parse(r.body);return store.transaction(()=>{const d=getPromotionDraft(store,p.id,p.type,mode(r.query),workflow(r.query));if(b.value.benchmarkImages.length&&p.type!=='post')fail('视频草稿不能带图文对标图组');if(b.value.benchmarkImages.length&&b.value.benchmarkImages.length!==b.value.outputKeys.length)fail('对标图数量与图文页数不一致');if(d.revision!==b.revision)fail('草稿已变化，输入保留，请重新载入',409);if(new Set(b.value.outputKeys).size!==b.value.outputKeys.length||b.value.generation.count!==b.value.outputKeys.length||p.type==='video'&&b.value.outputKeys.length!==1)fail('作品页数与输出位置不一致');if(b.value.workId){const w=work(store,b.value.workId);if(w.productId!==p.id||w.type!==p.type)fail('作品与商品不匹配');}if(p.type==='video'&&b.value.videoWorkflow!==d.value.videoWorkflow)fail('不能将另一视频模式保存到当前草稿');if(p.type==='post'&&postModeOf(b.value)!==postModeOf(d.value))fail('不能将另一模式保存到当前草稿');const next={...d,revision:d.revision+1,value:b.value,updatedAt:now()};store.put(kinds.draft,d.id,next);return next;});});
 app.post('/api/catalog/products/:id/promotion-drafts/:type/plan',async r=>{const p=z.object({id:z.string(),type:z.enum(['post','video'])}).parse(r.params),b=z.object({draftRevision:z.number().int(),productRevision:z.number().int()}).parse(r.body),product=getCatalogProduct(store,p.id),d=getPromotionDraft(store,p.id,p.type,mode(r.query),workflow(r.query));if(product.revision!==b.productRevision||d.revision!==b.draftRevision)fail('商品或草稿已更新，请重新报价',409);const creativeContext=promotionContext(store,d,product),draft=promotionGeneration(store,product,d);return {...await generation.plan(workshopSkill(p.type),draft,'generate',creativeContext),creativeContext,draft};});
 app.post('/api/promotions/:id/confirm',async r=>confirmPromotion(store,pid(r.params),z.object({revision:z.number().int(),versionId:z.string(),selection:z.record(z.string(),z.string()),title:z.string().max(500),body:z.string().max(16000),order:z.array(z.string()).min(1).max(100),idempotencyKey:z.string().min(8)}).parse(r.body)));
 app.post('/api/promotions/:id/replicate',async r=>{const b=z.object({versionId:z.string(),targetId:z.string(),revision:z.number().int(),replace:z.boolean(),regenerate:z.boolean().default(false)}).parse(r.body);return replicatePromotion(store,pid(r.params),b.versionId,b.targetId,b.revision,b.replace,b.regenerate);});
 app.put('/api/promotions/:id/worthy',async r=>{const w=work(store,pid(r.params)),b=z.object({versionId:z.string(),worthy:z.boolean()}).parse(r.body),v=version(store,b.versionId);if(v.workId!==w.id||!v.confirmed)fail('只能标记已完成作品');store.put('promotion-worthy',v.id,{worthy:b.worthy});return {ok:true};});
 app.post('/api/promotions/:id/performance',async r=>{const w=work(store,pid(r.params)),b=performanceSchema.parse(r.body),v=version(store,b.versionId);if(v.workId!==w.id||!v.confirmed)fail('请先完成作品生成再记录效果');if(b.url&&!/^https?:\/\//i.test(b.url))fail('发布链接应为 HTTP(S) 地址');const item:PromotionPerformanceRecord={...b,id:store.id('performance'),manual:true};store.put(kinds.performance,item.id,item);return item;});
 app.post('/api/promotions/:id/export',async r=>{const w=work(store,pid(r.params)),b=z.object({versionId:z.string()}).parse(r.body),v=version(store,b.versionId),id=store.id('export'),filename=id+'.zip',dir=path.join(store.dataDir,'exports');fs.mkdirSync(dir,{recursive:true});const destination=path.join(dir,filename);await new Promise<void>((resolve,reject)=>{const out=fs.createWriteStream(destination),archive=archiver('zip');out.on('close',resolve);out.on('error',reject);archive.on('error',reject);archive.pipe(out);try{appendPromotionExport(store,archive,w,v);void archive.finalize();}catch(e){archive.abort();out.destroy();reject(e);}});store.put('export',id,{id,filename,mime:'application/zip',workId:w.id,versionId:v.id,createdAt:now()});return {id,url:`/api/exports/${id}/download`};});
}
