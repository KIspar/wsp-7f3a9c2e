import {replicaRules} from '../../packages/product-design';
import {validateWearContext} from './wear-context';
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  defaultDraft, editableStatuses,
  type Asset, type Attempt, type Batch, type Draft, type Plan, type PlanItem,
  type SkillField, type Submission, type LedgerEntry, type CreativeContext,
} from "../../packages/contracts";
import { renderPrompt } from "./skills";
import { detailItems, editReferenceMap, productKitItems } from "./image-design";
import type { Store } from "./store";

import {fail} from './errors';
import {validateToken01Item} from './token01';
import {relayModelAvailable} from './relays';
import {ecommerceOutputSpecs} from '../../packages/ecommerce';
import {ecommerceControls,ecommerceControlInstructions,ecommerceControlVisible} from '../../packages/ecommerce/controls';
import {validateRemakeContext,admitRemake} from './remake-context';
import {getPromotionDraft,admitPromotion,promotionGeneration,submittedPromotionValue} from './promotion';
import {credentialVault} from './credentials';
import {ecommerceReferenceFormat} from './ecommerce-format';
import {ecommerceReferenceRatio} from '../../packages/ecommerce/settings';
import {getCatalogProduct,getCreativeDraft,workshopGeneration,workshopSkill} from './catalog';
export {fail} from './errors';
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const productPrompt = (draft: Draft, prompt: string) => draft.productContext
  ? `${prompt}\n\n用户载入的商品资料（接单快照）：${draft.productContext.name}\n${draft.productContext.facts || '未提供额外参数，仅按商品图片可见特征处理。'}\n不得补造未提供的成分、尺码或功效。` : prompt;

function validateFields(definitions: Record<string, SkillField>, values: Draft["fields"], label: string) {
  for (const key of Object.keys(values)) if (!definitions[key]) fail(`${label}包含未定义字段：${key}`);
  for (const [key, field] of Object.entries(definitions)) {
    const value = values[key] ?? field.default;
    if (field.type === "select" && !field.options?.includes(String(value))) fail(`${field.label}选项不合法`);
    if (field.type === "boolean" && typeof value !== "boolean") fail(`${field.label}应为开关值`);
    if (field.type === "text" && (typeof value !== "string" || value.length > 16000)) fail(`${field.label}文本不合法`);
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value) ||
      (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) fail(`${field.label}超出范围`);
  }
}

