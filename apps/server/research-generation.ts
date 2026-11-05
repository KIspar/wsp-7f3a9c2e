import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store';
import {fail} from './errors';
import {getCatalogProduct,getCreativeDraft,workshopGeneration,workshopSkill} from './catalog';
import {getPromotionDraft,promotionContext,promotionGeneration} from './promotion';
import {creativeValueSchema,type ProductCreativeDraft} from '../../packages/catalog';
import {promotionValueSchema,type PromotionDraft} from '../../packages/promotion';
import {deliveryKinds,type ProductResearch,type StrategyQuote} from '../../packages/research';
import {kitOutputKeys,kitSlots} from '../../packages/product-design';
import {draftSchema,type Batch,type CreativeContext} from '../../packages/contracts';
import type {createGenerationPricing} from './generation-pricing';
const now=()=>new Date().toISOString();
type StoredQuote=StrategyQuote&{fingerprint:string;prepared:{kind:string;before:ProductCreativeDraft;next:ProductCreativeDraft}[]};
export function registerResearchGeneration(app:FastifyInstance,store:Store,generation:ReturnType<typeof createGenerationPricing>){
 const params=z.object({id:z.string()}),config=z.object({purposes:z.array(z.enum(deliveryKinds)).min(1).max(4),strategyIndex:z.number().int().min(0).max(2),imageModelId:z.string(),videoModelId:z.string(),imageRatio:z.string(),videoRatio:z.string(),duration:z.number().int().positive(),imageNoText:z.boolean().default(false),idempotencyKey:z.string().min(8).max(100)});
 app.post('/api/research/:id/delivery-quote',async r=>{
  const j=store.get<ProductResearch>('product-research',params.parse(r.params).id)||fail('研究不存在',404),b=config.parse(r.body),s=j.strategies?.[b.strategyIndex]||fail('创作方案不存在');
  if(j.status!=='completed')fail('请等待方案编排完成');if(new Set(b.purposes).size!==b.purposes.length)fail('交付物不能重复');
  const p=getCatalogProduct(store,j.productId);if(p.revision!==j.product.revision)fail('商品资料已改变，请重新分析或重新形成方案后制作',409);
  const fingerprint=JSON.stringify({id:j.id,...b}),previous=store.list<StoredQuote>('research-quote').find(q=>q.fingerprint===fingerprint);if(previous)return previous;
  if(b.purposes.includes('video')&&b.purposes.length>1&&store.models().find(m=>m.id===b.videoModelId)?.provider==='token01')fail('Token01 视频按人民币独立计费，请将视频与图片分别查询报价并生成');
  const prepared:StoredQuote['prepared']=[],items:StrategyQuote['items']=[];
  for(const purpose of b.purposes){
   const old=purpose==='post'||purpose==='video'?getPromotionDraft(store,p.id,purpose,purpose==='post'?'creative':undefined,purpose==='video'?'direct':undefined):getCreativeDraft(store,p.id,purpose),next=structuredClone(old);next.revision++;next.updatedAt=now();
   const g=next.value.generation,model=store.models().find(m=>m.id===(purpose==='video'?b.videoModelId:b.imageModelId)&&m.enabled)||fail('所选生成模型不可用，请明确选择模型');
   if(model.category!==(purpose==='video'?'video':'image'))fail('生成模型类型不匹配');
   const ratio=purpose==='video'?b.videoRatio:b.imageRatio;if(!model.aspectRatios.includes(ratio))fail(`${model.name}不支持所选比例，请调整`);
   if(!j.input.productImageIds.length||j.input.productImageIds.length>model.maxReferences)fail(`${model.name}可用参考图上限为${model.maxReferences}张，请调整商品研究原图范围`);
   g.modelId=model.id;g.aspectRatio=ratio;g.parameters=Object.fromEntries(Object.entries(model.parameters).map(([key,v])=>[key,v.default??'']));g.requirements=`${s.requirements}\n制作方向：${s.angle}\n仅引用自有商品已确认信息与图片可见外观；来源声明、评论意见与创意假设不是已核实性能。${b.imageNoText?'图片中不添加文字、水印或字幕。':''}`;
   g.inputRoles={[purpose==='video'?'references':'product']:j.input.productImageIds};g.overrides={};g.outputInstructions=undefined;g.promptTemplate=undefined;g.productContext=undefined;
   if(purpose==='main'){
    g.productKit={platformRulesVersion:'douyin-cn-v1',whiteBackground:0,sellingPoints:3,scenes:2,other:2,otherPurposes:['商品细节','另一角度'],slotRequirements:{},slotProductIds:{},layouts:[]};g.count=7;g.imageDesign={groupCount:1,screens:[],bindings:[],nextNumber:1};kitSlots(g.productKit).forEach((slot,i)=>g.productKit!.slotRequirements[slot.id]=s.kit[i]);next.value.outputKeys=kitOutputKeys(g);
   }else if(purpose==='detail'){
    g.count=1;g.imageDesign={groupCount:1,screens:s.detail.map((row,i)=>({id:`research-${j.id.slice(-12)}-${i}`,type:row.type,requirements:row.prompt,facts:'',productIds:j.input.productImageIds})),bindings:j.input.productImageIds.map((assetId,i)=>({assetId,number:i+1})),nextNumber:j.input.productImageIds.length+1};next.value.outputKeys=g.imageDesign.screens.map(s=>s.id);
   }else if(purpose==='post'){
    const d=next as PromotionDraft;g.imageDesign=undefined;g.productKit=undefined;g.count=s.post.length;d.value.outputKeys=s.post.map(()=>store.id('page'));d.value.pageRequirements=Object.fromEntries(d.value.outputKeys.map((key,i)=>[key,s.post[i]]));d.value.postMode='creative';d.value.benchmarkImages=[];d.value.inspirationImages=[];d.value.postTemplatePages=undefined;d.value.imageNoText=b.imageNoText;d.value.title=s.name;d.value.body='';d.value.workId=undefined;
   }else{
    if(!model.durations.includes(b.duration))fail('视频模型不支持当前时长，请选择明确支持的值');g.imageDesign=undefined;g.productKit=undefined;g.count=1;g.duration=b.duration;next.value.outputKeys=[store.id('video')];next.value.script=`${s.video.script}\n用户选择成片${b.duration}秒，请保持完整叙事并按此时长组织动作与镜头。`;g.requirements+='\n'+s.video.prompt;const d=next as PromotionDraft;d.value.videoWorkflow='direct';d.value.title=s.name;d.value.workId=undefined;
   }
   next.value.generation=draftSchema.parse(g);next.value=purpose==='post'||purpose==='video'?promotionValueSchema.parse(next.value):creativeValueSchema.parse(next.value);
   const context:CreativeContext=purpose==='post'||purpose==='video'?promotionContext(store,next as PromotionDraft,p):{productId:p.id,productRevision:p.revision,purpose,draftRevision:next.revision,outputKeys:next.value.outputKeys};
   const draft=purpose==='post'||purpose==='video'?promotionGeneration(store,p,next as PromotionDraft):workshopGeneration(store,p,next),skillId=workshopSkill(purpose,next),plan=await generation.plan(skillId,draft,'generate',context);
   prepared.push({kind:purpose==='post'||purpose==='video'?'promotion-draft':'catalog-draft',before:old,next});items.push({purpose,skillId,draft,creativeContext:context,hash:plan.hash,quote:plan.quote});
  }
  const maximum=items.reduce((n,i)=>n+i.quote.maximum,0),available=items.some(i=>i.quote.available===null)?null:Math.min(...items.map(i=>i.quote.available!));
  const q:StoredQuote={id:store.id('research-quote'),researchId:j.id,strategyIndex:b.strategyIndex,productId:p.id,productRevision:p.revision,createdAt:now(),items,prepared,maximum,available,unit:items[0].quote.unit,affordable:items.every(i=>i.quote.affordable)&&(available===null||maximum<=available),status:'quoted',fingerprint};store.put('research-quote',q.id,q);return q;
 });
 const locks=new Set<string>();
 app.post('/api/research-deliveries/:id/submit',async r=>{
  const id=params.parse(r.params).id,b=z.object({maximumCost:z.number().finite().positive(),replaceDrafts:z.literal(true)}).parse(r.body),q=store.get<StoredQuote>('research-quote',id)||fail('报价不存在',404);
  if(locks.has(id))fail('此方案正在接单，请稍后查看结果',409);if(q.status==='submitted')return q;
  if(q.maximum>b.maximumCost+1e-9)fail('报价超过确认额度');const p=getCatalogProduct(store,q.productId);if(p.revision!==q.productRevision)fail('商品已修改，请重新报价',409);
  locks.add(id);try{
   // Check the whole remaining package before installing drafts or admitting its first paid task.
   const pending=q.items.filter(i=>!i.batchId),checks=await Promise.all(pending.map(async item=>{const plan=await generation.plan(item.skillId,item.draft,'generate',item.creativeContext);if(plan.hash!==item.hash||plan.quote.maximum>item.quote.maximum+1e-9)fail('制作报价已变化，请重新查询',409);return plan.quote;}));
   if(checks.some(q=>!q.affordable)||checks.length&&checks.every(q=>q.available!==null)&&pending.reduce((n,i)=>n+i.quote.maximum,0)>Math.min(...checks.map(q=>q.available!)))fail('可用算力不足以接单剩余整组内容，请减少制作项或充值后重试',402);
   if(q.status==='quoted'){
    // Validate every saved draft before changing any; backup the previous content explicitly.
    store.transaction(()=>{for(const row of q.prepared){const current=row.kind==='promotion-draft'?getPromotionDraft(store,p.id,row.before.purpose as 'post'|'video',row.before.purpose==='post'?'creative':undefined,row.before.purpose==='video'?'direct':undefined):getCreativeDraft(store,p.id,row.before.purpose);if(current.revision!==row.before.revision)fail('制作草稿已修改，请重新报价；未覆盖现有草稿',409);}
     for(const row of q.prepared){store.put('research-draft-backup',`${q.id}:${row.next.id}`,row.before);store.put(row.kind,row.next.id,row.next);}q.status='submitting';store.put('research-quote',q.id,q);
    });
   }
   for(const item of q.items){if(item.batchId)continue;try{const accepted=await generation.admit({skillId:item.skillId,draft:item.draft,action:'generate',creativeContext:item.creativeContext,expectedDraftRevision:item.creativeContext.draftRevision,planHash:item.hash,idempotencyKey:`${q.id}:${item.purpose}`,maximumCost:item.quote.maximum});item.batchId=accepted.batch.id;delete item.error;}catch(e){item.error=(e as Error).message;}store.put('research-quote',q.id,q);}
   q.status=q.items.every(i=>i.batchId)?'submitted':'partial';store.put('research-quote',q.id,q);return q;
  }finally{locks.delete(id);}
 });
 app.get('/api/research-deliveries/:id',async r=>store.get('research-quote',params.parse(r.params).id)||fail('方案执行记录不存在',404));
}
