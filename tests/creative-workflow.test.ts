import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, type Store } from '../apps/server/store';
import { createApp } from '../apps/server/app';
import { compilePlan, createWorker, retryAttempt, submit } from '../apps/server/engine';
import { defaultDraft, type ProductProfile, type ResultSelection } from '../packages/contracts';
import { loadProduct } from '../src/lib/creative-workflow';

let store:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-creative-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
const profile:ProductProfile={id:'product-example',name:'麦穗纹亨利领卫衣',facts:'仅确认名称，其他参数未提供。',assetIds:['example-6-1'],revision:1,updatedAt:new Date().toISOString()};
function completed(){
  const skill=store.skills().find(s=>s.id==='image-generate')!;
  const draft=loadProduct({...defaultDraft(skill,store.models()),requirements:'自然商品图'},skill,profile);
  const plan=compilePlan(store,skill.id,draft);
  const batch=submit(store,{skillId:skill.id,draft,action:'generate',planHash:plan.hash,idempotencyKey:crypto.randomUUID(),expectedDraftRevision:0}).batch;
  const worker=createWorker(store,{generationMs:0,savingMs:0});worker.tick();worker.tick();worker.tick();
  return {batch:store.readBatch(batch.id)!,worker};
}
describe('shared product and selected image delivery',()=>{
  it('loads product roles explicitly, preserves skill settings and resets only the consumed draft',()=>{
    const skill=store.skills().find(s=>s.id==='scene-recreate')!;
    const draft={...defaultDraft(skill,store.models()),requirements:'保留人物与场景',inputRoles:{reference:['example-10-1']}};
    const loaded=loadProduct(draft,skill,profile);
    expect(loaded.inputRoles).toEqual({reference:['example-10-1'],product:['example-6-1']});
    expect(loaded.requirements).toBe(draft.requirements);expect(loaded.parameters).toEqual(draft.parameters);
    expect(draft.inputRoles).not.toHaveProperty('product');
    const agent=store.skills().find(s=>s.id==='benchmark-agent')!;
    const rebound=loadProduct({...defaultDraft(agent,store.models()),whiteTaskId:'old',fields:{...defaultDraft(agent,store.models()).fields,whiteMode:'使用白底任务结果'}},agent,profile);
    expect(rebound.whiteTaskId).toBeUndefined();expect(rebound.fields.whiteMode).toBe('直接使用商品原图');
    expect(()=>loadProduct(defaultDraft(store.skills().find(s=>s.id==='image-edit')!,store.models()),store.skills().find(s=>s.id==='image-edit')!,profile)).toThrow('没有商品图入口');
    const {batch}=completed();expect(batch.draft.productContext?.name).toBe(profile.name);
    expect(batch.attempts[0].prompt).toContain(profile.name);
    expect(store.readDraft('image-generate').value.productContext).toBeUndefined();
    expect(store.readDraft('image-generate').value.inputRoles).toEqual({});
  });
  it('validates assets, prevents stale product edits and never mutates accepted snapshots',async()=>{
    const app=await createApp(store,{worker:false});
    try{
      const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token};
      const body={name:profile.name,facts:profile.facts,assetIds:profile.assetIds};
      expect((await app.inject({method:'POST',url:'/api/products',payload:body})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:'/api/products',headers,payload:{...body,assetIds:['missing']}})).statusCode).toBe(400);
      const saved=(await app.inject({method:'POST',url:'/api/products',headers,payload:body})).json<ProductProfile>();
      const {batch}=completed();
      const updated=await app.inject({method:'PUT',url:`/api/products/${saved.id}`,headers,payload:{...body,name:'修改名称',revision:1}});
      expect(updated.json().revision).toBe(2);
      expect((await app.inject({method:'PUT',url:`/api/products/${saved.id}`,headers,payload:{...body,revision:1}})).statusCode).toBe(409);
      expect(store.readBatch(batch.id)?.draft.productContext?.name).toBe(profile.name);
      expect(store.snapshot().products?.[0].name).toBe('修改名称');
    }finally{await app.close();}
  });
  it('pins chosen versions, rejects cross-item/stale choices and exports immutable ZIP snapshots',async()=>{
    const {batch,worker}=completed(),first=batch.attempts[0];
    const second=retryAttempt(store,first.id,first.revision);worker.tick();worker.tick();worker.tick();
    const app=await createApp(store,{worker:false});
    try{
      const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token};
      const choose=(itemId:string,attemptId:string|null,expectedAttemptId:string|null)=>app.inject({method:'PUT',url:`/api/selections/${itemId}`,headers,payload:{attemptId,expectedAttemptId}});
      expect((await choose('wrong-item',first.id,null)).statusCode).toBe(400);
      expect((await choose(first.itemId,first.id,null)).statusCode).toBe(200);
      expect((await choose(first.itemId,second.id,null)).statusCode).toBe(409);
      expect(store.get<ResultSelection>('result-selection',first.itemId)?.attemptId).toBe(first.id);
      const exported=await app.inject({method:'POST',url:'/api/deliveries/export',headers,payload:{attemptIds:[first.id]}});
      expect(exported.statusCode).toBe(200);const result=exported.json();
      const download=await app.inject(result.url);expect(download.headers['content-type']).toBe('application/zip');expect(download.rawPayload.subarray(0,2).toString()).toBe('PK');
      const again=await app.inject({method:'POST',url:'/api/deliveries/export',headers,payload:{attemptIds:[first.id]}});expect(again.json().url).toBe(result.url);
      expect((await app.inject({method:'POST',url:'/api/deliveries/export',headers,payload:{attemptIds:[first.id,second.id]}})).statusCode).toBe(400);
      expect((await choose(first.itemId,second.id,first.id)).statusCode).toBe(200);
      expect((await app.inject({method:'POST',url:'/api/deliveries/export',headers,payload:{attemptIds:[first.id]}})).statusCode).toBe(409);
      expect((await app.inject(result.url)).rawPayload).toEqual(download.rawPayload);
      expect((await choose(first.itemId,null,second.id)).statusCode).toBe(200);expect(store.snapshot().selections).toEqual([]);
      expect(store.readBatch(batch.id)?.attempts).toHaveLength(2);
    }finally{await app.close();}
  });
  it('persists products and choices across store restart',()=>{
    const {batch}=completed(),attempt=batch.attempts[0];
    store.transaction(()=>{store.put('product',profile.id,profile);store.put('result-selection',attempt.itemId,{itemId:attempt.itemId,attemptId:attempt.id,updatedAt:profile.updatedAt});});
    store.close();store=createStore(dir,process.cwd());
    expect(store.snapshot().products?.[0]).toEqual(profile);expect(store.snapshot().selections?.[0].attemptId).toBe(attempt.id);
    expect(store.readBatch(batch.id)?.draft.productContext?.name).toBe(profile.name);
  });
});
