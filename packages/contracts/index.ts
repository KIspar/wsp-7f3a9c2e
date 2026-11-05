import {wearContextSchema,type WearContext} from '../wear';
import {promptReferenceSchema} from '../prompt-reference';
import { z } from "zod";

export const statusLabels = {
  queued: "排队中",
  generating: "生成中",
  saving: "保存中",
  completed: "已完成",
  failed: "失败",
  waiting_dependency: "等待白底图",
  blocked_dependency: "等待白底图处理",
  pending_verification: "待核实",
} as const;
export type TaskStatus = keyof typeof statusLabels;
export const activeStatuses: TaskStatus[] = ["generating", "saving"];
export const editableStatuses: TaskStatus[] = ["queued", "waiting_dependency", "blocked_dependency"];

export const fieldSchema = z.object({
  label: z.string(),
  type: z.enum(["text", "select", "number", "boolean"]),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type SkillField = z.infer<typeof fieldSchema>;
export const skillSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.enum(["image", "video", "agent"]),
  description: z.string(),
  executor: z.enum(["media", "workflow"]),
  imageDesign: z.enum(["general", "replica", "detail", "edit", "kit"]).optional(),
  inputs: z.record(z.string(), z.object({
    label: z.string(), mediaType: z.literal("image"),
    cardinality: z.enum(["group", "targets", "single"]), required: z.boolean(),
  })),
  fields: z.record(z.string(), fieldSchema),
  batch: z.object({
    mode: z.enum(["repeat", "per-target", "screens"]),
    countField: z.string().optional(), defaultCount: z.number().optional(),
    targetRole: z.string().optional(), variantsField: z.string().optional(),
    defaultVariants: z.number().optional(), selectionField: z.string().optional(),
    perTargetOverrides: z.array(z.string()).optional(),
  }),
  model: z.object({ category: z.enum(["image", "video"]), defaultId: z.string() }),
  promptSection: z.string().optional(),
  actions: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type SkillDefinition = z.infer<typeof skillSchema>;
export type Skill = SkillDefinition & {
  revision: number;
  hash: string;
  sections: Record<string, string>;
  source: string;
  unpublished: boolean;
};
export const modelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  category: z.enum(["image", "video"]),
  upstreamId: z.string().min(1),
  enabled: z.boolean(),
  provider: z.enum(["chuhe", "token01", "simulator"]),
  credentialConfigured: z.boolean().optional(),
  relayAvailable: z.boolean().optional(),
  token01Group: z.string().min(1).max(100).optional(),
  token01KeyId: z.string().uuid().optional(),
  revision: z.number().int().positive(),
  maxReferences: z.number().int().min(0).max(16),
  aspectRatios: z.array(z.string()).min(1),
  durations: z.array(z.number().int().positive()),
  points: z.number().nonnegative().nullable(),
  parameters: z.record(z.string(), fieldSchema),
});
export type Model = z.infer<typeof modelSchema>;
export const settingsSchema = z.object({
  imageConcurrency: z.number().int().min(1).max(20),
  videoConcurrency: z.number().int().min(1).max(4),
  referenceQuota: z.number().min(0).nullable(),
  maxBatch: z.number().int().min(1).max(100),
  maxFileMb: z.number().int().min(1).max(30),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Asset = {
  id: string; url: string; type: "image" | "video" | "audio"; mime: string;
  bytes: number; createdAt: string; source: "upload" | "example" | "simulator" | "provider" | "collection" | "template";
};
export const detailScreenTypes = ["首屏主视觉", "使用场景图", "场景氛围图", "品牌故事图", "效果对比图", "工艺制作图", "配件/赠品图", "售后保障图", "核心卖点图", "多角度图", "商品细节图", "尺寸/容量/尺码图", "详细规格/参数表", "系列展示图", "商品成分图", "使用建议图"] as const;
export const detailScreenSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(detailScreenTypes), requirements: z.string().max(4000), facts: z.string().max(8000), productIds:z.array(z.string()).max(16).optional(), scopeLabel:z.string().max(300).optional(),
});
export type DetailScreen = z.infer<typeof detailScreenSchema>;
export const imageDesignDraftSchema = z.object({
  groupCount: z.number().int().min(1).max(100),
  screens: z.array(detailScreenSchema).max(40),
  bindings: z.array(z.object({ assetId: z.string(), number: z.number().int().positive() })).max(300),
  nextNumber: z.number().int().positive(),
});
export type ImageDesignDraft = z.infer<typeof imageDesignDraftSchema>;
export const emptyImageDesign = (): ImageDesignDraft => ({ groupCount: 1, screens: [], bindings: [], nextNumber: 1 });
export const productKitSchema = z.object({
  platformRulesVersion:z.literal('douyin-cn-v1').default('douyin-cn-v1'),
  whiteBackground: z.number().int().min(0).max(20).default(0),
  sellingPoints: z.number().int().min(3).max(20).default(3),
  scenes: z.number().int().min(2).max(20).default(2),
  other: z.number().int().min(2).max(20).default(2),
  otherPurposes: z.array(z.string().max(100)).max(20).default(['商品细节', '背面或另一角度']),
  slotRequirements: z.record(z.string(), z.string().max(3000)).default({}),
  slotProductIds: z.record(z.string(), z.array(z.string()).max(16)).default({}),
  layouts: z.array(z.object({id:z.string(),version:z.number().int().positive()})).max(20).default([]),
});
export type ProductKitDraft = z.infer<typeof productKitSchema>;
export const layoutSchema = z.object({
  attemptIds: z.array(z.string()).min(1).max(40), width: z.number().int().min(320).max(4096),
  gap: z.number().int().min(0).max(80), background: z.enum(["white", "gray", "black"]), format: z.enum(["png", "jpg"]),
});
export type LongImageLayout = z.infer<typeof layoutSchema>;
export const productProfileInputSchema = z.object({
  name: z.string().trim().min(1, '请填写商品名称').max(200),
  facts: z.string().max(8000),
  assetIds: z.array(z.string()).min(1, '请至少添加一张商品图').max(16),
});
export type ProductProfile = z.infer<typeof productProfileInputSchema> & { id: string; revision: number; updatedAt: string };
export type ResultSelection = { itemId: string; attemptId: string; updatedAt: string };
export const draftSchema = z.object({
  workbenchSource:z.object({projectId:z.string().max(120),creationId:z.string().max(120),versionId:z.string().max(120),directionId:z.string().max(120),segmentId:z.string().max(120)}).optional(),
  promptTemplate: promptReferenceSchema.optional(),
  productContext: z.object({ id: z.string(), revision: z.number().int().positive(), name: z.string().max(200), facts: z.string().max(8000) }).optional(),
  requirements: z.string().max(16000),
  editMasks:z.record(z.string(),z.object({assetId:z.string().min(1).max(120),description:z.string().max(500)})).optional(),
  ecommerceTemplateAssets:z.record(z.string().max(120),z.string().min(1).max(120)).optional(),
  outputProductIds:z.array(z.array(z.string().min(1).max(120)).min(1).max(16)).max(100).optional(),
  outputReferenceIds:z.array(z.array(z.string().min(1).max(120)).max(1)).max(100).optional(),
  outputInstructions:z.array(z.string().max(4000)).max(100).optional(),
  modelId: z.string(),
  aspectRatio: z.string(),
  count: z.number().int().min(1).max(100),
  duration: z.number().int().min(1).max(60),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  inputRoles: z.record(z.string(), z.array(z.string()).max(100)),
  selectedTargetIds: z.array(z.string()).max(100),
  overrides: z.record(z.string(), z.object({
    targetDescription: z.string().optional(),
    productIds: z.array(z.string()).max(16).optional(),
    promptOverride: z.string().max(16000).optional(),
  })),
  whiteTaskId: z.string().optional(),
  imageDesign: imageDesignDraftSchema.optional(),
  productKit: productKitSchema.optional(),
  catalogScope:z.object({kind:z.enum(["product","color","sku"]),id:z.string().optional()}).optional(),
  imageAssistance:z.object({visualJobId:z.string().optional(),listingJobId:z.string().optional(),appliedJobIds:z.array(z.string()).default([])}).optional(),
});
export type Draft = z.infer<typeof draftSchema>;
export type SavedDraft = { skillId: string; revision: number; value: Draft };
export const creativeContextSchema=z.object({remakeJobId:z.string().optional(),remakeShotId:z.string().optional(),remakePlanId:z.string().optional(),remakeEpoch:z.number().int().nonnegative().optional(),remakeStage:z.enum(['frame','video']).optional(),videoWorkflow:z.enum(['direct','reverse','shot-remake']).optional(),postMode:z.enum(['creative','replicate']).optional(),promotionWorkId:z.string().optional(),promotionVersionId:z.string().optional(),productId:z.string(),productRevision:z.number().int().positive(),purpose:z.enum(["main","detail","sku","post","video"]),draftRevision:z.number().int().nonnegative(),outputKeys:z.array(z.string().min(1).max(120)).min(1).max(100)});
export type CreativeContext=z.infer<typeof creativeContextSchema>;
export const submissionSchema = z.object({
  creativeContext:creativeContextSchema.optional(),
  wearContext:wearContextSchema.optional(),
  skillId: z.string(),
  draft: draftSchema,
  action: z.enum(["generate", "prepareWhite", "replaceSelected"]).default("generate"),
  idempotencyKey: z.string().min(8).max(100),
  planHash: z.string(),
  expectedDraftRevision: z.number().int().nonnegative().optional(),
  maximumCost: z.number().finite().nonnegative().optional(),
});
export type Submission = z.infer<typeof submissionSchema>;
export type PlanItem = {
  index: number; variant: number; targetId?: string; targetLabel?: string;
  prompt: string; references: string[]; model: Model; parameters: Record<string, unknown>;
  dependencyTaskId?: string;
  groupIndex?: number; screenId?: string; screenType?: string; screenOrder?: number;
};
export type GenerationQuote = {
  credentialVersion?:string;checkedAt:string;balance:number|null;keyRemaining:number|null;reserved:number;available:number|null;
  minimum:number;maximum:number;affordable:boolean;unit:'算力'|'元';provider?:'token01';note?:string;
  items:{index:number;minimum:number;maximum:number;channels:number}[];
};
export type Plan = {
  hash: string; total: number; points: number | null; items: PlanItem[];
  skillId: string; skillRevision: number; skillHash: string; action: Submission["action"];
  quote?: GenerationQuote;
  wearContext?: WearContext;
};
export type Attempt = {
  id: string; batchId: string; itemId: string; index: number; variant: number;
  attemptNumber: number; status: TaskStatus; step: string; revision: number;
  prompt: string; references: string[]; targetId?: string; dependencyTaskId?: string;
  model: Model; parameters: Record<string, unknown>;
  groupIndex?: number; screenId?: string; screenType?: string; screenOrder?: number;
  assetId?: string; createdAt: string; updatedAt: string; dueAt?: number;
  error?: string; points: number | null; simulated: boolean;
  credentialVersion?: string; upstreamTaskId?: string; resultUrl?: string; submittedAt?: string; nextPollAt?: number;
  reservedCost?: number; billing?: {cost?:number;isFinal:boolean;refunded?:boolean;refundedAmount?:number;inputTokens?:number;outputTokens?:number;channelGroup?:string;unit?:'算力'|'元';note?:string};
};
export type Batch = {
  id: string; skillId: string; skillName: string; skillRevision: number;
  action: Submission["action"]; createdAt: string; draft: Draft;
  attempts: Attempt[]; simulated: boolean; wearContext?:WearContext; creativeContext?:CreativeContext; productSnapshot?:unknown;
};
export type LedgerEntry = {
  id: string; attemptId: string; batchId: string; skillId: string;
  modelId: string; modelName: string; points: number | null; createdAt: string;
  simulated: boolean; cost?:number; refunded?:boolean; refundedAmount?:number; upstreamTaskId?:string;unit?:'算力'|'元';
};
export type Snapshot = {
  batches: Batch[]; assets: Asset[]; ledger: LedgerEntry[]; eventId: number;
  products?: ProductProfile[]; selections?: ResultSelection[];
};
export type Bootstrap = {
  skills: Skill[]; models: Model[]; settings: Settings; drafts: SavedDraft[];
  examples: Asset[]; health: { database: boolean; worker: boolean; freeBytes: number | null; mode: "live" | "simulator" };
};

