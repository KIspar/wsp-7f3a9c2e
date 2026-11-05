/** Explicit paid completion of workshop image workflows; persisted keys prevent duplicate calls. */
import fs from 'node:fs';
import path from 'node:path';
import {createStore} from '../apps/server/store';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {getCreativeDraft,workshopGeneration,workshopSkill} from '../apps/server/catalog';
import {createMediaWorker} from '../apps/server/media-worker';
import type {CatalogProduct} from '../packages/catalog';
import type {Attempt,Batch} from '../packages/contracts';
const dir=path.resolve('output/catalog-live-20261029'),store=createStore(dir,process.cwd()),pricing=createGenerationPricing(store),worker=createMediaWorker(store,{pollMs:5000});
const product=store.list<CatalogProduct>('catalog-product')[0];
const report:{quotes:unknown[];attempts?:unknown}={quotes:[]};
try{
for(const purpose of ['detail','sku','post'] as const){
 if(store.list<Batch>('batch').some(b=>b.creativeContext?.purpose===purpose))continue;
 const d=getCreativeDraft(store,product.id,purpose);d.revision++;
 const main=product.bindings.find(b=>b.kind==='main')!.assetId;
 d.value.generation.inputRoles={product:[purpose==='sku'?product.bindings.find(b=>b.kind==='color')!.assetId:main]};
 d.value.generation.requirements='保持参考商品黑色毛领连帽外套的真实廓形和可见细节。纯净电商画面，不新增标识、材质成分或功能承诺。';
 if(purpose==='detail'){d.value.generation.imageDesign!.screens=[{id:'acceptance-first',type:'首屏主视觉',requirements:'主视觉展示，聚焦毛领与连帽结构，不添加宣传文字',facts:''}];d.value.generation.imageDesign!.groupCount=1;d.value.outputKeys=['acceptance-first'];}
 if(purpose==='sku'){d.value.outputKeys=[product.colors[0].id];d.value.generation.requirements+='只保留完整商品，统一浅灰背景和居中构图，不改变商品颜色。';}
 if(purpose==='post'){d.value.outputKeys=['acceptance-cover','acceptance-detail'];d.value.generation.count=2;d.value.pageRequirements={'acceptance-cover':'第一页封面：正面全貌，居中构图，留白，不加文字','acceptance-detail':'第二页：毛领与连帽局部近景，不加文字'};d.value.generation.inputRoles.reference=[product.bindings.filter(b=>b.kind==='main')[1].assetId];d.value.referenceCopy='先呈现整体造型，再突出领口细节。只参考结构。';}
 store.transaction(()=>store.put('catalog-draft',d.id,d));
 const ctx={productId:product.id,productRevision:product.revision,purpose,draftRevision:d.revision,outputKeys:d.value.outputKeys},draft=workshopGeneration(store,product,d),skillId=workshopSkill(purpose),plan=await pricing.plan(skillId,draft,'generate',ctx);
 report.quotes.push({purpose,quote:plan.quote});
 if(!plan.quote?.affordable||plan.quote.maximum>.18)throw Error('报价超出验收上限，未提交');
 const accepted=await pricing.admit({skillId,draft,creativeContext:ctx,action:'generate',planHash:plan.hash,maximumCost:plan.quote.maximum,idempotencyKey:`catalog-live-${purpose}-20261029`,expectedDraftRevision:d.revision});
 console.log('已接单',purpose,accepted.batch.id,'报价',plan.quote.maximum);
}
const stamps=new Map<string,string>(),until=Date.now()+15*60*1000;
while(Date.now()<until){await worker.tick();const attempts=store.list<Attempt>('attempt');for(const a of attempts){const stamp=a.status+a.step;if(stamps.get(a.id)!==stamp){console.log(a.model.id,a.status,a.step,a.upstreamTaskId||'',a.error||'');stamps.set(a.id,stamp);}}if(attempts.every(a=>['completed','failed','pending_verification'].includes(a.status)))break;await new Promise(r=>setTimeout(r,1000));}
report.attempts=store.list<Batch>('batch').filter(b=>['detail','sku','post'].includes(b.creativeContext?.purpose||'')).flatMap(b=>store.readBatch(b.id)!.attempts.map(a=>({purpose:b.creativeContext!.purpose,id:a.id,status:a.status,upstreamTaskId:a.upstreamTaskId,assetId:a.assetId,billing:a.billing,error:a.error})));
fs.writeFileSync(path.join(dir,'image-workflows-report.json'),JSON.stringify(report,null,2));
}finally{await worker.stop();store.close();}
