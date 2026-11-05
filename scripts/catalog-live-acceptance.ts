/** Explicit, paid acceptance run. Idempotency keys and upstream IDs are persisted; reruns never create new paid attempts. */
import fs from 'node:fs';
import path from 'node:path';
import {createStore} from '../apps/server/store';
import {credentialVault} from '../apps/server/credentials';
import {createGenerationPricing} from '../apps/server/generation-pricing';
import {getCreativeDraft,workshopGeneration,workshopSkill} from '../apps/server/catalog';
import {createMediaWorker} from '../apps/server/media-worker';
import {createAnalysisService} from '../apps/server/analysis';
import type {CatalogProduct,ProductCreativeDraft} from '../packages/catalog';
import type {Attempt,Batch} from '../packages/contracts';
const dir=path.resolve('output/catalog-live-20261029'),store=createStore(dir,process.cwd());
const sourceVault=credentialVault(path.resolve('data')),vault=credentialVault(dir);
for(const id of ['tt-image','omni','gem-3.8-flash'])if(!vault.current(id)){const v=sourceVault.current(id);if(v)vault.set(id,sourceVault.get(id,v));}
const product=store.list<CatalogProduct>('catalog-product')[0];if(!product?.sourceSnapshotId)throw Error('先运行真实链接采集验收');
const pricing=createGenerationPricing(store),worker=createMediaWorker(store,{pollMs:4000}),manifest:{quotes:unknown[];productId:string;startedAt:string;attempts?:unknown;videoAnalysis?:unknown}={quotes:[],productId:product.id,startedAt:new Date().toISOString()};
try{
 for(const purpose of ['main','video'] as const){
  const existing=store.list<Batch>('batch').find(b=>b.creativeContext?.purpose===purpose);if(existing)continue;
  const d=getCreativeDraft(store,product.id,purpose);d.revision=1;
  d.value.generation.requirements=purpose==='main'?'为图片中的黑色连帽毛领外套制作一张电商主图，保持颜色、廓形和细节。参考图仅提供构图，干净自然光，无文案，不添加无依据的功能说明。':'4秒服装商品展示：参考图中的黑色连帽毛领外套，保持商品结构和颜色。起始展示外套全貌，随后镜头缓慢向前推近并略微侧移，展示领口毛领和袖子纹理。动作自然，背景简洁，不添加文字。';
  if(purpose==='main')d.value.generation.inputRoles={product:[product.bindings.find(b=>b.kind==='main')!.assetId],reference:[product.bindings.filter(b=>b.kind==='main')[1].assetId]};
  else{d.value.generation.inputRoles={references:[product.bindings.find(b=>b.kind==='main')!.assetId]};d.value.generation.duration=4;d.value.generation.aspectRatio='9:16';}
  store.transaction(()=>store.put('catalog-draft',d.id,d));
  const ctx={productId:product.id,productRevision:product.revision,purpose,draftRevision:d.revision,outputKeys:d.value.outputKeys},draft=workshopGeneration(store,product,d),skillId=workshopSkill(purpose),plan=await pricing.plan(skillId,draft,'generate',ctx);
  if(!plan.quote?.affordable||plan.quote.maximum>(purpose==='main'?.15:.5))throw Error('余额不足或超出本次验收预算，未提交');
  manifest.quotes.push({purpose,quote:plan.quote});console.log('报价',purpose,plan.quote.minimum,plan.quote.maximum,'可用',plan.quote.available);
  const accepted=await pricing.admit({skillId,draft,creativeContext:ctx,action:'generate',planHash:plan.hash,maximumCost:plan.quote.maximum,idempotencyKey:`catalog-live-${purpose}-20261029`,expectedDraftRevision:d.revision});console.log('接单',purpose,accepted.batch.id);
 }
 const stamps=new Map<string,string>(),until=Date.now()+20*60*1000;
 while(Date.now()<until){await worker.tick();const attempts=store.list<Attempt>('attempt');for(const a of attempts){const stamp=a.status+':'+a.step;if(stamps.get(a.id)!==stamp){console.log(a.model.id,a.status,a.step,a.upstreamTaskId||'',a.error||'');stamps.set(a.id,stamp);}}
 if(attempts.every(a=>['completed','failed','pending_verification'].includes(a.status)))break;await new Promise(r=>setTimeout(r,1000));}
 manifest.attempts=store.list<Attempt>('attempt').map(a=>({id:a.id,batchId:a.batchId,status:a.status,upstreamTaskId:a.upstreamTaskId,assetId:a.assetId,error:a.error,billing:a.billing,model:a.model.upstreamId}));
 const video=store.list<Attempt>('attempt').find(a=>a.model.category==='video'&&a.status==='completed');
 if(video?.assetId){const analysis=createAnalysisService(store);const j=analysis.submit({action:'reverse-video',text:'请核对完整视频的时间顺序、真实主体运动和镜头变化。逐段写出观察，不根据生成提示词猜测。',productName:'',assetIds:[video.assetId],idempotencyKey:'catalog-live-video-reverse-20261029'});if(j.status==='queued'){analysis.tick();await analysis.idle();}const result=analysis.job(j.id);manifest.videoAnalysis={id:result.id,status:result.status,upstreamTaskId:result.upstreamTaskId,usage:result.usage,billing:result.billing,result:result.result,error:result.error};if(result.result)fs.writeFileSync(path.join(dir,'video-reverse.md'),result.result);console.log('原生视频反推',result.status,result.billing.cost??'待结算');}
 fs.writeFileSync(path.join(dir,'generation-report.json'),JSON.stringify(manifest,null,2));console.log('报告',path.join(dir,'generation-report.json'));
}finally{await worker.stop();store.close();}
