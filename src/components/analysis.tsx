import {useBackgroundDraft} from '@/lib/use-background-draft';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { analysisActionLabels, analysisStatusLabels, type AnalysisInput, type AnalysisJob, type AnalysisModel, type AnalysisModelId, type AnalysisSettings } from '../../packages/analysis';
import type { Asset, Skill } from '../../packages/contracts';
import { api, dateTime } from '@/lib/api';
import {DirectPolishButton} from './direct-polish';
import { useStudio } from '@/lib/studio';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { FormSelect } from './form-select';
import {Tooltip,TooltipContent,TooltipTrigger} from './ui/tooltip';
export function useAnalysis(){
  const cache=useQueryClient();
  const config=useQuery({queryKey:['analysis-config'],queryFn:()=>api<{models:AnalysisModel[];settings:AnalysisSettings}>('/analysis/config'),refetchInterval:5000});
  const jobs=useQuery({queryKey:['analysis-jobs'],queryFn:()=>api<AnalysisJob[]>('/analysis/jobs'),refetchInterval:1500});
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:['analysis-config']}),cache.invalidateQueries({queryKey:['analysis-jobs']})]);};
  return {config:config.data,jobs:jobs.data||[],refresh,error:config.error||jobs.error};
}
const pendingStorage='studio-analysis-pending';
function pendingRequests():AnalysisInput[]{try{return JSON.parse(localStorage.getItem(pendingStorage)||'[]');}catch{return [];}}
function remember(input:AnalysisInput){localStorage.setItem(pendingStorage,JSON.stringify([...pendingRequests().filter(i=>i.idempotencyKey!==input.idempotencyKey),input]));window.dispatchEvent(new Event('analysis-pending'));}
function forget(key:string){localStorage.setItem(pendingStorage,JSON.stringify(pendingRequests().filter(i=>i.idempotencyKey!==key)));window.dispatchEvent(new Event('analysis-pending'));}
export function downloadMarkdown(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function copy(text:string){try{await navigator.clipboard.writeText(text);toast.success('已复制');}catch{toast.error('复制失败，请选中内容手动复制');}}
const active=(job?:AnalysisJob)=>job&&['queued','preparing','submitting'].includes(job.status);
function JobState({job}:{job:AnalysisJob}){
  const analysis=useAnalysis();const [busy,setBusy]=useState(false);
  return <div className="analysis-job-state"><div className={`flex flex-wrap items-center gap-2 ${active(job)?'analysis-pending-status':''}`}><Badge variant="outline">真实 API</Badge><Badge variant="secondary">{analysisStatusLabels[job.status]}</Badge><span className="muted">{job.model.name}</span>{active(job)&&<LoaderCircle className="spin" />}</div>
    {job.error&&<Alert variant="destructive"><AlertTitle>{job.status==='unknown'?'请核实供应商任务':'分析未完成'}</AlertTitle><AlertDescription>{job.error}</AlertDescription></Alert>}
    <p className="muted">输入 {job.usage?.inputTokens??job.billing.inputTokens??'待确认'} token · 输出 {job.usage?.outputTokens??job.billing.outputTokens??'待确认'} token · {job.billing.status==='final'?`最终消费 ${job.billing.cost} 算力`:job.billing.cost!==undefined?`暂记预扣 ${job.billing.cost} 算力`:'费用待核对'}<br/>{job.upstreamTaskId?`任务号 ${job.upstreamTaskId}`:'尚无供应商任务号'}</p>
    {(job.billing.inputTokens!==undefined||job.billing.outputTokens!==undefined)&&<p className="muted">最终计费用量：输入 {job.billing.inputTokens??'待确认'} / 输出 {job.billing.outputTokens??'待确认'} token（供应商口径，可能包含思考用量）</p>}
    {job.billing.refunded&&<p className="muted">供应商已退款 {job.billing.refundedAmount??'待确认'} 算力 · 净消费 {job.billing.cost??'待确认'} 算力</p>}
    {job.billing.channelGroup&&<p className="muted">实际渠道：{job.billing.channelGroup}</p>}
    {job.billing.error&&<p className="muted">{job.billing.error}</p>}
    {!active(job)&&<Button type="button" variant="ghost" size="sm" disabled={busy||!job.upstreamTaskId||job.billing.status==='final'} onClick={async()=>{setBusy(true);try{await api(`/analysis/jobs/${job.id}/billing`,{});await analysis.refresh();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}}><RefreshCw />{job.billing.status==='final'?'费用已核对':'补查费用与用量'}</Button>}
  </div>;
}
export function AnalysisResult({job,onText}:{job:AnalysisJob;onText?:(text:string)=>void}){
  const [text,setText]=useBackgroundDraft('analysis-edit-'+job.id+(job.result?'':':pending'),()=>localStorage.getItem('analysis-edit-'+job.id)||job.result||'');

  useEffect(()=>{onText?.(text);},[text]);
  return <>
    <JobState job={job}/>
    {job.preview&&<a className="analysis-preview-link" href={job.preview.url} target="_blank" rel="noreferrer"><img src={job.preview.url} alt="实际发送的带图号分析预览"/><span>实际发送预览 · {job.preview.width}×{job.preview.height} · {Math.ceil(job.preview.bytes/1024)}KB</span></a>}
    {!!job.result&&<Field><FieldLabel htmlFor={'result-'+job.id}>候选内容 · 可编辑</FieldLabel><Textarea id={'result-'+job.id} className="analysis-result" value={text} maxLength={64000} onChange={e=>{setText(e.target.value);}}/><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>void copy(text)}><Copy />复制</Button><Button type="button" size="sm" variant="outline" onClick={()=>downloadMarkdown(text,job.id)}><Download />下载 Markdown</Button></div></Field>}
  </>;
}
type AiAssistProps={skill:Skill;action?:AnalysisInput['action'];field?:string;assetIds?:string[];label?:string;iconOnly?:boolean;disabled?:boolean};
export function AiAssistButton(props:AiAssistProps){
  const studio=useStudio(),{skill,field}=props;
  if(props.action&&props.action!=='polish')return <ReviewAiAssistButton {...props}/>;
  const draft=studio.draft(skill.id),text=field?String(draft.fields[field]||''):draft.requirements;
  return <DirectPolishButton key={`${skill.id}:${field||'requirements'}`} storageKey={`studio-direct-polish:${skill.id}:${field||'requirements'}`} text={text} productName={String(draft.fields.productName||'')} skillId={skill.id} label={props.label} iconOnly={props.iconOnly} disabled={props.disabled} onChange={next=>{const current=studio.draft(skill.id);studio.updateDraft(skill.id,field?{...current,fields:{...current.fields,[field]:next}}:{...current,requirements:next});}}/>;
}
function ReviewAiAssistButton({skill,action='polish',field,assetIds,label,iconOnly=action==='polish',disabled=false}:{skill:Skill;action?:AnalysisInput['action'];field?:string;assetIds?:string[];label?:string;iconOnly?:boolean;disabled?:boolean}){
  const studio=useStudio(),analysis=useAnalysis();const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]),[source,setSource]=useState(''),[sourceName,setSourceName]=useState(''),[jobId,setJobId]=useState<string>(),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState<string>(),[candidate,setCandidate]=useState('');
  const latch=useRef(false);
  const draft=studio.draft(skill.id),allIds=[...new Set(assetIds||Object.values(draft.inputRoles).flat())];
  const read=()=>{const current=studio.draft(skill.id);return field?String(current.fields[field]||''):current.requirements;};
  const model=analysis.config?.models.find(m=>m.id===analysis.config?.settings.defaultModelId);
  const job=analysis.jobs.find(j=>j.id===jobId);
  const assets=[...studio.snapshot.assets,...studio.boot.examples];
  const changed=read()!==source;
  async function run(){
    if(latch.current||uncertain)return;latch.current=true;setBusy(true);
    const input:AnalysisInput={action,text:source,productName:sourceName,assetIds:selected,imageNumbers:selected.map(id=>draft.imageDesign?.bindings.find(b=>b.assetId===id)?.number??allIds.indexOf(id)+1),skillId:skill.id,idempotencyKey:crypto.randomUUID()};remember(input);
    try{const next=await api<AnalysisJob>('/analysis/jobs',input);setJobId(next.id);forget(input.idempotencyKey);await analysis.refresh();}
    catch(e){const error=e as Error&{status?:number};if(!error.status||error.status>=500)setUncertain(input.idempotencyKey);else forget(input.idempotencyKey);toast.error(error.message);}
    finally{setBusy(false);latch.current=false;}
  }
  function apply(replace:boolean){
    const current=studio.draft(skill.id),currentText=read();if(replace&&currentText!==source){toast.error('原文已有新输入，请使用插入，或关闭后重新分析');return;}
    const next=replace?candidate:[currentText,candidate].filter(Boolean).join('\n');if(next.length>16000){toast.error('合并后超过 16000 字，请精简候选内容');return;}
    studio.updateDraft(skill.id,field?{...current,fields:{...current.fields,[field]:next}}:{...current,requirements:next});setOpen(false);toast.success('已采纳候选内容');
  }
  const triggerLabel=label||analysisActionLabels[action];
  const trigger=<Button type="button" variant="ghost" size={iconOnly?'icon-sm':'sm'} aria-label={triggerLabel} disabled={disabled} className={iconOnly?'ai-assist-icon':undefined} onClick={()=>{if(!jobId || (job && ['completed','failed'].includes(job.status))){setJobId(undefined);setCandidate('');setSource(read());setSourceName(String(studio.draft(skill.id).fields.productName||''));setSelected(allIds.length<=4?allIds:[]);}setOpen(true);}}><Sparkles aria-hidden="true"/>{!iconOnly&&triggerLabel}</Button>;
  return <>
    {iconOnly?<Tooltip><TooltipTrigger asChild>{trigger}</TooltipTrigger><TooltipContent>{triggerLabel}</TooltipContent></Tooltip>:trigger}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent aria-describedby={undefined} className="analysis-sheet"><SheetHeader><SheetTitle>{label||analysisActionLabels[action]}</SheetTitle></SheetHeader><div className="analysis-sheet-body">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{job?.model.name||model?.name||'加载模型…'}</Badge><span className="muted">{job?'接单时模型快照 · 中文输出':'在系统设置中切换 · 中文输出'}</span></div>
      {!jobId&&<><FieldGroup><Field><FieldLabel>本次输入快照</FieldLabel><Textarea aria-label="本次分析要求" value={source} readOnly/></Field>
        {!!allIds.length&&<Field><FieldLabel>分析素材（{selected.length}/4）</FieldLabel><div className="analysis-assets">{allIds.map((id,index)=>{const asset=assets.find(a=>a.id===id);return <label key={id}><Checkbox aria-label={`分析图片 ${index+1}`} checked={selected.includes(id)} disabled={selected.length>=4&&!selected.includes(id)} onCheckedChange={checked=>setSelected(checked?[...selected,id]:selected.filter(a=>a!==id))}/><img src={asset?.url} alt={`图${index+1}`}/><span>图{draft.imageDesign?.bindings.find(b=>b.assetId===id)?.number??index+1}</span></label>;})}</div></Field>}
      </FieldGroup>
      {model?.id==='tt-6.1-sol'&&selected.length>0&&model.vision.status!=='passed'&&<Alert><AlertTitle>TT 图片分析尚未通过验证</AlertTitle><AlertDescription>{model.vision.reason||'请到模型配置进行小图验证。'}文字润色可取消素材后执行。</AlertDescription></Alert>}
      {(!model?.enabled||!model.credentialConfigured)&&<Alert><AlertTitle>模型暂不可用</AlertTitle><AlertDescription>请到模型配置中保存中转站密钥、同步可用模型并启用。</AlertDescription></Alert>}
      <Button type="button" disabled={busy||!!uncertain||!model?.enabled||!model.credentialConfigured||(model.id==='tt-6.1-sol'&&!!selected.length&&model.vision.status!=='passed')||(action==='reverse-image'&&selected.length!==1)} onClick={()=>void run()}>{busy?<LoaderCircle className="spin"/>:<Sparkles/>}开始分析</Button></>}
      {uncertain&&<Alert><AlertTitle>接单结果待核实</AlertTitle><AlertDescription>不会自动重提请求。<Button type="button" variant="outline" onClick={async()=>{try{const result=await api<{job:AnalysisJob|null}>(`/analysis/by-key/${uncertain}`);if(result.job){setJobId(result.job.id);forget(uncertain);setUncertain(undefined);await analysis.refresh();}else toast.info('本地尚未查到任务，可在全部任务中保留凭据继续核实');}catch(e){toast.error((e as Error).message);}}}>查询接单结果</Button></AlertDescription></Alert>}
      {job&&<AnalysisResult job={job} onText={setCandidate}/>}
      {changed&&job&&<Alert><AlertTitle>原文已有新输入</AlertTitle><AlertDescription>旧结果不会覆盖新输入；你仍可将候选内容插入当前文本。</AlertDescription></Alert>}
    </div><div className="analysis-sheet-actions"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>{active(job)?'关闭面板，后台继续':'取消'}</Button>{job?.status==='completed'&&<><Button type="button" variant="outline" disabled={!candidate.trim()} onClick={()=>apply(false)}>插入当前文本</Button><Button type="button" disabled={changed||!candidate.trim()} onClick={()=>apply(true)}>替换原文</Button></>}</div></SheetContent></Sheet>
  </>;
}
export function AnalysisModelsPanel({allowedIds,embedded=false}:{allowedIds?:string[];embedded?:boolean}){
  const analysis=useAnalysis(),studio=useStudio();const [busy,setBusy]=useState<string>(),[images,setImages]=useState<Record<string,string>>({}),[terms,setTerms]=useState<Record<string,string>>({});
  async function verify(id:AnalysisModelId){
    if(busy)return;setBusy(id);const input:AnalysisInput={action:'verify-image',text:'',productName:'',assetIds:[images[id]],idempotencyKey:crypto.randomUUID(),verificationModel:id,expectedTerms:(terms[id]||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean)};remember(input);
    try{await api('/analysis/jobs',input);forget(input.idempotencyKey);await analysis.refresh();toast.success('小图验证已提交，结果见分析任务历史');}catch(e){const err=e as Error&{status?:number};if(err.status&&err.status<500)forget(input.idempotencyKey);toast.error(err.message);}finally{setBusy(undefined);}
  }
  return <section className={embedded?undefined:"settings-panel"}>{!embedded&&<><h2>聊天类模型</h2></>}{allowedIds&&!analysis.config?.models.some(m=>allowedIds.includes(m.id))&&<p className="muted">暂无已同步的可用 AI 辅助模型。</p>}<div className="analysis-model-list">{analysis.config?.models.filter(model=>!allowedIds||allowedIds.includes(model.id)).map(model=><div className="analysis-model-row" key={model.id}><div className="flex flex-wrap items-center justify-between gap-3"><h3>{model.name}</h3><Badge variant="outline">复用中转站密钥</Badge></div><p className="muted">{model.capabilities.map(c=>({text:'文字',image:'图片',video:'原生视频'}[c])).join(' · ')} · 本地识图：{({unverified:'未验证',pending:'验证中',passed:'通过',failed:'未通过'}[model.vision.status])}</p><FieldGroup><Field orientation="horizontal"><FieldLabel htmlFor={'analysis-enabled-'+model.id}>启用分析模型</FieldLabel><Switch id={'analysis-enabled-'+model.id} checked={model.enabled} disabled={busy===model.id} onCheckedChange={async enabled=>{setBusy(model.id);try{await api('/analysis/models/'+model.id,{enabled,revision:model.revision},'PUT');await analysis.refresh();}catch(e){toast.error((e as Error).message);}finally{setBusy(undefined);}}}/></Field>
        <Field><FieldLabel>本地识图小样验证</FieldLabel><FormSelect aria-label={model.name+' 验证素材'} value={images[model.id]||''} placeholder="选择已上传的已知产品图" options={studio.snapshot.assets.filter(a=>a.type==='image'&&a.source==='upload').map((a,i)=>({value:a.id,label:`产品素材 ${i+1} · ${a.id.slice(-8)}`}))} onValueChange={id=>setImages({...images,[model.id]:id})}/><Input aria-label={model.name+' 已知特征'} placeholder="已知可见特征，以逗号分隔，如：棕，纽扣，纹理" value={terms[model.id]||''} onChange={e=>setTerms({...terms,[model.id]:e.target.value})}/><FieldDescription>512px · ≤48KB · 一次付费验证</FieldDescription><Button type="button" variant="outline" disabled={!!busy||!images[model.id]||!terms[model.id]?.trim()||!model.enabled||!model.credentialConfigured||model.vision.status==='pending'} onClick={()=>void verify(model.id)}>开始小图真实验证</Button>{model.vision.reason&&<p className="muted">{model.vision.reason}</p>}</Field>
      </FieldGroup></div>)}</div></section>;
}
export function AnalysisHistory({usage=false,action}:{usage?:boolean;action?:AnalysisInput['action']}){
  const analysis=useAnalysis();const [view,setView]=useState<string>(),[pending,setPending]=useState(pendingRequests());
  useEffect(()=>{const handler=()=>setPending(pendingRequests());window.addEventListener('analysis-pending',handler);return()=>window.removeEventListener('analysis-pending',handler);},[]);
  const selected=analysis.jobs.find(j=>j.id===view),rows=analysis.jobs.filter(j=>!action||j.input.action===action);
  return <section className="settings-panel"><div className="section-heading"><div><h2>{usage?'真实 AI 分析用量':'AI 辅助任务'}</h2><p className="muted">{rows.length} 次任务 · 算力</p></div></div>
    {pending.filter(input=>!action||input.action===action).map(input=><Alert key={input.idempotencyKey}><AlertTitle>接单待核实 · {analysisActionLabels[input.action]}</AlertTitle><AlertDescription>凭据 {input.idempotencyKey}<Button type="button" size="sm" variant="outline" onClick={async()=>{try{const result=await api<{job:AnalysisJob|null}>(`/analysis/by-key/${input.idempotencyKey}`);if(result.job){forget(input.idempotencyKey);setView(result.job.id);await analysis.refresh();}else toast.info('本地尚无此任务；未重新发送付费请求，请稍后核实');}catch(e){toast.error((e as Error).message);}}}>查询接单结果</Button></AlertDescription></Alert>)}
    {!rows.length?<p className="muted">点击 AI 辅助后，真实分析任务和用量会记录在这里。</p>:<div className="analysis-table-wrap"><table><thead><tr><th>时间 / 功能</th><th>模型 / 状态</th><th>计费输入 / 输出 token</th><th>最终消费（算力）</th><th>详情</th></tr></thead><tbody>{rows.map(job=><tr key={job.id}><td>{dateTime(job.createdAt)}<br/>{analysisActionLabels[job.input.action]}</td><td>{job.model.name}<br/>{analysisStatusLabels[job.status]}</td><td>{job.billing.inputTokens??job.usage?.inputTokens??'待核对'} / {job.billing.outputTokens??job.usage?.outputTokens??'待核对'}</td><td>{job.billing.status==='final'?job.billing.cost:'待核对'}</td><td><Button type="button" variant="ghost" size="sm" onClick={()=>setView(job.id)}>查看分析</Button></td></tr>)}</tbody></table></div>}
    <Sheet open={!!view} onOpenChange={open=>{if(!open)setView(undefined);}}><SheetContent className="analysis-sheet"><SheetHeader><SheetTitle>{selected?analysisActionLabels[selected.input.action]:'分析任务'}</SheetTitle><SheetDescription>模型与素材保留提交时快照。</SheetDescription></SheetHeader><div className="analysis-sheet-body">{selected&&<><p className="muted">{selected.input.productName}</p>{selected.input.skillId?.startsWith('prompt-workbench:')?<><Button asChild variant="outline" size="sm"><Link to={`/agents/prompt-workbench/${encodeURIComponent(selected.input.skillId.slice('prompt-workbench:'.length))}`}>返回创作项目</Link></Button><details className="pwb-details"><summary>查看提交资料快照</summary><pre className="pwb-prewrap">{selected.input.text}</pre></details></>:<p className="muted">{selected.input.text}</p>}<div className="analysis-assets">{selected.assets.map((a,i)=><div key={a.id}>{a.type==='image'?<img src={a.url} alt={`原图 ${i+1}`}/>:<a href={`/api/assets/${a.id}/download`}>下载原视频</a>}<span>素材 {i+1}</span></div>)}</div><AnalysisResult job={selected}/></>}</div></SheetContent></Sheet>
  </section>;
}
export function VideoReversePage(){
  const analysis=useAnalysis(),studio=useStudio();const [asset,setAsset]=useState<Asset & {duration?:number}>(),[text,setText]=useState(''),[busy,setBusy]=useState(false),[id,setId]=useState<string>();const latch=useRef(false),videoInput=useRef<HTMLInputElement>(null);
  const job=analysis.jobs.find(j=>j.id===id),model=analysis.config?.models.find(m=>m.id==='gem-4-argon');
  async function upload(file?:File){if(!file)return;if(file.size>30*1024*1024){toast.error('视频不能超过 30MB');return;}setBusy(true);try{const body=new FormData();body.append('file',file);setAsset(await api('/analysis/video',body));await studio.refresh();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  return <div className="management-page video-reverse-page"><section className="management-heading"><h1>视频反推</h1></section><div className="video-reverse-layout"><section className="settings-panel"><div className="section-heading"><h2>视频与分析要求</h2><Badge variant="secondary">GEM 4 argon · 原生视频</Badge></div><FieldGroup><Field><FieldLabel htmlFor="reverse-video-file">单个 MP4 / WebM</FieldLabel><div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={busy||!!active(job)} onClick={()=>videoInput.current?.click()}>{busy?<LoaderCircle className="spin"/>:<Sparkles/>}{asset?'更换视频':'上传视频'}</Button><span className="muted">{asset?'视频已通过格式与时长检查':'选择一段本地视频'}</span></div><Input ref={videoInput} className="sr-only" id="reverse-video-file" type="file" accept="video/mp4,video/webm" disabled={busy||!!active(job)} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/><FieldDescription>MP4 / WebM · ≤30MB · ≤120 秒</FieldDescription>{asset&&<p>{Math.ceil(asset.bytes/1024/1024*10)/10}MB · {asset.duration?.toFixed(2)} 秒 · 上传完成</p>}</Field><Field><FieldLabel htmlFor="reverse-video-text">关注内容（可选）</FieldLabel><Textarea id="reverse-video-text" value={text} maxLength={16000} placeholder="例如：关注模特动作、服装展示顺序与镜头转场" onChange={e=>setText(e.target.value)}/></Field></FieldGroup><div className="modal-actions"><Button type="button" disabled={busy||!!active(job)||!asset||!model?.enabled||!model.credentialConfigured} onClick={async()=>{if(latch.current||!asset)return;latch.current=true;setBusy(true);const input:AnalysisInput={action:'reverse-video',text,productName:'',assetIds:[asset.id],idempotencyKey:crypto.randomUUID()};remember(input);try{const next=await api<AnalysisJob>('/analysis/jobs',input);setId(next.id);forget(input.idempotencyKey);await analysis.refresh();}catch(e){const err=e as Error&{status?:number};if(err.status&&err.status<500)forget(input.idempotencyKey);toast.error(err.message);}finally{setBusy(false);latch.current=false;}}}>{busy?<LoaderCircle className="spin"/>:<Sparkles/>}开始视频反推</Button></div>{(!model?.enabled||!model.credentialConfigured)&&<p className="muted">请先在模型配置中保存初和中转站密钥、同步并启用 GEM。</p>}</section><div className="video-reverse-results">{!job&&<div className="video-reverse-empty"><Sparkles/><h2>视频分析结果</h2><p>上传视频，提交后在这里查看镜头、动作和创作提示词。</p></div>}{job&&<section className="settings-panel"><AnalysisResult job={job}/></section>}<AnalysisHistory action="reverse-video"/></div></div></div>;
}
