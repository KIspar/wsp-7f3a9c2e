import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store';
import { fail } from './errors';
import type { Asset, Attempt, Batch } from '../../packages/contracts';
import type { PromotionVersion, PromotionWork } from '../../packages/promotion';
import type { VideoRemakeJob } from '../../packages/video-remake';
import { emptyPrompt, expandPrompt, promptTemplateInputSchema, promptSourceSchema, promptKinds, promptCategory, type PromptTemplateInput, type PromptTemplate, type PromptVersion, type PromptDetail, type PromptSource } from '../../packages/prompts';
import {exportWorkbench,type WorkbenchCreation,type WorkbenchVersion} from '../../packages/prompt-workbench';

const current = (store: Store, id: string) => store.get<PromptTemplate>('prompt-template', id) || fail('提示词模板不存在', 404);
function version(store: Store, t: PromptTemplate, id = t.currentVersionId) {
  const v = store.get<PromptVersion>('prompt-version', id) || fail('模板内容不存在', 404);
  if (v.templateId !== t.id) fail('内容不属于当前模板');
  return v;
}
function assetsFor(store: Store, values: PromptTemplateInput[]) {
  return [...new Set(values.flatMap(v => [...v.exampleIds, ...v.referenceIds]))].map(id => store.get<Asset>('asset', id)).filter((a): a is Asset => !!a);
}
function validateMedia(store: Store, value: PromptTemplateInput) {
  for (const id of [...value.exampleIds, ...value.referenceIds]) {
    const a = store.get<Asset>('asset', id) || fail('素材不存在，请重新选择');
    if (!['image', 'video'].includes(a.type)) fail('模板仅支持图片和视频素材');
    if (['example', 'simulator'].includes(a.source)) fail('不能使用模拟或原型素材作为模板示例');
    if (value.referenceIds.includes(id) && promptCategory(value) !== 'video' && a.type !== 'image') fail('图片模板的参考素材必须是图片');
  }
}
export function capturePrompt(store: Store, source: PromptSource): PromptTemplateInput {
  let value = emptyPrompt(); value.source = source;
  if (source.kind === 'attempt') {
    const a = store.get<Attempt>('attempt', source.id || '') || fail('生成记录不存在', 404);
    const b = store.readBatch(a.batchId) || fail('任务不存在', 404);
    if (a.status !== 'completed' || !a.assetId || a.simulated) fail('请选择已完成的真实生成结果');
    value = { ...value, name: `${b.skillName} · ${a.index}`, kind: a.model.category === 'image' ? 'image' : 'video-first-frame', prompt: b.draft.requirements || a.prompt,
      exampleIds: [a.assetId], settings: { modelId: a.model.id, aspectRatio: b.draft.aspectRatio, ...(a.model.category === 'video' ? { duration: b.draft.duration } : {}), parameters: b.draft.parameters } };
  } else if (source.kind === 'promotion') {
    const w = store.get<PromotionWork>('promotion-work', source.id || '') || fail('作品不存在', 404);
    const v = store.get<PromotionVersion>('promotion-version', source.versionId || w.confirmedVersionId || '') || fail('请先完成作品生成', 404);
    if (v.workId !== w.id) fail('作品内容不匹配');
    if (v.value.videoWorkflow === 'shot-remake' && v.value.remakeJobId) return capturePrompt(store, {kind:'remake',id:v.value.remakeJobId,versionId:v.value.remakeCompositionId});
    const media = v.value.outputKeys.map(key => v.media[key] || v.batchIds.flatMap(id => store.readBatch(id)?.attempts.filter(a => a.status === 'completed' && !a.simulated && a.assetId && store.readBatch(id)?.creativeContext?.outputKeys[a.index - 1] === key) || []).sort((a, b) => b.attemptNumber - a.attemptNumber)[0]?.assetId).filter((id): id is string => !!id);
    if (!media.length) fail('当前还没有可用成品');
    const g = v.value.generation;
    value = { ...value, name: w.name.slice(0, 100), category: w.type === 'post' ? 'post' : 'video', kind: w.type === 'post' ? v.value.postMode === 'replicate' ? 'image-replica' : 'image' : v.value.script ? 'video-storyboard' : 'video-first-frame',
      prompt: [g.requirements,w.type==='post'&&v.value.imageNoText?'图片不加文字，不添加标题、字幕、卖点字、标签或水印。':''].filter(Boolean).join('\n'), script: v.value.script, exampleIds: media.slice(0, 8), replacementObject: v.value.replacementObject || '',
      pages: w.type === 'post' ? v.value.outputKeys.map((k, i) => ({ title: i === 0 ? '封面' : `内容页 ${i + 1}`, prompt: v.value.pageRequirements[k] || '' })) : [],
      referenceIds: w.type === 'post' && v.value.postMode === 'replicate' ? v.value.benchmarkImages : [],
      settings: { modelId: g.modelId, aspectRatio: g.aspectRatio, ...(w.type === 'video' ? { duration: g.duration } : {}), parameters: g.parameters }, source: { ...source, versionId: v.id } };
  } else if (source.kind === 'remake') {
    const j = store.get<VideoRemakeJob>('video-remake', source.id || '') || fail('分镜任务不存在', 404);
    const comp = source.versionId ? j.compositions.find(c => c.id === source.versionId) || fail('成片不存在', 404) : undefined;
    value = { ...value, name: `${j.productTitle} · 分镜复刻`.slice(0, 100), kind: 'video-remake', prompt: (comp?.input || j.input).requirements, replacementObject: (comp?.input || j.input).replacementObject,
      exampleIds: comp ? [comp.assetId] : [], referenceIds: [(comp?.input || j.input).sourceVideoId], settings: { aspectRatio: j.input.aspectRatio, parameters: { resolution: j.input.resolution } },
      shots: (comp?.shots || j.shots).map((s, i) => ({ title: `镜头 ${i + 1}`, duration: Math.round((s.end - s.start) * 1000) / 1000, scene: s.text.scene, person:s.text.person, replacement:s.text.replacement, action: s.text.action, camera: s.text.camera, dialogue: s.transcript, framePrompt: s.text.framePrompt, prompt: s.text.videoPrompt })) };
  } else if(source.kind==='workbench'){
    const c=store.get<WorkbenchCreation>('workbench-creation',source.id||'')||fail('工作台创作不存在',404);
    const v=store.get<WorkbenchVersion>('workbench-version',source.versionId||'')||fail('工作台版本不存在',404);
    if(v.creationId!==c.id)fail('工作台来源版本不匹配');
    value={...value,name:v.content.brief.name.slice(0,100),kind:'video-storyboard',category:'video',prompt:exportWorkbench(v.content,'prompts'),source};
  } else if (source.kind !== 'manual') fail('来源类型不支持');
  return { ...value, category: promptCategory(value) };
}
export function promptDetail(store: Store, id: string): PromptDetail {
  const t = current(store, id), versions = store.list<PromptVersion>('prompt-version').filter(v => v.templateId === id).sort((a, b) => b.number - a.number);
  return { template: t, version: version(store, t), versions, assets: assetsFor(store, versions.map(v => v.value)) };
}
export function savePrompt(store: Store, value: PromptTemplateInput, id?: string, revision?: number, key?: string) {
  value = promptTemplateInputSchema.parse({ ...value, category: promptCategory(value) });
  validateMedia(store, value);
  if (value.source.kind !== 'manual') capturePrompt(store, value.source); // Verify provenance; never trust arbitrary source links.
  return store.transaction(() => {
    const old = id ? current(store, id) : undefined;
    if (old && old.revision !== revision) fail('模板已更新，当前编辑已保留，请重新读取', 409);
    if (old?.archived) fail('请先恢复已归档模板');
    const stamp = new Date().toISOString(), templateId = old?.id || store.id('prompt');
    const v: PromptVersion = { id: store.id('prompt-version'), templateId, number: old ? version(store, old).number + 1 : 1, createdAt: stamp, value };
    const t: PromptTemplate = { id: templateId, revision: (old?.revision || 0) + 1, currentVersionId: v.id, createdAt: old?.createdAt || stamp, updatedAt: stamp, archived: false };
    store.put('prompt-template', t.id, t); store.put('prompt-version', v.id, v);
    if(key) store.put('prompt-save',key,{fingerprint:JSON.stringify(value),id:t.id,versionId:v.id});
    return { template: t, version: v };
  });
}
export function registerPromptRoutes(app: FastifyInstance, store: Store) {
  app.get('/api/prompt-templates', async r => {
    const q = z.object({ search: z.string().max(200).default(''), kind: z.enum([...promptKinds, 'all']).default('all'), category: z.enum(['all', 'post', 'image', 'video']).default('all'), kinds: z.string().max(200).default(''), categories: z.string().max(100).default(''), tag: z.string().max(30).default(''), archived: z.enum(['true', 'false']).default('false'), page: z.coerce.number().int().min(1).default(1) }).parse(r.query);
    const all = store.list<PromptTemplate>('prompt-template').filter(t => t.archived === (q.archived === 'true')).map(t => ({ template: t, version: version(store, t) }));
    const compatible = q.kinds ? q.kinds.split(',').map(k=>z.enum(promptKinds).parse(k)) : undefined;
    const categories = q.categories ? q.categories.split(',').map(c => z.enum(['post', 'image', 'video']).parse(c)) : undefined;
    const filtered = all.filter(e => (!categories || categories.includes(promptCategory(e.version.value))) && (!compatible || compatible.includes(e.version.value.kind)) && (q.kind === 'all' || e.version.value.kind === q.kind) && (q.category === 'all' || promptCategory(e.version.value) === q.category) && (!q.tag || e.version.value.tags.includes(q.tag)) && `${e.version.value.name} ${e.version.value.description} ${e.version.value.prompt} ${e.version.value.script} ${e.version.value.tags.join(' ')}`.toLowerCase().includes(q.search.toLowerCase())).sort((a, b) => b.template.updatedAt.localeCompare(a.template.updatedAt) || b.template.id.localeCompare(a.template.id));
    const items = filtered.slice((q.page - 1) * 20, q.page * 20);
    return { items, total: filtered.length, page: q.page, tags: [...new Set(all.flatMap(e => e.version.value.tags))].sort(), assets: assetsFor(store, items.map(e => e.version.value)) };
  });
  app.post('/api/prompt-templates/capture', async r => { const value = capturePrompt(store, promptSourceSchema.parse(r.body)); return { value, assets: assetsFor(store, [value]) }; });
  app.get<{ Params: { id: string } }>('/api/prompt-templates/:id', async r => promptDetail(store, r.params.id));
  app.post('/api/prompt-templates', async r => {
    const b = z.object({ value: promptTemplateInputSchema, key: z.string().min(8).max(120) }).parse(r.body);
    b.value = promptTemplateInputSchema.parse({ ...b.value, category: promptCategory(b.value) });
    const before = store.get<{ fingerprint: string; id: string; versionId: string }>('prompt-save', b.key), fingerprint = JSON.stringify(b.value);
    if (before) {
      const old = promptTemplateInputSchema.parse(JSON.parse(before.fingerprint));
      const normalized = promptTemplateInputSchema.parse({ ...old, category: promptCategory(old) });
      if (JSON.stringify(normalized) !== fingerprint) fail('保存凭据已用于另一份内容', 409);
      return {template:current(store,before.id),version:version(store,current(store,before.id),before.versionId)};
    }
    // All writes are synchronous; no paid or remote operations occur in this route.
    const result = savePrompt(store, b.value,undefined,undefined,b.key);
    return result;
  });
  app.put<{ Params: { id: string } }>('/api/prompt-templates/:id', async r => { const b = z.object({ value: promptTemplateInputSchema, revision: z.number().int().positive() }).parse(r.body); return savePrompt(store, b.value, r.params.id, b.revision); });
  app.patch<{ Params: { id: string } }>('/api/prompt-templates/:id', async r => {
    const b = z.object({ revision: z.number().int().positive(), archived: z.boolean() }).parse(r.body);
    return store.transaction(() => { const t = current(store, r.params.id); if (t.revision !== b.revision) fail('模板已更新，请刷新后重试', 409); const next = { ...t, revision: t.revision + 1, updatedAt: new Date().toISOString(), archived: b.archived }; store.put('prompt-template', t.id, next); return next; });
  });
  app.post<{ Params: { id: string } }>('/api/prompt-templates/:id/render', async r => {
    const b = z.object({ versionId: z.string(), variables: z.record(z.string().max(50), z.string().max(8000)).default({}) }).parse(r.body);
    const t = current(store, r.params.id); if (t.archived) fail('请先恢复已归档模板');
    const v = version(store, t, b.versionId); let value: PromptTemplateInput;
    try { value = expandPrompt(v.value, b.variables); } catch (e) { fail((e as Error).message); }
    validateMedia(store, value);
    return { value, template: { id: t.id, versionId: v.id, versionNumber:v.number, name: v.value.name, appliedAt: new Date().toISOString() }, variables: b.variables };
  });
}
