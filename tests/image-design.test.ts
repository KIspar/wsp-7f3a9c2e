import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createStore, type Store } from '../apps/server/store';
import { compilePlan, createWorker, submit, retryAttempt } from '../apps/server/engine';
import { defaultDraft, restoreDraft, type Asset, type Draft, type LongImageLayout } from '../packages/contracts';
import { exportLayout, inspectLayout } from '../apps/server/layout';
let store:Store,dir:string;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-design-'));store=createStore(dir,process.cwd());});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
const draft=(id:string):Draft=>defaultDraft(store.skills().find(s=>s.id===id)!,store.models());
function enqueue(id:string,d:Draft){const plan=compilePlan(store,id,d);return submit(store,{skillId:id,draft:d,action:'generate',planHash:plan.hash,idempotencyKey:crypto.randomUUID(),expectedDraftRevision:store.readDraft(id).revision}).batch;}
describe('image design plans and long images',()=>{
 it('restores legacy roles and current fields without truncating references or changing the batch snapshot',()=>{
  const skill=store.skills().find(s=>s.id==='scene-recreate')!;
  const old={...draft('scene-recreate'),fields:{targetDescription:'旧字段'},inputRoles:{product:['example-6-1'],targets:['example-10-1','example-10-2']},selectedTargetIds:['example-10-1']};
  const restored=restoreDraft(skill,store.models(),old);
  expect(restored.inputRoles).toEqual({product:['example-6-1'],reference:['example-10-1','example-10-2']});
  expect(restored.fields.language).toBe('简体中文');expect(restored.fields).not.toHaveProperty('targetDescription');
  expect(old.inputRoles.targets).toHaveLength(2);expect(()=>compilePlan(store,skill.id,restored)).toThrow('只能有一张');
  const general=store.skills().find(s=>s.id==='image-generate')!;
  expect(restoreDraft(general,store.models(),{...old,inputRoles:{references:['example-6-1']}}).inputRoles.product).toEqual(['example-6-1']);
 });
 it('edits a generated image using that exact target instead of an unrelated reference',()=>{
  const initial=draft('image-generate');initial.inputRoles={product:['example-10-1']};
  const worker=createWorker(store,{generationMs:0,savingMs:0});
  const original=enqueue('image-generate',initial);worker.tick();worker.tick();worker.tick();
  const target=store.get<Asset>('asset',store.readBatch(original.id)!.attempts[0].assetId!)!;
  const d=draft('image-edit');d.inputRoles={reference:['example-6-2'],targets:[target.id]};d.selectedTargetIds=[target.id];d.requirements='修改图2背景';
  d.imageDesign!.bindings=[{assetId:'example-6-2',number:1},{assetId:target.id,number:2}];d.imageDesign!.nextNumber=3;
  const edited=enqueue('image-edit',d);worker.tick();worker.tick();worker.tick();
  const result=store.readBatch(edited.id)!.attempts[0];expect(result.status).toBe('completed');
  const output=store.get<Asset>('asset',result.assetId!)!;
  expect(fs.readFileSync(path.join(dir,'media',path.basename(output.url)))).toEqual(fs.readFileSync(path.join(dir,'media',path.basename(target.url))));
  d.inputRoles.reference.push(target.id);expect(()=>compilePlan(store,'image-edit',d)).toThrow('不能同时');
 });
 it('uses product/reference roles and counts outputs rather than uploaded product angles',()=>{
  const d=draft('scene-recreate');d.inputRoles={product:['example-6-1','example-6-2'],reference:['example-10-1']};d.count=2;
  const plan=compilePlan(store,'scene-recreate',d);expect(plan.total).toBe(2);expect(plan.items.every(i=>i.references.length===3)).toBe(true);
  expect(()=>compilePlan(store,'scene-recreate',{...d,inputRoles:{...d.inputRoles,reference:['example-10-1','example-10-2']}})).toThrow('只能有一张');
  expect(()=>compilePlan(store,'scene-recreate',{...d,inputRoles:{product:d.inputRoles.product}})).toThrow('参考图');
 });
 it('expands ordered screens by group, rejects invented parameter screens and bounds the total',()=>{
  const d=draft('detail-design');d.inputRoles={product:['example-6-1']};d.fields.productName='测试商品';d.imageDesign!.screens=d.imageDesign!.screens.slice(0,1);d.imageDesign!.screens.push({id:'detail',type:'商品细节图',requirements:'展示领口',facts:''});d.imageDesign!.groupCount=2;
  const plan=compilePlan(store,'detail-design',d);expect(plan.total).toBe(4);expect(plan.items.map(i=>[i.groupIndex,i.screenOrder])).toEqual([[1,1],[1,2],[2,1],[2,2]]);expect(plan.items[1].prompt).toContain('展示领口');
  d.imageDesign!.screens.push({id:'size',type:'尺寸/容量/尺码图',requirements:'',facts:''});expect(()=>compilePlan(store,'detail-design',d)).toThrow('已确认资料');
  d.imageDesign!.screens[2].facts='L码：衣长70cm';expect(compilePlan(store,'detail-design',d).items[2].prompt).toContain('衣长70cm');
  d.imageDesign!.groupCount=100;expect(()=>compilePlan(store,'detail-design',d)).toThrow('单批最多');
 });
 it('binds stable image numbers, excludes auxiliary outputs and detects removed references',()=>{
  const d=draft('image-edit');d.inputRoles={targets:['example-10-2','example-10-3'],reference:['example-10-1']};d.selectedTargetIds=[...d.inputRoles.targets];d.imageDesign!.bindings=[{assetId:'example-10-1',number:1},{assetId:'example-10-2',number:2},{assetId:'example-10-3',number:3}];d.imageDesign!.nextNumber=4;d.count=2;d.requirements='将图2、图3的人物改为图1';
  const p=compilePlan(store,'image-edit',d);expect(p.total).toBe(4);expect(p.items[0].prompt).toContain('本项只输出图2');expect(p.items.every(i=>i.references.length===3)).toBe(true);
  d.inputRoles.reference=[];expect(()=>compilePlan(store,'image-edit',d)).toThrow('图1的引用已失效');
 });
 it('exports the chosen group and version in order, preserves layout and rejects cross-group assets',async()=>{
  const d=draft('detail-design');d.inputRoles={product:['example-6-1']};d.fields.productName='测试商品';d.imageDesign!.screens=d.imageDesign!.screens.slice(0,1);d.imageDesign!.screens.push({id:'detail',type:'商品细节图',requirements:'',facts:''});d.imageDesign!.groupCount=2;
  const batch=enqueue('detail-design',d),worker=createWorker(store,{generationMs:0,savingMs:0});worker.tick();worker.tick();worker.tick();
  const result=store.readBatch(batch.id)!;expect(result.attempts.every(a=>a.status==='completed')).toBe(true);
  const first=result.attempts[0];const retry=retryAttempt(store,first.id,first.revision);expect(retry.groupIndex).toBe(1);expect(retry.screenId).toBe(first.screenId);
  const layout:LongImageLayout={attemptIds:[result.attempts[1].id,first.id],width:500,gap:10,background:'white',format:'png'};
  const info=await inspectLayout(store,batch.id,1,layout);const exported=await exportLayout(store,batch.id,1,layout);expect(exported.height).toBe(info.height);
  const doc=store.get<{filename:string;layout:LongImageLayout}>('export',exported.url.split('/')[3])!;expect(doc.layout.attemptIds).toEqual(layout.attemptIds);const meta=await sharp(path.join(dir,'exports',doc.filename)).metadata();expect(meta.width).toBe(500);expect(meta.height).toBe(info.height);
  await expect(inspectLayout(store,batch.id,1,{...layout,attemptIds:[result.attempts[2].id]})).rejects.toThrow('不属于当前详情组');
  await expect(inspectLayout(store,batch.id,1,{...layout,attemptIds:[first.id,first.id]})).rejects.toThrow('重复图片');
 });
});
