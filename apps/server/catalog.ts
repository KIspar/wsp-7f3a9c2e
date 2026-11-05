import {kitOutputKeys} from '../../packages/product-design';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import sharp from 'sharp';
import {defaultDraft,type Asset,type Batch,type Draft,type ProductProfile} from '../../packages/contracts';
import {creativeValueSchema,productEditableSchema,mediaBindingSchema,purposes,type CatalogProduct,type CatalogDetail,type CollectionJob,type SourceSnapshot,type ProductCreativeDraft,type CreativePurpose,type ProductMediaBinding} from '../../packages/catalog';
import type {Store} from './store';
import {fail} from './errors';
import {createCollectionService,sourceBindings} from './catalog-collection';
import type {RemoteReader} from './remote';
import type {createGenerationPricing} from './generation-pricing';
import {assetFile} from './analysis-media';
import {appendPromotionExport} from './promotion';
import type {PromotionDraft,PromotionVersion,PromotionWork} from '../../packages/promotion';
const now=()=>new Date().toISOString();
export const creativeDraftId=(productId:string,purpose:string)=>`${productId}:${purpose}`;
export function getCatalogProduct(store:Store,id:string){return store.get<CatalogProduct>('catalog-product',id)||fail('商品不存在',404);}
export function initialCreativeDraft(store:Store,product:CatalogProduct,purpose:CreativePurpose):ProductCreativeDraft{
  const skill=store.skills().find(s=>s.id===(purpose==='video'?'video-generate':purpose==='detail'?'detail-design':purpose==='main'?'product-kit':'image-generate'))||fail('创作技能不可用');
  const generation=defaultDraft(skill,store.models());generation.requirements='';generation.inputRoles={product:['main','detail'].includes(purpose)?[]:product.bindings.filter(b=>b.kind==='main').slice(0,3).map(b=>b.assetId)};
  if(purpose==='video')generation.inputRoles={references:product.bindings.filter(b=>b.kind==='main').slice(0,3).map(b=>b.assetId)};
  if(purpose==='detail'&&generation.imageDesign){generation.fields.productName=product.title;generation.fields.sellingPoints=product.sellingPoints;}
  const outputKey=purpose==='main'?`main-${product.bindings.filter(b=>b.kind==='main').length+1}`:purpose==='detail'?'first-screen':purpose==='sku'?product.colors[0]?.id||'unbound':`${purpose}-1`;
  return {id:creativeDraftId(product.id,purpose),productId:product.id,purpose,revision:0,value:{generation,outputKeys:purpose==='main'?kitOutputKeys(generation):purpose==='detail'?generation.imageDesign!.screens.map(s=>s.id):[outputKey],script:'',pageRequirements:{}},updatedAt:now()};
}
function migrateLegacyMainDraft(store:Store,product:CatalogProduct,source:ProductCreativeDraft):ProductCreativeDraft{
  if(source.value.generation.productKit)return source;
  const skill=store.skills().find(s=>s.id==='product-kit')||fail('商品套图技能不可用');
  const legacy=source.value.generation, generation=defaultDraft(skill,store.models());
  generation.modelId=store.models().some(m=>m.id===legacy.modelId&&m.category==='image')?legacy.modelId:generation.modelId;
  const model=store.models().find(m=>m.id===generation.modelId);
  generation.aspectRatio=model?.aspectRatios.includes(legacy.aspectRatio)?legacy.aspectRatio:generation.aspectRatio;
  generation.inputRoles={product:legacy.inputRoles.product||[],reference:legacy.inputRoles.reference||[]};
  generation.requirements=legacy.requirements;
  generation.fields={...generation.fields,language:legacy.fields.language||generation.fields.language};
  return {...source,value:{...source.value,generation,outputKeys:kitOutputKeys(generation)}};
}
export function getCreativeDraft(store:Store,productId:string,purpose:CreativePurpose){const product=getCatalogProduct(store,productId),saved=store.get<ProductCreativeDraft>('catalog-draft',creativeDraftId(productId,purpose));if(!saved)return initialCreativeDraft(store,product,purpose);return purpose==='main'?migrateLegacyMainDraft(store,product,saved):saved;}
export function workshopSkill(purpose:CreativePurpose,draft?:ProductCreativeDraft){return purpose==='video'?'video-generate':purpose==='detail'?'detail-design':purpose==='main'?'product-kit':'image-generate';}
export function workshopGeneration(store:Store,product:CatalogProduct,draft:ProductCreativeDraft):Draft{
  const g=structuredClone(draft.value.generation);
  // Product facts are a submitted snapshot; no silent update of ProductProfile.
  g.productContext={id:product.id,revision:product.revision,name:product.title.slice(0,200),facts:`用户确认卖点：${product.sellingPoints||'无'}\n参数（保留来源，需核实）：\n${product.parameters.map(p=>`${p.name}：${p.value}（${p.origin==='source'?'来源提供，未核实':'用户填写'}）`).join('\n')}`};
  const scope=g.catalogScope;
  if(scope&&scope.kind!=='product'){
    const sku=scope.kind==='sku'?product.skus.find(s=>s.id===scope.id):undefined;
    const color=product.colors.find(c=>c.id===(sku?.colorId||scope.id));
    if(!color||scope.kind==='sku'&&!sku)fail('本次颜色或规格已不存在，请重新选择');
    const own=product.bindings.filter(b=>b.kind===scope.kind&&b.targetId===scope.id);
    const bound=own.length?own:product.bindings.filter(b=>b.kind==='color'&&b.targetId===color.id);
    if(!bound.length)fail('所选颜色或规格尚未绑定商品图片，请先绑定，不使用其他颜色替代');
    if(!g.inputRoles.product?.length)fail('请选择本次颜色或规格的商品原图');
    g.productContext.facts+=`\n本次范围：颜色 ${color.name}${sku?`；尺码 ${sku.size}`:''}。仅此范围，不推广到所有规格。`;
  } else g.productContext.facts+=`\n颜色选项（用户/来源资料，未确认不推断成分）：${product.colors.map(c=>c.name).join('、')||'未提供'}；尺码选项：${product.sizes.join('、')||'未提供'}。具体参数以本次确认范围为准。`;
  if(draft.purpose==='post'){g.outputInstructions=draft.value.outputKeys.map(key=>draft.value.pageRequirements?.[key]||'按共同要求制作本页');if(draft.value.referenceCopy?.trim())g.requirements+=`\n同行文案（仅参考内容结构与表达，不是本商品事实，不得照搬无依据承诺）：\n${draft.value.referenceCopy}`;}
  if(draft.purpose==='detail'){g.fields.productName=product.title;g.fields.sellingPoints=product.sellingPoints;}
  if(draft.purpose==='video'&&draft.value.script.trim())g.requirements=`${g.requirements}\n分镜脚本：\n${draft.value.script}`;
  if(g.requirements.length>16000||g.productContext!.facts.length>8000)fail('商品资料或脚本过长，请精简后生成；未截断输入');
  return g;
}
export function registerCatalogRoutes(app:FastifyInstance,store:Store,generation:ReturnType<typeof createGenerationPricing>,options:{worker?:boolean;remote?:RemoteReader}={}){
  const collection=createCollectionService(store,options.remote);
  const params=z.object({id:z.string()});
  function revision(p:CatalogProduct,r:number){if(p.revision!==r)fail('商品在其他页面已更新，请重新载入后合并；当前输入保留',409);}
  function save(p:CatalogProduct,patch:Partial<CatalogProduct>){const next={...p,...patch,revision:p.revision+1,updatedAt:now()};store.put('catalog-product',p.id,next);return next;}
  app.post('/api/collection/jobs',async request=>{const b=z.object({urls:z.array(z.string().max(2000)).min(1).max(20),idempotencyKey:z.string().min(8).max(100)}).parse(request.body);return collection.enqueue(b.urls,b.idempotencyKey);});
  app.get('/api/collection/jobs/:id',async request=>store.get<CollectionJob>('collection-job',params.parse(request.params).id)||fail('采集任务不存在',404));
  app.post('/api/catalog/products/:id/source-page',async request=>{
    const id=params.parse(request.params).id,key=z.object({idempotencyKey:z.string().min(8).max(100)}).parse(request.query).idempotencyKey;
    const file=await request.file({limits:{fileSize:8*1024*1024,files:1,fields:0,parts:1}});
    if(!file)fail('请选择浏览器保存的 HTML 商品页面');
    if(!/\.html?$/i.test(file.filename))fail('请选择 .html 或 .htm 页面文件');
    const bytes=await file.toBuffer();if(file.file.truncated)fail('页面文件超过 8MB');
    const charset=/charset\s*=\s*["']?(gbk|gb2312|gb18030)/i.test(bytes.subarray(0,4096).toString('latin1'))?'gb18030':'utf-8';
    return collection.supplement(id,new TextDecoder(charset).decode(bytes),key);
  });
  app.get('/api/catalog/products',async request=>{
    const q=z.object({search:z.string().max(500).default(''),status:z.string().default('all'),page:z.coerce.number().int().min(1).default(1),archived:z.enum(['true','false']).default('false')}).parse(request.query);
    const all=store.list<CatalogProduct>('catalog-product').filter(p=>p.archived===(q.archived==='true')&&`${p.title} ${p.itemNumber} ${p.supplier}`.toLowerCase().includes(q.search.toLowerCase())&&(q.status==='all'||p.collectionStatus===q.status)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const items=all.slice((q.page-1)*20,q.page*20),ids=new Set(items.flatMap(p=>p.bindings.map(b=>b.assetId)));
    return {items,total:all.length,page:q.page,assets:store.list<Asset>('asset').filter(a=>ids.has(a.id)),jobs:store.list<CollectionJob>('collection-job').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10)};
  });
  app.get('/api/catalog/products/:id',async request=>{
    const {id}=params.parse(request.params),product=getCatalogProduct(store,id),snapshots=store.list<SourceSnapshot>('source-snapshot').filter(s=>s.productId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const batches=store.list<Batch>('batch').filter(b=>b.creativeContext?.productId===id).map(b=>store.readBatch(b.id)!);
    const drafts=purposes.map(purpose=>getCreativeDraft(store,id,purpose));
    const promotionDrafts=store.list<PromotionDraft>('promotion-draft').filter(d=>d.productId===id);
    const registered=store.list<{productId:string;assetId:string}>('catalog-image').filter(a=>a.productId===id).map(a=>a.assetId);
    const imageIds=[...new Set([...registered,...snapshots.flatMap(s=>s.media.flatMap(m=>m.assetId?[m.assetId]:[])),...product.bindings.map(b=>b.assetId),...drafts.flatMap(d=>[...d.value.generation.inputRoles.product||[],...Object.values(d.value.generation.productKit?.slotProductIds||{}).flat(),...d.value.generation.imageDesign?.screens.flatMap(s=>s.productIds||[])||[]]),...promotionDrafts.flatMap(d=>[...d.value.generation.inputRoles.product||[],...Object.values(d.value.targetSettings||{}).flatMap(s=>s.productIds||[])]),...batches.flatMap(b=>b.attempts.flatMap(a=>a.assetId?[a.assetId]:[]))])].filter(id=>store.get<Asset>('asset',id)?.type==='image');
    const ids=new Set([...promotionDrafts.flatMap(d=>[...Object.values(d.value.generation.inputRoles).flat(),...d.value.benchmarkImages||[],...d.value.inspirationImages||[],...Object.values(d.value.targetSettings||{}).flatMap(s=>s.productIds||[]),d.value.referenceVideoId]),...product.bindings.map(b=>b.assetId),...snapshots.flatMap(s=>s.media.map(m=>m.assetId)),...drafts.flatMap(d=>[...Object.values(d.value.generation.inputRoles).flat(),...Object.values(d.value.generation.productKit?.slotProductIds||{}).flat(),...d.value.generation.imageDesign?.screens.flatMap(s=>s.productIds||[])||[]]),...drafts.map(d=>d.value.referenceVideoId),...batches.flatMap(b=>b.attempts.flatMap(a=>[a.assetId,...a.references]))]);
    for(const id of imageIds)ids.add(id);
    return {product,snapshots,batches,drafts,imageIds,assets:store.list<Asset>('asset').filter(a=>ids.has(a.id)),jobs:store.list<CollectionJob>('collection-job').filter(j=>j.items.some(i=>i.productId===id))} satisfies CatalogDetail;
  });
  app.post('/api/catalog/products/:id/images',async request=>{
    const {id}=params.parse(request.params),{assetId}=z.object({assetId:z.string().min(1).max(200)}).parse(request.body);
    getCatalogProduct(store,id);const asset=store.get<Asset>('asset',assetId)||fail('图片不存在',404);
    if(asset.type!=='image'||['simulator','example'].includes(asset.source))fail('请选择可用的真实图片');
    const key=`${id}:${assetId}`;if(!store.get('catalog-image',key))store.put('catalog-image',key,{productId:id,assetId,createdAt:now()});
    return {assetId};
  });
  app.patch('/api/catalog/products/:id',async request=>{const b=z.object({revision:z.number().int(),changes:productEditableSchema.partial()}).parse(request.body);return store.transaction(()=>{const p=getCatalogProduct(store,params.parse(request.params).id);revision(p,b.revision);if(b.changes.skus){const colors=b.changes.colors||p.colors;if(b.changes.skus.some(s=>!colors.some(c=>c.id===s.colorId)))fail('SKU 必须关联已存在的颜色');}return save(p,b.changes);});});
  app.post('/api/catalog/products/:id/recollect',async request=>{const p=getCatalogProduct(store,params.parse(request.params).id);const b=z.object({idempotencyKey:z.string().min(8).max(100)}).parse(request.body);if(store.list<CollectionJob>('collection-job').some(j=>j.items.some(i=>i.productId===p.id&&['queued','parsing','downloading'].includes(i.status)&&!(i as {duplicate?:boolean}).duplicate)))fail('此商品正在采集，请等待完成',409);return collection.enqueue([p.sourceUrl],b.idempotencyKey,true);});
  app.post('/api/catalog/products/:id/merge-source',async request=>{
    const b=z.object({revision:z.number().int(),snapshotId:z.string(),fields:z.array(z.enum(['title','supplier','itemNumber','wholesaleCost','parameters','colors','sizes','skus'])).max(8),mediaKeys:z.array(z.string()).max(200)}).parse(request.body);
    return store.transaction(()=>{const p=getCatalogProduct(store,params.parse(request.params).id);revision(p,b.revision);const s=store.get<SourceSnapshot>('source-snapshot',b.snapshotId)||fail('来源快照不存在',404);if(s.productId!==p.id)fail('来源不属于该商品');const patch:Partial<CatalogProduct>={sourceSnapshotId:s.id};for(const key of b.fields)(patch as Record<string,unknown>)[key]=s[key];const selected=sourceBindings(s).filter(binding=>b.mediaKeys.some(key=>binding.id===`source-${s.id}-${key}`));const bindings=[...p.bindings];for(const binding of selected){const index=bindings.findIndex(b=>b.kind===binding.kind&&b.order===binding.order&&b.targetId===binding.targetId);if(index>=0)bindings[index]=binding;else bindings.push(binding);}patch.bindings=bindings;return save(p,patch);});
  });
  app.get('/api/catalog/products/:id/drafts/:purpose',async request=>{const {id,purpose}=z.object({id:z.string(),purpose:z.enum(purposes)}).parse(request.params);return getCreativeDraft(store,id,purpose);});
  app.put('/api/catalog/products/:id/drafts/:purpose',async request=>{
    const {id,purpose}=z.object({id:z.string(),purpose:z.enum(purposes)}).parse(request.params);const b=z.object({revision:z.number().int().nonnegative(),value:creativeValueSchema}).parse(request.body);
    return store.transaction(()=>{getCatalogProduct(store,id);const old=getCreativeDraft(store,id,purpose);if(old.revision!==b.revision)fail('该商品的创作草稿已变化，请重新载入；未覆盖其他页面输入',409);if(b.value.generation.productKit&&JSON.stringify(b.value.outputKeys)!==JSON.stringify(kitOutputKeys(b.value.generation)))fail('套图输出位置与结构不一致，请重新保存');if(b.value.outputKeys.length!==new Set(b.value.outputKeys).size)fail('每个输出位置须唯一');store.put('catalog-draft-history',`${old.id}:${old.revision}`,store.get<ProductCreativeDraft>('catalog-draft',old.id)||old);const next={...old,revision:old.revision+1,value:b.value,updatedAt:now()};store.put('catalog-draft',next.id,next);return next;});
  });
  app.post('/api/catalog/products/:id/creative/:purpose/plan',async request=>{const {id,purpose}=z.object({id:z.string(),purpose:z.enum(purposes)}).parse(request.params);const p=getCatalogProduct(store,id),d=getCreativeDraft(store,id,purpose);const b=z.object({draftRevision:z.number().int(),productRevision:z.number().int()}).parse(request.body);revision(p,b.productRevision);if(d.revision!==b.draftRevision)fail('创作草稿已变化，请保存后预览',409);const ctx={productId:id,productRevision:p.revision,purpose,draftRevision:d.revision,outputKeys:d.value.outputKeys};const draft=workshopGeneration(store,p,d);return {...await generation.plan(workshopSkill(purpose,d),draft,'generate',ctx),draft,creativeContext:ctx};});
  app.put('/api/catalog/products/:id/adoptions',async request=>{
    const b=z.object({revision:z.number().int(),bindings:z.array(mediaBindingSchema).max(300)}).parse(request.body);
    return store.transaction(()=>{const p=getCatalogProduct(store,params.parse(request.params).id);revision(p,b.revision);if(new Set(b.bindings.map(x=>x.id)).size!==b.bindings.length)fail('素材位置不能重复');
      const slots=new Set<string>();for(const binding of b.bindings){const slot=`${binding.kind}:${binding.targetId||binding.order}`;if(slots.has(slot))fail('同一位置只能放置一份素材');slots.add(slot);const a=store.get<Asset>('asset',binding.assetId)||fail('素材不存在');if(a.source==='simulator'||a.source==='example')fail('商品工坊不能采用模拟或示例结果');if((binding.kind==='video')!==(a.type==='video'))fail('素材类型与位置不匹配');if(['color','sku'].includes(binding.kind)&&!(binding.kind==='color'?p.colors:p.skus).some(t=>t.id===binding.targetId))fail('颜色或 SKU 位置不存在');
      if(binding.attemptId){const attempt=store.readBatch(store.get<{batchId:string}>('attempt',binding.attemptId)?.batchId||'')?.attempts.find(a=>a.id===binding.attemptId);const batch=attempt&&store.readBatch(attempt.batchId);if(batch?.creativeContext){const context=batch.creativeContext,key=context.outputKeys[attempt!.index-1],expected=context.purpose==='sku'?(p.skus.some(s=>s.id===key)?'sku':'color'):context.purpose;if(expected!==binding.kind||binding.id!==key||['sku','color'].includes(expected)&&binding.targetId!==key)fail('采用位置与任务输出快照不匹配');}if(!attempt||attempt.status!=='completed'||attempt.assetId!==a.id||attempt.simulated||batch?.creativeContext?.productId!==p.id)fail('候选结果不属于该商品或尚未保存');}}
      return save(p,{bindings:b.bindings});});
  });
  app.post('/api/catalog/products/:id/sync-profile',async request=>{const b=z.object({revision:z.number().int(),assetIds:z.array(z.string()).min(1).max(16)}).parse(request.body);return store.transaction(()=>{const p=getCatalogProduct(store,params.parse(request.params).id);revision(p,b.revision);const allowed=new Set([...p.bindings.map(b=>b.assetId),...store.list<SourceSnapshot>('source-snapshot').filter(s=>s.productId===p.id).flatMap(s=>s.media.map(m=>m.assetId))]);if(b.assetIds.some(id=>!allowed.has(id)||store.get<Asset>('asset',id)?.type!=='image'))fail('请选择当前商品的图片');const old=p.profileId?store.get<ProductProfile>('product',p.profileId):undefined;const id=old?.id||store.id('profile');if(p.title.length>200)fail('商品资料名称最多 200 字，请先精简标题；尚未同步');const profile:ProductProfile={id,name:p.title,facts:`${p.sellingPoints}\n${p.parameters.map(x=>`${x.name}：${x.value}（${x.origin==='source'?'来源提供，未核实':'用户填写'}）`).join('\n')}`,assetIds:b.assetIds,revision:(old?.revision||0)+1,updatedAt:now()};if(profile.facts.length>8000)fail('商品资料最多 8000 字，请先精简卖点与参数；尚未同步');store.put('product',id,profile);save(p,{profileId:id});return profile;});});
  app.post('/api/catalog/products/:id/export',async request=>{
    const b=z.object({revision:z.number().int(),longImage:z.boolean().default(false),promotionVersionIds:z.array(z.string()).max(100).default([])}).parse(request.body);const p=getCatalogProduct(store,params.parse(request.params).id);revision(p,b.revision);const frozen=structuredClone(p),id=store.id('catalog-export'),filename=`${id}.zip`,file=path.join(store.dataDir,'exports',filename),tmp=file+'.tmp';
    const folder:Record<ProductMediaBinding['kind'],string>={main:'主图',detail:'详情',color:'SKU-颜色',sku:'SKU-规格',unclassified:'待分类',post:'推广图文',video:'推广视频'};
    const selectedWorks=b.promotionVersionIds.map(id=>{const v=store.get<PromotionVersion>('promotion-version',id)||fail('作品不存在');const w=store.get<PromotionWork>('promotion-work',v.workId)||fail('作品不存在');if(w.productId!==p.id||!v.confirmed)fail('请选择当前商品已完成的作品');return {w:structuredClone(w),v:structuredClone(v)};});
    const entries=frozen.bindings.filter(binding=>!Object.hasOwn(request.body as object,'promotionVersionIds')||!['post','video'].includes(binding.kind)).slice().sort((a,b)=>a.order-b.order).map(binding=>{const asset=store.get<Asset>('asset',binding.assetId)||fail('采用素材不存在');return {binding,asset,file:assetFile(store,asset)};});
    if(!entries.length&&!selectedWorks.length)fail('请先生成或添加素材');
    let longImage:Buffer|undefined;if(b.longImage){const detail=entries.filter(e=>e.binding.kind==='detail');if(!detail.length)fail('请先添加详情图片');const images=[];let top=0;for(const e of detail){const img=await sharp(e.file).resize({width:750}).png().toBuffer({resolveWithObject:true});if(top+img.info.height>60000)fail('长图超过 60000 像素，请减少详情图片');images.push({input:img.data,left:0,top});top+=img.info.height;}longImage=await sharp({create:{width:750,height:top,channels:3,background:'#fff'}}).composite(images).png().toBuffer();}
    const drafts=store.list<ProductCreativeDraft>('catalog-draft').filter(d=>d.productId===p.id),zip=archiver('zip',{zlib:{level:5}});const done=new Promise<void>((resolve,reject)=>{const out=fs.createWriteStream(tmp);out.on('close',resolve);out.on('error',reject);zip.on('error',reject);zip.pipe(out);});
    for(const {binding,asset,file}of entries)zip.file(file,{name:`${folder[binding.kind]}/${String(binding.order+1).padStart(2,'0')}-${(binding.targetId||binding.id).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g,'_')}${path.extname(asset.url)}`});
    for(const {w,v} of selectedWorks)appendPromotionExport(store,zip,w,v,`推广作品/${w.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g,'_').slice(0,60)}-${w.id.slice(-8)}/`);
    if(longImage)zip.append(longImage,{name:'详情/详情长图.png'});
    zip.append(JSON.stringify({product:frozen,exportedAt:now(),bindings:frozen.bindings},null,2),{name:'商品资料与素材清单.json'});
    if(!Object.hasOwn(request.body as object,'promotionVersionIds'))zip.append(`# ${frozen.postTitle||frozen.title}\n\n${frozen.postBody}\n\n${entries.filter(e=>e.binding.kind==='post').map(e=>`${e.binding.order+1}. ${e.binding.label}`).join('\n')}`,{name:'推广图文/标题与正文.md'});
    const related=store.list<Batch>('batch').filter(x=>x.creativeContext?.productId===p.id).map(x=>store.readBatch(x.id)!);
    zip.append(drafts.map(d=>`## ${d.purpose}\n\n${d.value.script}\n\n${d.value.generation.requirements}`).join('\n\n')+'\n\n'+related.flatMap(b=>b.attempts.filter(a=>frozen.bindings.some(x=>x.attemptId===a.id)).map(a=>`## 生成任务 ${a.id}\n\n${a.prompt}`)).join('\n\n'),{name:'脚本与提示词.md'});
    await zip.finalize();await done;fs.renameSync(tmp,file);store.transaction(()=>store.put('export',id,{id,filename,mime:'application/zip',productId:p.id,revision:p.revision,createdAt:now()}));return {id,url:`/api/exports/${id}/download`,revision:p.revision};
  });
  if(options.worker!==false)collection.start();app.addHook('onClose',()=>collection.stop());return collection;
}
