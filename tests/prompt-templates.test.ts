import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, type Store } from '../apps/server/store';
import { createApp } from '../apps/server/app';
import { capturePrompt, savePrompt, promptDetail } from '../apps/server/prompts';
import { emptyPrompt, promptCategory, promptTemplateInputSchema, expandPrompt, promptVariables, promptScript, type AppliedPrompt } from '../packages/prompts';
import { defaultDraft, draftSchema, type Asset, type Attempt, type Batch } from '../packages/contracts';
import { promotionValueSchema } from '../packages/promotion';
import { applyPromotionTemplate, applySkillTemplate, mergePrompt, requestedTemplateVersion, skillTemplateDestination, skillTemplateKinds } from '../src/lib/prompt-templates';
import {expandPostPages} from '../packages/post-plan';
import { remakeInputSchema } from '../packages/video-remake';

let store: Store, dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-library-test-')); store = createStore(dir, process.cwd()); });
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
function asset(id: string, type: Asset['type'] = 'image', source: Asset['source'] = 'upload') { const a: Asset = { id, type, source, mime: type === 'video' ? 'video/mp4' : 'image/jpeg', url: `/media/${id}.jpg`, bytes: 100, createdAt: new Date().toISOString() }; store.put('asset', id, a); return a; }
function value() { return { ...emptyPrompt(), name: '夜景穿搭', prompt: '展示 {{商品名称}}，置于 {{场景}}。', exampleIds: [] as string[] }; }
function applied(kind: AppliedPrompt['value']['kind'] = 'image'): AppliedPrompt { return { value: { ...emptyPrompt(kind), name: '模板', prompt: '商品创意' }, template: { id: 'template', versionId: 'immutable-1', name: '模板', appliedAt: new Date().toISOString() }, variables: {} }; }
async function app() { const transport = vi.fn(async () => { throw Error('本测试禁止供应商调用'); }); const a = await createApp(store, { worker: false, providerTransport: transport }); const boot = await a.inject('/api/bootstrap'); const headers = { 'x-studio-token': boot.json().token }; return { a, headers, transport }; }