export function compilePlan(store: Store, skillId: string, draft: Draft, action: Submission["action"] = "generate", pricingOnly=false,creativeContext?:CreativeContext,wearContext?:import('../../packages/wear').WearContext): Plan {
  const skill = store.skills().find((s) => s.id === skillId) || fail("技能不存在", 404);
  const model = store.models().find((m) => m.id === draft.modelId && m.enabled) || fail("所选模型不可用");
  if(relayModelAvailable(store,model.id)===false)fail('中转站未确认此模型可用，请在模型配置中同步可用模型');
  if (model.category !== skill.model.category) fail("模型类型与技能不匹配");
  const followReference=skillId.startsWith('ec-')&&model.category==='image'&&draft.aspectRatio===ecommerceReferenceRatio;
  if (!followReference&&!model.aspectRatios.includes(draft.aspectRatio)) fail("模型不支持所选画幅");
  if (model.category === "video" && !model.durations.includes(draft.duration)) fail("模型不支持所选时长");
  validateFields(skill.fields, draft.fields, "技能参数");
  validateFields(model.parameters, draft.parameters, "模型参数");
  if (skill.executor === "media" && action !== "generate") fail("普通技能不支持该操作");
  if (skill.executor === "workflow" && !["prepareWhite", "replaceSelected"].includes(action)) fail("请选择白底生成或替换操作");
  if(draft.outputProductIds){if(!creativeContext?.promotionWorkId||creativeContext.purpose!=='post'||draft.outputProductIds.length!==draft.count)fail('逐图商品参考只适用于推广图文');for(const ids of draft.outputProductIds){if(!ids.length)fail('本图商品参考不能为空');for(const id of ids){const a=store.get<Asset>('asset',id);if(!a||a.type!=='image'||['simulator','example'].includes(a.source))fail('本图商品参考不可用');}}}
  if(draft.outputReferenceIds){if(!creativeContext?.promotionWorkId||creativeContext.purpose!=='post'||draft.outputReferenceIds.length!==draft.count)fail('逐页对标图只适用于商品推广图文任务');for(const id of draft.outputReferenceIds.flat()){const a=store.get<Asset>('asset',id);if(!a||a.type!=='image'||['simulator','example'].includes(a.source))fail('逐页对标图不可用');}}
  for (const [role, ids] of Object.entries(draft.inputRoles)) {
    const def = skill.inputs[role] || fail(`未知图片角色：${role}`);
    if (def.cardinality === "single" && ids.length > 1) fail(`${def.label}只能有一张`);
    for (const id of ids) {
      const asset = store.get<Asset>("asset", id) || fail("参考素材已不存在");
      if(role==='product'&&asset.source==='template')fail('版式效果示例不能作为商品原图，请选择自己的商品图片');
      if (asset.type !== def.mediaType) fail(`${def.label}只接受图片`);
    }
  }
  for (const [role, input] of Object.entries(skill.inputs)) {
    if (action === "prepareWhite" && role !== "product") continue;
    if (!pricingOnly&&input.required && !draft.inputRoles[role]?.length) fail(`请添加${input.label}`);
  }
  if(draft.editMasks&&Object.keys(draft.editMasks).length){
    if(!skill.id.startsWith('ec-')||skill.imageDesign!=='edit')fail('当前功能不支持局部选区');
    for(const [target,mask] of Object.entries(draft.editMasks)){
      if(!draft.inputRoles.targets?.includes(target))fail('选区对应原图已移除，请重新框选');
      const asset=store.get<Asset>('asset',mask.assetId);
      if(!asset||asset.type!=='image'||['example','simulator'].includes(asset.source))fail('选区蒙版已失效，请重新框选');
    }
  }
  if (!pricingOnly&&skill.batch.mode === "repeat" && !draft.requirements.trim() && !Object.values(draft.inputRoles).flat().length) {
    fail("请填写创作要求或添加参考图片");
  }
  if (skill.imageDesign && !["1K", "2K", "4K"].includes(String(draft.parameters.resolution))) fail("请选择 1K、2K 或 4K 分辨率");
  if (skill.imageDesign === "detail") {
    const items = detailItems(skill, draft, model, store.settings().maxBatch,pricingOnly).map(item=>({...item,prompt:productPrompt(draft,item.prompt)}));
    for(const item of items){
      if(item.references.length>model.maxReferences)fail(`${model.name}每屏最多支持 ${model.maxReferences} 张商品图片`);
      for(const id of item.references){if(store.get<Asset>('asset',id)?.type!=='image')fail('本屏商品参考已失效');}
      if(item.references.reduce((n,id)=>n+Math.ceil(store.get<Asset>('asset',id)!.bytes/3)*4,0)>30*1024*1024)fail('单项参考图编码后超过 30 MB');
    }
    const base = { ...(creativeContext?{creativeContext}:{}), ...(wearContext?{wearContext}:{}), total: items.length, points: model.points === null ? null : model.points * items.length, items, skillId, skillRevision: skill.revision, skillHash: skill.hash, action };
    return { ...base, hash: digest(canonical(base)) };
  }
  if (skill.imageDesign === "kit") {
    const items = productKitItems(skill, draft, model, store.settings().maxBatch, pricingOnly,ref=>{
      const t=store.get<import('../../packages/prompts').PromptTemplate>('prompt-template',ref.id);
      if(!t||t.archived)fail('卖点版式不可用，请重新选择');
      const v=store.list<import('../../packages/prompts').PromptVersion>('prompt-version').find(v=>v.templateId===ref.id&&v.number===ref.version);
      if(!v||v.value.kind!=='image-layout')fail('卖点版式不存在，请重新选择');
      if(v.value.layout?.ratios.length&&!v.value.layout.ratios.includes(draft.aspectRatio))fail('所选卖点版式不支持当前比例');
      return {id:ref.id,version:ref.version,name:v.value.name,rules:v.value.prompt,ratios:v.value.layout?.ratios||[],textDensity:'简洁',fields:[],category:'通用'};
    })
      .map(item => ({ ...item, prompt: productPrompt(draft, item.prompt) }));
    for(const item of items) {
      if(item.references.length > model.maxReferences) fail(`${model.name}每项最多支持 ${model.maxReferences} 张参考图片`);
      for(const id of item.references){const a=store.get<Asset>('asset',id);if(!a||a.type!=='image')fail('本图商品参考已失效');}
      if(item.references.reduce((n,id)=>n+Math.ceil(store.get<Asset>('asset',id)!.bytes/3)*4,0)>30*1024*1024)fail('单项参考图编码后超过 30 MB');
    }
    const base = { ...(creativeContext ? { creativeContext } : {}), total: items.length, points: model.points === null ? null : model.points * items.length, items, skillId, skillRevision: skill.revision, skillHash: skill.hash, action };
    return { ...base, hash: digest(canonical(base)) };
  }
  if(skill.id==='image-replica'&&draft.count!==1)fail('每张对标原图仅生成一张，更多候选请单独重新生成');
  const editMap = skill.imageDesign === "edit"&&!pricingOnly ? editReferenceMap(draft,!skill.id.startsWith('ec-')) : "";
  const preparing = action === "prepareWhite";
  const targetRole = skill.batch.targetRole;
  const allTargets = targetRole ? draft.inputRoles[targetRole] || [] : [];
  const selected = [...new Set(draft.selectedTargetIds)];
  if (!preparing && targetRole && (!selected.length || selected.some((id) => !allTargets.includes(id)))) fail("请勾选有效的目标图");
  const targets: (string | undefined)[] = preparing || !targetRole ? [undefined] : selected;
  const ecommerceSpecs=preparing?undefined:ecommerceOutputSpecs(skill,draft);
  if(ecommerceSpecs&&!ecommerceSpecs.length)fail('请选择至少一个输出项目；SKU 图请填写 SKU 清单，套拍或矩阵图请添加主商品');
  const specs=ecommerceSpecs||[undefined];
  for(const spec of specs)if(spec?.aspectRatio&&!model.aspectRatios.includes(spec.aspectRatio))fail(`${model.name}不支持输出比例 ${spec.aspectRatio}，请更换模型或调整版式`);
  const total = preparing ? 1 : targets.length * draft.count * specs.length;
  if (total > store.settings().maxBatch) fail(`单批最多 ${store.settings().maxBatch} 项，当前 ${total} 项`);
  let dependencyTaskId: string | undefined;
  if (!preparing && skill.executor === "workflow" && draft.fields.whiteMode === "使用白底任务结果") {
    const dependency = store.get<Attempt>("attempt", draft.whiteTaskId || "") || fail("请选择一个白底任务");
    const batch = store.readBatch(dependency.batchId);
    if (batch?.action !== "prepareWhite") fail("绑定的任务不是白底任务");
    if (digest(batch.draft.inputRoles.product || []) !== digest(draft.inputRoles.product || [])) fail("白底任务属于另一组商品参考图");
    dependencyTaskId = dependency.id;
  }
  if (!preparing && skill.executor === "workflow" && draft.fields.whiteMode === "使用已有" && !draft.inputRoles.whiteAsset?.length) fail("请添加已有白底图");
  const items: PlanItem[] = [];
  for (const targetId of targets) {
    for(const spec of specs){
    for (let variant = 1; variant <= (preparing ? 1 : draft.count); variant++) {
      const index = items.length + 1;
      const targetLabel = targetId ? skill.imageDesign === "edit" ? `图${draft.imageDesign?.bindings.find(b=>b.assetId===targetId)?.number??allTargets.indexOf(targetId)+1}` : `目标图 ${allTargets.indexOf(targetId) + 1}` : undefined;
      const override = targetId ? draft.overrides[targetId] : undefined;
      if(skill.id==='image-replica'&&!pricingOnly&&override?.productIds&&!override.productIds.length)fail('本图商品参考不能为空');
      if(skill.id==='image-replica' && !pricingOnly && !(override?.targetDescription || draft.fields.targetDescription || '').toString().trim())fail('请填写每张对标图的替换对象');
      const variables: Record<string, unknown> = {
        "user.requirements": draft.requirements, "item.index": index, "item.variant": variant,
        "batch.total": total, "target.label": targetLabel || "",
        "target.description": override?.targetDescription ?? draft.fields.targetDescription ?? "",
        ...Object.fromEntries(Object.entries(skill.fields).map(([key, field]) => {const control=ecommerceControls[skill.id]?.controls.find(c=>c.label===field.label);return [`fields.${key}`,control&&!ecommerceControlVisible(control,draft.fields,skill.fields)?'不适用':spec?.fieldValues?.[field.label]??draft.fields[key]??field.default??''];})),
      };
      const section = preparing ? "prompt.white-background" : skill.executor === "workflow" ? "prompt.replace" : skill.promptSection!;
      const prompt = productPrompt(draft,((skill.id==='image-replica'?renderPrompt(skill.sections[section],variables)+(override?.promptOverride?`\n本图补充要求：${override.promptOverride}`:" "):override?.promptOverride?.trim() || renderPrompt(skill.sections[section], variables))) + (skill.imageDesign === "replica" ? `\n${replicaRules(String(draft.fields.replicationType || "电商商品图"),String(draft.fields.replicationFidelity || "高度复刻"))}` : "") + (editMap ? `\n图片映射：${editMap}。本项只输出${targetLabel}，其余图片只作为参照。` : "")+(spec?`\n本次独立成品：${spec.label}。${spec.instruction}\n单张独立输出，不把其他任务的成品拼在本图中。`:'' )+(draft.outputInstructions?.[index-1]?wearContext?`\n本次只输出服饰穿戴第${index}张照片。具体要求：${draft.outputInstructions[index-1]}`:`\n这是有序图文中的第${index}页，本次只输出这一页。逐页内容与要求：${draft.outputInstructions[index-1]}`:""));
      const scopedFields=spec?.fieldValues?Object.fromEntries(Object.entries(draft.fields).map(([key,value])=>[key,spec.fieldValues?.[skill.fields[key]?.label]??value])):draft.fields;
      const controlInstructions=ecommerceControlInstructions(skill,{...draft,fields:scopedFields});
      const mask=targetId?draft.editMasks?.[targetId]:undefined;
      const references = [...new Set([...Object.entries(draft.inputRoles).flatMap(([role, ids]) => {
        if(spec?.inputRoles?.[role])return spec.inputRoles[role];
        if(skill.id === "image-replica" && role === "product" && override?.productIds)return override.productIds;
        if (draft.outputProductIds&&role=== "product")return draft.outputProductIds[index-1];
        if (draft.outputReferenceIds&&role === "reference")return [];
        if (role === targetRole) return skill.imageDesign === "edit" ? ids : targetId ? [targetId] : [];
        if (role === "whiteAsset") return !preparing && draft.fields.whiteMode === "使用已有" ? ids : [];
        return ids;
      }),...(draft.outputReferenceIds?.[index-1]||[]),...(mask?[mask.assetId]:[])])];
      if (references.length + (dependencyTaskId ? 1 : 0) > model.maxReferences) fail(`${model.name}每项最多 ${model.maxReferences} 张参考图片`);
      for(const id of references){const a=store.get<Asset>('asset',id);if(!a||a.type!=='image')fail('逐图参考图片已失效');}
      const encodedBytes = references.reduce((n, id) => n + Math.ceil(store.get<Asset>("asset", id)!.bytes / 3) * 4, 0);
      if (model.provider!=='token01' && encodedBytes > 30 * 1024 * 1024) fail("单项参考图编码后超过 30 MB");
      const format=spec?.aspectRatio?{aspectRatio:spec.aspectRatio}:followReference?ecommerceReferenceFormat(store,model,targetId||references[0],draft.parameters.resolution):{aspectRatio:draft.aspectRatio};
      items.push({
        index, variant, targetId, targetLabel:[targetLabel,spec?.label].filter(Boolean).join(' · ')||undefined, prompt:(mask?`${prompt}\n最后一张参考是当前原图的选区蒙版，不是内容素材。白色区域是允许编辑区域，黑色区域保持原图内容；不把蒙版颜色绘入成品。${mask.description}`:prompt)+controlInstructions, references, model,
        parameters: { ...draft.parameters, ...format, ...(model.category === "video" ? { duration: draft.duration } : {}), ...(preparing ? { background: "opaque" } : {}) },
        dependencyTaskId,
      });
    }
    }
  }
  if(model.provider==='token01'){for(const item of items){validateToken01Item(item);for(const id of item.references){if(store.get<Asset>('asset',id)!.bytes>20*1024*1024)fail('Token01 单张图片不得超过 20 MiB');}}}
  const base = { ...(creativeContext?{creativeContext}:{}), ...(wearContext?{wearContext}:{}), total, points: model.points === null ? null : model.points * total, items, skillId, skillRevision: skill.revision, skillHash: skill.hash, action };
  return { ...base, hash: digest(canonical(base)) };
}

