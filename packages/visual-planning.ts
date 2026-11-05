import {z} from 'zod';
export const visualPlanningSchema=z.object({
 schemaVersion:z.literal(1),visibleFeatures:z.array(z.string()).max(20),providedFacts:z.array(z.string()).max(20),missing:z.array(z.string()).max(20),
 style:z.string().min(1).max(3000),suggestion:z.string().max(4000),
 slots:z.array(z.object({id:z.string().max(100),theme:z.string().max(500),evidence:z.string().max(1000),requirements:z.string().max(2000)})).max(40),
});
export type VisualPlanning=z.infer<typeof visualPlanningSchema>;
export const listingCopySchema=z.object({schemaVersion:z.literal(1),title:z.string().max(300),sellingPoints:z.array(z.string().max(500)).max(12),description:z.string().max(3000),missing:z.array(z.string()).max(20)});
export const visualPlanningInstruction='你是电商运营和商品视觉设计师。只返回 JSON，不加代码围栏。字段 schemaVersion 固定为1；visibleFeatures、providedFacts、missing 为字符串数组，分别区分直接可见特征、用户提供事实和待补资料；style 为整套配色、场景、人物姿态、光线、构图与文字层级；suggestion 为购买动机与表达策略建议，不作流量承诺；slots 为数组，每项有 id（必须对应输入的输出位置）、theme、evidence、requirements。按输入数量逐张规划独立卖点、场景及其他明确用途。商品颜色与适用规格不可混淆。不编造材料成分、精确尺码、功效、销量或已验证爆款结论。';
export const listingCopyInstruction='只返回 JSON，不加代码围栏，schemaVersion 为1，title 为商品标题，sellingPoints 为短句数组，description 为商品简介，missing 为待补资料数组。仅使用用户提供的明确事实与直接可见外观；不补造面料成分、尺码、价格、功效、销量、认证或承诺。不发布商品。';
