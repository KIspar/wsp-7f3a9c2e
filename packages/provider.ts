import {z} from 'zod';
export const providerCredentialIds=['tt-image','omni','gk-video-3.5','tt-6.1-sol','gem-3.8-flash','gem-4-argon'] as const;
export type ProviderCredentialId=typeof providerCredentialIds[number];
export const credentialQuerySchema=z.object({credentialId:z.enum(providerCredentialIds)});
const optionalTime=z.string().max(40).refine(value=>Number.isFinite(providerTime(value)),'请输入有效日期或带时区的时间').optional();
export function providerTime(value:string):number{
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if(!match)return NaN;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const calendar=new Date(Date.UTC(year,month-1,day));
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day)return NaN;
  if(Number(match[4]||0)>23||Number(match[5]||0)>59||Number(match[6]||0)>59)return NaN;
  return Date.parse(value.length===10?value+'T00:00:00+08:00':value.replace(' ','T')+(match[7]?'':'+08:00'));
}
export const usageQuerySchema=credentialQuerySchema.extend({
  scope:z.enum(['key','user']).default('key'),days:z.coerce.number().int().min(1).max(30).default(1),
  start_time:optionalTime,end_time:optionalTime,model:z.string().trim().max(200).optional(),
  detail:z.enum(['0','1']).default('0'),limit:z.coerce.number().int().min(1).max(200).default(50),offset:z.coerce.number().int().min(0).max(10_000_000).default(0),
}).superRefine((v,ctx)=>{
  if(!!v.start_time!==!!v.end_time)ctx.addIssue({code:'custom',message:'起止时间必须同时填写',path:['start_time']});
  if(v.start_time&&v.end_time){const difference=providerTime(v.end_time)-providerTime(v.start_time);if(difference<0||difference>30*86400000)ctx.addIssue({code:'custom',message:'时间范围必须按先后顺序且不超过 30 天',path:['end_time']});}
});
export type UsageQuery=z.infer<typeof usageQuerySchema>;
export const modelTypeSchema=z.enum(['chat','image','video','audio']);
export const modelQuerySchema=credentialQuerySchema.extend({model:z.string().trim().min(1).max(200),status:z.enum(['active']).optional()});
export const taskQuerySchema=credentialQuerySchema.extend({taskId:z.string().regex(/^\d{1,20}$/,'请输入供应商数字任务号（X-Task-Id）')});
export type ProviderEnvelope<T>={credentialId:ProviderCredentialId;fetchedAt:string;data:T};
export type ProviderBalance={balance:number;unit:string;api_key_quota:{used:number;limit:number;remaining?:number}};
export type ProviderKey={id:number|string;name:string;status:number;strategy:string;limit:number;used:number;api_edit_allowed:boolean;ip_whitelist?:string[];custom_groups?:unknown[];exclusions?:unknown[];[key:string]:unknown};
export type UsageTotals={cost?:number;count?:number;success_count?:number;failed_count?:number;refunded_cost?:number;refunded_count?:number};
export type ProviderUsageRecord={task_id:number|string;model:string;model_type?:string;state:string;cost?:number;refunded?:boolean;refunded_amount?:number;created_at?:string;completed_at?:string|null};
export type ProviderUsage={scope:'key'|'user';unit:string;from:string;to:string;grand_total?:UsageTotals;by_model?:(UsageTotals&{model:string;model_type?:string})[];records?:ProviderUsageRecord[];total?:number;limit?:number;offset?:number};
export type ProviderTask={task_id:number|string;model?:string;state:string;is_final:boolean;status?:string;status_group?:string;progress?:number|string;cost?:number;channel_group?:string;error?:string|null;error_code?:string;refunded?:boolean;refunded_amount?:number;created_at?:string;completed_at?:string|null;duration_seconds?:number;input_tokens?:number;output_tokens?:number;result_urls?:string[];result_url?:string;ai_reply?:string;[key:string]:unknown};
export type ProviderModel={name:string;display_name?:string;type:string;description?:string;tags?:string[];available_for_this_key?:boolean;api_format?:string;api_endpoint?:string;params?:Record<string,unknown>[];channel_constraints?:Record<string,unknown>[];[key:string]:unknown};
export type ProviderModelList={models:ProviderModel[];total:number;type?:string};
export type ProviderPriceGroup={group_id:number|string;group_name:string;is_active:boolean;configuredForceCall?:boolean;routingStatus?:import('./chuhe-routing').ChuheChannelStatus;in_key_whitelist?:boolean;excluded_for_this_key?:boolean;billing_method?:string;base_price?:number;input_token_price?:number;output_token_price?:number;min_price?:number;input_image_price?:number;input_image_free_count?:number;option_prices?:Record<string,unknown>[];supported_options?:Record<string,unknown>;capability_rules?:unknown[];unsupported?:string[];[key:string]:unknown};
export type ProviderPricing={name?:string;model?:string;available_for_this_key?:boolean;channel_groups:ProviderPriceGroup[];[key:string]:unknown};
