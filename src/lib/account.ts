import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from './api';
import type {AccountBalance,AccountRecords,AccountUsage} from '../../packages/account';

export const accountQueryOptions={retry:false,staleTime:15000,refetchInterval:30000,refetchIntervalInBackground:false,refetchOnWindowFocus:'always' as const};
export const formatPower=(value:number|undefined|null)=>value==null?'—':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:6}).format(value);
export function useAccountBalance(){
  return useQuery({queryKey:['account','balance'],queryFn:()=>api<AccountBalance>('/account'),...accountQueryOptions});
}
export function useAccountUsage(days:number){
  return useQuery({queryKey:['account','usage',days],queryFn:()=>api<AccountUsage>('/account/usage?days='+days),...accountQueryOptions});
}
export function useAccountRecords(days:number,page:number){
  return useQuery({queryKey:['account','records',days,page],queryFn:()=>api<AccountRecords>(`/account/records?days=${days}&limit=10&offset=${page*10}`),placeholderData:previous=>previous,...accountQueryOptions});
}
export function useRefreshAccount(){
  const cache=useQueryClient();
  return ()=>cache.invalidateQueries({queryKey:['account']});
}
