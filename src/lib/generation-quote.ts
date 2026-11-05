import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from './api';
import {useStudio} from './studio';
import type {Draft,GenerationQuote,Skill,Submission} from '../../packages/contracts';

export const quoteAmount=(value:number|null|undefined)=>value==null?'未提供':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:6}).format(value);
export const quoteRange=(quote:Pick<GenerationQuote,'minimum'|'maximum'>)=>quote.minimum===quote.maximum?quoteAmount(quote.maximum):`${quoteAmount(quote.minimum)}–${quoteAmount(quote.maximum)}`;

export function useGenerationQuote(skill:Skill,action:Submission['action']='generate'){
  const studio=useStudio();return useDraftGenerationQuote(skill,studio.draft(skill.id),studio.boot.models.find(m=>m.id===studio.draft(skill.id).modelId)?.revision,action);
}
export function useDraftGenerationQuote(skill:Skill,draft:Draft,modelRevision?:number,action:Submission['action']='generate'){
  // Text editing does not change the price of these per-call media models.
  // All billed parameters, references, targets, detail screens and groups stay in the key.
  const projected:Draft={...draft,requirements:'',overrides:Object.fromEntries(Object.entries(draft.overrides).map(([id,v])=>[id,{...v,promptOverride:'',targetDescription:''}])),fields:skill.id.startsWith('ec-')?draft.fields:Object.fromEntries(Object.entries(skill.fields).map(([key,field])=>[key,key==='whiteMode'?draft.fields[key]??field.default??'':field.default??''])),
    ...(draft.imageDesign?{imageDesign:{...draft.imageDesign,screens:draft.imageDesign.screens.map(screen=>({...screen,requirements:'',facts:''}))}}:{})};
  const signature=JSON.stringify({skillId:skill.id,draft:projected,action,modelRevision});
  const [settled,setSettled]=useState(signature);
  useEffect(()=>{const timer=setTimeout(()=>setSettled(signature),300);return ()=>clearTimeout(timer);},[signature]);
  const empty=action!=='prepareWhite'&&(skill.batch.mode==='per-target'?!draft.selectedTargetIds.length:skill.imageDesign==='detail'?!draft.imageDesign?.screens.length:false);
  const query=useQuery({queryKey:['generation-quote',settled],enabled:!empty,queryFn:()=>{const {skillId,draft,action}=JSON.parse(settled);return api<GenerationQuote>('/generation/estimate',{skillId,draft,action});},retry:false,staleTime:15000,refetchInterval:30000,refetchIntervalInBackground:false,refetchOnWindowFocus:'always'});
  const ready=!empty&&settled===signature&&!!query.data;
  return {quote:ready?query.data:undefined,error:settled===signature?query.error:null,loading:!empty&&(!ready&&!query.isError||settled!==signature),refreshing:ready&&query.isFetching,empty,canSubmit:ready&&!query.isError&&!!query.data?.affordable,refresh:query.refetch};
}
export type GenerationQuoteState=ReturnType<typeof useGenerationQuote>;
