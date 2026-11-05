import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {createWorkbenchService} from '../apps/server/prompt-workbench';
import {workbenchHarness} from './support/workbench-harness';
import {parseWorkbenchResponse,mergeWorkbenchIssues,editedContent,compileWorkbenchSegment,inspectWorkbench,contentFingerprint,workbenchCompatibility,validateWorkbenchContent,frameScriptFingerprint,type WorkbenchCreation} from '../packages/prompt-workbench';
let h:Awaited<ReturnType<typeof workbenchHarness>>;
beforeEach(async()=>{h=await workbenchHarness();});afterEach(async()=>{await h.close();});
function create(){return h.service.create({name:'蓝色连帽外套',catalogProductId:'wb-product'}).creation;}
async function start(c:WorkbenchCreation,stage:'smart'|'prompts'|'audit'|'repair'|'scripts'='smart',target={},scope:'scripts'|'prompts'=stage==='smart'?'scripts':'prompts'){
  const j=await h.service.start(c.id,{revision:c.revision,stage,scope,target,instruction:'',key:crypto.randomUUID(),maximumCost:10});await h.drive(j.id);return h.service.run(j.id);
}
async function complete(){let c=create();await start(c);c=h.service.creation(c.id);await start(c,'prompts');c=h.service.creation(c.id);await start(c,'audit');return h.service.creation(c.id);}
describe('prompt workbench lifecycle',()=>{
 it('saves independent segment frames without invalidating the paid script and preserves them across later prompt generation',async()=>{
  let c=await complete();const before=structuredClone(c.content),s=c.content.scripts[0].segments[0];
  const frames={directionId:c.content.scripts[0].directionId,segmentId:s.id,first:{prompt:'商品在衣架上，固定中景',assetId:'wb-image-1',referenceIds:['wb-image-0']},last:{prompt:'商品展示结束，保持构图',assetId:'wb-image-2',referenceIds:['wb-image-0']}};
  c=h.service.saveFrames(c.id,c.revision,frames);const detail=h.service.detail(c.id);
  expect(c.content.frames?.[0]).toEqual({...frames,scriptFingerprint:frameScriptFingerprint(s)});expect(detail.assets.some(a=>a.id==='wb-image-1')).toBe(true);expect(detail.assets.some(a=>a.id==='wb-image-2')).toBe(true);
  expect(c.content.scripts).toEqual(before.scripts);expect(c.content.analysis).toEqual(before.analysis);expect(c.content.materials).toEqual(before.materials);expect(c.content.stale).toEqual(before.stale);
  expect(()=>h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false})).toThrow('检查');
  await start(c,'prompts');c=h.service.creation(c.id);expect(c.content.frames?.[0].first.assetId).toBe('wb-image-1');
  const next=structuredClone(c.content);next.scripts[0].segments[0].shots[0].visual='改为近景';c=h.service.patch(c.id,c.revision,next);
  expect(c.content.frames?.[0].scriptFingerprint).not.toBe(frameScriptFingerprint(c.content.scripts[0].segments[0]));
 });
 it('rejects invalid frame images, missing segments, stale revisions and writes during running tasks',async()=>{
  const c=await complete(),frames={directionId:c.content.scripts[0].directionId,segmentId:c.content.scripts[0].segments[0].id,first:{prompt:'首帧',assetId:null,referenceIds:[] as string[]},last:{prompt:'尾帧',assetId:null,referenceIds:[] as string[]}};
  expect(()=>h.service.saveFrames(c.id,c.revision-1,frames)).toThrow('更新');
  expect(()=>h.service.saveFrames(c.id,c.revision,{...frames,segmentId:'missing'})).toThrow('不存在');
  expect(()=>h.service.saveFrames(c.id,c.revision,{...frames,first:{...frames.first,assetId:'missing'}})).toThrow('真实图片');
  expect(()=>h.service.saveFrames(c.id,c.revision,{...frames,last:{...frames.last,referenceIds:['missing']}})).toThrow('真实图片');
  const asset=h.store.get<import('../packages/contracts').Asset>('asset','wb-image-1')!;h.store.put('asset','example-frame',{...asset,id:'example-frame',source:'example'});
  expect(()=>h.service.saveFrames(c.id,c.revision,{...frames,first:{...frames.first,assetId:'example-frame'}})).toThrow('真实图片');
  await h.service.start(c.id,{revision:c.revision,stage:'audit',key:crypto.randomUUID(),maximumCost:10});expect(()=>h.service.saveFrames(c.id,c.revision,frames)).toThrow('等待');
 });
 it('binds missing reference images independently without invalidating generated facts and scripts',async()=>{
  let c=await complete();const next=structuredClone(c.content),segment=next.plans[0].segments[0];
  segment.refs.push({key:'person-a',role:'person',assetId:null,label:'主角',scope:'仅参考外观'},{key:'person-b',role:'person',assetId:null,label:'配角',scope:'仅参考外观'});segment.modules.character='{{ref:person-a}} 与 {{ref:person-b}}';c=h.service.patch(c.id,c.revision,next);
  const before=structuredClone(c.content),fingerprint=contentFingerprint(before),target={directionId:next.plans[0].directionId,segmentId:segment.id};
  c=h.service.bindReference(c.id,{revision:c.revision,...target,key:'person-a',assetId:'wb-image-1'});
  c=h.service.bindReference(c.id,{revision:c.revision,...target,key:'person-b',assetId:'wb-image-2'});
  const saved=h.service.detail(c.id).creation.content,refs=saved.plans[0].segments[0].refs;
  expect(refs.find(r=>r.key==='person-a')?.assetId).toBe('wb-image-1');expect(refs.find(r=>r.key==='person-b')?.assetId).toBe('wb-image-2');
  expect(saved.materials.find(m=>m.assetId==='wb-image-1')).toMatchObject({role:'person',analyze:false});
  expect(saved.analysis).toEqual(before.analysis);expect(saved.readings).toEqual(before.readings);expect(saved.scripts).toEqual(before.scripts);expect(saved.stale).toEqual(before.stale);
  expect(contentFingerprint(saved)).not.toBe(fingerprint);expect(compileWorkbenchSegment(saved,saved.plans[0].segments[0])).toContain('【人物参考图2】 与 【人物参考图3】');
  expect(()=>h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false})).toThrow('检查');
  const revision=c.revision;c=h.service.bindReference(c.id,{revision,...target,key:'person-a',assetId:'wb-image-1'});expect(c.revision).toBe(revision);
 });
 it('rejects stale targets, incompatible images and full material lists atomically',async()=>{
  let c=await complete();const target={directionId:c.content.plans[0].directionId,segmentId:c.content.plans[0].segments[0].id,key:'product'};
  expect(()=>h.service.bindReference(c.id,{revision:c.revision-1,...target,assetId:'wb-image-1'})).toThrow('更新');
  expect(()=>h.service.bindReference(c.id,{revision:c.revision,...target,key:'missing',assetId:'wb-image-1'})).toThrow('位置');
  expect(()=>h.service.bindReference(c.id,{revision:c.revision,...target,assetId:'not-found'})).toThrow('真实图片');
  const next=structuredClone(c.content);next.materials.push({assetId:'wb-image-1',role:'scene',label:'场景',scope:'场景',analyze:false});c=h.service.patch(c.id,c.revision,next);
  expect(()=>h.service.bindReference(c.id,{revision:c.revision,...target,assetId:'wb-image-1'})).toThrow('其他角色');
  const full=structuredClone(c.content);for(let i=2;i<9;i++)full.materials.push({assetId:`wb-image-${i}`,role:'product',label:'商品',scope:'外观',analyze:false});c=h.service.patch(c.id,c.revision,full);
  const asset=h.store.get<any>('asset','wb-image-8');h.store.put('asset','extra-image',{...asset,id:'extra-image'});
  const revision=c.revision;expect(()=>h.service.bindReference(c.id,{revision,...target,assetId:'extra-image'})).toThrow('9 张');expect(h.service.creation(c.id).revision).toBe(revision);
  c=h.service.bindReference(c.id,{revision,...target,assetId:'wb-image-8'});expect(c.content.materials).toHaveLength(9);
 });
 it('locks reference binding while a creation task is active',async()=>{
  const c=await complete(),target={directionId:c.content.plans[0].directionId,segmentId:c.content.plans[0].segments[0].id,key:'product'};
  await h.service.start(c.id,{revision:c.revision,stage:'audit',scope:'prompts',key:crypto.randomUUID(),maximumCost:10});
  expect(()=>h.service.bindReference(c.id,{revision:c.revision,...target,assetId:'wb-image-1'})).toThrow('等待');
 });
 it('lets the user replace an unused image at capacity while preserving generated work',async()=>{
  let c=await complete();const next=structuredClone(c.content),s=next.plans[0].segments[0];s.refs.push({key:'person',role:'person',assetId:null,label:'人物',scope:'人物外观'});
  for(let i=1;i<9;i++)next.materials.push({assetId:`wb-image-${i}`,role:'product',label:'备用商品图',scope:'外观',analyze:false});
  c=h.service.patch(c.id,c.revision,next);const before=structuredClone(c.content),asset=h.store.get<import('../packages/contracts').Asset>('asset','wb-image-8')!;h.store.put('asset','new-person',{...asset,id:'new-person'});
  const input={revision:c.revision,directionId:next.plans[0].directionId,segmentId:s.id,key:'person',assetId:'new-person'};
  expect(()=>h.service.bindReference(c.id,{...input,replaceAssetId:'wb-image-0'})).toThrow('未参与识图');
  const analyzed=structuredClone(c.content);analyzed.materials[8].analyze=true;c=h.service.patch(c.id,c.revision,analyzed);
  expect(()=>h.service.bindReference(c.id,{...input,revision:c.revision,replaceAssetId:'wb-image-8'})).toThrow('未参与识图');
  const safe=structuredClone(c.content);safe.materials[8].analyze=false;c=h.service.patch(c.id,c.revision,safe);const stale=[...c.content.stale];
  c=h.service.bindReference(c.id,{...input,revision:c.revision,replaceAssetId:'wb-image-8'});
  expect(c.content.materials).toHaveLength(9);expect(c.content.materials.some(m=>m.assetId==='wb-image-8')).toBe(false);expect(h.store.get('asset','wb-image-8')).toBeTruthy();
  expect(c.content.materials.find(m=>m.assetId==='new-person')?.role).toBe('person');expect(c.content.scripts).toEqual(before.scripts);expect(c.content.analysis).toEqual(before.analysis);expect(c.content.stale).toEqual(stale);
 });
 it('creates independent projects, runs the complete staged flow and exports only the checked version',async()=>{
  const c=await complete(),detail=h.service.detail(c.id);
  expect(detail.creation.content.directions).toHaveLength(4);expect(detail.creation.content.scripts).toHaveLength(4);expect(detail.creation.content.plans).toHaveLength(4);
  expect(detail.reviews.some(r=>r.complete)).toBe(true);expect(inspectWorkbench(c.content)).toEqual([]);
  expect(h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false}).text).toContain('蓝色');
  const next=structuredClone(c.content);next.plans[0].segments[0].modules.scene='改为干净浅色背景';const changed=h.service.patch(c.id,c.revision,next);
  expect(()=>h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false})).toThrow('检查');
  expect(h.service.exported(changed.id,{scope:'prompts',draft:true,format:'md',whole:true,notes:false}).text).toContain('草稿');
 });
 it('runs every direction and segment through prompts and audit in one quoted run',async()=>{
  const c=create(),q=await h.service.estimate(c.id,{revision:c.revision,stage:'smart',scope:'prompts',target:{},instruction:''});
  expect(q.calls).toBe(22);expect(q.stages.at(-1)).toContain('审核');
  const j=await start(c,'smart',{},'prompts'),updated=h.service.creation(c.id);
  expect(j.status).toBe('completed');expect(j.steps).toHaveLength(q.calls);expect(h.calls).toHaveLength(q.calls);
  expect(updated.content.plans).toHaveLength(4);expect(updated.content.plans.every(p=>p.segments.length===2&&p.totalSeconds===30)).toBe(true);
  expect(h.service.detail(c.id).reviews[0].complete).toBe(true);expect(inspectWorkbench(updated.content)).toEqual([]);
  expect(h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false}).text).toContain('第 2 段');
 });
 it('resumes a failed paid step without repeating completed stages and retains all attempt costs',async()=>{
  const c=create();h.control.failStage='prompts';const j=await start(c,'smart',{},'prompts');expect(j.status).toBe('failed');
  const finished=j.steps.filter(s=>s.status==='completed').map(s=>s.jobId),failed=j.steps.find(s=>s.status==='failed')!;expect(failed.jobId).toBeTruthy();
  h.control.failStage='';await h.service.resume(j.id,10);await h.drive(j.id);const done=h.service.run(j.id);
  expect(done.status).toBe('completed');expect(h.calls.filter(x=>x.stage==='analysis')).toHaveLength(1);expect(h.calls.filter(x=>x.stage==='scripts')).toHaveLength(4);
  expect(done.steps.filter(s=>finished.includes(s.jobId)).length).toBe(finished.length);expect(done.steps.find(s=>s.id===failed.id)?.attempts).toHaveLength(1);
  expect(h.service.detail(c.id).runs[0].calls).toHaveLength(23);expect(h.service.detail(c.id).reviews[0].complete).toBe(true);
 });
 it('refuses retry of an unknown request and retry against changed input',async()=>{
  const c=create();h.control.unknown=true;const j=await start(c,'smart',{},'prompts');await expect(h.service.resume(j.id,20)).rejects.toThrow('待核实');expect(h.calls).toHaveLength(1);
  h.control.unknown=false;h.service.cancel(j.id);
  // A separate creation avoids interfering with the still-unknown charge.
  const other=create();h.control.failStage='scripts';const failed=await start(other,'smart',{},'prompts');const latest=h.service.creation(other.id),next=structuredClone(latest.content);next.brief.description='新资料';h.service.patch(other.id,latest.revision,next);
  await expect(h.service.resume(failed.id,20)).rejects.toThrow('输入已变化');
 });
 it('recovers the durable pipeline after restarting its scheduler without repeated paid calls',async()=>{
  const c=create(),j=await h.service.start(c.id,{revision:c.revision,stage:'smart',scope:'prompts',key:crypto.randomUUID(),maximumCost:10});
  for(let i=0;i<8;i++){h.service.tick();await h.service.idle();h.analysis.tick();await h.analysis.idle();}
  const previousCalls=h.calls.length;expect(previousCalls).toBeGreaterThan(0);await h.service.stop();const restarted=createWorkbenchService(h.store,h.analysis);
  try{for(let i=0;i<100&&['running','queued'].includes(restarted.run(j.id).status);i++){restarted.tick();await restarted.idle();h.analysis.tick();await h.analysis.idle();}
    expect(restarted.run(j.id).status).toBe('completed');expect(h.calls).toHaveLength(22);expect(h.calls.filter(x=>x.stage==='analysis')).toHaveLength(1);
  }finally{await restarted.stop();}
 });
 it('keeps the confirmed budget on retry and pauses before spending beyond it',async()=>{
  const c=create();h.control.failStage='prompts';const j=await start(c,'smart',{},'prompts');h.control.failStage='';h.control.finalCost=11;
  await expect(h.service.resume(j.id,1)).rejects.toThrow('预算');await h.service.resume(j.id,10);await h.drive(j.id);
  expect(h.service.run(j.id).status).toBe('paused');expect(h.service.run(j.id).steps.find(s=>s.attempts?.length)?.attempts).toHaveLength(1);
 });
 it('recovers an older parse failure from its stored completed response without another paid request',async()=>{
  h.control.trailingReview=true;h.control.structuredClaims=true;h.control.structuredDescriptions=true;const c=create(),j=await h.service.start(c.id,{revision:c.revision,stage:'smart',scope:'prompts',key:crypto.randomUUID(),maximumCost:10});
  h.service.tick();await h.service.idle();h.analysis.tick();await h.analysis.idle();const previous=h.service.run(j.id);previous.status='failed';previous.error='旧版解析失败';previous.steps[0].status='failed';h.store.put('workbench-run',j.id,previous);
  expect(h.calls).toHaveLength(1);await h.service.resume(j.id,10);await h.drive(j.id);const done=h.service.run(j.id);
  expect(done.status).toBe('completed');expect(h.calls).toHaveLength(22);expect(done.steps[0].attempts).toBeUndefined();expect(h.service.creation(c.id).content.analysis?.claims[0].qualifiers).toContain('仅说明可见颜色');
 });
 it('shows each deterministic review issue once and prioritizes blockers',()=>{
  const warning={path:'x',severity:'warning' as const,message:'待补参考图',suggestion:'补图'},blocker={path:'y',severity:'blocker' as const,message:'动作冲突',suggestion:'修正衔接'};
  expect(mergeWorkbenchIssues([warning],[warning,blocker])).toEqual([blocker,warning]);
 });
 it('never repairs incomplete required fields or fabricates missing audit results',()=>{
  expect(()=>parseWorkbenchResponse('{"directionId":"x","segment":{"modules":{"scene":"cut','prompts')).toThrow('不完整');
  expect(()=>parseWorkbenchResponse('{"summary":"ok","identityQuestion":"","claims":[],"missing":["cut','analysis')).toThrow('不完整');
  expect(()=>parseWorkbenchResponse('{"issues":[{"message":"cut','audit')).toThrow('不完整');
  expect(()=>parseWorkbenchResponse('{"issues":[],"issues":"cut','audit')).toThrow('不完整');
  expect(parseWorkbenchResponse('{"issues":[],"z_end_turn_review":"cut','audit')).toEqual({issues:[]});
 });
 it('partitions nine image readings into 4/4/1 and keeps every image identity',async()=>{
  let c=create();const content=structuredClone(c.content);content.materials=Array.from({length:9},(_,i)=>({assetId:`wb-image-${i}`,role:'product',label:`商品图 ${i}`,scope:'外观',analyze:true}));c=h.service.patch(c.id,c.revision,content);const j=await start(c);
  expect(j.status).toBe('completed');expect(j.steps.filter(s=>s.stage==='images').map(s=>s.assetIds.length)).toEqual([4,4,1]);expect(h.service.creation(c.id).content.readings).toHaveLength(9);
 });
 it('preserves successful directions when a later call fails and deduplicates admission keys',async()=>{
  const c=create(),input={revision:c.revision,stage:'smart',scope:'prompts',target:{},instruction:'',key:crypto.randomUUID(),maximumCost:10};const j=await h.service.start(c.id,input);expect((await h.service.start(c.id,input)).id).toBe(j.id);
  h.control.failStage='scripts';await h.drive(j.id);expect(h.service.run(j.id).status).toBe('failed');expect(h.service.creation(c.id).content.directions).toHaveLength(4);expect(h.calls.filter(c=>c.stage==='directions')).toHaveLength(1);
 });
 it('preserves editing during a running AI task as a candidate and never silently overwrites it',async()=>{
  const c=create(),j=await h.service.start(c.id,{revision:c.revision,stage:'smart',key:crypto.randomUUID(),maximumCost:10});h.service.tick();await h.service.idle();h.analysis.tick();await h.analysis.idle();const newer=structuredClone(c.content);newer.brief.description='用户随后补充的资料';h.service.patch(c.id,c.revision,newer);await h.drive(j.id);
  expect(h.service.run(j.id).status).toBe('conflict');expect(h.service.creation(c.id).content.brief.description).toContain('随后补充');expect(h.service.run(j.id).candidateStepId).toBeTruthy();
 });
 it('does not retry an unknown paid request',async()=>{
  const c=create();h.control.unknown=true;const j=await start(c);expect(j.status).toBe('unknown');const count=h.calls.length;h.service.tick();await h.service.idle();h.analysis.tick();await h.analysis.idle();expect(h.calls).toHaveLength(count);expect(()=>h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:false,notes:false})).toThrow();
 });
 it('refuses prompt refinement that changes confirmed speech',async()=>{
  let c=create();await start(c);c=h.service.creation(c.id);h.control.changedSpeech=true;const j=await start(c,'prompts');expect(j.status).toBe('failed');expect(j.error).toContain('台词');expect(h.service.creation(c.id).content.plans).toHaveLength(0);
 });
 it('normalizes structured prompt module and continuity fields without losing their content',async()=>{
  let c=create();await start(c);c=h.service.creation(c.id);h.control.structuredPromptFields=true;const j=await start(c,'prompts');c=h.service.creation(c.id);
  expect(j.status).toBe('completed');expect(c.content.plans).toHaveLength(4);
  const segment=c.content.plans[0].segments[0];expect(segment.modules.character).toContain('presentation: 无具名人物');expect(segment.modules.product).toContain('蓝色');expect(segment.modules.product).toContain('{{ref:product}}');expect(segment.modules.boundaries).toContain('保暖承诺');expect(segment.continuity).toContain('保持同款颜色和结构');
  expect(h.service.exported(c.id,{scope:'prompts',draft:true,format:'md',whole:true,notes:false}).text).toContain('保持同款颜色和结构');
 });
 it('marks only the edited script segment stale, keeps speech and references compiled from one version',async()=>{
  const c=await complete(),next=structuredClone(c.content);next.scripts[1].segments[0].shots[0].speech='选一件蓝色外套。';const edited=editedContent(c.content,next);expect(edited.stale).toEqual([`prompts:${next.scripts[1].directionId}:${next.scripts[1].segments[0].id}`]);
  const segment=c.content.plans[0].segments[0],compiled=compileWorkbenchSegment(c.content,segment);expect(compiled).toContain('【商品参考图1】');expect(compiled).not.toContain('{{ref:');expect(compiled).toContain(segment.shots[0].speech);
 });
 it('a partial repair audit cannot authorize formal full export',async()=>{
  let c=await complete();const changed=structuredClone(c.content);changed.plans[0].segments[0].modules.scene='修改背景';c=h.service.patch(c.id,c.revision,changed);const p=c.content.plans[0],j=await start(c,'repair',{directionId:p.directionId,segmentId:p.segments[0].id});expect(j.status).toBe('completed');expect(h.service.detail(c.id).reviews[0].complete).toBe(false);expect(()=>h.service.exported(c.id,{scope:'prompts',draft:false,format:'md',whole:true,notes:false})).toThrow('检查');
 });
 it('stores provenance in templates, creates only compatible video drafts and keeps a draft backup',async()=>{
  const c=await complete(),p=c.content.plans[0],model=h.store.models().find(m=>m.category==='video'&&m.durations.includes(4)&&m.aspectRatios.includes('9:16')&&m.maxReferences>=1)!;
  const saved=h.service.toTemplate(c.id,p.directionId);expect(saved.version.value.source.kind).toBe('workbench');expect(saved.version.value.prompt).not.toContain('{{ref:');
  expect(workbenchCompatibility(c.content,p.segments[0],{...model,durations:[10]}).errors).toContain('本段 4 秒；模型支持 10 秒');
  const before=h.store.readDraft('video-generate');const old=h.store.saveDraft('video-generate',{...before.value,requirements:'原视频草稿内容'},before.revision);
  const draft=h.service.handoff(c.id,{revision:c.revision,directionId:p.directionId,segmentId:p.segments[0].id,modelId:model.id,draftRevision:old.revision});expect(draft.value.duration).toBe(4);expect(draft.value.workbenchSource?.creationId).toBe(c.id);expect(h.store.list('workbench-draft-backup')).toHaveLength(1);expect(h.store.snapshot().batches).toHaveLength(0);
  const backup=h.service.detail(c.id).draftBackups[0];expect(()=>h.service.restoreDraft(c.id,backup.id,old.revision)).toThrow('草稿已变化');const restored=h.service.restoreDraft(c.id,backup.id,draft.revision);expect(restored.value.requirements).toBe('原视频草稿内容');expect(h.service.detail(c.id).draftBackups).toHaveLength(2);
 });
 it('deduplicates repeated image references without skipping upload numbers and rejects duplicate aliases',async()=>{
  const c=await complete(),segment=structuredClone(c.content.plans[0].segments[0]);segment.refs.push({...segment.refs[0],key:'detail'});segment.modules.scene='近看 {{ref:detail}}';segment.objective='展示 {{ref:product}}';segment.productPresentation='近看 {{ref:detail}}';
  const compiled=compileWorkbenchSegment(c.content,segment);expect(compiled).toContain('【商品参考图1】');expect(compiled).not.toContain('参考图2');expect(workbenchCompatibility(c.content,segment,{...h.store.models().find(m=>m.category==='video')!,maxReferences:1}).assetIds).toEqual(['wb-image-0']);
  c.content.plans[0].segments[0].refs.push({...segment.refs[0]});expect(()=>validateWorkbenchContent(c.content)).toThrow('素材代称重复');
 });
 it('blocks unsupported claims in directions and creative intent',async()=>{
  const c=await complete();c.content.directions[0].claimIds=['missing'];c.content.plans[0].segments[0].intent.claimIds=['missing'];const issues=inspectWorkbench(c.content);expect(issues.some(i=>i.message.includes('方向采用'))).toBe(true);expect(issues.some(i=>i.message.includes('策划意图采用'))).toBe(true);
 });
 it('pauses later steps when actual charges exceed reserved estimates and resumes without repeating completed calls',async()=>{
  const c=create();h.control.finalCost=11;const j=await start(c);expect(j.status).toBe('paused');expect(j.error).toContain('预算');expect(h.calls).toHaveLength(1);h.control.finalCost=.001;await h.service.resume(j.id,20);await h.drive(j.id);expect(h.service.run(j.id).status).toBe('completed');expect(h.calls.filter(c=>c.stage==='analysis')).toHaveLength(1);
 });
 it('cancels unsubmitted work and refuses rotated credentials or a stale model confirmation',async()=>{
  const c=create(),q=await h.service.estimate(c.id,{revision:c.revision,stage:'smart',scope:'prompts',target:{},instruction:''});
  await expect(h.service.start(c.id,{revision:c.revision,stage:'smart',key:crypto.randomUUID(),maximumCost:10,expectedModelRevision:q.modelRevision+1})).rejects.toThrow('模型配置已变化');
  const j=await h.service.start(c.id,{revision:c.revision,stage:'smart',key:crypto.randomUUID(),maximumCost:10});h.service.cancel(j.id);await h.drive(j.id);expect(h.calls).toHaveLength(0);
  const next=await h.service.start(c.id,{revision:c.revision,stage:'smart',key:crypto.randomUUID(),maximumCost:10});h.analysis.configure('tt-6.1-sol',{key:'sk-isolated-new-version-no-real-key'});await h.drive(next.id);expect(h.service.run(next.id).status).toBe('paused');expect(h.calls).toHaveLength(0);
 });
 it('restores immutable history as a new version and separates new creation rounds',async()=>{
  const c=await complete(),detail=h.service.detail(c.id),old=detail.versions.at(-1)!;const restored=h.service.restore(c.id,old.id,c.revision);expect(contentFingerprint(restored.content)).toBe(contentFingerprint(old.content));expect(h.service.detail(c.id).versions[0].reason).toContain('恢复版本');const round=h.service.addCreation(c.id,'第二轮');expect(round.content.plans).toEqual([]);expect(round.content.materials).toHaveLength(1);
 });
});