const submissionFingerprint=(request:Submission)=>digest({ ...(request.creativeContext?{creativeContext:request.creativeContext}:{}), ...(request.wearContext?{wearContext:request.wearContext}:{}), ...(request.canvasNodeId?{canvasNodeId:request.canvasNodeId,...(request.canvasBoardId&&request.canvasBoardId!=='main'?{canvasBoardId:request.canvasBoardId}:{})}:{}), skillId: request.skillId, action: request.action, draft: request.draft, planHash: request.planHash,...(request.maximumCost!==undefined?{maximumCost:request.maximumCost}:{}) });
export function replaySubmission(store:Store,request:Submission){
  const fingerprint=submissionFingerprint(request);
  const previous = store.db.prepare("SELECT batch_id, fingerprint FROM workspace_idempotency WHERE workspace_id=? AND key=?").get(store.currentWorkspace(), request.idempotencyKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) fail("接单凭据已用于其他内容，请重新预览", 409);
    return { batch: store.readBatch(previous.batch_id as string)!, draft: store.readDraft(request.skillId), replayed: true };
  }
  return undefined;
}
export function submit(store: Store, request: Submission,quote?:import('../../packages/contracts').GenerationQuote,simulated=true) {
  const replay=replaySubmission(store,request);if(replay)return replay;
  const fingerprint=submissionFingerprint(request);
  const plan = compilePlan(store, request.skillId, request.draft, request.action,false,request.creativeContext,request.wearContext);
  if (plan.hash !== request.planHash) fail("技能、模型或计划已变更，请重新预览后提交", 409);
  const skill = store.skills().find((s) => s.id === request.skillId)!;
  return store.transaction(() => {
    const current = store.readDraft(skill.id);
    const context=request.creativeContext;
    if(context&&request.wearContext)fail('不能同时提交两种创作上下文');
    const wearSnapshot=request.wearContext?validateWearContext(store,request.wearContext,request.draft,skill.id):undefined;
    if(context?.remakeJobId){validateRemakeContext(store,context,request.draft,skill.id);}
    else if(context){
      const product=getCatalogProduct(store,context.productId),d=context.promotionWorkId?getPromotionDraft(store,context.productId,context.purpose as 'post'|'video',context.postMode,context.videoWorkflow):getCreativeDraft(store,context.productId,context.purpose);
      if(!!context.promotionWorkId!==!!context.promotionVersionId||context.promotionWorkId&&!['post','video'].includes(context.purpose))fail('推广作品关联不完整');
      if(context.promotionWorkId&&'workId' in d.value&&d.value.workId&&d.value.workId!==context.promotionWorkId)fail('作品草稿关联不一致');
      if(product.revision!==context.productRevision||d.revision!==context.draftRevision)fail('商品或创作草稿已更新，请重新预览',409);
      if(workshopSkill(context.purpose,d)!==skill.id||digest(canonical(context.promotionWorkId?promotionGeneration(store,product,d as import('../../packages/promotion').PromotionDraft):workshopGeneration(store,product,d)))!==digest(canonical(request.draft))||digest(context.promotionWorkId?submittedPromotionValue(d as import('../../packages/promotion').PromotionDraft).outputKeys:d.value.outputKeys)!==digest(context.outputKeys))fail('商品创作快照与计划不一致',409);
      if(context.outputKeys.length!==plan.items.length)fail('输出位置数量与生成计划不一致');
    }
    if (!context&&!request.wearContext&&!request.canvasNodeId&&request.expectedDraftRevision !== current.revision) fail("草稿版本已变更，请保留输入并重新预览", 409);
    const now = new Date().toISOString();
    const batch: Batch = {
      id: store.id("batch"), skillId: skill.id, skillName: skill.name, skillRevision: skill.revision,
      ...(request.canvasNodeId?{canvasNodeId:request.canvasNodeId,canvasBoardId:request.canvasBoardId||'main'}:{}),
      action: request.action, createdAt: now, draft: request.draft, simulated, attempts: [], ...(request.wearContext?{wearContext:request.wearContext}:{}), ...(context?{creativeContext:context,productSnapshot:getCatalogProduct(store,context.productId)}:{}),
    };
    store.put("batch", batch.id, batch);
    if(wearSnapshot)store.put('wear-job',batch.id,{batchId:batch.id,scope:request.wearContext!.scope,stage:request.wearContext!.stage,value:wearSnapshot,createdAt:now});
    for (const item of plan.items) {
      const attempt: Attempt = {
        id: store.id("attempt"), batchId: batch.id, itemId: store.id("item"), index: item.index,
        variant: item.variant, attemptNumber: 1, status: item.dependencyTaskId ? "waiting_dependency" : "queued",
        step: item.dependencyTaskId ? "等待指定白底任务" : "等待调度", revision: 1, prompt: item.prompt,
        references: item.references, targetId: item.targetId, dependencyTaskId: item.dependencyTaskId,
        model: item.model, parameters: item.parameters, createdAt: now, updatedAt: now,
        groupIndex: item.groupIndex, screenId: item.screenId, screenType: item.screenType, screenOrder: item.screenOrder,
        points: item.model.points, simulated,
        ...(!simulated?{credentialVersion:quote?.credentialVersion||credentialVault(store.dataDir).current(item.model.id)}:{}),
        reservedCost:quote?.items.find(row=>row.index===item.index)?.maximum,
      };
      store.put("attempt", attempt.id, attempt);
    }
    if(context?.remakeJobId)admitRemake(store,batch);
    else if(context?.promotionWorkId)admitPromotion(store,batch);
    const saved = !context&&!request.wearContext&&!request.canvasNodeId&&skill.executor === "media" ? store.saveDraft(skill.id, defaultDraft(skill, store.models()), current.revision) : current;
    store.db.prepare("INSERT INTO workspace_idempotency(workspace_id,key,batch_id,fingerprint) VALUES (?,?,?,?)").run(store.currentWorkspace(), request.idempotencyKey, batch.id, fingerprint);
    return { batch: store.readBatch(batch.id)!, draft: saved, replayed: false };
  });
}