export function defaultDraft(skill: Skill, models: Model[]): Draft {
  const model = models.find((m) => m.id === skill.model.defaultId && m.enabled)
    || models.find((m) => m.category === skill.model.category && m.enabled);
  return {
    requirements: "", modelId: model?.id || "",
    aspectRatio: (skill.id.startsWith('ec-')||skill.imageDesign === "kit") && model?.aspectRatios.includes("1:1") ? "1:1" : model?.aspectRatios.includes("3:4") ? "3:4" : model?.aspectRatios[0] || "",
    count: skill.batch.defaultCount || (skill.imageDesign === "kit" ? 7 : 1), duration: model?.durations[0] || 6,
    fields: Object.fromEntries(Object.entries(skill.fields).map(([key, field]) => [key, field.default ?? ""])),
    parameters: Object.fromEntries(Object.entries(model?.parameters || {}).map(([key, field]) => [key, skill.imageDesign === "kit" && key === "resolution" && field.options?.includes("2K") ? "2K" : field.default ?? ""])),
    inputRoles: {}, selectedTargetIds: [], overrides: {},
    ...(skill.imageDesign ? { imageDesign: { ...emptyImageDesign(), screens: skill.imageDesign === "detail" ? [
      {id: "first-screen", type: "首屏主视觉" as const, requirements: "", facts: ""},
      {id: "selling-points", type: "核心卖点图" as const, requirements: "", facts: ""},
      {id: "scene", type: "使用场景图" as const, requirements: "", facts: ""},
      {id: "angles", type: "多角度图" as const, requirements: "", facts: ""},
      {id: "mood", type: "场景氛围图" as const, requirements: "", facts: ""},
      {id: "detail", type: "商品细节图" as const, requirements: "", facts: ""},
    ] : [] } } : {}),
    ...(skill.imageDesign === "kit" ? { productKit: productKitSchema.parse({}) } : {}),
  };
}

