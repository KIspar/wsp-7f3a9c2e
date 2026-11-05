import { z } from 'zod';
import type { Asset } from './contracts';

export const promptKinds = ['image', 'image-replica', 'image-layout', 'video-first-frame', 'video-storyboard', 'video-remake'] as const;
export type PromptKind = typeof promptKinds[number];
export const promptCategories = ['post', 'image', 'video'] as const;
export type PromptCategory = typeof promptCategories[number];
export const promptCategoryLabels: Record<PromptCategory, string> = { post: '图文', image: '图片', video: '视频' };
/** Classify legacy versions without rewriting them. Page-based image templates represent a whole post. */
export function promptCategory(value: { category?: PromptCategory; kind: PromptKind; pages: unknown[] }): PromptCategory {
  return value.category ?? (value.kind.startsWith('video') ? 'video' : value.pages.length ? 'post' : 'image');
}
export function templateTypeLabel(value: { category?: PromptCategory; kind: PromptKind; pages: unknown[] }) {
  return promptCategory(value) === 'post' ? value.kind === 'image-replica' ? '逐图复刻' : '创意图文' : promptKindLabels[value.kind];
}
export const promptKindLabels: Record<PromptKind, string> = {
  image: '图片创作', 'image-layout':'卖点图版式', 'image-replica': '图片逐图复刻', 'video-first-frame': '首帧视频',
  'video-storyboard': '分镜脚本', 'video-remake': '爆款复刻',
};
export const promptSourceSchema = z.object({
  kind: z.enum(['manual', 'attempt', 'promotion', 'remake', 'workbench']).default('manual'),
  id: z.string().max(120).optional(), versionId: z.string().max(120).optional(),
});
export type PromptSource = z.infer<typeof promptSourceSchema>;
export const promptShotSchema = z.object({
  title: z.string().max(100).default(''), duration: z.number().finite().positive().max(120).nullable().default(null),
  person: z.string().max(3000).optional(), replacement: z.string().max(3000).optional(),
  scene: z.string().max(3000).default(''), action: z.string().max(3000).default(''),
  camera: z.string().max(3000).default(''), dialogue: z.string().max(3000).default(''),
  framePrompt: z.string().max(6000).default(''), prompt: z.string().max(6000).default(''),
});
export const promptTemplateInputSchema = z.object({
  name: z.string().trim().min(1, '请填写模板名称').max(100), kind: z.enum(promptKinds), category: z.enum(promptCategories).optional(),
  description: z.string().max(2000).default(''), tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  prompt: z.string().max(16000).default(''), script: z.string().max(16000).default(''),
  replacementObject: z.string().max(500).default(''),
  pages: z.array(z.object({ title: z.string().max(100), prompt: z.string().max(4000) })).max(20).default([]),
  shots: z.array(promptShotSchema).max(20).default([]),
  exampleIds: z.array(z.string().min(1).max(120)).max(8).default([]),
  referenceIds: z.array(z.string().min(1).max(120)).max(20).default([]),
  settings: z.object({ modelId: z.string().max(120).optional(), aspectRatio: z.string().max(20).optional(),
    duration: z.number().int().min(1).max(60).optional(),
    parameters: z.record(z.string().max(100), z.union([z.string().max(500), z.number().finite(), z.boolean()])).default({}),
  }).default({ parameters: {} }),
  layout: z.object({structure:z.string().max(4000),textDensity:z.string().max(100),productPosition:z.string().max(300),ratios:z.array(z.string()).max(10),fields:z.array(z.string()).max(30),categories:z.array(z.string()).max(30)}).optional(),
  source: promptSourceSchema.default({ kind: 'manual' }),
}).superRefine((v, ctx) => {
  if (![v.prompt, v.script, ...v.pages.map(p => p.prompt), ...v.shots.flatMap(s => [s.prompt, s.framePrompt, s.scene, s.person||'', s.replacement||'', s.action, s.camera, s.dialogue])].some(t => t.trim()))
    ctx.addIssue({ code: 'custom', path: ['prompt'], message: '请填写提示词或分镜内容' });
  if (new Set(v.exampleIds).size !== v.exampleIds.length || new Set(v.referenceIds).size !== v.referenceIds.length)
    ctx.addIssue({ code: 'custom', path: ['exampleIds'], message: '同一素材不能重复添加' });
  if (v.kind.startsWith('image') && v.shots.length) ctx.addIssue({ code: 'custom', path: ['shots'], message: '图片模板不能保存视频分镜' });
  if ((promptCategory(v) === 'video') !== v.kind.startsWith('video')) ctx.addIssue({ code: 'custom', path: ['kind'], message: '模板类型与分类不匹配' });
  if (promptCategory(v) !== 'post' && v.pages.length) ctx.addIssue({ code: 'custom', path: ['pages'], message: '有逐页编排的模板请选择图文分类' });
  if (promptCategory(v) !== 'video' && v.script.trim()) ctx.addIssue({ code: 'custom', path: ['script'], message: '视频脚本请选择视频分类' });
});
export type PromptTemplateInput = z.infer<typeof promptTemplateInputSchema>;
export type PromptShot = z.infer<typeof promptShotSchema>;
export type PromptTemplate = { id: string; revision: number; currentVersionId: string; createdAt: string; updatedAt: string; archived: boolean };
export type PromptVersion = { id: string; templateId: string; number: number; createdAt: string; value: PromptTemplateInput };
export type PromptEntry = { template: PromptTemplate; version: PromptVersion };
export type PromptDetail = PromptEntry & { versions: PromptVersion[]; assets: Asset[] };
export type PromptList = { items: PromptEntry[]; total: number; page: number; tags: string[]; assets: Asset[] };
export type AppliedPrompt = { value: PromptTemplateInput; template: { id: string; versionId: string; versionNumber?:number; name: string; appliedAt: string }; variables: Record<string, string> };

