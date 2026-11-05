import type {Attempt, ResultSelection} from '../../packages/contracts';
import type {CatalogProduct, ProductMediaBinding} from '../../packages/catalog';
import type {PromotionVersion, PromotionWork} from '../../packages/promotion';
import type {VideoRemakeJob} from '../../packages/video-remake';
import type {Store} from './store';

const newer=(a:Attempt,b:Attempt)=>a.createdAt.localeCompare(b.createdAt)||a.attemptNumber-b.attemptNumber||a.id.localeCompare(b.id);
/** Called inside the transaction saving a verified output. History and files remain untouched. */
export function updateCurrentResult(store:Store,a:Attempt){
 if(a.status!=='completed'||!a.assetId||a.simulated)return;
 const batch=store.readBatch(a.batchId);if(!batch)return;
 const timestamp=new Date().toISOString();
 const selection=store.get<ResultSelection>('result-selection',a.itemId);
 const old=selection&&store.get<Attempt>('attempt',selection.attemptId);
 if(!old||newer(a,old)>0)store.put('result-selection',a.itemId,{itemId:a.itemId,attemptId:a.id,updatedAt:timestamp});
 const c=batch.creativeContext;if(!c)return;
 if(c.remakeJobId&&c.remakeShotId){
  const j=store.get<VideoRemakeJob>('video-remake',c.remakeJobId),s=j?.shots.find(s=>s.id===c.remakeShotId);
  if(!j||!s||(s.epoch||0)!==(c.remakeEpoch||0)||j.status==='cancelled')return;
  const stage=c.remakeStage,ids=stage==='frame'?s.frameBatchIds:s.videoBatchIds;
  const latest=ids.flatMap(id=>store.readBatch(id)?.attempts||[]).filter(x=>x.status==='completed'&&x.assetId&&!x.simulated&&(store.readBatch(x.batchId)?.creativeContext?.remakeEpoch||0)===(s.epoch||0)&&(stage!=='video'||x.references[0]===s.selectedFrameId)).sort(newer).at(-1);
  if(latest?.id!==a.id)return;
  if(stage==='frame'&&s.selectedFrameId!==a.assetId){s.selectedFrameId=a.assetId;s.selectedVideoId=undefined;s.videoFrameId=undefined;}
  else if(stage==='video'&&a.references[0]===s.selectedFrameId&&s.selectedVideoId!==a.assetId){s.selectedVideoId=a.assetId;s.videoFrameId=s.selectedFrameId;}
  else return;
  s.revision++;j.revision++;j.updatedAt=timestamp;store.put('video-remake',j.id,j);return;
 }
 if(c.promotionWorkId&&c.promotionVersionId){
  const w=store.get<PromotionWork>('promotion-work',c.promotionWorkId);let v=store.list<PromotionVersion>('promotion-version').filter(v=>v.workId===c.promotionWorkId&&v.batchIds.includes(a.batchId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(!w||!v)return;
  const key=c.outputKeys[a.index-1];if(!key)return;
  const chosen=store.list<PromotionVersion>('promotion-version').filter(x=>x.workId===w.id).flatMap(x=>x.selection[key]?[store.get<Attempt>('attempt',x.selection[key])]:[]).filter((x):x is Attempt=>!!x).sort(newer).at(-1);if(chosen&&newer(a,chosen)<=0)return;
  if(v.confirmed){v={...structuredClone(v),id:store.id('version'),createdAt:timestamp};}
  v.selection[key]=a.id;v.media[key]=a.assetId;
  // Regeneration may reuse successful pages until their replacements finish.
  for(const output of v.value.outputKeys){if(v.media[output])continue;const previous=store.list<PromotionVersion>('promotion-version').filter(x=>x.workId===w.id&&x.id!==v.id&&x.createdAt<=v.createdAt&&x.media[output]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(previous){v.media[output]=previous.media[output];v.selection[output]=previous.selection[output];}}
  v.confirmed=v.value.outputKeys.every(k=>!!v.media[k]);store.put('promotion-version',v.id,v);
  const current=w.confirmedVersionId&&store.get<PromotionVersion>('promotion-version',w.confirmedVersionId);
  if(v.confirmed&&(!current||current.id===v.id||current.createdAt<=v.createdAt)){w.confirmedVersionId=v.id;w.revision++;store.put('promotion-work',w.id,w);}return;
 }
 if(!['main','detail','sku'].includes(c.purpose))return;
 const p=store.get<CatalogProduct>('catalog-product',c.productId),key=c.outputKeys[a.index-1];if(!p||!key)return;
 const laterRequest=store.list<Attempt>('attempt').some(x=>x.batchId!==a.batchId&&x.status==='completed'&&!x.simulated&&x.createdAt>a.createdAt&&(()=>{const context=store.readBatch(x.batchId)?.creativeContext;return context?.productId===c.productId&&context.purpose===c.purpose&&(c.purpose!=='sku'||context.outputKeys[x.index-1]===key);})());if(laterRequest)return;
 const kind:ProductMediaBinding['kind']=c.purpose==='sku'?(p.skus.some(s=>s.id===key)?'sku':'color'):c.purpose as 'main'|'detail';
 if(c.purpose==='sku'&&!p.skus.some(s=>s.id===key)&&!p.colors.some(s=>s.id===key))return;
 const targetId=c.purpose==='sku'?key:undefined;
 const previous=p.bindings.find(x=>targetId?x.kind===kind&&x.targetId===targetId:x.kind===kind&&(x.id===key||x.order===a.index-1));
 const previousAttempt=previous?.attemptId&&store.get<Attempt>('attempt',previous.attemptId);
 if(previousAttempt&&newer(a,previousAttempt)<=0)return;
 const binding:ProductMediaBinding={id:key,kind,targetId,label:a.screenType||`${kind==='main'?'商品图':kind==='detail'?'详情图':'规格图'} ${a.index}`,order:targetId?(previous?.order??p.bindings.filter(x=>x.kind===kind).length):a.index-1,assetId:a.assetId,attemptId:a.id};
 p.bindings=[...p.bindings.filter(x=>x.id!==previous?.id&&x.id!==key),binding];
 const all=batch.attempts.filter(x=>x.attemptNumber===1);
 if(!targetId&&all.every(x=>batch.attempts.some(t=>t.itemId===x.itemId&&t.status==='completed'))){p.bindings=p.bindings.filter(x=>x.kind!==kind||x.order<c.outputKeys.length);}
 p.revision++;p.updatedAt=timestamp;store.put('catalog-product',p.id,p);
}

/** One-time, local-only adoption for existing real outputs. No requests or file deletion. */
export function migrateCurrentResults(store:Store){
 if(store.get('migration','automatic-current-results'))return;
 store.transaction(()=>{for(const a of store.list<Attempt>('attempt').filter(a=>a.status==='completed'&&!a.simulated).sort(newer))updateCurrentResult(store,a);store.put('migration','automatic-current-results',{completedAt:new Date().toISOString()});});
}
