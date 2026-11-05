import type { Draft, Model, Skill } from '../../packages/contracts';
import { promptCategory, promptScript, type AppliedPrompt, type PromptKind, type PromptTemplateInput } from '../../packages/prompts';
import {minimumPostPages} from '../../packages/post-plan';
import type { PromotionValue } from '../../packages/promotion';

export type TemplateApplyOptions = { mode: 'replace' | 'append'; references: boolean; settings: boolean };
export const imagePromptKinds: PromptKind[] = ['image', 'image-replica'];
export const videoPromptKinds: PromptKind[] = ['video-first-frame', 'video-storyboard'];
export function mergePrompt(old: string, incoming: string, mode: TemplateApplyOptions['mode'], max = 16000) {
  const result = mode === 'append' ? [old, incoming].filter(Boolean).join('\n\n') : incoming;
  if (result.length > max) throw new Error(`合并后超过 ${max} 字，请精简原稿或选择替换`);
  return result;
}
export function templateSettings(draft: Draft, value: PromptTemplateInput, models: Model[]) {
  // A template never changes the chosen model or silently coerces unsupported parameters.
  const model = models.find(m => m.id === draft.modelId);
  if (!model) throw new Error('当前模型不可用，请先选择模型');
  const s = value.settings;
  if (s.modelId && s.modelId !== model.id) throw new Error('模板使用了其他模型，请先切换对应模型，或取消带入参数');
  if (s.aspectRatio && !model.aspectRatios.includes(s.aspectRatio)) throw new Error('当前模型不支持模板比例，请取消带入参数');
  if (s.duration && model.category === 'video' && !model.durations.includes(s.duration)) throw new Error('当前模型不支持模板时长，请取消带入参数');
  const parameters = { ...draft.parameters };
  for (const [key, v] of Object.entries(s.parameters)) {
    const field = model.parameters[key];
    if (!field || field.type === 'select' && !field.options?.includes(String(v)) || field.type === 'boolean' && typeof v !== 'boolean' || field.type === 'number' && (typeof v !== 'number' || field.min != null && v < field.min || field.max != null && v > field.max)) throw new Error('模板包含当前模型不支持的参数，请取消带入参数');
    parameters[key] = v;
  }
  return { ...draft, aspectRatio: s.aspectRatio || draft.aspectRatio, duration: model.category === 'video' ? s.duration || draft.duration : draft.duration, parameters };
}
export function applySkillTemplate(current: Draft, applied: AppliedPrompt, options: TemplateApplyOptions, skill: Skill, models: Model[]): Draft {
  const v = applied.value, video = skill.model.category === 'video';
  if(v.kind==='image-layout'){
    if(skill.imageDesign!=='kit'||!current.productKit)throw Error('卖点版式请在商品套图中使用');
    const version=applied.template.versionNumber||Number(applied.template.versionId.split('-v').pop());
    if(!Number.isInteger(version)||version<1)throw Error('请从商品套图的版式选择器指定版式');
    if(current.productKit.layouts.length>=current.productKit.sellingPoints)throw Error('已选版式超过卖点图数量');
    return {...current,productKit:{...current.productKit,layouts:[...current.productKit.layouts,{id:applied.template.id,version}]}};
  }
  if (promptCategory(v) === 'post') throw new Error('图文模板请在商品的图文创作区使用');
  if (video ? !videoPromptKinds.includes(v.kind) : !imagePromptKinds.includes(v.kind)) throw new Error('此模板与当前创作类型不兼容');
  const text = [v.prompt, video ? promptScript(v) : v.pages.map((p, i) => `第 ${i + 1} 页：${p.prompt}`).join('\n')].filter(Boolean).join('\n\n');
  let next: Draft = { ...current, requirements: mergePrompt(current.requirements, text, options.mode), promptTemplate: applied.template };
  if (options.references && v.referenceIds.length) {
    const role = v.kind === 'image-replica' ? skill.inputs.targets ? 'targets' : skill.inputs.reference ? 'reference' : undefined : !video && skill.inputs.reference ? 'reference' : undefined;
    if (!role) throw new Error('此入口不接受模板参考素材，请取消带入参考图');
    if (skill.inputs[role].cardinality === 'single' && v.referenceIds.length > 1) throw new Error('当前入口仅支持一张参考图，请在逐图复刻中使用');
    if (role === 'targets' && skill.imageDesign === 'edit') throw new Error('图像编辑的原图需手动指定，请取消带入参考图');
    next = { ...next, inputRoles: { ...current.inputRoles, [role]: v.referenceIds }, ...(role === 'targets' ? { selectedTargetIds: v.referenceIds } : {}) };
  }
  if (options.settings) next = templateSettings(next, v, models);
  return next;
}
export function applyPromotionTemplate(current: PromotionValue, applied: AppliedPrompt, options: TemplateApplyOptions, models: Model[], maxBatch: number): PromotionValue {
  const v = applied.value, video = v.kind.startsWith('video');
  if (v.kind === 'video-remake') throw new Error('爆款复刻模板请在独立爆款复刻工作区使用');
  let generation: Draft = { ...current.generation, requirements: mergePrompt(current.generation.requirements, v.prompt, options.mode), promptTemplate: applied.template };
  if (options.settings) generation = templateSettings(generation, v, models);
  if (video && options.references && v.referenceIds.length) throw new Error('此视频入口使用当前商品图片或首帧；模板参考仅供查看，请取消带入参考素材');
  if (video) return { ...current, generation, script: mergePrompt(current.script, promptScript(v), options.mode) };
  const replica = current.postMode === 'replicate';
  if ((v.kind === 'image-replica') !== replica) throw new Error('请在对应的创意生成或逐图复刻模式选用模板');
  const ids = replica && options.references ? v.referenceIds : current.benchmarkImages;
  const count = replica ? ids.length : Math.max(minimumPostPages, options.mode === 'append' ? Math.max(v.pages.length, generation.count) : v.pages.length || generation.count);
  if (!count && replica) throw new Error('请先选择对标原图，或勾选带入模板参考图');
  if (count > Math.min(20, maxBatch)) throw new Error('模板页数超过本次批次上限，请调整模板');
  const outputKeys = Array.from({ length: count }, (_, i) => replica ? current.targetSettings?.[ids[i]]?.outputKey || crypto.randomUUID() : current.outputKeys[i] || crypto.randomUUID());
  const templatePages=replica?[]:options.mode==='append'?[...(current.postTemplatePages||[]),...v.pages]:v.pages;
  if(templatePages.length>20)throw new Error('累计模板段落超过 20 段，请选择替换现有要求');
  return { ...current, generation: { ...generation, count }, outputKeys,
    pageRequirements: Object.fromEntries(outputKeys.map((key, i) => [key, replica?mergePrompt(current.pageRequirements[key] || '', v.pages[i]?.prompt || '', options.mode, 4000):options.mode==='append'?current.pageRequirements[key]||'':''])),
    ...(!replica?{postTemplatePages:templatePages}:{}),
    ...(replica ? { benchmarkImages: ids, selectedBenchmarkIds: options.references ? ids : current.selectedBenchmarkIds || ids, replacementObject: v.replacementObject || current.replacementObject, targetSettings: Object.fromEntries(ids.map((id, i) => [id, { ...current.targetSettings?.[id], outputKey: outputKeys[i] }])) } : {}),
  };
}
