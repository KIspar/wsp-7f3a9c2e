/** Isolated UI acceptance data only. No user drafts, credentials or paid transport. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../apps/server/store';
import {createApp} from '../apps/server/app';
import {credentialVault} from '../apps/server/credentials';
import {compilePlan,createWorker,retryAttempt,submit} from '../apps/server/engine';
import {defaultDraft,type ProductProfile} from '../packages/contracts';
import {loadProduct} from '../src/lib/creative-workflow';
import prices from '../tests/fixtures/media-pricing.json';

const directory=path.resolve(process.env.STUDIO_DATA||'');
if(!directory.startsWith(os.tmpdir()+path.sep))throw Error('UI fixture requires an explicit temporary STUDIO_DATA');
const store=createStore(directory,process.cwd());
const product:ProductProfile={id:'product-acceptance',name:'桌面验收商品 · 示例外套',facts:'只使用随附示例验证交互，不代表本轮真实生成结果。',assetIds:['example-6-1','example-6-2'],revision:1,updatedAt:new Date().toISOString()};
store.put('product',product.id,product);
const worker=createWorker(store,{generationMs:0,savingMs:0});
for(const id of ['image-generate','detail-design']){
  const skill=store.skills().find(s=>s.id===id)!;
  const draft=loadProduct({...defaultDraft(skill,store.models()),requirements:'检查版型与商品外观，干净背景。'},skill,product);
  if(id==='detail-design')draft.imageDesign!.screens.push({id:'detail-screen',type:'商品细节图',requirements:'展示领口结构',facts:''});
  else draft.count=2;
  const plan=compilePlan(store,id,draft);
  const batch=submit(store,{skillId:id,draft,action:'generate',planHash:plan.hash,idempotencyKey:crypto.randomUUID(),expectedDraftRevision:0}).batch;
  worker.tick();worker.tick();worker.tick();
  if(id==='image-generate'){
    const first=store.readBatch(batch.id)!.attempts[0];
    retryAttempt(store,first.id,first.revision);worker.tick();worker.tick();worker.tick();
    store.put('result-selection',first.itemId,{itemId:first.itemId,attemptId:first.id,updatedAt:new Date().toISOString()});
  }
}
const vault=credentialVault(directory);for(const id of ['tt-image','omni'])vault.set(id,'sk-fixture-only-12345678901234567890');
const app=await createApp(store,{providerTransport:async(raw,init)=>{
  if(init.method!=='GET')throw Error('Paid requests are disabled in acceptance fixture');
  const url=new URL(raw),data=url.pathname.endsWith('/balance')?{balance:100,unit:'算力',api_key_quota:{limit:0,used:0}}:url.pathname.endsWith('/pricing')?prices[url.searchParams.get('model') as keyof typeof prices]:undefined;
  return new Response(JSON.stringify(data||{}),{status:data?200:404});
}});
console.log('Isolated workflow acceptance: '+await app.listen({host:'127.0.0.1',port:0}));
async function close(){await app.close();store.close();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
