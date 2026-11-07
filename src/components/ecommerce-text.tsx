import {useBackgroundDraft} from '@/lib/use-background-draft';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowRight,Copy,FileText,LoaderCircle,RefreshCw,Sparkles} from 'lucide-react';
import {toast} from 'sonner';
import type {EcommerceFeature} from '@/lib/ecommerce-features';
import {api} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import type {AnalysisJob} from '../../packages/analysis';
import {MaterialInputRow} from './catalog/materials';
import {EcommerceOutput,EcommerceStepHeading,ecommerceReferences,importEcommerceExample} from './ecommerce-presentation';
import {EcommerceFields} from './ecommerce-fields';
import {ecommerceFields} from '@/lib/ecommerce-profiles';
import {EcommerceMoreSettings} from './ecommerce-more-settings';
import {ecommerceCommonKeys} from '../../packages/ecommerce/settings';
import {Modal,copy} from './common';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';

type TextDraft={name:string;facts:string;requirements:string;market:string;language:string;platform:string;assetIds:string[];fields:Record<string,string|number|boolean>};
const blank:TextDraft={name:'',facts:'',requirements:'',market:'菲律宾',language:'英语',platform:'TikTok Shop',assetIds:[],fields:{}};
const activeStatuses=['queued','preparing','submitting'];
export function EcommerceTextPage({feature}:{feature:EcommerceFeature}){
  const studio=useStudio();
  const [draft,setDraft]=useBackgroundDraft<TextDraft>(`ecommerce-text:${feature.id}`,()=>{try{return {...blank,...JSON.parse(localStorage.getItem(`ecommerce-text:${feature.id}`)||'{}')};}catch{return blank;}});
  const jobStorageKey=`ecommerce-text:job:${feature.id}`;
  const [jobId,setJobId]=useState<string|undefined>(()=>localStorage.getItem(jobStorageKey)||undefined);
  const [confirm,setConfirm]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  useEffect(()=>{if(jobId)localStorage.setItem(jobStorageKey,jobId);else localStorage.removeItem(jobStorageKey);},[jobId,jobStorageKey]);
  const quote=useQuery({queryKey:['ecommerce-text-estimate'],queryFn:()=>api<{modelName:string;estimated:number;available:number;affordable:boolean}>('/analysis/estimate'),retry:false,staleTime:15000});
  const job=useQuery({queryKey:['ecommerce-text-job',jobId],queryFn:()=>api<AnalysisJob>(`/analysis/jobs/${jobId}`),enabled:!!jobId,refetchInterval:q=>q.state.data&&activeStatuses.includes(q.state.data.status)?1500:false,retry:false});
  const update=(patch:Partial<TextDraft>)=>setDraft(old=>({...old,...patch}));
  const active=!!jobId&&(job.isPending||!!job.data&&activeStatuses.includes(job.data.status));
  const [loadingExample,setLoadingExample]=useState(false);
  const pendingKey=`ecommerce-text:pending:${feature.id}`;
  async function submit(){
    if(submitting||!quote.data?.affordable)return;
    setSubmitting(true);
    const key=localStorage.getItem(pendingKey)||crypto.randomUUID();
    localStorage.setItem(pendingKey,key);
    try{
      const fields=Object.fromEntries(Object.entries(ecommerceFields(feature)).filter(([key])=>!['market','platform','language'].includes(key)).map(([key,field])=>[field.label,draft.fields?.[key]??field.default??'']));
      const result=await api<AnalysisJob>('/analysis/jobs',{action:'ecommerce-text',skillId:feature.id,productName:draft.name,text:JSON.stringify({task:feature.name,market:draft.market,language:draft.language,platform:draft.platform,verifiedFacts:draft.facts,requirements:draft.requirements,fields}),assetIds:draft.assetIds,idempotencyKey:key,maximumCost:quote.data.estimated});
      setJobId(result.id);setConfirm(false);localStorage.removeItem(pendingKey);toast.success('文案任务已接单，结果会自动更新');
    }catch(error){toast.error((error as Error).message);}
    finally{setSubmitting(false);}
  }
  async function loadExample(){if(loadingExample)return;setLoadingExample(true);try{const images=ecommerceReferences[feature.id]?.recommendations.slice(0,2)||[];if(!images.length)throw new Error('此页面暂无商品示例，请上传参考图');const assets=[];for(const image of images)assets.push(await importEcommerceExample(image));await studio.refresh();update({assetIds:assets.map(a=>a.id),requirements:`请基于所选图片完成${feature.name}，无法确认的商品信息标记为待补充。`});toast.success('示例已载入草稿');}catch(error){toast.error((error as Error).message);}finally{setLoadingExample(false);}}
  return <div className="ecommerce-page"><header className="ecommerce-page-heading"><div><span className="page-eyebrow">电商设计 / {feature.group}</span><h1>{feature.name}</h1><p>依据已确认商品资料、目标市场与平台完成文案或检测。</p></div><Button variant="ghost" size="sm" disabled={active||submitting} onClick={()=>{setDraft(blank);setJobId(undefined);}}><RefreshCw/>新建任务</Button></header>
    <div className="ecommerce-page-grid"><aside className="ecommerce-controls" aria-label={`${feature.name}操作区`}><div className="ecommerce-controls-scroll">
      <section><EcommerceStepHeading number={1} english="PRODUCT" title="商品资料"/><div className="ecommerce-upload-card"><MaterialInputRow purpose="product" label="商品参考图 · 最多 4 张" ids={draft.assetIds} assets={[...studio.snapshot.assets,...studio.boot.examples]} max={4} onChange={assetIds=>update({assetIds})} onUpload={()=>void studio.refresh()}/></div><label>商品名称<Input aria-label="商品名称" value={draft.name} maxLength={200} onChange={e=>update({name:e.target.value})} placeholder="例如：便携蓝牙音箱"/></label><label>已确认商品信息<Textarea aria-label="已确认商品信息" rows={4} maxLength={8000} value={draft.facts} onChange={e=>update({facts:e.target.value})} placeholder="材质、尺寸、功能、认证等；未知信息留空"/></label></section>
      <section><EcommerceStepHeading number={2} english="MARKET" title="市场与风格"/><EcommerceMoreSettings values={{...draft.fields,market:draft.market,language:draft.language,platform:draft.platform}} onChange={({market,language,platform,...fields})=>update({market:String(market),language:String(language),platform:String(platform),fields})}/></section>
      <section><EcommerceStepHeading number={3} english="BRIEF" title="输出要求"/><EcommerceFields feature={feature} values={draft.fields||{}} onChange={fields=>update({fields})} exclude={ecommerceCommonKeys}/><Textarea aria-label="输出要求" rows={5} maxLength={8000} value={draft.requirements} onChange={e=>update({requirements:e.target.value})} placeholder={`补充${feature.name}的重点、关键词或需要检查的项目…`}/></section>
    </div><footer className="ecommerce-controls-footer"><span className="ecommerce-quote">{quote.isPending?'查询报价中…':quote.error?(quote.error as Error).message:quote.data?`${quote.data.modelName} · 预估上限 ${quote.data.estimated.toFixed(4)} 算力`:'报价不可用'}</span><Button disabled={submitting||active||!quote.data?.affordable||(!draft.name.trim()&&!draft.facts.trim()&&!draft.assetIds.length)} onClick={()=>setConfirm(true)}><Sparkles/>准备文案 · 查询报价<ArrowRight/></Button></footer></aside>
    <EcommerceOutput feature={feature} onExample={()=>void loadExample()} hasResults={!!jobId}>{jobId&&<div className="ecommerce-output-toolbar"><strong>分析结果</strong><Button size="sm" variant="ghost" onClick={()=>void job.refetch()}><RefreshCw/>刷新</Button></div>}{!jobId&&<div className="ecommerce-empty-result"><FileText/><p>暂无生成记录</p></div>}
      {jobId&&<section className="ecommerce-text-result" aria-live="polite"><div className="ecommerce-text-result-heading"><FileText/><strong>{feature.name}</strong><span>{job.error?'查询失败':job.data?.status==='completed'?'已完成':job.data?.status==='failed'?'失败':job.data?.status==='unknown'?'待核实':'生成中'}</span></div>{job.error&&<p role="alert">{(job.error as Error).message}，请点击刷新重试。</p>}{job.data?.error&&<p role="alert">{job.data.error}</p>}{active&&<p><LoaderCircle className="spin"/>正在处理，请稍候。切换页面不会中断任务。</p>}{job.data?.result&&<><pre>{job.data.result}</pre><Button variant="outline" onClick={()=>void copy(job.data!.result||'')}><Copy/>复制结果</Button></>}</section>}
    </EcommerceOutput></div><Modal open={confirm} onClose={()=>!submitting&&setConfirm(false)} title={`确认${feature.name}`} description="确认后调用真实聊天模型，结果会计费。"><p>模型：{quote.data?.modelName||'未配置'}</p><p>预估最高费用：{quote.data?.estimated.toFixed(4)||'—'} 算力 · 当前可用：{quote.data?.available.toFixed(4)||'—'}</p><div className="modal-actions"><Button variant="outline" onClick={()=>setConfirm(false)}>返回编辑</Button><Button disabled={submitting||!quote.data?.affordable} onClick={()=>void submit()}>{submitting?<LoaderCircle className="spin"/>:<Sparkles/>}确认生成</Button></div></Modal></div>;
}
