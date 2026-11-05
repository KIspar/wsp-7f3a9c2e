import {promptReferenceSchema} from './prompt-reference';
import {promptShotSchema} from './prompts';
import {z} from 'zod';
import type {Asset,Attempt,Batch,Draft,Plan,CreativeContext} from './contracts';
export const videoWorkflows=['direct','reverse','shot-remake'] as const;
export type VideoWorkflow=typeof videoWorkflows[number];
export const remakeInputSchema=z.object({promptTemplate:promptReferenceSchema.optional(),templateScript:z.string().max(16000).optional(),templateShots:z.array(promptShotSchema).max(20).optional(),sourceVideoId:z.string().min(1),productIds:z.array(z.string()).min(1).max(15),replacementObject:z.string().trim().min(1).max(500),requirements:z.string().max(8000).default(''),aspectRatio:z.enum(['9:16','16:9','1:1','3:2','2:3']).default('9:16'),resolution:z.enum(['720p','480p']).default('720p'),audioMode:z.enum(['original','replacement','silent']).default('original'),audioAssetId:z.string().optional(),imageModelId:z.string().default('tt-image'),idempotencyKey:z.string().min(8).max(100),sourceJobId:z.string().optional()});
export type RemakeInput=z.infer<typeof remakeInputSchema>;
export const shotTextSchema=z.object({scene:z.string().max(3000).default(''),person:z.string().max(3000).default(''),action:z.string().max(3000).default(''),camera:z.string().max(3000).default(''),replacement:z.string().max(3000).default(''),framePrompt:z.string().max(6000).default(''),videoPrompt:z.string().max(6000).default(''),uncertainty:z.string().max(3000).default('')});
export type ShotText=z.infer<typeof shotTextSchema>;
export type VideoRemakeShot={id:string;revision:number;epoch?:number;start:number;end:number;frames:string[];text:ShotText;transcript:string;frameBatchIds:string[];videoBatchIds:string[];analyses:{id:string;revision:number;applied?:boolean}[];selectedFrameId?:string;selectedVideoId?:string;videoFrameId?:string;error?:string};
export type RemakeComposition={id:string;revision:number;assetId:string;createdAt:string;shots:VideoRemakeShot[];input?:RemakeInput;audioMode:RemakeInput['audioMode'];audioAssetId?:string;confirmedVersionId?:string};
export type VideoRemakeJob={id:string;workspaceId?:string;productId:string;productRevision:number;productTitle:string;revision:number;createdAt:string;updatedAt:string;input:RemakeInput;status:'queued'|'extracting'|'ready'|'composing'|'completed'|'failed'|'cancelled';step:string;duration?:number;hasAudio?:boolean;shots:VideoRemakeShot[];compositions:RemakeComposition[];error?:string;localAction?:'extract'|'compose'|'frames';folder:string;pendingComposition?:{id:string;shots:VideoRemakeShot[];revision:number};audioFile?:string;transcript?:string;range?:{start:number;end:number};workId?:string;sourceCompositionId?:string;transcriptSegments?:{start:number;end:number;text:string}[];frameRefresh?:boolean;summary?:{mediaCost:number;analysisCost:number;pending:number;failed:number;stage:string}};
export type RemakeDetail={job:VideoRemakeJob;assets:Asset[];batches:Batch[];analyses:import('./analysis').AnalysisJob[]};
export type RemakePlan=Plan&{id:string;draft:Draft;creativeContext:CreativeContext};
export const remakeStages={queued:'等待拆解',extracting:'本地拆解中',ready:'分镜制作',composing:'本地合成中',completed:'成片已保存',failed:'处理失败',cancelled:'已停止'} as const;
export function validateTimeline(shots:Pick<VideoRemakeShot,'id'|'start'|'end'>[],start:number,end:number){
 if(!shots.length||shots.length>20)throw Error('每项任务需要 1–20 个镜头，请调整范围或拆任务');
 if(new Set(shots.map(s=>s.id)).size!==shots.length)throw Error('镜头标识不能重复');
 let cursor=start;for(const s of shots){if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||Math.abs(s.start-cursor)>.001||s.end<=s.start||s.end-s.start>15.001)throw Error('镜头须连续覆盖选定范围，单镜头时长不能超过 15 秒');cursor=s.end;}
 if(Math.abs(cursor-end)>.001)throw Error('镜头未完整覆盖选定范围');
}
export const shotAttempts=(detail:RemakeDetail,shot:VideoRemakeShot,stage:'frame'|'video'):Attempt[]=>detail.batches.filter(b=>(stage==='frame'?shot.frameBatchIds:shot.videoBatchIds).includes(b.id)).flatMap(b=>b.attempts);

export function remakeProgress(j:VideoRemakeJob){if(['queued','extracting','composing','failed','cancelled'].includes(j.status))return j.step;if(j.status==='completed')return '成片已保存';if(j.shots.length&&j.shots.every(s=>s.selectedVideoId&&s.videoFrameId===s.selectedFrameId))return '分镜片段已就绪，可本地合成';if(j.shots.some(s=>s.selectedFrameId))return '首帧已就绪，继续制作分镜片段';if(j.shots.some(s=>s.text.framePrompt||s.text.videoPrompt))return '分镜要求已保存，待制作首帧';return j.step;}
