import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { productProfileInputSchema, type Asset, type Attempt, type ProductProfile, type ResultSelection } from '../../packages/contracts';
import type { Store } from './store';
import { fail } from './errors';

export function registerCreativeRoutes(app: FastifyInstance, store: Store) {
  function checkAssets(ids: string[]) {
    if (new Set(ids).size !== ids.length) fail('商品图片不能重复');
    for (const id of ids) if (store.get<Asset>('asset',id)?.type !== 'image') fail('商品图片不存在或不是静态图片');
  }
  app.post('/api/products', async request => {
    const input = productProfileInputSchema.parse(request.body);
    checkAssets(input.assetIds);
    const product: ProductProfile = {...input,id:store.id('product'),revision:1,updatedAt:new Date().toISOString()};
    store.transaction(()=>store.put('product',product.id,product));
    return product;
  });
  app.put<{Params:{id:string}}>('/api/products/:id',async request=>{
    const {revision,...input} = productProfileInputSchema.extend({revision:z.number().int().positive()}).parse(request.body);
    checkAssets(input.assetIds);
    return store.transaction(()=>{
      const current=store.get<ProductProfile>('product',request.params.id)||fail('商品资料不存在',404);
      if(current.revision!==revision)fail('商品资料已在其他窗口更新，请重新载入后编辑',409);
      const next={...input,id:current.id,revision:revision+1,updatedAt:new Date().toISOString()};
      store.put('product',next.id,next);
      return next;
    });
  });
  app.put<{Params:{itemId:string}}>('/api/selections/:itemId',async request=>{
    const {attemptId,expectedAttemptId}=z.object({attemptId:z.string().nullable(),expectedAttemptId:z.string().nullable()}).parse(request.body);
    return store.transaction(()=>{
      const current=store.get<ResultSelection>('result-selection',request.params.itemId);
      if((current?.attemptId||null)!==expectedAttemptId)fail('当前结果已更新，请刷新后继续',409);
      if(attemptId===null){
        store.remove('result-selection',request.params.itemId);
        return {selection:null};
      }
      const attempt=store.get<Attempt>('attempt',attemptId)||fail('结果不存在',404);
      if(attempt.itemId!==request.params.itemId)fail('结果不属于当前条目');
      if(attempt.status!=='completed'||!attempt.assetId||store.get<Asset>('asset',attempt.assetId)?.type!=='image')fail('仅已保存的图片可选入交付');
      const selection:ResultSelection={itemId:attempt.itemId,attemptId,updatedAt:new Date().toISOString()};
      store.put('result-selection',attempt.itemId,selection);
      return {selection};
    });
  });

  // A confirmed image list always exports an immutable file, never today's latest versions.
  const exportsInFlight=new Map<string,Promise<{url:string;count:number}>>();
  app.post('/api/deliveries/export',async request=>{
    const {attemptIds}=z.object({attemptIds:z.array(z.string()).min(1).max(100)}).parse(request.body);
    if(new Set(attemptIds).size!==attemptIds.length)fail('交付图片重复');
    const items=new Set<string>();
    const entries=attemptIds.map(id=>{
      const attempt=store.get<Attempt>('attempt',id)||fail('交付结果不存在',404);
      if(items.has(attempt.itemId))fail('同一条目只能交付一份结果');items.add(attempt.itemId);
      if(store.get<ResultSelection>('result-selection',attempt.itemId)?.attemptId!==id)fail('当前结果已更新，请刷新交付清单后重试',409);
      const asset=store.get<Asset>('asset',attempt.assetId||'');
      if(attempt.status!=='completed'||asset?.type!=='image')fail('交付图片尚未保存');
      const batch=store.readBatch(attempt.batchId)||fail('批次不存在',404);
      const root=asset.source==='example'?path.join(store.projectRoot,'public/examples'):path.join(store.dataDir,'media');
      const file=path.join(root,path.basename(asset.url));
      if(!fs.existsSync(file))fail('交付图片文件不可用，请重新保存',409);
      return {attempt,asset,batch,file};
    });
    const fingerprint=createHash('sha256').update(JSON.stringify(attemptIds)).digest('hex');
    const pending=exportsInFlight.get(fingerprint);if(pending)return pending;
    const run=async()=>{
      const existing=store.get<{id:string}>('delivery-export',fingerprint);
      if(existing&&fs.existsSync(path.join(store.dataDir,'exports',`${existing.id}.zip`)))return {url:`/api/exports/${existing.id}/download`,count:entries.length};
      const id=store.id('delivery'),filename=`${id}.zip`,file=path.join(store.dataDir,'exports',filename);
      const archive=archiver('zip',{zlib:{level:6}});
      const write=pipeline(archive,fs.createWriteStream(file+'.tmp',{flags:'wx'}));
      const manifest=entries.map(({attempt,asset,batch,file},index)=>{
        const name=`${String(index+1).padStart(2,'0')}_${batch.skillId}_${attempt.itemId}_v${attempt.attemptNumber}${path.extname(file)}`;
        archive.file(file,{name});
        return {file:name,product:batch.draft.productContext||null,skill:batch.skillName,batchId:batch.id,itemId:attempt.itemId,attemptId:attempt.id,version:attempt.attemptNumber,simulated:attempt.simulated,source:asset.source};
      });
      archive.append(JSON.stringify({createdAt:new Date().toISOString(),images:manifest},null,2),{name:'交付清单.json'});
      try {
        await Promise.all([archive.finalize(),write]);
        fs.renameSync(file+'.tmp',file);
        store.transaction(()=>{
          store.put('export',id,{filename,mime:'application/zip',attemptIds,createdAt:new Date().toISOString()});
          store.put('delivery-export',fingerprint,{id});
        });
        return {url:`/api/exports/${id}/download`,count:entries.length};
      }catch(error){archive.abort();await write.catch(()=>{});fs.rmSync(file+'.tmp',{force:true});fs.rmSync(file,{force:true});throw error;}
    };
    const job=run();exportsInFlight.set(fingerprint,job);
    try{return await job;}finally{exportsInFlight.delete(fingerprint);}
  });
}