describe('模板中心持久化与接口', () => {
  it('separates whole-post, single-image and video templates while reading immutable legacy versions', async () => {
    const legacy = savePrompt(store, { ...value(), pages:[{title:'封面',prompt:'街头上身'},{title:'细节',prompt:'领口特写'}] });
    const legacyValue = { ...legacy.version.value }; delete legacyValue.category;
    store.put('prompt-version',legacy.version.id,{...legacy.version,value:legacyValue});
    const snapshot = JSON.stringify(store.get('prompt-version',legacy.version.id));
    savePrompt(store,{...value(),name:'单图',category:'image'});
    savePrompt(store,{...emptyPrompt('video-storyboard'),name:'视频',prompt:'运镜脚本'});
    const {a,headers,transport}=await app();
    try {
      const posts=(await a.inject('/api/prompt-templates?category=post')).json();
      expect(posts.total).toBe(1); expect(posts.items[0].template.id).toBe(legacy.template.id);
      expect((await a.inject('/api/prompt-templates?category=image')).json().total).toBe(21);
      expect((await a.inject('/api/prompt-templates?categories=post&kinds=image,image-replica')).json().total).toBe(1);
      expect((await a.inject('/api/prompt-templates?category=video')).json().total).toBe(1);
      const render=await a.inject({method:'POST',url:`/api/prompt-templates/${legacy.template.id}/render`,headers,payload:{versionId:legacy.version.id,variables:{商品名称:'卫衣',场景:'街头'}}});
      expect(render.statusCode).toBe(200);expect(promptCategory(render.json().value)).toBe('post');
      expect(JSON.stringify(store.get('prompt-version',legacy.version.id))).toBe(snapshot);
      expect(transport).not.toHaveBeenCalled();
    }finally {await a.close();}
    expect(promptTemplateInputSchema.safeParse({...value(),category:'image',pages:[{title:'封面',prompt:'内容'}]}).success).toBe(false);
    expect(promptTemplateInputSchema.safeParse({...emptyPrompt('video-storyboard'),name:'视频误带图文页',category:'video',pages:[{title:'封面',prompt:'内容'}]}).success).toBe(false);
    expect(promptTemplateInputSchema.safeParse({...value(),category:'post',kind:'video-first-frame'}).success).toBe(false);
    const skill=store.skills().find(s=>s.id==='image-generate')!;
    expect(()=>applySkillTemplate(defaultDraft(skill,store.models()),{...applied(),value:{...legacyValue}}, {mode:'append',references:false,settings:false},skill,store.models())).toThrow('图文模板');
  });

  it('creates, searches and filters compatible kinds, idempotently saves without paid calls', async () => {
    const { a, headers, transport } = await app();
    try {
      const payload = { value: { ...value(), tags: ['男装', '穿搭'] }, key: 'save-stable-key' };
      const first = await a.inject({ method: 'POST', url: '/api/prompt-templates', headers, payload });
      expect(first.statusCode).toBe(200);
      const retry = await a.inject({ method: 'POST', url: '/api/prompt-templates', headers, payload });
      expect(retry.json().version.id).toBe(first.json().version.id);
      const conflict = await a.inject({ method: 'POST', url: '/api/prompt-templates', headers, payload: { ...payload, value: { ...payload.value, name: '其他' } } });
      expect(conflict.statusCode).toBe(409);
      const list = await a.inject('/api/prompt-templates?search=夜景&category=image&tag=男装&kinds=image');
      expect(list.json().total).toBe(1);
      expect((await a.inject('/api/prompt-templates?category=video')).json().total).toBe(0);
      expect((await a.inject('/api/prompt-templates?kinds=invalid')).statusCode).toBe(400);
      expect(transport).not.toHaveBeenCalled();
      expect(store.list('batch')).toHaveLength(0);
    } finally { await a.close(); }
  });
  it('keeps immutable versions, rejects stale writes, restores archives and survives restart', async () => {
    const first = savePrompt(store, value()), before = JSON.stringify(first.version);
    const second = savePrompt(store, { ...value(), prompt: '新版内容' }, first.template.id, 1);
    expect(second.version.number).toBe(2); expect(JSON.stringify(store.get('prompt-version', first.version.id))).toBe(before);
    expect(() => savePrompt(store, value(), first.template.id, 1)).toThrow('已更新');
    const { a, headers } = await app();
    try {
      const patch = (revision: number, archived: boolean) => a.inject({ method: 'PATCH', url: `/api/prompt-templates/${first.template.id}`, headers, payload: { revision, archived } });
      expect((await patch(2, true)).statusCode).toBe(200);
      expect((await a.inject('/api/prompt-templates?kinds=image')).json().total).toBe(0);
      expect((await a.inject('/api/prompt-templates?archived=true')).json().total).toBe(1);
      expect((await a.inject({ method: 'POST', url: `/api/prompt-templates/${first.template.id}/render`, headers, payload: { versionId: second.version.id } })).statusCode).toBe(400);
      expect((await patch(3, false)).statusCode).toBe(200);
    } finally { await a.close(); }
    store.close(); store = createStore(dir, process.cwd());
    expect(promptDetail(store, first.template.id).versions).toHaveLength(2);
    expect(promptDetail(store, first.template.id).template.archived).toBe(false);
  });
  it('renders a specific historical version, requires variables, and does not add examples to references', async () => {
    asset('example-photo'); const first = savePrompt(store, { ...value(), exampleIds: ['example-photo'] });
    savePrompt(store, { ...value(), prompt: '新版' }, first.template.id, 1);
    const other = savePrompt(store, { ...value(), name: '其他模板' }); const { a, headers, transport } = await app();
    try {
      const render = (versionId: string, variables: Record<string, string>) => a.inject({ method: 'POST', url: `/api/prompt-templates/${first.template.id}/render`, headers, payload: { versionId, variables } });
      expect((await render(first.version.id, {})).statusCode).toBe(400);
      expect((await render(other.version.id, {})).statusCode).toBe(400);
      const expanded = (await render(first.version.id, { 商品名称: '亨利领卫衣', 场景: '停车场' })).json();
      expect(expanded.value.prompt).toBe('展示 亨利领卫衣，置于 停车场。');
      expect(expanded.template.versionId).toBe(first.version.id); expect(expanded.value.referenceIds).toEqual([]);
      expect(expanded.value.exampleIds).toEqual(['example-photo']); expect(transport).not.toHaveBeenCalled();
    } finally { await a.close(); }
  });
  it('rejects missing assets, audio and simulated media and verifies capture provenance', () => {
    expect(() => savePrompt(store, { ...value(), exampleIds: ['missing'] })).toThrow('素材不存在');
    asset('audio', 'audio'); expect(() => savePrompt(store, { ...value(), exampleIds: ['audio'] })).toThrow('仅支持');
    asset('fake', 'image', 'simulator'); expect(() => savePrompt(store, { ...value(), exampleIds: ['fake'] })).toThrow('模拟');
    expect(() => savePrompt(store, { ...value(), source: { kind: 'promotion', id: 'forged' } })).toThrow('作品不存在');
  });
  it('captures completed real attempts without copying product references or secrets', () => {
    const skill = store.skills().find(s => s.id === 'image-generate')!, draft = defaultDraft(skill, store.models());
    draft.requirements = '夜景穿搭'; draft.inputRoles.product = ['private-product'];
    const b: Batch = { id: 'b', skillId: skill.id, skillName: skill.name, skillRevision: 1, action: 'generate', createdAt: new Date().toISOString(), draft, attempts: [], simulated: false };
    const a: Attempt = { id: 'a', batchId: 'b', itemId: 'i', index: 1, variant: 1, attemptNumber: 1, revision: 1, status: 'completed', step: '完成', prompt: 'compiled with product facts', references: ['private-product'], assetId: 'result', model: store.models()[0], parameters: {}, createdAt: b.createdAt, updatedAt: b.createdAt, points: null, simulated: false };
    store.put('batch', b.id, b); store.put('attempt', a.id, a); asset('result', 'image', 'provider');
    const capture = capturePrompt(store, { kind: 'attempt', id: a.id });
    expect(capture.prompt).toBe('夜景穿搭'); expect(capture.referenceIds).toEqual([]); expect(capture.exampleIds).toEqual(['result']);
    expect(JSON.stringify(capture)).not.toContain('private-product');
    store.put('attempt', a.id, { ...a, simulated: true }); expect(() => capturePrompt(store, { kind: 'attempt', id: a.id })).toThrow('真实');
  });
});

