import { productKitSchema } from '../../packages/contracts';
import { kitSlots } from '../../packages/product-design';
import { resolveSellingLayout } from '../../packages/selling-layouts';
import type { Draft, Model, PlanItem, Skill } from '../../packages/contracts';
import { fail } from './engine';
import { renderPrompt } from './skills';

export const factScreens = new Set(['品牌故事图','效果对比图','工艺制作图','配件/赠品图','售后保障图','尺寸/容量/尺码图','详细规格/参数表','商品成分图']);
export function productKitItems(skill: Skill, draft: Draft, model: Model, maxBatch: number, pricingOnly = false,resolveLayout:(ref:{id:string;version:number})=>{id:string;version:number;name:string;rules:string} = resolveSellingLayout): PlanItem[] {
  const kit = productKitSchema.parse(draft.productKit || {});
  if (!pricingOnly && !draft.inputRoles.product?.length) fail('请添加商品原图');
  const slots = kitSlots(kit);
  if (slots.some(s=>!s.purpose)) fail('请为每张其他图片填写具体用途');
  if (kit.layouts.length > kit.sellingPoints) fail('已选版式超过卖点图数量，请调整版式选择');
  for(const slot of slots)if(!pricingOnly&&kit.slotProductIds[slot.id]&&!kit.slotProductIds[slot.id].length)fail('本图商品参考不能为空，请恢复公共商品图或添加图片');
  const layouts=kit.layouts.map(resolveLayout);
  if (new Set(kit.layouts.map(l=>l.id)).size!==kit.layouts.length) fail('卖点版式不能重复选择');
  if (slots.length > maxBatch) fail(`商品套图共 ${slots.length} 张，超过单批上限 ${maxBatch} 张，请调整分类数量`);
  const base = designPrompt(skill,draft,1,slots.length)+`\n面向抖音电商设计；规则版本：${kit.platformRulesVersion}。此为创作规范，不保证平台审核结果。`;
  return slots.map((slot, index) => ({
    index: index + 1, variant: 1, targetLabel: `第 ${index + 1} 张 · ${slot.category}`,
    targetId: slot.id, screenType: slot.category, screenOrder: index + 1,
    references: [...new Set([...(kit.slotProductIds[slot.id] || draft.inputRoles.product || []),...(draft.inputRoles.reference || [])])], model,
    parameters: {...draft.parameters, aspectRatio:draft.aspectRatio},
    prompt: `${base}\n当前输出：第 ${index + 1} / ${slots.length} 张，类别：${slot.category}。\n本张用途：${slot.purpose}。\n本图补充要求：${kit.slotRequirements[slot.id] || "无"}。\n${slot.category === "卖点图" && layouts[slot.ordinal-1] ? `版式 ${layouts[slot.ordinal-1].name} v${layouts[slot.ordinal-1].version}：${layouts[slot.ordinal-1].rules}` : "版式根据本页职责与整组风格设计。"}\n同组商品外观、颜色与可见结构保持一致；每张使用不同景别、角度或场景，不生成重复画面，不拼成多格图。商品未知参数不得补造。`,
  }));
}
export function designPrompt(skill: Skill, draft: Draft, index: number, total: number) {
  return renderPrompt(skill.sections[skill.promptSection!], {
    'user.requirements': draft.requirements, 'item.index': index, 'item.variant': 1, 'batch.total': total,
    ...Object.fromEntries(Object.entries(skill.fields).map(([key, field]) => [`fields.${key}`, draft.fields[key] ?? field.default ?? ''])),
  });
}
export function detailItems(skill: Skill, draft: Draft, model: Model, maxBatch: number, pricingOnly=false): PlanItem[] {
  const design = draft.imageDesign;
  if (!pricingOnly&&!draft.fields.productName?.toString().trim()) fail('请填写产品名');
  if (!design?.screens.length) fail('请至少添加一屏详情图');
  if (new Set(design.screens.map(s => s.id)).size !== design.screens.length) fail('详情屏标识重复，请重新添加');
  for(const screen of design.screens)if(!pricingOnly&&screen.productIds&&!screen.productIds.length)fail('本屏商品参考不能为空，请添加图片');
  for (const screen of design.screens) if (!pricingOnly&&factScreens.has(screen.type) && !screen.facts.trim()) fail(`${screen.type}：请填写已确认资料，不从图片推断参数或政策`);
  const total = design.screens.length * design.groupCount;
  if (total > maxBatch) fail(`单批最多 ${maxBatch} 张，当前 ${design.screens.length} 屏 × ${design.groupCount} 组 = ${total} 张`);
  const references = [...new Set(Object.values(draft.inputRoles).flat())];
  const items: PlanItem[] = [];
  for (let group = 1; group <= design.groupCount; group++) {
    const shared = `组内设计计划：商品为${draft.fields.productName}；语言${draft.fields.language}；全组统一产品结构、配色和字体表达。屏顺序：${design.screens.map((s,i)=>`${i+1}.${s.type}`).join(' → ')}。组内共同要求：${draft.requirements}。`;
    design.screens.forEach((screen, order) => {
      const index = items.length + 1;
      items.push({index, variant:group, groupIndex:group, screenId:screen.id, screenType:screen.type, screenOrder:order+1,
        targetLabel:`第 ${group} 组 · 第 ${order+1} 屏 · ${screen.type}`, references:screen.productIds||references, model,
        parameters:{...draft.parameters,aspectRatio:draft.aspectRatio},
        prompt: `${designPrompt(skill,draft,index,total)}\n${shared}\n当前第${group}组、第${order+1}屏，类型：${screen.type}。\n局部要求：${screen.requirements || '按屏类型组织画面'}\n适用范围：${screen.scopeLabel || "当前商品范围"}。\n已确认资料（精确引用，不改数值）：${screen.facts || '未提供额外资料，不编造'}\n每次输出当前一屏，禁止合成多屏联系表。${factScreens.has(screen.type)?"精确资料将由本地排版追加至图片下方；画面中不要重绘数值或参数表，不要编造额外数值。":""}`,
      });
    });
  }
  return items;
}
export function editReferenceMap(draft: Draft,requireInstructions=true): string {
  if (requireInstructions&&!draft.requirements.trim()) fail('请填写编辑要求，并用图号明确目标和参照');
  if (draft.inputRoles.targets?.some(id=>draft.inputRoles.reference?.includes(id))) fail('同一图片不能同时作为待编辑图和辅助参考，请先从一个入口移除');
  const active = [...new Set(Object.values(draft.inputRoles).flat())];
  const bindings = draft.imageDesign?.bindings || [];
  if (new Set(bindings.map(b=>b.number)).size !== bindings.length || new Set(bindings.map(b=>b.assetId)).size !== bindings.length) fail('图片编号重复，请重新载入素材');
  if (active.some(id=>!bindings.some(b=>b.assetId===id))) fail('图片缺少稳定编号，请重新添加素材');
  for (const match of draft.requirements.matchAll(/图\s*(\d+)/g)) {
    const binding=bindings.find(b=>b.number===Number(match[1]));
    if (!binding || !active.includes(binding.assetId)) fail(`图${match[1]}的引用已失效，请修改编辑要求或恢复图片`);
  }
  return active.map((id,index)=>`请求图片${index+1} = 图${bindings.find(b=>b.assetId===id)!.number}（${draft.inputRoles.targets?.includes(id)?'待编辑':'辅助参考'}）`).join('；');
}
