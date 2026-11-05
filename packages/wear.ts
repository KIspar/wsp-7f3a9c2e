import {z} from 'zod';
import type {Asset,Batch,Attempt} from './contracts';
export const wearScenes=['纯色棚拍','都市街头','街角咖啡','自然草坪','度假海滩','温馨居家','艺术展馆'] as const;
export const wearProfileOptions={gender:['男','女'],age:['婴儿','儿童','青少年','青年','中年','老年'],appearance:['欧美白人','中国人','亚洲人','东南亚人','非裔','中东人','拉丁裔'],body:['纤细','标准','肌肉','微胖','大码']} as const;
export const wearValueSchema=z.object({
 productIds:z.array(z.string().min(1).max(120)).max(6).refine(ids=>new Set(ids).size===ids.length,'服装图片不能重复').default([]),modelSource:z.enum(['library','ai','upload']).default('library'),modelAssetId:z.string().max(120).default(''),
 scenes:z.array(z.enum(wearScenes)).max(7).refine(s=>new Set(s).size===s.length,'场景不能重复').default(['纯色棚拍']),customScene:z.string().max(1000).default(''),recommend:z.boolean().default(true),poses:z.number().int().min(1).max(4).default(3),requirements:z.string().max(6000).default(''),
 modelId:z.string().default('tt-image'),aspectRatio:z.enum(['3:4','1:1','9:16']).default('3:4'),resolution:z.enum(['1K','2K']).default('1K'),
 profile:z.object({gender:z.enum(wearProfileOptions.gender).default('女'),age:z.enum(wearProfileOptions.age).default('青年'),appearance:z.enum(wearProfileOptions.appearance).default('中国人'),body:z.enum(wearProfileOptions.body).default('标准'),details:z.string().max(1500).default('')}).prefault({}),
});
export const wearContextSchema=z.object({scope:z.string().min(1).max(120),draftRevision:z.number().int().nonnegative(),stage:z.enum(['model','outfit']),productRevision:z.number().int().positive().optional()});
export type WearContext=z.infer<typeof wearContextSchema>;
export type WearValue=z.infer<typeof wearValueSchema>;
export type WearDraft={id:string;revision:number;value:WearValue};
export type WearLibrary={models:{id:string;name:string;asset:Asset}[];scenes:string[]};
export type WearJob={legacy?:boolean;batchId:string;scope:string;stage:'model'|'outfit';value:WearValue;createdAt:string;batch:Batch};
export type WearJobs={items:WearJob[];total:number;assets:Asset[]};
export function latestWearAttempts(batch:Batch):Attempt[]{
 const latest=new Map<number,Attempt>();for(const a of batch.attempts){const old=latest.get(a.index);if(!old||a.attemptNumber>old.attemptNumber||a.attemptNumber===old.attemptNumber&&a.createdAt>old.createdAt)latest.set(a.index,a);}return [...latest.values()].sort((a,b)=>a.index-b.index);
}
export const wearOutputCount=(value:WearValue)=> (value.scenes.length+(value.customScene.trim()?1:0))*value.poses;