export function emptyPrompt(kind: PromptKind = 'image', category?: PromptCategory): PromptTemplateInput {
  return { name: '', kind, ...(category ? { category } : {}), description: '', tags: [], prompt: '', script: '', replacementObject: '', pages: [], shots: [], exampleIds: [], referenceIds: [], settings: { parameters: {} }, source: { kind: 'manual' } };
}
export function promptVariables(value: PromptTemplateInput): string[] {
  const text = [value.prompt, value.script, value.replacementObject, ...value.pages.flatMap(p => [p.title, p.prompt]), ...value.shots.flatMap(s => [s.title, s.scene, s.person||'', s.replacement||'', s.action, s.camera, s.dialogue, s.framePrompt, s.prompt])].join('\n');
  return [...new Set(Array.from(text.matchAll(/\{\{\s*([^{}\n]{1,50}?)\s*\}\}/g), m => m[1].trim()))];
}
export function expandPrompt(value: PromptTemplateInput, variables: Record<string, string>): PromptTemplateInput {
  const missing = promptVariables(value).filter(k => !Object.hasOwn(variables,k) || !variables[k]?.trim());
  if (missing.length) throw new Error(`请填写：${missing.join('、')}`);
  const fill = (s: string) => s.replace(/\{\{\s*([^{}\n]{1,50}?)\s*\}\}/g, (_, k: string) => variables[k.trim()]);
  return promptTemplateInputSchema.parse({ ...value, prompt: fill(value.prompt), script: fill(value.script), replacementObject: fill(value.replacementObject),
    pages: value.pages.map(p => ({ title: fill(p.title), prompt: fill(p.prompt) })),
    shots: value.shots.map(s => ({ ...s, title: fill(s.title), scene: fill(s.scene), person: fill(s.person||''), replacement: fill(s.replacement||''), action: fill(s.action), camera: fill(s.camera), dialogue: fill(s.dialogue), framePrompt: fill(s.framePrompt), prompt: fill(s.prompt) })),
  });
}
export function promptScript(value: PromptTemplateInput): string {
  return [value.script, ...value.shots.map((s, i) => [
    `镜头 ${i + 1}${s.title ? ` · ${s.title}` : ''}${s.duration ? ` · ${s.duration} 秒` : ''}`,
    s.scene && `场景：${s.scene}`, s.person && `人物：${s.person}`, s.replacement && `商品替换：${s.replacement}`, s.action && `动作：${s.action}`, s.camera && `运镜：${s.camera}`,
    s.dialogue && `台词：${s.dialogue}`, s.framePrompt && `首帧：${s.framePrompt}`, s.prompt && `视频提示词：${s.prompt}`,
  ].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
}
export function promptMarkdown(value: PromptTemplateInput): string {
  return [`# ${value.name}`, `${promptCategoryLabels[promptCategory(value)]}模板 · ${templateTypeLabel(value)}`, value.description, value.tags.length && `标签：${value.tags.join('、')}`, value.prompt && `## 创作要求\n\n${value.prompt}`, value.replacementObject && `替换对象：${value.replacementObject}`, ...value.pages.map((p, i) => `## 第 ${i + 1} 页 · ${p.title}\n\n${p.prompt}`), promptScript(value)].filter(Boolean).join('\n\n');
}
