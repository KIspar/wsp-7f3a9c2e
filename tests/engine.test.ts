import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, type Store } from '../apps/server/store';
import { compilePlan, createWorker, editAttempt, retryAttempt, submit } from '../apps/server/engine';
import { batchStatus, defaultDraft, type Attempt, type Draft, type Submission } from '../packages/contracts';
import { createApp } from '../apps/server/app';

let store: Store;
let directory: string;
beforeEach(() => { directory=fs.mkdtempSync(path.join(os.tmpdir(),'creative-studio-test-')); store=createStore(directory,process.cwd()); });
afterEach(() => { store.close(); fs.rmSync(directory,{recursive:true,force:true}); });
function draft(skillId='image-generate'):Draft { return {...defaultDraft(store.skills().find(s=>s.id===skillId)!,store.models()),requirements:'男装商品创作'}; }
function request(value:Draft,skillId='image-generate',action:Submission['action']='generate'):Submission {const plan=compilePlan(store,skillId,value,action);return {skillId,draft:value,action,planHash:plan.hash,idempotencyKey:crypto.randomUUID(),expectedDraftRevision:store.readDraft(skillId).revision};}
function finish() {const worker=createWorker(store,{generationMs:0,savingMs:0});worker.tick();worker.tick();worker.tick();}
function attempt(id:string) {return store.get<Attempt>('attempt',id)!;}
describe('persistent creative workflow',()=>{
 it('expands all skills and never sends unselected targets',()=>{
   expect(store.skills().map(s=>s.id)).toEqual(expect.arrayContaining(["product-kit","image-replica","scene-recreate","detail-design"]));
   const value={...draft('benchmark-agent'),count:2,inputRoles:{product:['example-6-1'],targets:['example-10-1','example-10-2']},selectedTargetIds:['example-10-2']};
   const plan=compilePlan(store,'benchmark-agent',value,'replaceSelected');
   expect(plan.total).toBe(2); expect(plan.items.every(i=>i.targetId==='example-10-2'&&!i.references.includes('example-10-1'))).toBe(true);
   const white=compilePlan(store,'benchmark-agent',value,'prepareWhite');expect(white.total).toBe(1);expect(white.items[0].references).toEqual(['example-6-1']);
 });
 it('accepts once, consumes the ordinary draft atomically and rejects reused keys with changed content',()=>{
   const value=draft();store.transaction(()=>store.saveDraft('image-generate',value,0));
   const req=request(value);const first=submit(store,req);const second=submit(store,req);
   expect(second.batch.id).toBe(first.batch.id);expect(second.replayed).toBe(true);expect(store.snapshot().batches).toHaveLength(1);expect(first.draft.value.requirements).toBe('');
   expect(()=>submit(store,{...req,draft:{...value,requirements:'changed'}})).toThrow('接单凭据');
 });
 it('rejects stale draft or plan without creating partial tasks',()=>{
   const value=draft();const req=request(value);store.transaction(()=>store.saveDraft('image-generate',value,0));
   expect(()=>submit(store,req)).toThrow('草稿版本');expect(store.snapshot().batches).toHaveLength(0);
   expect(()=>submit(store,{...req,expectedDraftRevision:1,planHash:'old'})).toThrow('计划已变更');
 });
 it('waits for a white result without occupying a generation slot and binds it before executing',()=>{
   const id='benchmark-agent';const value={...draft(id),inputRoles:{product:['example-6-1'],targets:['example-10-1']},selectedTargetIds:['example-10-1']};
   const white=submit(store,request(value,id,'prepareWhite')).batch.attempts[0];
   const replace={...value,whiteTaskId:white.id,fields:{...value.fields,whiteMode:'使用白底任务结果'}};
   const task=submit(store,request(replace,id,'replaceSelected')).batch.attempts[0];
   expect(task.status).toBe('waiting_dependency');finish();finish();
   expect(attempt(task.id).status).toBe('completed');expect(attempt(task.id).references).toContain(attempt(white.id).assetId);
 });
 it('caps concurrency, permits queued edits and preserves completed attempts on regeneration',()=>{
   store.transaction(()=>store.put('settings','global',{...store.settings(),imageConcurrency:1}));
   submit(store,request({...draft(),count:2}));const worker=createWorker(store,{generationMs:0,savingMs:0});worker.tick();
   expect(store.list<Attempt>('attempt').filter(a=>a.status==='generating')).toHaveLength(1);
   const queued=store.list<Attempt>('attempt').find(a=>a.status==='queued')!;editAttempt(store,queued.id,queued.revision,'修改后的提示词');
   const active=store.list<Attempt>('attempt').find(a=>a.status==='generating')!;
   expect(()=>editAttempt(store,active.id,active.revision,'不可变更')).toThrow('已提交');
   for(let i=0;i<6;i++)worker.tick();
   const completed=attempt(queued.id);const next=retryAttempt(store,completed.id,completed.revision,'再生成提示词');
   expect(batchStatus(store.readBatch(next.batchId)!)).toBe('queued');
   expect(next.attemptNumber).toBe(2);expect(attempt(completed.id).assetId).toBe(completed.assetId);
   finish();expect(batchStatus(store.readBatch(next.batchId)!)).toBe('completed');expect(store.snapshot().ledger.filter(e=>e.attemptId===next.id)).toHaveLength(1);finish();expect(store.snapshot().ledger).toHaveLength(3);
 });
 it('retries a failed save without creating another generation or duplicate ledger charge',()=>{
   const task=submit(store,request(draft())).batch.attempts[0];const worker=createWorker(store,{generationMs:0,savingMs:0});worker.tick();worker.tick();
   const media=path.join(directory,'media');fs.renameSync(media,media+'-moved');worker.tick();
   expect(attempt(task.id).step).toBe('保存失败');fs.renameSync(media+'-moved',media);
   retryAttempt(store,task.id,attempt(task.id).revision);worker.tick();worker.tick();expect(attempt(task.id).status).toBe('completed');expect(store.snapshot().ledger).toHaveLength(1);
 });
 it('continues accepted work after reopening the database',()=>{
   const task=submit(store,request(draft())).batch.attempts[0];createWorker(store,{generationMs:0}).tick();store.close();store=createStore(directory,process.cwd());finish();
   expect(attempt(task.id).status).toBe('completed');expect(store.snapshot().ledger).toHaveLength(1);
 });
 it('enforces local session writes and rejects malformed model settings',async()=>{
   const app=await createApp(store,{worker:false});
   try {
     const denied=await app.inject({method:'PUT',url:'/api/settings',payload:store.settings()});expect(denied.statusCode).toBe(403);
     const boot=await app.inject('/api/bootstrap');const token=boot.json().token;
     const invalid=await app.inject({method:'PUT',url:'/api/settings',headers:{'x-studio-token':token},payload:{...store.settings(),imageConcurrency:99}});expect(invalid.statusCode).toBe(400);
     const ok=await app.inject({method:'PUT',url:'/api/settings',headers:{'x-studio-token':token},payload:{...store.settings(),imageConcurrency:3}});expect(ok.statusCode).toBe(200);
   } finally {await app.close();}
 });
});
