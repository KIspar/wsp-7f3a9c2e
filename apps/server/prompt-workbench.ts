import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {Store} from './store';
import type {AnalysisService} from './analysis';
import type {AnalysisInput,AnalysisModelId} from '../../packages/analysis';
import type {CatalogProduct} from '../../packages/catalog';
import {defaultDraft,type Asset} from '../../packages/contracts';
import {relayModelAvailable} from './relays';
import {credentialVault} from './credentials';
import {fail} from './errors';
import {savePrompt} from './prompts';
import {emptyPrompt} from '../../packages/prompts';
import {
  workbenchFramesSchema,frameScriptFingerprint,workbenchContentSchema,emptyWorkbenchContent,editedContent,contentFingerprint,sourcesFor,inspectWorkbench,normalizePromptSegmentFields,parseWorkbenchResponse,normalizeWorkbenchAnalysisFields,normalizeWorkbenchResponseFields,
  workbenchAnalysisSchema,directionSchema,scriptPlanSchema,promptSegmentSchema,imageReadingSchema,issueOutputSchema,
  exportWorkbench,workbenchCompatibility,validateWorkbenchContent,workbenchStages,stageLabels,
  type WorkbenchContent,type WorkbenchProject,type WorkbenchCreation,type WorkbenchVersion,type WorkbenchRun,
  type WorkbenchStep,type WorkbenchTarget,type WorkbenchReview,type WorkbenchIssue,type WorkbenchTaskStage,type WorkbenchDraftBackup,
} from '../../packages/prompt-workbench';
const stamp=()=>new Date().toISOString();
const targetSchema=z.object({directionId:z.string().max(120).optional(),segmentId:z.string().max(120).optional()});
export const workbenchRequestSchema=z.object({revision:z.number().int().positive(),stage:z.enum([...workbenchStages,'smart','repair']),scope:z.enum(['scripts','prompts']).default('prompts'),target:targetSchema.default({}),instruction:z.string().max(2000).default('')});
type Request=z.infer<typeof workbenchRequestSchema>;
const generationPolicy=(c:WorkbenchContent)=>({totalSeconds:c.brief.duration??30,segmentCount:Math.ceil((c.brief.duration??30)/15)});
const label=(s:WorkbenchStep)=>stageLabels[s.stage]+(s.target.segmentId?' · 当前段':s.target.directionId?' · 当前方案':'');
export function createWorkbenchService(store:Store,analysis:AnalysisService){
  const project=(id:string)=>store.get<WorkbenchProject>('workbench-project',id)||fail('创作项目不存在',404);
  const creation=(id:string)=>store.get<WorkbenchCreation>('workbench-creation',id)||fail('创作记录不存在',404);
  const run=(id:string)=>store.get<WorkbenchRun>('workbench-run',id)||fail('创作任务不存在',404);
  const versions=(id:string)=>store.list<WorkbenchVersion>('workbench-version').filter(v=>v.creationId===id).sort((a,b)=>b.number-a.number);
  const runs=(id:string)=>store.list<WorkbenchRun>('workbench-run').filter(j=>j.creationId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const persist=(j:WorkbenchRun)=>{j.updatedAt=stamp();store.transaction(()=>store.put('workbench-run',j.id,j));};
  function validate(c:WorkbenchContent){validateWorkbenchContent(c);for(const m of c.materials){const a=store.get<Asset>('asset',m.assetId)||fail('素材已不存在，请重新选择');if(a.type!=='image'||['example','simulator'].includes(a.source))fail('请选择真实商品或参考图片');}for(const f of c.frames||[])for(const assetId of [...f.first.referenceIds,...f.last.referenceIds,...[f.first.assetId,f.last.assetId].filter((id):id is string=>!!id)]){const a=store.get<Asset>('asset',assetId);if(!a||a.type!=='image'||['example','simulator'].includes(a.source))fail('首尾帧只能使用图片库中的真实图片');}}
  function saveVersion(c:WorkbenchCreation,reason:string){const v:WorkbenchVersion={id:store.id('workbench-version'),creationId:c.id,number:(versions(c.id)[0]?.number||0)+1,createdAt:stamp(),reason,content:structuredClone(c.content)};c.currentVersionId=v.id;store.put('workbench-version',v.id,v);return v;}
  function write(c:WorkbenchCreation,content:WorkbenchContent,reason?:string){validate(content);c.content=structuredClone(content);c.revision++;c.updatedAt=stamp();if(reason)saveVersion(c,reason);store.put('workbench-creation',c.id,c);const p=project(c.projectId);p.name=content.brief.name||p.name;p.updatedAt=c.updatedAt;store.put('workbench-project',p.id,p);return c;}
  function newCreation(p:WorkbenchProject,title:string,content:WorkbenchContent){const c:WorkbenchCreation={id:store.id('workbench-creation'),projectId:p.id,title,revision:1,content,createdAt:stamp(),updatedAt:stamp()};saveVersion(c,'创建创作');store.put('workbench-creation',c.id,c);return c;}
  function create(input:{name:string;catalogProductId?:string}){
    const p:WorkbenchProject={id:store.id('workbench-project'),name:input.name,createdAt:stamp(),updatedAt:stamp()},content=emptyWorkbenchContent(input.name);
    if(input.catalogProductId){const product=store.get<CatalogProduct>('catalog-product',input.catalogProductId)||fail('商品不存在',404);p.catalogProductId=product.id;p.catalogRevision=product.revision;p.name=product.title;content.brief.name=product.title;if(product.sellingPoints.length>9000)fail('商品介绍过长，请精简后导入');content.brief.description='';content.brief.specification='';if(content.brief.specification.length>1500)fail('商品参数过长，请先精简后导入');content.sources=[{id:'catalog',title:'商品工坊资料快照',url:product.sourceUrl,text:[product.title,product.sellingPoints,...product.parameters.map(x=>`${x.name}：${x.value}`)].join('\n')}];if(content.sources[0].text.length>9000)fail('商品资料过长，请精简后导入');content.materials=[...new Set(product.bindings.filter(b=>b.kind!=='video').map(b=>b.assetId))].filter(id=>store.get<Asset>('asset',id)?.type==='image').slice(0,9).map((assetId,i)=>({assetId,role:'product',label:`商品图 ${i+1}`,scope:'只参考本商品外观，不推断材质或功效',analyze:false}));}
    validate(content);return store.transaction(()=>{store.put('workbench-project',p.id,p);const c=newCreation(p,'第一轮创作',content);return {project:p,creation:c};});
  }
  function detail(id:string){const c=creation(id),p=project(c.projectId),rs=runs(id);return {project:p,creation:c,creations:store.list<WorkbenchCreation>('workbench-creation').filter(x=>x.projectId===p.id).map(x=>({...x,content:emptyWorkbenchContent(x.content.brief.name)})),versions:versions(id),runs:rs.map(j=>({...j,calls:j.steps.flatMap(s=>[...(s.attempts||[]).map(a=>analysis.job(a.jobId)),...(s.jobId?[analysis.job(s.jobId)]:[])])})),reviews:store.list<WorkbenchReview>('workbench-review').filter(r=>versions(id).some(v=>v.id===r.versionId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),draftBackups:store.list<WorkbenchDraftBackup>('workbench-draft-backup').filter(b=>b.creationId===id&&b.id).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(({id,savedAt})=>({id,savedAt})),assets:[...new Set([...c.content.materials.map(m=>m.assetId),...(c.content.frames||[]).flatMap(f=>[...f.first.referenceIds,...f.last.referenceIds,...(f.first.assetId?[f.first.assetId]:[]),...(f.last.assetId?[f.last.assetId]:[])])])].map(assetId=>store.get<Asset>('asset',assetId)).filter((a):a is Asset=>!!a),catalogChanged:!!p.catalogProductId&&store.get<CatalogProduct>('catalog-product',p.catalogProductId)?.revision!==p.catalogRevision};}
  function patch(id:string,revision:number,content:WorkbenchContent){return store.transaction(()=>{const c=creation(id);if(c.revision!==revision)fail('创作已在其他页面更新，本地编辑保留，请比较后重新载入',409);return write(c,editedContent(c.content,content));});}
  function bindReference(id:string,b:{revision:number;directionId:string;segmentId:string;key:string;assetId:string;replaceAssetId?:string}){return store.transaction(()=>{
    const c=creation(id);if(c.revision!==b.revision)fail('创作已更新，请刷新后重新选择图片',409);
    if(runs(id).some(j=>['queued','running','unknown','conflict'].includes(j.status)))fail('请等待当前创作任务结束后再补图',409);
    const next=structuredClone(c.content),ref=next.plans.find(p=>p.directionId===b.directionId)?.segments.find(s=>s.id===b.segmentId)?.refs.find(r=>r.key===b.key);
    if(!ref)fail('参考图位置已变化，请刷新',404);
    const asset=store.get<Asset>('asset',b.assetId);if(!asset||asset.type!=='image'||['example','simulator'].includes(asset.source))fail('请选择图片库中的真实图片');
    const material=next.materials.find(m=>m.assetId===b.assetId);
    if(material&&material.role!==ref.role)fail('这张图片已用于其他角色，请选择对应角色的图片');
    if(ref.assetId===b.assetId)return c;
    if(b.replaceAssetId){
      const replaced=next.materials.find(m=>m.assetId===b.replaceAssetId);
      if(material||!replaced||replaced.analyze||next.readings.some(r=>r.assetId===b.replaceAssetId)||next.plans.some(p=>p.segments.some(s=>s.refs.some(r=>r.assetId===b.replaceAssetId))))fail('只能替换未参与识图且未被提示词引用的素材');
      next.materials=next.materials.filter(m=>m.assetId!==b.replaceAssetId);
    }
    if(!material){if(next.materials.length>=9)fail('每个项目最多添加 9 张参考图，请先替换一张未使用的素材');next.materials.push({assetId:b.assetId,role:ref.role,label:ref.label,scope:ref.scope,analyze:false});}
    ref.assetId=b.assetId;
    // Execution references do not change analyzed facts; the new fingerprint still requires a fresh review.
    return write(c,next,'补充或替换参考图');
  });}
  function saveFrames(id:string,revision:number,input:Omit<import('../../packages/prompt-workbench').WorkbenchFrames,'scriptFingerprint'>){return store.transaction(()=>{
    const c=creation(id);if(c.revision!==revision)fail('创作已更新，请关闭弹窗后重新编辑',409);
    if(runs(id).some(j=>['queued','running','unknown','conflict'].includes(j.status)))fail('请等待当前创作任务结束',409);
    const segment=c.content.scripts.find(p=>p.directionId===input.directionId)?.segments.find(s=>s.id===input.segmentId);if(!segment)fail('生成段已不存在，请刷新',404);
    for(const assetId of [...input.first.referenceIds,...input.last.referenceIds,...[input.first.assetId,input.last.assetId].filter((id):id is string=>!!id)]){const a=store.get<Asset>('asset',assetId);if(!a||a.type!=='image'||['example','simulator'].includes(a.source))fail('首尾帧只能使用图片库中的真实图片');}
    const next=structuredClone(c.content),frames={...input,scriptFingerprint:frameScriptFingerprint(segment)};
    next.frames=[...(next.frames||[]).filter(f=>f.directionId!==input.directionId||f.segmentId!==input.segmentId),frames];
    return write(c,next,'编辑分段首尾帧');
  });}
  function commit(id:string,revision:number,reason='应用手动修改'){return store.transaction(()=>{const c=creation(id);if(c.revision!==revision)fail('创作已更新，请刷新',409);saveVersion(c,reason);store.put('workbench-creation',c.id,c);return c;});}
  function addCreation(id:string,title:string){const c=creation(id),content=emptyWorkbenchContent(c.content.brief.name);Object.assign(content,{brief:structuredClone(c.content.brief),sources:structuredClone(c.content.sources),materials:structuredClone(c.content.materials)});return store.transaction(()=>newCreation(project(c.projectId),title,content));}
  function checkInput(c:WorkbenchContent,b:Request){
    if(!c.brief.name.trim())fail('请先填写商品名称');
    if(b.target.segmentId&&!b.target.directionId)fail('请选择段落所属方向');
    if(b.target.directionId&&!c.directions.some(d=>d.id===b.target.directionId))fail('方向不存在');
    if(['directions','scripts','prompts','audit','repair'].includes(b.stage)&&(!c.analysis||c.stale.includes('analysis')))fail('请先更新商品卖点');
    if(c.analysis?.identityQuestion&&b.stage!=='analysis'&&b.stage!=='smart')fail('请先明确商品身份：'+c.analysis.identityQuestion);
    if(['scripts','prompts','audit','repair'].includes(b.stage)&&c.stale.includes('directions'))fail('请先按当前资料更新内容方向');
    const selected=c.directions.filter(d=>(!b.target.directionId||d.id===b.target.directionId)&&d.selected);
    if(['scripts','prompts','audit','repair'].includes(b.stage)&&!selected.length)fail('请选用至少一套内容方向');
    if(['prompts','audit','repair'].includes(b.stage)){
      const issues=inspectWorkbench(c,'scripts',b.target).filter(i=>i.severity==='blocker');if(issues.length)fail(issues[0].message);
    }
    if(b.stage==='repair'&&(!b.target.directionId||!b.target.segmentId||!c.plans.find(p=>p.directionId===b.target.directionId)?.segments.some(s=>s.id===b.target.segmentId)))fail('请选择需要修正的提示词段落');
    validate(c);
  }
  function step(stage:WorkbenchTaskStage,target:WorkbenchTarget={},assetIds:string[]=[]):WorkbenchStep{return {id:store.id('wb-step'),stage,target,assetIds,status:'pending'};}
  function steps(c:WorkbenchContent,b:Request){
    const selected=c.directions.filter(d=>d.selected&&(!b.target.directionId||d.id===b.target.directionId));
    if(['analysis','smart'].includes(b.stage)){const images=c.materials.filter(m=>m.analyze).map(m=>m.assetId),result:WorkbenchStep[]=[];for(let i=0;i<images.length;i+=4)result.push(step('images',{},images.slice(i,i+4)));result.push(step('analysis'));if(b.stage==='smart')result.push(step('directions'));return result;}
    if(b.stage==='directions')return [step('directions',b.target)];
    if(b.stage==='scripts')return selected.map(d=>step('scripts',{directionId:d.id,...b.target}));
    if(b.stage==='prompts')return selected.flatMap(d=>(c.scripts.find(p=>p.directionId===d.id)?.segments||[]).filter(s=>!b.target.segmentId||s.id===b.target.segmentId).map(s=>step('prompts',{directionId:d.id,segmentId:s.id})));
    if(b.stage==='repair')return [step('repair',b.target),step('audit',b.target)];
    return selected.flatMap(d=>((b.scope==='scripts'?c.scripts:c.plans).find(p=>p.directionId===d.id)?.segments||[]).filter(s=>!b.target.segmentId||s.id===b.target.segmentId).map(s=>step('audit',{directionId:d.id,segmentId:s.id})));
  }
  const model=()=>{const m=analysis.models().find(m=>m.id===analysis.settings().defaultModelId)||fail('默认辅助模型不存在');if(!m.enabled||!m.credentialConfigured)fail('请到模型配置勾选已配置的 AI 辅助模型');return m;};
  async function estimate(id:string,b:Request){const c=creation(id);if(c.revision!==b.revision)fail('当前创作已变化，请保存后重新报价',409);checkInput(c.content,b);const m=model(),selectedImages=['analysis','smart'].includes(b.stage)?c.content.materials.filter(x=>x.analyze).length:0;
    if(selectedImages&&(!m.capabilities.includes('image')||m.id==='tt-6.1-sol'&&m.vision.status!=='passed'))fail('当前辅助模型尚未通过图片能力验证，请取消图片分析或在模型配置完成验证');
    const planned=steps(c.content,b),full=b.stage==='smart'&&b.scope==='prompts',segments=generationPolicy(c.content).segmentCount,calls=planned.length+(b.stage==='smart'?c.content.brief.count*(1+(full?segments*2:0)):0);if(!calls)fail('当前选择没有可执行内容');
    const q=await analysis.estimate(m.id);return {modelId:m.id,modelRevision:m.revision,modelName:m.name,unit:'算力',unitEstimate:q.estimated,calls,images:selectedImages,estimated:q.estimated*calls,available:q.available,affordable:q.available>=q.estimated*calls,stages:[...planned.map(label),...(b.stage==='smart'?['生成所有方案脚本',...(full?['细化所有分段提示词','逐段审核并准备交付']:[])]:[])],fingerprint:JSON.stringify(b)};
  }
  async function start(id:string,raw:unknown){const b=workbenchRequestSchema.extend({key:z.string().min(8).max(120),maximumCost:z.number().finite().positive(),expectedModelId:z.string().optional(),expectedModelRevision:z.number().int().optional()}).parse(raw),fingerprint=JSON.stringify({id,...b}),previous=store.list<WorkbenchRun>('workbench-run').find(j=>j.key===b.key);if(previous){if(previous.fingerprint!==fingerprint)fail('接单凭据已用于其他内容',409);return previous;}
    if(runs(id).some(j=>['queued','running','unknown','conflict'].includes(j.status)))fail('本次创作已有待完成任务，请先处理',409);
    const q=await estimate(id,b);if(b.expectedModelId&&b.expectedModelId!==q.modelId||b.expectedModelRevision!==undefined&&b.expectedModelRevision!==q.modelRevision)fail('辅助模型配置已变化，请重新确认费用',409);if(q.estimated>b.maximumCost+1e-9||!q.affordable)fail('报价变化或可用余额不足，请重新确认',402);
    return store.transaction(()=>{const c=creation(id);if(c.revision!==b.revision||model().id!==q.modelId||model().revision!==q.modelRevision)fail('内容或模型已变化，请重新确认',409);if(runs(id).some(j=>['queued','running','unknown','conflict'].includes(j.status)))fail('已有任务运行中',409);commitInTransaction(c);const j:WorkbenchRun={id:store.id('workbench-run'),workspaceId:store.currentWorkspace(),creationId:id,key:b.key,fingerprint,stage:b.stage,scope:b.scope,fullPipeline:b.stage==='smart'&&b.scope==='prompts',plannedCalls:q.calls,target:b.target,instruction:b.instruction,modelId:q.modelId,modelRevision:q.modelRevision,credentialVersion:credentialVault(store.dataDir).current(q.modelId)!,maximumCost:b.maximumCost,unitEstimate:q.unitEstimate,steps:steps(c.content,b),working:structuredClone(c.content),baseRevision:c.revision,baseVersionId:c.currentVersionId!,status:'queued',createdAt:stamp(),updatedAt:stamp(),issues:[]};if(['analysis','smart'].includes(b.stage))j.working.stale=[...new Set([...j.working.stale,'analysis','directions'])];store.put('workbench-run',j.id,j);return j;});
  }
  function commitInTransaction(c:WorkbenchCreation){const v=c.currentVersionId?store.get<WorkbenchVersion>('workbench-version',c.currentVersionId):undefined;if(!v||contentFingerprint(v.content)!==contentFingerprint(c.content)){saveVersion(c,'任务输入快照');store.put('workbench-creation',c.id,c);}}
  function context(j:WorkbenchRun,s:WorkbenchStep){const c=j.working,d=c.directions.find(d=>d.id===s.target.directionId),script=c.scripts.find(p=>p.directionId===s.target.directionId),segment=script?.segments.find(sg=>sg.id===s.target.segmentId),prompt=c.plans.find(p=>p.directionId===s.target.directionId)?.segments.find(sg=>sg.id===s.target.segmentId);
    const base={brief:{...c.brief,...(s.stage==='directions'&&d?{count:1}:{})},target:s.target,instruction:j.instruction};
    if(s.stage==='images')return {...base,materials:s.assetIds.map(assetId=>c.materials.find(m=>m.assetId===assetId))};
    if(s.stage==='analysis')return {...base,sources:sourcesFor(c),readings:c.readings};
    const facts={sources:sourcesFor(c).map(source=>({...source,text:source.text})),analysis:c.analysis?{...c.analysis,claims:c.analysis.claims.filter(x=>x.selected&&x.status==='supported')}:null};
    if(s.stage==='directions')return {...base,...facts,oldDirection:d,otherDirections:c.directions.map(x=>({title:x.title,audience:x.audience,hook:x.hook,difference:x.difference}))};
    if(s.stage==='scripts')return {...base,...facts,...(j.fullPipeline?{generationPolicy:generationPolicy(c)}:{}),direction:d,existing:s.target.segmentId?segment:script};
    return {...base,...facts,direction:d,materials:c.materials,scriptSegment:segment,adjacent:script?.segments.map(x=>({id:x.id,objective:x.objective,first:x.shots[0]?.visual,last:x.shots.at(-1)?.visual})),segment:s.stage==='audit'?(j.scope==='scripts'?segment:prompt):s.stage==='repair'?prompt:undefined,issues:s.stage==='repair'?inspectWorkbench(c,'prompts',s.target):undefined};
  }
  function result(j:WorkbenchRun,s:WorkbenchStep,raw:unknown){
    raw=normalizeWorkbenchResponseFields(raw,s.stage);
    const c=structuredClone(j.working),directionId=s.target.directionId,segmentId=s.target.segmentId;
    if(s.stage==='images'){const parsed=z.object({readings:z.array(imageReadingSchema).max(4)}).parse(raw);if(JSON.stringify(parsed.readings.map(r=>r.assetId).sort())!==JSON.stringify([...s.assetIds].sort()))throw Error('图片分析结果与本批素材编号不匹配');c.readings=[...c.readings.filter(r=>!s.assetIds.includes(r.assetId)),...parsed.readings];}
    if(s.stage==='analysis'){c.analysis=workbenchAnalysisSchema.parse(normalizeWorkbenchAnalysisFields(raw));c.stale=c.stale.filter(x=>x!=='analysis');c.stale.push('directions');}
    if(s.stage==='directions'){const ds=z.object({directions:z.array(directionSchema).min(1).max(6)}).parse(raw).directions;if(directionId){if(ds.length!==1||ds[0].id!==directionId)throw Error('AI 修改了指定方向之外的内容');c.directions=c.directions.map(d=>d.id===directionId?{...ds[0],selected:d.selected,primary:d.primary}:d);}
      else {if(ds.length!==c.brief.count)throw Error('返回方向数量与所选数量不符');c.directions=ds.map(d=>({...d,selected:j.fullPipeline?true:d.selected}));c.scripts=c.scripts.filter(p=>ds.some(d=>d.id===p.directionId));c.plans=c.plans.filter(p=>ds.some(d=>d.id===p.directionId));}c.stale=c.stale.filter(x=>x!=='directions');for(const d of ds)c.stale.push(`scripts:${d.id}`);}
    if(s.stage==='scripts'){
      const plan=scriptPlanSchema.parse(raw);if(j.fullPipeline){const policy=generationPolicy(c);if(plan.segments.length!==policy.segmentCount||Math.abs(plan.totalSeconds-policy.totalSeconds)>.02)throw Error('返回脚本的分段数量或时长与本轮计划不符，请继续当前步骤');}if(plan.segments.some(s=>s.duration>15))throw Error('通用脚本生成段不得超过 15 秒，请调整分段');if(plan.directionId!==directionId)throw Error('脚本不属于指定方向');
      if(segmentId){const old=c.scripts.find(p=>p.directionId===directionId),newSegment=plan.segments.find(x=>x.id===segmentId);if(!old||plan.segments.length!==1||!newSegment||newSegment.duration!==old.segments.find(x=>x.id===segmentId)?.duration)throw Error('局部脚本改变了指定段落或时长');old.segments=old.segments.map(x=>x.id===segmentId?newSegment:x);}
      else {if(c.brief.duration!==null&&Math.abs(plan.totalSeconds-c.brief.duration)>.02)throw Error('脚本全片时长与指定时长不符');c.scripts=[...c.scripts.filter(p=>p.directionId!==directionId),plan];}
      c.stale=c.stale.filter(x=>x!==`scripts:${directionId}`);for(const seg of plan.segments)c.stale.push(`prompts:${directionId}:${seg.id}`);
      const blockers=inspectWorkbench(c,'scripts',{directionId}).filter(x=>x.severity==='blocker');if(blockers.length)throw Error(blockers[0].message);
    }
    if(s.stage==='prompts'||s.stage==='repair'){
      const parsed=z.object({directionId:z.string(),segment:promptSegmentSchema}).parse(normalizePromptSegmentFields(raw)),script=c.scripts.find(p=>p.directionId===directionId),source=script?.segments.find(x=>x.id===segmentId),seg=parsed.segment;
      if(!source||parsed.directionId!==directionId||seg.id!==segmentId||seg.duration!==source.duration||JSON.stringify(seg.shots.map(x=>[x.id,x.start,x.end,x.speech]))!==JSON.stringify(source.shots.map(x=>[x.id,x.start,x.end,x.speech])))throw Error('提示词改变了已确认的镜头、台词或时间，原稿保留');
      if(s.stage==='repair'){const old=c.plans.find(p=>p.directionId===directionId)?.segments.find(sg=>sg.id===segmentId);if(!old||JSON.stringify(old.refs)!==JSON.stringify(seg.refs))throw Error('修正任务改变了素材身份，原稿保留');}
      const old=c.plans.find(p=>p.directionId===directionId),plan=old||{directionId:directionId!,totalSeconds:script!.totalSeconds,segments:[]};plan.totalSeconds=script!.totalSeconds;plan.segments=[...plan.segments.filter(x=>x.id!==segmentId),seg].sort((a,b)=>script!.segments.findIndex(x=>x.id===a.id)-script!.segments.findIndex(x=>x.id===b.id));c.plans=[...c.plans.filter(p=>p.directionId!==directionId),plan];c.stale=c.stale.filter(x=>x!==`prompts:${directionId}:${segmentId}`);
    }
    if(s.stage==='audit'){const parsed=issueOutputSchema.parse(raw);s.result=parsed.issues.map(x=>({...x,directionId,segmentId,path:`direction:${directionId}/segment:${segmentId}/${x.path}`}));}
    validate(c);c.stale=[...new Set(c.stale)];return c;
  }
  function finish(j:WorkbenchRun){const c=creation(j.creationId);if(j.cancelRequested){j.status='cancelled';j.error='后续步骤已停止；已提交调用的结果和费用继续保留。';persist(j);return;}
    if(['audit','repair'].includes(j.stage)||j.fullPipeline){
      const issues=[...inspectWorkbench(j.working,j.scope,j.target),...j.steps.flatMap(s=>s.stage==='audit'&&Array.isArray(s.result)?s.result as WorkbenchIssue[]:[])];
      if(contentFingerprint(c.content)!==contentFingerprint(j.working)){j.status='conflict';j.error='当前编辑已变化，检查结果不会标记新稿通过。';persist(j);return;}
      commitInTransaction(c);const review:WorkbenchReview={id:store.id('workbench-review'),scope:j.scope,complete:(j.stage==='audit'||!!j.fullPipeline)&&!j.target.directionId&&!j.target.segmentId,fingerprint:contentFingerprint(c.content),versionId:c.currentVersionId!,createdAt:stamp(),issues};store.put('workbench-review',review.id,review);j.issues=issues;
    }j.status='completed';persist(j);
  }
  async function advance(j:WorkbenchRun){
    try{
      const s=j.steps.find(s=>s.status!=='completed');if(!s){finish(j);return;}
      if(s.jobId){const a=analysis.job(s.jobId);if(['queued','preparing','submitting'].includes(a.status))return;if(a.status==='unknown'){j.status='unknown';j.error='提交结果待核实，不会重新发送付费请求。';persist(j);return;}if(a.status==='failed'){s.status='failed';s.error=a.error;j.status='failed';j.error=a.error||'辅助调用失败';persist(j);return;}
        if(a.status==='completed'){
          const candidate=result(j,s,parseWorkbenchResponse(a.result||'{}',s.stage));const c=creation(j.creationId);
          if(c.revision!==j.baseRevision){s.result=a.result;j.candidateStepId=s.id;j.status='conflict';j.error='任务期间内容已修改。候选结果已保留，请比较或恢复输入版本后继续。';persist(j);return;}
          store.transaction(()=>{j.working=candidate;if(s.stage!=='audit'){write(c,candidate,label(s));j.baseRevision=c.revision;j.baseVersionId=c.currentVersionId!;}s.status='completed';
            if(j.stage==='smart'&&s.stage==='directions')j.steps.push(...j.working.directions.filter(d=>d.selected).map(d=>step('scripts',{directionId:d.id})));
            if(j.fullPipeline&&s.stage==='scripts')j.steps.push(...j.working.scripts.find(p=>p.directionId===s.target.directionId)!.segments.map(seg=>step('prompts',{directionId:s.target.directionId,segmentId:seg.id})));
            if(j.fullPipeline&&s.stage==='prompts')j.steps.push(step('audit',s.target));
            if(s.stage==='analysis'&&j.working.analysis?.identityQuestion){j.status='paused';j.error=j.working.analysis.identityQuestion;}
            else j.status='running';j.updatedAt=stamp();store.put('workbench-run',j.id,j);});
          if(j.cancelRequested){j.status='cancelled';persist(j);}else if(j.steps.every(x=>x.status==='completed'))finish(j);return;
        }
      }
      if(j.cancelRequested){j.status='cancelled';persist(j);return;}
      const c=creation(j.creationId);if(c.revision!==j.baseRevision){j.status='conflict';j.error='输入已变化，后续步骤已停止；已完成成果保留。';persist(j);return;}
      const m=analysis.models().find(m=>m.id===j.modelId);if(!m||m.revision!==j.modelRevision||credentialVault(store.dataDir).current(j.modelId)!==j.credentialVersion||!m.enabled||!m.credentialConfigured){j.status='paused';j.error='辅助模型配置已变化，请确认后新建任务。';persist(j);return;}
      const input=JSON.stringify(context(j,s));if(input.length>16000)throw Error('本阶段输入超过 16000 字符，未截断资料或提交付费请求；请精简后重新开始');
      const q=await analysis.estimate(j.modelId),held=j.steps.flatMap(x=>[...(x.attempts||[]),...(x.jobId?[{jobId:x.jobId,reserved:x.reserved||0}]:[])]).reduce((sum,x)=>{const a=analysis.job(x.jobId);return sum+Math.max(x.reserved,a.billing.cost||0);},0);
      if(q.estimated+held>j.maximumCost+1e-9){j.status='paused';j.error='预算不足以继续下一步，已有内容保留。';persist(j);return;}
      if(run(j.id).cancelRequested)return;
      store.transaction(()=>{const current=creation(j.creationId);if(current.revision!==j.baseRevision)fail('当前内容已变化，未提交下一步',409);if(credentialVault(store.dataDir).current(j.modelId)!==j.credentialVersion||analysis.models().find(m=>m.id===j.modelId)?.revision!==j.modelRevision)fail('模型配置已变化，未提交下一步',409);const a=analysis.submit({action:`workbench-${s.stage}` as AnalysisInput['action'],modelId:j.modelId,maximumCost:q.estimated,text:input,productName:j.working.brief.name,skillId:`prompt-workbench:${j.creationId}`,assetIds:s.assetIds,idempotencyKey:`${j.id}:${s.id}:${s.attempts?.length||0}`},true);s.jobId=a.id;s.reserved=q.estimated;s.status='running';j.status='running';j.updatedAt=stamp();store.put('workbench-run',j.id,j);});
    }catch(e){const s=j.steps.find(s=>s.status!=='completed');if(s){s.status='failed';s.error=(e as Error).message;}j.status='failed';j.error=(e as Error).message;persist(j);}
  }
  let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined,stopping=false;
  function tick(){if(stopping||pending)return;for(const j of store.list<WorkbenchRun>('workbench-run').filter(j=>j.status==='unknown')){const s=j.steps.find(s=>s.status!=='completed');if(s?.jobId&&['completed','failed'].includes(analysis.job(s.jobId).status)){j.status='running';persist(j);}}
    const j=store.list<WorkbenchRun>('workbench-run').filter(j=>['queued','running'].includes(j.status)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(j)pending=store.withWorkspace(j.workspaceId||store.workspaceOf('workbench-run',j.id)||store.currentWorkspace(),()=>advance(j)).finally(()=>{pending=undefined;});}
  function cancel(id:string){const j=run(id);if(!['queued','running','unknown','paused','conflict','failed'].includes(j.status))return j;j.cancelRequested=true;const active=j.steps.find(s=>s.jobId&&s.status!=='completed');if(active?.jobId){const a=analysis.job(active.jobId);if(a.status==='queued'){store.transaction(()=>store.put('analysis-job',a.id,{...a,status:'failed',error:'用户停止尚未提交的工作台调用'}));j.status='cancelled';}else if(['preparing','submitting','unknown'].includes(a.status)){j.status=a.status==='unknown'?'unknown':'running';j.error='已停止后续步骤；当前已开始的调用仍需核实结果与费用。';}else j.status='cancelled';}else j.status='cancelled';persist(j);return j;}
  async function resume(id:string,maximumCost:number){
    const j=run(id);if(!['paused','failed'].includes(j.status))fail('仅暂停或明确失败的任务可以继续；接单待核实的调用不会重发');
    if(runs(j.creationId).some(other=>other.id!==j.id&&['queued','running','unknown','conflict'].includes(other.status)))fail('已有其他任务运行，请先处理',409);
    const c=creation(j.creationId);if(c.revision!==j.baseRevision)fail('输入已变化，请用新内容重新开始',409);
    const m=model();if(m.id!==j.modelId||m.revision!==j.modelRevision||credentialVault(store.dataDir).current(j.modelId)!==j.credentialVersion)fail('模型配置已变化，请重新开始');
    if(j.working.analysis?.identityQuestion)fail('请先补充商品身份，再重新分析');
    const q=await analysis.estimate(j.modelId);if(maximumCost<j.maximumCost||maximumCost<q.estimated)fail('新预算不能低于已确认预算或下一步估算');
    const s=j.steps.find(s=>s.status!=='completed');
    if(j.status==='failed'&&s?.jobId){const a=analysis.job(s.jobId);if(!['failed','completed'].includes(a.status))fail('当前调用仍待核实，不会重新发送付费请求');let reusable=false;if(a.status==='completed'){try{result(j,structuredClone(s),parseWorkbenchResponse(a.result||'{}',s.stage));reusable=true;}catch{/* Retry only after the user explicitly confirms this failed step. */}}if(!reusable){s.attempts=[...(s.attempts||[]),{jobId:s.jobId,reserved:s.reserved||0}];delete s.jobId;delete s.reserved;delete s.result;}}
    if(s){s.status='pending';delete s.error;}j.maximumCost=maximumCost;j.status='queued';delete j.error;persist(j);return j;
  }
  function restore(id:string,versionId:string,revision:number){const c=creation(id),v=store.get<WorkbenchVersion>('workbench-version',versionId)||fail('版本不存在',404);if(c.revision!==revision||v.creationId!==id)fail('版本不匹配或内容已更新',409);return store.transaction(()=>write(c,v.content,`恢复版本 ${v.number}`));}
  function applyCandidate(id:string,revision:number){const j=run(id),c=creation(j.creationId);if(j.status!=='conflict'||!j.candidateStepId)fail('没有可应用的候选结果');if(c.revision!==revision)fail('当前编辑已变化',409);const s=j.steps.find(s=>s.id===j.candidateStepId)!;
    // Applying a result is only safe against the same input; restoring that input is explicit in the UI.
    if(contentFingerprint(c.content)!==contentFingerprint(j.working))fail('候选结果依据的是任务输入版本。请先恢复相应输入版本，或保留新稿重新发起。',409);
    j.baseRevision=c.revision;j.status='running';delete j.error;delete j.candidateStepId;persist(j);return j;
  }
  function reviewFor(c:WorkbenchCreation,scope:'scripts'|'prompts'){const fp=contentFingerprint(c.content);return store.list<WorkbenchReview>('workbench-review').find(r=>r.complete&&r.scope===scope&&r.fingerprint===fp&&versions(c.id).some(v=>v.id===r.versionId));}
  function exported(id:string,b:{scope:'scripts'|'prompts';directionId?:string;segmentId?:string;whole:boolean;notes:boolean;draft:boolean;format:'md'|'txt'|'json'}){const c=creation(id);if(!b.draft){const review=reviewFor(c,b.scope),issues=[...inspectWorkbench(c.content,b.scope),...review?.issues||[]];if(!review||issues.some(x=>x.severity==='blocker'))fail('请先检查当前版本并处理阻塞问题');}
    const prefix=b.draft?'【草稿 · 未完成当前版本检查】\n\n':'';return {text:b.format==='json'?JSON.stringify({schemaVersion:1,project:project(c.projectId),creation:c,draft:b.draft},null,2):prefix+exportWorkbench(c.content,b.scope,b.directionId,b.segmentId,b.whole,b.notes),filename:`提示词工作台-${b.draft?'草稿':'交付'}.${b.format}`};}
  function toTemplate(id:string,directionId:string){const c=creation(id),p=c.content.plans.find(p=>p.directionId===directionId),d=c.content.directions.find(d=>d.id===directionId);if(!p||!d?.selected)fail('请选择已完成提示词的方向');exported(id,{scope:'prompts',draft:false,format:'md',notes:false,whole:true});commitInTransaction(c);const prompt=exportWorkbench(c.content,'prompts',directionId,undefined,true),script=exportWorkbench(c.content,'scripts',directionId);if(prompt.length>16000||script.length>16000)fail('整套内容超过模板长度上限，请使用分段文件导出');return savePrompt(store,{...emptyPrompt('video-storyboard','video'),name:`${c.content.brief.name} · ${d.title}`.slice(0,100),prompt,script,referenceIds:[...new Set(p.segments.flatMap(s=>s.refs.flatMap(r=>r.assetId?[r.assetId]:[])))],settings:{aspectRatio:c.content.brief.aspectRatio,parameters:{}},source:{kind:'workbench',id:c.id,versionId:c.currentVersionId}});}
  function handoff(id:string,b:{revision:number;directionId:string;segmentId:string;modelId:string;draftRevision:number}){const c=creation(id);if(c.revision!==b.revision)fail('内容已变化，请重新检查',409);exported(id,{scope:'prompts',draft:false,format:'md',notes:false,whole:false});if(!c.content.directions.some(d=>d.id===b.directionId&&d.selected))fail('请选择已选用的内容方向');const segment=c.content.plans.find(p=>p.directionId===b.directionId)?.segments.find(s=>s.id===b.segmentId)||fail('段落不存在');const m=store.models().find(m=>m.id===b.modelId)||fail('视频模型不存在');const model={...m,enabled:m.enabled&&relayModelAvailable(store,m.id)!==false,credentialConfigured:!!credentialVault(store.dataDir).current(m.id)},compat=workbenchCompatibility(c.content,segment,model,b.directionId);if(compat.errors.length)fail(compat.errors.join('；'));const skill=store.skills().find(s=>s.id==='video-generate')||fail('视频生成入口不存在');const old=store.readDraft(skill.id);if(old.revision!==b.draftRevision)fail('视频草稿已变化，请重新确认替换',409);commitInTransaction(c);const draft={...defaultDraft(skill,store.models()),modelId:m.id,duration:segment.duration,aspectRatio:c.content.brief.aspectRatio,count:1,parameters:Object.fromEntries(Object.entries(m.parameters).map(([key,f])=>[key,f.default??''])),requirements:exportWorkbench(c.content,'prompts',b.directionId,b.segmentId),inputRoles:{references:compat.assetIds},workbenchSource:{projectId:c.projectId,creationId:c.id,versionId:c.currentVersionId!,directionId:b.directionId,segmentId:b.segmentId}};return store.transaction(()=>{backupDraft(c.id,old);return store.saveDraft(skill.id,draft,b.draftRevision);});}
  function backupDraft(creationId:string,draft:ReturnType<Store['readDraft']>){const backup:WorkbenchDraftBackup={id:store.id('workbench-draft-backup'),creationId,savedAt:stamp(),draft};store.put('workbench-draft-backup',backup.id,backup);}
  function restoreDraft(id:string,backupId:string,draftRevision:number){creation(id);const backup=store.get<WorkbenchDraftBackup>('workbench-draft-backup',backupId)||fail('草稿备份不存在',404);if(backup.creationId!==id)fail('备份不属于本次创作',409);return store.transaction(()=>{const current=store.readDraft('video-generate');if(current.revision!==draftRevision)fail('视频草稿已变化，请重新确认',409);backupDraft(id,current);return store.saveDraft('video-generate',backup.draft.value,draftRevision);});}
  return {project,creation,create,detail,patch,bindReference,saveFrames,commit,addCreation,estimate,start,run,restore,applyCandidate,cancel,resume,exported,toTemplate,handoff,restoreDraft,tick,async idle(){await pending;},startWorker(){timer=setInterval(tick,600);},async stop(){stopping=true;clearInterval(timer);await pending;}};
}
export function registerWorkbenchRoutes(app:FastifyInstance,store:Store,analysis:AnalysisService,enabled=true){
  const service=createWorkbenchService(store,analysis),id=(p:unknown)=>z.object({id:z.string()}).parse(p).id;
  app.get('/api/prompt-workbench/projects',async r=>{const {search}=z.object({search:z.string().max(200).default('')}).parse(r.query);return store.list<WorkbenchProject>('workbench-project').filter(p=>!p.archived&&p.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=>{const cs=store.list<WorkbenchCreation>('workbench-creation').filter(c=>c.projectId===p.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));const c=cs[0];return {...p,creationId:c?.id,count:cs.length,stage:c?.content.plans.length?'提示词已生成':c?.content.scripts.length?'脚本已生成':c?.content.directions.length?'方向已生成':c?.content.analysis?'卖点已分析':'准备资料',image:c?.content.materials[0]?store.get<Asset>('asset',c.content.materials[0].assetId)?.url:undefined};});});
  app.post('/api/prompt-workbench/projects',async r=>service.create(z.object({name:z.string().trim().min(1).max(200),catalogProductId:z.string().optional()}).parse(r.body)));
  app.get('/api/prompt-workbench/creations/:id',async r=>service.detail(id(r.params)));
  app.post('/api/prompt-workbench/creations/:id/new',async r=>service.addCreation(id(r.params),z.object({title:z.string().trim().min(1).max(100)}).parse(r.body).title));
  app.patch('/api/prompt-workbench/creations/:id',async r=>{const b=z.object({revision:z.number().int(),content:workbenchContentSchema}).parse(r.body);return service.patch(id(r.params),b.revision,b.content);});
  app.post('/api/prompt-workbench/creations/:id/reference',async r=>service.bindReference(id(r.params),z.object({revision:z.number().int().positive(),directionId:z.string().min(1).max(120),segmentId:z.string().min(1).max(120),key:z.string().min(1).max(120),assetId:z.string().min(1).max(120),replaceAssetId:z.string().min(1).max(120).optional()}).parse(r.body)));
  app.post('/api/prompt-workbench/creations/:id/frames',async r=>{const b=z.object({revision:z.number().int().positive(),frames:workbenchFramesSchema.omit({scriptFingerprint:true})}).parse(r.body);return service.saveFrames(id(r.params),b.revision,b.frames);});
  app.post('/api/prompt-workbench/creations/:id/commit',async r=>service.commit(id(r.params),z.object({revision:z.number().int()}).parse(r.body).revision));
  app.post('/api/prompt-workbench/creations/:id/estimate',async r=>service.estimate(id(r.params),workbenchRequestSchema.parse(r.body)));
  app.post('/api/prompt-workbench/creations/:id/jobs',async r=>service.start(id(r.params),r.body));
  app.post('/api/prompt-workbench/creations/:id/restore',async r=>{const b=z.object({revision:z.number().int(),versionId:z.string()}).parse(r.body);return service.restore(id(r.params),b.versionId,b.revision);});
  app.post('/api/prompt-workbench/runs/:id/candidate',async r=>service.applyCandidate(id(r.params),z.object({revision:z.number().int()}).parse(r.body).revision));
  app.post('/api/prompt-workbench/runs/:id/cancel',async r=>service.cancel(id(r.params)));
  app.post('/api/prompt-workbench/runs/:id/resume',async r=>service.resume(id(r.params),z.object({maximumCost:z.number().finite().positive()}).parse(r.body).maximumCost));
  app.post('/api/prompt-workbench/creations/:id/export',async r=>service.exported(id(r.params),z.object({scope:z.enum(['scripts','prompts']),directionId:z.string().optional(),segmentId:z.string().optional(),whole:z.boolean().default(false),notes:z.boolean().default(false),draft:z.boolean().default(false),format:z.enum(['md','txt','json']).default('md')}).parse(r.body)));
  app.post('/api/prompt-workbench/creations/:id/template',async r=>service.toTemplate(id(r.params),z.object({directionId:z.string()}).parse(r.body).directionId));
  app.post('/api/prompt-workbench/creations/:id/handoff',async r=>service.handoff(id(r.params),z.object({revision:z.number().int(),directionId:z.string(),segmentId:z.string(),modelId:z.string(),draftRevision:z.number().int()}).parse(r.body)));
  app.post('/api/prompt-workbench/creations/:id/restore-draft',async r=>{const b=z.object({backupId:z.string(),draftRevision:z.number().int()}).parse(r.body);return service.restoreDraft(id(r.params),b.backupId,b.draftRevision);});
  if(enabled)service.startWorker();app.addHook('onClose',async()=>service.stop());return service;
}