describe('模板应用与商品隔离', () => {
  it('routes compatible ecommerce templates to the current pages and excludes workspaces without consumers', () => {
    const get = (id:string) => store.skills().find(s=>s.id===id)!;
    expect(skillTemplateDestination(get('ec-product-01'),applied().value)?.path).toBe('/ecommerce/ec-product-01');
    expect(skillTemplateDestination(get('image-generate'),applied().value)?.path).toBe('/studio/image-generate');
    expect(skillTemplateDestination(get('product-kit'),applied('image-layout').value)?.path).toBe('/studio/product-kit');
    expect(skillTemplateDestination(get('ec-product-01'),applied('image-layout').value)).toBeUndefined();
    expect(skillTemplateDestination(get('image-generate'),{...applied().value,category:'post'})).toBeUndefined();
    expect(skillTemplateDestination(get('video-generate'),applied().value)).toBeUndefined();
    expect(skillTemplateDestination(get('video-generate'),applied('video-storyboard').value)?.path).toBe('/studio/video-generate');
    expect(skillTemplateDestination(get('video-generate'),applied('video-remake').value)).toBeUndefined();
    expect(skillTemplateKinds(get('model-outfit'))).toEqual([]);
    expect(skillTemplateKinds(get('scene-recreate'))).toEqual([]);
    expect(skillTemplateKinds({...get('ec-product-01'),id:'ec-tools-24'})).toEqual([]);
    expect(skillTemplateKinds({...get('ec-product-01'),executor:'workflow'})).toEqual([]);
  });
  it('uses the linked immutable version and refuses missing or foreign versions', () => {
    const first=savePrompt(store,value());
    const latest=savePrompt(store,{...value(),prompt:'新版'},first.template.id,1);
    const detail=promptDetail(store,first.template.id);
    expect(requestedTemplateVersion(detail,first.version.id)?.value.prompt).toBe(value().prompt);
    expect(requestedTemplateVersion(detail)?.id).toBe(latest.version.id);
    expect(requestedTemplateVersion(detail,'missing')).toBeUndefined();
    const other=savePrompt(store,{...value(),name:'其他'});
    expect(requestedTemplateVersion({...detail,versions:[...detail.versions,other.version]},other.version.id)).toBeUndefined();
  });
  it('adds a versioned layout once and preserves materials, requirements and output counts', () => {
    const skill=store.skills().find(s=>s.id==='product-kit')!, current=defaultDraft(skill,store.models());
    current.inputRoles.product=['own']; current.requirements='保留当前卖点';
    const template=applied('image-layout');template.template.versionNumber=2;
    const options={mode:'append' as const,references:false,settings:false};
    const next=applySkillTemplate(current,template,options,skill,store.models());
    const twice=applySkillTemplate(next,template,options,skill,store.models());
    expect(twice.productKit?.layouts).toEqual([{id:'template',version:2}]);
    expect(twice.requirements).toBe(current.requirements);expect(twice.count).toBe(current.count);
    expect(twice.inputRoles).toEqual(current.inputRoles);expect(current.productKit?.layouts).toEqual([]);
    expect(twice.promptTemplate?.versionId).toBe(template.template.versionId);
    expect(()=>applySkillTemplate(current,{...template,variables:{商品名称:'测试'}},options,skill,store.models())).toThrow('暂不支持变量');
    const full={...current,productKit:{...current.productKit!,sellingPoints:1,layouts:[{id:'other',version:1}]}};
    expect(()=>applySkillTemplate(full,template,options,skill,store.models())).toThrow('超过');
  });
  it('limits imported ecommerce references and preserves manually selected edit originals', () => {
    const skill=store.skills().find(s=>s.id==='ec-product-01')!, current=defaultDraft(skill,store.models()), template=applied();
    current.inputRoles.product=['own'];template.value.referenceIds=Array.from({length:7},(_,i)=>`reference-${i}`);
    const options={mode:'append' as const,references:true,settings:false};
    expect(()=>applySkillTemplate(current,template,options,skill,store.models())).toThrow('6 张');
    template.value.referenceIds=['style'];current.ecommerceTemplateAssets={old:'old-asset'};
    const next=applySkillTemplate(current,template,options,skill,store.models());
    expect(next.inputRoles).toEqual({product:['own'],reference:['style']});expect(next.ecommerceTemplateAssets).toEqual({});
    const edit=store.skills().find(s=>s.id==='image-edit')!, editDraft=defaultDraft(edit,store.models());
    expect(()=>applySkillTemplate(editDraft,{...template,value:{...template.value,kind:'image-replica'}},options,edit,store.models())).toThrow('原图需手动');
    expect(store.list('batch')).toHaveLength(0);
  });
  it('fills literal values in ordered scripts without interpreting replacement tokens', () => {
    const v = { ...value(), kind: 'video-storyboard' as const, shots: [{ title: '{{场景}}', duration: 4, scene: '', action: '{{商品名称}}', camera: '', dialogue: '', framePrompt: '', prompt: '推进到 {{商品名称}}' }] };
    expect(promptVariables(v)).toEqual(['商品名称', '场景']);
    expect(expandPrompt(v, { 商品名称: '$&卫衣', 场景: '街道' }).shots[0].action).toBe('$&卫衣');
    expect(promptScript(expandPrompt(v, { 商品名称: '上衣', 场景: '街道' }))).toContain('镜头 1 · 街道 · 4 秒');
  });
  it('only modifies explicit fields, keeps product material and facts, and preserves template provenance in saved schema', () => {
    const skill = store.skills().find(s => s.id === 'image-generate')!, d = defaultDraft(skill, store.models());
    d.requirements = '我的新输入'; d.inputRoles = { product: ['my-product'] }; d.productContext = { id: 'own', revision: 1, name: '自己的商品', facts: '已确认资料' };
    const a = applied(); a.value.exampleIds = ['other-product-example']; a.value.referenceIds = ['style-ref'];
    const next = applySkillTemplate(d, a, { mode: 'append', references: false, settings: false }, skill, store.models());
    expect(next.requirements).toBe('我的新输入\n\n商品创意'); expect(next.inputRoles).toEqual(d.inputRoles); expect(next.productContext).toEqual(d.productContext);
    expect(draftSchema.parse(next).promptTemplate?.versionId).toBe('immutable-1'); expect(d.requirements).toBe('我的新输入');
    expect(() => mergePrompt('x'.repeat(16000), 'new', 'append')).toThrow('超过');
  });
  it('does not silently switch unsupported models or parameters', () => {
    const skill = store.skills().find(s => s.id === 'video-generate')!, d = defaultDraft(skill, store.models()), a = applied('video-first-frame');
    a.value.settings.modelId = 'missing-model';
    expect(() => applySkillTemplate(d, a, { mode: 'replace', references: false, settings: true }, skill, store.models())).toThrow('其他模型');
    a.value.settings = { parameters: {}, duration: 60 };
    expect(() => applySkillTemplate(d, a, { mode: 'replace', references: false, settings: true }, skill, store.models())).toThrow('时长');
    expect(applySkillTemplate(d, a, { mode: 'replace', references: false, settings: false }, skill, store.models()).modelId).toBe(d.modelId);
  });
  it('keeps creative pages on append, maps replica pages to actual references and preserves local product overrides', () => {
    const skill = store.skills().find(s => s.id === 'image-generate')!, g = defaultDraft(skill, store.models()); g.count = 3; g.inputRoles.product = ['own'];
    const current = promotionValueSchema.parse({ generation: g, outputKeys: ['one', 'two', 'three'], postMode: 'creative', pageRequirements: { three: '保留第三页' } });
    const a = applied(); a.value.pages = [{ title: '封面', prompt: '新的封面' }];
    const next = applyPromotionTemplate(current, a, { mode: 'append', references: false, settings: false }, store.models(), 20);
    expect(next.outputKeys).toHaveLength(6); expect(next.pageRequirements.three).toContain('保留第三页'); expect(next.generation.inputRoles.product).toEqual(['own']);
    const replica = { ...current, postMode: 'replicate' as const, benchmarkImages: ['peer'], selectedBenchmarkIds: ['peer'], targetSettings: { peer: { outputKey: 'stable-key', productIds: ['special-product'], requirements: '本页要求' } }, outputKeys: ['stable-key'], generation: { ...g, count: 1 } };
    const r = applied('image-replica'); r.value.replacementObject = '模特上衣';
    const replicated = applyPromotionTemplate(replica, r, { mode: 'replace', references: false, settings: false }, store.models(), 20);
    expect(replicated.targetSettings?.peer.outputKey).toBe('stable-key'); expect(replicated.targetSettings?.peer.productIds).toEqual(['special-product']);
    expect(() => applyPromotionTemplate(current, r, { mode: 'replace', references: false, settings: false }, store.models(), 20)).toThrow('对应');
  });
  it('expands a three-stage template into six distinct pages in order without adding example images to generation',()=>{
    const skill=store.skills().find(s=>s.id==='image-generate')!,generation=defaultDraft(skill,store.models());
    generation.inputRoles.product=['own'];
    const current=promotionValueSchema.parse({generation,postMode:'creative',outputKeys:['cover']});
    const a=applied();a.value.pages=[{title:'造型亮相',prompt:'街头穿搭全貌'},{title:'穿着细节',prompt:'领口与衣袖'},{title:'场景收尾',prompt:'日常通勤场景'}];a.value.exampleIds=['peer-example'];
    const next=applyPromotionTemplate(current,a,{mode:'replace',references:false,settings:false},store.models(),20);
    expect(next.generation.count).toBe(6);expect(next.outputKeys[0]).toBe('cover');
    const instructions=expandPostPages(next.postTemplatePages||[],next.generation.count);expect(new Set(instructions).size).toBe(6);
    expect(instructions[0]).toContain('造型亮相');expect(instructions[1]).toContain('造型亮相');expect(instructions[2]).toContain('穿着细节');expect(instructions[4]).toContain('场景收尾');
    expect(expandPostPages(next.postTemplatePages||[],8)[7]).toContain('场景收尾');
    expect(next.generation.inputRoles).toEqual(current.generation.inputRoles);expect(JSON.stringify(next)).not.toContain('peer-example');
    expect(()=>applyPromotionTemplate(current,a,{mode:'replace',references:false,settings:false},store.models(),5)).toThrow('上限');
  });
  it('persists structured remake guidance without changing a source timeline or initiating generation', () => {
    const v = applied('video-remake'); v.value.shots = [{ title: '开场', duration: 4, scene: '街头', action: '展示商品', camera: '推进', dialogue: '', framePrompt: '首帧', prompt: '动作' }];
    const saved = remakeInputSchema.partial().parse({ promptTemplate: v.template, templateShots: v.value.shots, templateScript: '整片参考' });
    expect(saved.templateShots?.[0].duration).toBe(4); expect(saved.promptTemplate?.versionId).toBe('immutable-1');
    expect(store.list('batch')).toHaveLength(0);
  });
});
