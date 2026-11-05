import {createHash} from 'node:crypto';
import type {Store} from './store';
import type {Batch,CreativeContext,Draft} from '../../packages/contracts';
import type {VideoRemakeJob,RemakePlan} from '../../packages/video-remake';
import {fail} from './errors';
export const canonicalJSON=(v:unknown):string=>JSON.stringify(sort(v));
function sort(v:unknown):unknown{return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;}
export const remakeDigest=(v:unknown)=>createHash('sha256').update(canonicalJSON(v)).digest('hex');
export function validateRemakeContext(store:Store,c:CreativeContext,draft:Draft,skillId:string){
 const plan=store.get<RemakePlan>('remake-plan',c.remakePlanId||'')||fail('分镜报价不存在，请重新报价',409);
 const j=store.get<VideoRemakeJob>('video-remake',c.remakeJobId||'')||fail('分镜任务不存在');
 const s=j.shots.find(s=>s.id===c.remakeShotId)||fail('镜头不存在');
 if(['cancelled','extracting','composing','queued'].includes(j.status)||j.frameRefresh)fail('任务当前阶段不能提交');
 if(plan.creativeContext.draftRevision!==s.revision||plan.creativeContext.productRevision!==j.productRevision||plan.skillId!==skillId||remakeDigest(plan.creativeContext)!==remakeDigest(c)||remakeDigest(plan.draft)!==remakeDigest(draft))fail('镜头或报价已变化，请重新报价',409);
 if(c.remakeStage==='video'&&(!s.selectedFrameId||s.selectedFrameId!==draft.inputRoles.references?.[0]))fail('确认首帧已变化',409);
 return {j,s};
}
export function admitRemake(store:Store,batch:Batch){
 const c=batch.creativeContext!,{j,s}=validateRemakeContext(store,c,batch.draft,batch.skillId);
 (c.remakeStage==='frame'?s.frameBatchIds:s.videoBatchIds).push(batch.id);s.revision++;j.revision++;j.updatedAt=new Date().toISOString();store.put('video-remake',j.id,j);
}