export function retryAttempt(store: Store, id: string, revision: number, prompt?: string, admission?: Pick<Attempt, 'model' | 'reservedCost'> & {simulated?:boolean;credentialVersion?:string}) {
  return store.transaction(() => {
    const current = store.get<Attempt>("attempt", id) || fail("任务不存在", 404);
    if (current.revision !== revision) fail("任务状态已变化，请刷新", 409);
    if (!["completed", "failed"].includes(current.status)) fail("仅已完成或明确失败的任务可创建新尝试");
    const existing = store.list<Attempt>("attempt").filter((a) => a.itemId === current.itemId);
    if (existing.some((a) => !["completed", "failed"].includes(a.status))) fail("此项已有未结束的尝试", 409);
    if (current.status === "failed" && current.step === "保存失败") {
      const next = { ...current, status: "saving" as const, error: undefined, dueAt: Date.now(), revision: current.revision + 1 };
      store.put("attempt", id, next);
      return next;
    }
    const now = new Date().toISOString();
    const next: Attempt = {
      ...current, ...admission, id: store.id("attempt"), attemptNumber: Math.max(...existing.map((a) => a.attemptNumber)) + 1,
      prompt: prompt?.trim() || current.prompt, status: current.dependencyTaskId ? "waiting_dependency" : "queued",
      credentialVersion:(admission?.simulated??current.simulated)?undefined:admission?.credentialVersion||credentialVault(store.dataDir).current((admission?.model||current.model).id),upstreamTaskId:undefined,resultUrl:undefined,submittedAt:undefined,nextPollAt:undefined,billing:undefined,
      step: "等待调度", assetId: undefined, error: undefined, dueAt: undefined, revision: 1, createdAt: now, updatedAt: now,
    };
    store.put("attempt", next.id, next);
    return next;
  });
}

