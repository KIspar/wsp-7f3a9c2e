import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {LoaderCircle,Sparkles} from 'lucide-react';
import {toast} from 'sonner';
import type {AnalysisJob,AnalysisModel,AnalysisSettings} from '../../packages/analysis';
import {api} from '@/lib/api';
import {polishResult} from '@/lib/polish-result';
import {Button} from './ui/button';
import {Tooltip,TooltipContent,TooltipTrigger} from './ui/tooltip';

type Pending={key:string;source:string;jobId?:string;unknown?:boolean};
function restored(storageKey:string):Pending|undefined{
  try{const v=JSON.parse(localStorage.getItem(storageKey)||'null');return v&&typeof v.key==='string'&&typeof v.source==='string'?(v.jobId?v:{...v,unknown:true}):undefined;}catch{return undefined;}
}
export function DirectPolishButton({storageKey,text,productName='',skillId,onChange,disabled=false,label='AI 润色',iconOnly=true}:{storageKey:string;text:string;productName?:string;skillId?:string;onChange:(text:string)=>void;disabled?:boolean;label?:string;iconOnly?:boolean}){
  const cache=useQueryClient(),[pending,setPending]=useState<Pending|undefined>(()=>restored(storageKey)),[checking,setChecking]=useState(false);
  const latch=useRef(false),settled=useRef(''),latest=useRef({text,onChange});latest.current={text,onChange};
  const config=useQuery({queryKey:['analysis-config'],queryFn:()=>api<{models:AnalysisModel[];settings:AnalysisSettings}>('/analysis/config'),refetchInterval:5000});
  const model=config.data?.models.find(m=>m.id===config.data.settings.defaultModelId);
  const result=useQuery({queryKey:['direct-polish',pending?.jobId],queryFn:()=>api<AnalysisJob>(`/analysis/jobs/${pending!.jobId}`),enabled:!!pending?.jobId,refetchInterval:q=>q.state.data&&['completed','failed','unknown'].includes(q.state.data.status)?false:1500,retry:false});
  function remember(v:Pending|undefined){if(v)localStorage.setItem(storageKey,JSON.stringify(v));else localStorage.removeItem(storageKey);setPending(v);}
  useEffect(()=>{
    const job=result.data;if(!pending||!job||settled.current===job.id)return;
    if(job.status==='unknown'){if(!pending.unknown)remember({...pending,unknown:true});return;}
    if(!['completed','failed'].includes(job.status))return;
    settled.current=job.id;remember(undefined);void cache.invalidateQueries({queryKey:['analysis-jobs']});
    if(job.status==='failed'){toast.error(job.error||'润色失败，原文已保留');return;}
    const outcome=polishResult(pending.source,latest.current.text,job.result);
    if(outcome.kind==='apply'){
      latest.current.onChange(outcome.text);toast.success('已润色',{action:{label:'撤销',onClick:()=>{if(latest.current.text===outcome.text)latest.current.onChange(pending.source);else toast.info('已有新输入，未撤销');}}});
    }else if(outcome.kind==='changed'||outcome.kind==='too-long'){
      toast.info(outcome.kind==='changed'?'润色完成，已保留你后续输入的内容':'润色结果过长，原文已保留',{duration:10000,action:{label:'复制润色结果',onClick:()=>{void navigator.clipboard.writeText(outcome.text).then(()=>toast.success('已复制')).catch(()=>toast.error('复制失败，可在 AI 分析历史查看结果'));}}});
    }else toast.error('未取得润色内容，原文已保留');
  },[result.data,pending]);
  async function run(){
    if(latch.current||pending)return;
    if(!text.trim()){toast.info('请先填写需要润色的内容');return;}
    if(!model?.enabled||!model.credentialConfigured){toast.error(config.error?'无法读取辅助模型，请检查后台服务':'请先配置并启用 AI 辅助模型');return;}
    latch.current=true;const next:Pending={key:crypto.randomUUID(),source:text};remember(next);
    try{const job=await api<AnalysisJob>('/analysis/jobs',{action:'polish',text,productName,skillId,assetIds:[],idempotencyKey:next.key});remember({...next,jobId:job.id});void cache.invalidateQueries({queryKey:['analysis-jobs']});}
    catch(e){const error=e as Error&{status?:number};remember(!error.status||error.status>=500?{...next,unknown:true}:undefined);toast.error(error.message);}
    finally{latch.current=false;}
  }
  async function reconcile(){
    if(checking||!pending)return;setChecking(true);
    try{const response=await api<{job:AnalysisJob|null}>(`/analysis/by-key/${pending.key}`);if(response.job){
      const job=response.job.status==='unknown'&&response.job.upstreamTaskId?await api<AnalysisJob>(`/analysis/jobs/${response.job.id}/billing`,{}):response.job;
      remember({...pending,jobId:job.id,unknown:job.status==='unknown'});cache.setQueryData(['direct-polish',job.id],job);
      if(job.status==='unknown')toast.info('结果仍待核实，原文已保留；不会重复发送',{duration:10000,action:{label:'结束本地等待',onClick:()=>{if(restored(storageKey)?.key===pending.key)remember(undefined);}}});
    }else toast.info('接单结果尚未确定，保留原请求，不会自动重新润色',{duration:10000,action:{label:'结束本地等待',onClick:()=>{if(restored(storageKey)?.key===pending.key)remember(undefined);}}});}
    catch(e){toast.error((e as Error).message);}finally{setChecking(false);}
  }
  const unknown=pending?.unknown,readError=!!result.error,loading=!!pending&&!unknown&&!readError,title=readError?'读取润色结果失败，点击重查':unknown?'润色接单待核实':loading?'正在润色…':label;
  const trigger=<Button type="button" variant="ghost" size={iconOnly?'icon-sm':'sm'} className={iconOnly?'ai-assist-icon':undefined} aria-label={title} aria-busy={loading||checking} title={title} disabled={disabled||loading||checking||config.isLoading} onClick={()=>void(readError?result.refetch():unknown?reconcile():run())}>{loading||checking?<LoaderCircle className="spin" aria-hidden="true"/>:<Sparkles aria-hidden="true"/>}{!iconOnly&&title}</Button>;
  return <span className="ai-polish-control">{iconOnly?<Tooltip><TooltipTrigger asChild>{trigger}</TooltipTrigger><TooltipContent>{title}{unknown?' · 点击核实原请求':''}</TooltipContent></Tooltip>:trigger}<span className="sr-only" role="status">{loading?'AI 正在润色，原文仍可编辑':unknown?'润色接单待核实，不会自动重复提交':''}</span></span>;
}
