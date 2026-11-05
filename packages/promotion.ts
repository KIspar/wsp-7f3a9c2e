import {z} from 'zod';
import {creativeValueSchema,type ProductCreativeDraft} from './catalog';
import type {Asset,Batch} from './contracts';
import type {WearJob} from './wear';
import {minimumPostPages} from './post-plan';
export const postModes=['creative','replicate'] as const;
export type PostMode=typeof postModes[number];
export const postModeOf=(value:{postMode?:PostMode;benchmarkImages?:string[]})=>value.postMode||(value.benchmarkImages?.length?'replicate':'creative');
export const promotionValueSchema=creativeValueSchema.extend({postMode:z.enum(postModes).optional(),replicationType:z.enum(['电商商品图','服饰电商图','营销海报','社媒图文','创意海报','其他']).optional(),replicationFidelity:z.enum(['参考风格','高度复刻']).optional(),imageNoText:z.boolean().optional(),postTemplatePages:z.array(z.object({title:z.string().max(100),prompt:z.string().max(4000)})).max(20).optional(),inspirationImages:z.array(z.string().min(1).max(120)).max(4).optional(),selectedBenchmarkIds:z.array(z.string().min(1).max(120)).max(20).optional(),replacementObject:z.string().max(500).optional(),targetSettings:z.record(z.string(),z.object({outputKey:z.string().min(1).max(120),productIds:z.array(z.string().min(1).max(120)).max(16).optional(),replacementObject:z.string().max(500).optional(),requirements:z.string().max(3000).optional()})).optional(),analysisEpoch:z.string().max(120).optional(),benchmarkImages:z.array(z.string().min(1).max(120)).max(20).default([]),referenceSourceUrl:z.string().max(2000).default(''),remakeJobId:z.string().optional(),remakeCompositionId:z.string().optional(),composedDuration:z.number().positive().max(120).optional(),videoWorkflow:z.enum(['direct','reverse','shot-remake']).default('direct'),title:z.string().max(500).default(''),body:z.string().max(16000).default(''),workId:z.string().optional(),sourceWorkId:z.string().optional(),sourceVersionId:z.string().optional(),sourceStructure:z.string().max(200000).optional()});
export type PromotionValue=z.infer<typeof promotionValueSchema>;
/** Upgrade an editable creative draft only; immutable task/version snapshots stay untouched. */
export function ensureCreativePostPages(value:PromotionValue,newKey:(index:number)=>string=()=>crypto.randomUUID()):PromotionValue {
 if(postModeOf(value)!=='creative'||value.generation.count>=minimumPostPages)return value;
 const outputKeys=Array.from({length:minimumPostPages},(_,i)=>value.outputKeys[i]||newKey(i));
 return {...value,outputKeys,generation:{...value.generation,count:minimumPostPages}};
}
export type PromotionDraft=Omit<ProductCreativeDraft,'value'|'purpose'>&{purpose:'post'|'video';value:PromotionValue};
export type PromotionWork={id:string;productId:string;type:'post'|'video';name:string;revision:number;createdAt:string;archived:boolean;confirmedVersionId?:string;sourceWorkId?:string;sourceVersionId?:string};
export type PromotionVersion={id:string;workId:string;createdAt:string;confirmed:boolean;legacy:boolean;value:PromotionValue;batchIds:string[];selection:Record<string,string>;media:Record<string,string>};
export const performanceSchema=z.object({versionId:z.string(),publicationId:z.string().min(1).max(120),url:z.string().max(2000).default(''),publishedAt:z.string().default(''),recordedAt:z.iso.datetime(),plays:z.number().int().nonnegative().nullable(),likes:z.number().int().nonnegative().nullable(),comments:z.number().int().nonnegative().nullable(),favorites:z.number().int().nonnegative().nullable(),shares:z.number().int().nonnegative().nullable(),orders:z.number().int().nonnegative().nullable(),revenue:z.number().nonnegative().nullable(),notes:z.string().max(4000).default('')});
export type PromotionPerformanceRecord=z.infer<typeof performanceSchema>&{id:string;manual:true};
export type PromotionEntry={work:PromotionWork;versions:PromotionVersion[];batches:Batch[];worthyVersionIds:string[];records:PromotionPerformanceRecord[]};
export type PromotionList={items:PromotionEntry[];total:number;assets:Asset[]};
/** Optional workshop feed combines types before filtering and pagination. */
export type ContentTaskList=PromotionList&{wearItems:WearJob[];order:string[]};