export function editAttempt(store: Store, id: string, revision: number, prompt: string, rebindOriginal = false) {
  return store.transaction(() => {
    const attempt = store.get<Attempt>("attempt", id) || fail("任务不存在", 404);
    if (attempt.revision !== revision) fail("任务状态已变化，请刷新后编辑", 409);
    if (!editableStatuses.includes(attempt.status)) fail("该请求已提交，修改只能用于新尝试", 409);
    if (!prompt.trim() || prompt.length > 16000) fail("提示词不能为空或超过 16000 字");
    const next: Attempt = {
      ...attempt, prompt, revision: revision + 1, updatedAt: new Date().toISOString(),
      ...(rebindOriginal ? { dependencyTaskId: undefined, status: "queued", step: "已明确改用商品原图" } : {}),
    };
    store.put("attempt", id, next);
    return next;
  });
}

export function createWorker(store: Store, options: { interval?: number; generationMs?: number; savingMs?: number } = {}) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastBatch = "";
  let running = false;
  const change = (attempt: Attempt, patch: Partial<Attempt>) => {
    const next = { ...attempt, ...patch, updatedAt: new Date().toISOString(), revision: attempt.revision + 1 };
    store.put("attempt", next.id, next);
    return next;
  };
  function saveResult(attempt: Attempt) {
    const video = attempt.model.category === "video";
    const sourceAsset = [attempt.targetId, ...attempt.references].filter(Boolean)
      .map((id) => store.get<Asset>("asset", id!)).find((asset) => asset?.type === "image");
    const sourceFile = video ? path.join(store.projectRoot, `public/examples/demo-${attempt.parameters.aspectRatio === "16:9" ? "landscape" : "portrait"}-${attempt.parameters.duration}.mp4`)
      : sourceAsset ? path.join(sourceAsset.source === "example" ? path.join(store.projectRoot, "public/examples") : path.join(store.dataDir, "media"), path.basename(sourceAsset.url))
      : path.join(store.projectRoot, "public/examples", `10-${((attempt.index - 1) % 4) + 1}.jpg`);
    const ext = video ? ".mp4" : path.extname(sourceFile);
    const assetId = `output-${attempt.id}`;
    const filename = `${assetId}${ext}`;
    const destination = path.join(store.dataDir, "media", filename);
    fs.copyFileSync(sourceFile, destination + ".tmp");
    const fd = fs.openSync(destination + ".tmp", "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(destination + ".tmp", destination);
    const asset: Asset = {
      id: assetId, url: `/media/${filename}`, type: video ? "video" : "image",
      mime: video ? "video/mp4" : sourceAsset?.mime || "image/jpeg",
      bytes: fs.statSync(destination).size, createdAt: new Date().toISOString(), source: "simulator",
    };
    store.transaction(() => {
      store.put("asset", asset.id, asset);
      change(attempt, { status: "completed", step: "本地模拟素材已保存", assetId, dueAt: undefined, error: undefined });
      const batch = store.readBatch(attempt.batchId)!;
      const entry: LedgerEntry = {
        id: `ledger-${attempt.id}`, attemptId: attempt.id, batchId: batch.id, skillId: batch.skillId,
        modelId: attempt.model.id, modelName: attempt.model.name, points: attempt.points,
        createdAt: new Date().toISOString(), simulated: true,
      };
      store.db.prepare("INSERT OR IGNORE INTO ledger(attempt_id,value) VALUES (?,?)").run(attempt.id, JSON.stringify(entry));
    });
  }
  function tick() {
    if (running) return;
    running = true;
    try {
      for (const attempt of store.list<Attempt>("attempt").filter(a=>a.simulated)) {
        if (["waiting_dependency", "blocked_dependency"].includes(attempt.status)) {
          const dep = store.get<Attempt>("attempt", attempt.dependencyTaskId || "");
          if (dep?.status === "completed" && dep.assetId) store.transaction(() => change(attempt, {
            status: "queued", step: "白底图已绑定，等待调度", references: [...new Set([...attempt.references, dep.assetId!])],
          }));
          else if ((!dep || ["failed", "pending_verification"].includes(dep.status)) && attempt.status !== "blocked_dependency") {
            store.transaction(() => change(attempt, { status: "blocked_dependency", step: "白底任务异常，请明确重试或改用原图" }));
          }
        }
        if (attempt.status === "generating" && (attempt.dueAt || 0) <= Date.now()) {
          store.transaction(() => change(attempt, { status: "saving", step: "保存本地模拟素材", dueAt: Date.now() + (options.savingMs ?? 700) }));
        }
        if (attempt.status === "saving" && (attempt.dueAt || 0) <= Date.now()) {
          try { saveResult(attempt); } catch (error) {
            store.transaction(() => change(attempt, { status: "failed", step: "保存失败", error: (error as Error).message, dueAt: undefined }));
          }
        }
      }
      for (const category of ["image", "video"] as const) {
        const attempts = store.list<Attempt>("attempt").filter(a=>a.simulated);
        const limit = category === "image" ? store.settings().imageConcurrency : store.settings().videoConcurrency;
        const active = attempts.filter((a) => a.model.category === category && ["generating", "saving"].includes(a.status)).length;
        const queue = attempts.filter((a) => a.model.category === category && a.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (let slot = active; slot < limit && queue.length; slot++) {
          const batchIds = [...new Set(queue.map((a) => a.batchId))];
          const nextBatch = batchIds[(batchIds.indexOf(lastBatch) + 1) % batchIds.length];
          const index = queue.findIndex((a) => a.batchId === nextBatch);
          const [attempt] = queue.splice(index, 1);
          lastBatch = nextBatch;
          store.transaction(() => change(attempt, { status: "generating", step: "本地模拟执行中", dueAt: Date.now() + (options.generationMs ?? 2200) }));
        }
      }
    } finally { running = false; }
  }
  return {
    tick,
    start() { if (!timer) timer = setInterval(tick, options.interval ?? 350); },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