/** Reopen history against today's form while retaining the original batch snapshot. */
export function restoreDraft(skill: Skill, models: Model[], source: Draft): Draft {
  const defaults = defaultDraft(skill, models);
  const model = models.find(m => m.id === source.modelId);
  const roles = { ...source.inputRoles };
  if (skill.imageDesign === "general" && !roles.product) roles.product = roles.references || [];
  if (skill.imageDesign === "replica" && skill.inputs.reference && !roles.reference) roles.reference = roles.targets || [];
  return {
    ...defaults, ...source,
    fields: Object.fromEntries(Object.entries(skill.fields).map(([key, field]) => [key, source.fields[key] ?? field.default ?? ""])),
    parameters: Object.fromEntries(Object.entries(model?.parameters || {}).map(([key, field]) => [key, source.parameters[key] ?? field.default ?? ""])),
    // Keep excess single-role inputs visible so the user can correct them explicitly.
    inputRoles: Object.fromEntries(Object.keys(skill.inputs).map(role => [role, roles[role] || []])),
    selectedTargetIds: skill.batch.targetRole ? source.selectedTargetIds.filter(id => roles[skill.batch.targetRole!]?.includes(id)) : [],
    ...(skill.imageDesign ? { imageDesign: source.imageDesign || defaults.imageDesign } : {}),
  };
}

export function batchStatus(batch: Batch): TaskStatus {
  const latest = new Map<string, Attempt>();
  for (const attempt of batch.attempts) {
    const previous = latest.get(attempt.itemId);
    if (!previous || previous.attemptNumber < attempt.attemptNumber) latest.set(attempt.itemId, attempt);
  }
  const order: TaskStatus[] = ["pending_verification", "blocked_dependency", "generating", "saving", "waiting_dependency", "queued", "failed"];
  return order.find((s) => [...latest.values()].some((a) => a.status === s)) || "completed";
}
