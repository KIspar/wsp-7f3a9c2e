import { z } from 'zod';
import type { Asset } from './contracts';
export const analysisModelIds = ['tt-6.1-sol','gem-3.8-flash','gem-4-argon'] as const;
export type AnalysisModelId = typeof analysisModelIds[number];
export const analysisInputSchema = z.object({
  action:z.enum(['research-evidence','research-summary','research-strategy','visual-planning','listing-copy','ecommerce-text','shot-reverse','reference-inspiration','polish','selling-points','reverse-image','reverse-video','verify-image','workbench-images','workbench-analysis','workbench-directions','workbench-scripts','workbench-prompts','workbench-audit','workbench-repair']),
  text:z.string().max(16000).default(''), productName:z.string().max(500).default(''),
  assetIds:z.array(z.string().max(100)).max(4).default([]), imageNumbers:z.array(z.number().int().positive().max(999)).max(4).optional(), skillId:z.string().max(100).optional(),
  idempotencyKey:z.string().min(8).max(100),
  modelId:z.enum(analysisModelIds).optional(), maximumCost:z.number().finite().positive().optional(),
  verificationModel:z.enum(analysisModelIds).optional(), expectedTerms:z.array(z.string().min(1).max(80)).max(12).optional(),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type VisionVerification = { status:'unverified'|'pending'|'passed'|'failed'; jobId?:string; reason?:string; credentialVersion?:string };
export type AnalysisModel = {
  id:AnalysisModelId; name:string; enabled:boolean; revision:number;
  capabilities:('text'|'image'|'video')[]; credentialConfigured:boolean; vision:VisionVerification;
};
export type AnalysisSettings = { defaultModelId:AnalysisModelId; concurrency:1; language:'zh-CN' };
export type AnalysisJob = {
  id:string; workspaceId?:string; input:AnalysisInput; fingerprint:string; model:AnalysisModel; credentialVersion:string;
  assets:(Asset & {sha256:string;duration?:number})[];
  status:'queued'|'preparing'|'submitting'|'completed'|'failed'|'unknown';
  createdAt:string; updatedAt:string; simulated:false;
  preview?:{url:string;bytes:number;width:number;height:number;sha256:string};
  result?:string; error?:string; upstreamTaskId?:string;
  usage?:{inputTokens:number;outputTokens:number;totalTokens:number};
  billing:{status:'pending'|'final'|'unavailable';cost?:number;inputTokens?:number;outputTokens?:number;checkedAt?:string;nextPollAt?:string;error?:string;isFinal?:boolean;state?:string;refunded?:boolean;refundedAmount?:number;channelGroup?:string;errorCode?:string};
};
export const analysisActionLabels:Record<AnalysisInput['action'],string> = {'research-evidence':'商品证据分析','research-summary':'商品洞察汇总','research-strategy':'创作方案编排','visual-planning':'爆款风格分析','listing-copy':'商品上架文案','ecommerce-text':'电商文案与检测','shot-reverse':'分镜反推','reference-inspiration':'提取画面灵感',polish:'AI 润色','selling-points':'提炼卖点','reverse-image':'参考图反推','reverse-video':'视频反推','verify-image':'本地识图验证','workbench-images':'工作台图片识读','workbench-analysis':'工作台卖点分析','workbench-directions':'工作台方向策划','workbench-scripts':'工作台脚本分镜','workbench-prompts':'工作台提示词细化','workbench-audit':'工作台内容检查','workbench-repair':'工作台局部修正'};
export const analysisStatusLabels:Record<AnalysisJob['status'],string> = {queued:'排队中',preparing:'准备素材',submitting:'分析中',completed:'已完成',failed:'失败',unknown:'提交结果待核实'};
