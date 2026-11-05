import {z} from 'zod';
import type {ProviderKey,ProviderPriceGroup,ProviderPricing} from './provider';

const groupId=z.union([z.string(),z.number()]).transform(String);
export const chuheCustomGroupsSchema=z.array(z.object({
  model:z.string(),group_ids:z.array(groupId).optional(),force_group_ids:z.array(groupId).optional(),
  groups:z.array(z.object({group_id:groupId,group_name:z.string(),status:z.string().optional()})).optional(),
}));
export type ChuheChannelStatus='active'|'congested'|'removed'|'unknown';
export function chuheChannelStatus(active?:boolean,savedStatus?:string):ChuheChannelStatus{
  if(savedStatus==='removed')return 'removed';
  if(active!==undefined)return active?'active':'congested';
  return savedStatus==='active'?'active':savedStatus==='offline'?'congested':'unknown';
}
export const chuheChannelStatusLabel=(status:ChuheChannelStatus)=>({active:'正常',congested:'临时拥挤',removed:'已关闭',unknown:'状态待确认'}[status]);
export function chuheChannelRoutable(group:ProviderPriceGroup){
  return group.in_key_whitelist===true&&group.excluded_for_this_key===false&&group.routingStatus!=='removed'&&(group.is_active===true||group.configuredForceCall===true);
}
export function withChuheRouting(pricing:ProviderPricing,key:ProviderKey|undefined,model:string):ProviderPricing{
  const parsed=chuheCustomGroupsSchema.safeParse(key?.custom_groups||[]);
  const settings=key?.custom_groups_in_effect===true&&parsed.success?parsed.data.find(row=>row.model===model):undefined;
  const channel_groups=pricing.channel_groups.map(group=>{
    const id=String(group.group_id),saved=settings?.groups?.find(row=>row.group_id===id);
    const routingStatus=chuheChannelStatus(group.is_active,saved?.status);
    // Only the key's effective custom configuration can authorize forced calling.
    return {...group,routingStatus,configuredForceCall:routingStatus!=='removed'&&settings?.force_group_ids?.includes(id)===true};
  });
  // The public availability summary can lag the key's forced-route setting.
  const forcedRoute=channel_groups.some(group=>group.configuredForceCall&&chuheChannelRoutable(group));
  return {...pricing,channel_groups,available_for_this_key:pricing.available_for_this_key===true||forcedRoute};
}
