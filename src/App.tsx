import {VersionControl} from './components/version-control';
import {StudioCategoryTabs, StudioPrimaryNavigation, StudioFeatureNavigation} from './components/studio-navigation';
import {EcommerceFeatureRoute} from './components/ecommerce-feature';
import {InfiniteCanvas} from './components/infinite-canvas';
import {PromptWorkbenchPage} from './components/prompt-workbench';
import {HelpCenter} from './components/help-center';
import {ecommerceFeatureById} from './lib/ecommerce-features';
import {helpHref} from './lib/help';
import {RelayModelSettings} from './components/relay-models';
import {FormSelect} from './components/form-select';
import {TaskMedia} from './components/task-media';
import {useQuery} from '@tanstack/react-query';
import {PromptLibraryPage} from './components/prompt-library';
import {CatalogLibrary} from './components/catalog/library';
import {CatalogEditor} from './components/catalog/editor';
import {AccountBalance} from './components/account-balance';
import {DeliveryPage} from './components/delivery';
import {AccountUsagePage} from './components/account-usage';
import {useRefreshAccount} from './lib/account';
import {ProviderTaskPanel,ProviderKeyInfoPanel} from './components/provider';
import { AnalysisHistory, VideoReversePage, useAnalysis } from './components/analysis';
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Fragment, useEffect, useLayoutEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {Copy,Download,Activity,ArrowDownToLine,ArrowUpRight,Check,ChevronRight,CircleHelp,Code2,Database,Layers3,Monitor,PanelLeftClose,PanelLeftOpen,RefreshCw,ShieldCheck,Sparkles} from "lucide-react";
import { toast } from "sonner";
import { Workspace } from "./Workspace";
import { WearWorkspace } from "./components/wear-workspace";
import { useStudio } from "@/lib/studio";
import { api, ApiError, bytes, dateTime, shortId } from "@/lib/api";
import { pendingKey } from "@/components/submission";
import { BatchDetails } from "@/components/results";
import {Status,copy} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { batchStatus, type Batch, type SavedDraft, type Settings, type Skill } from "../packages/contracts";

export default function App() {
  const studio = useStudio();
  const location = useLocation();
  const isCanvas = location.pathname === '/canvas';
  const [featureRailCollapsed,setFeatureRailCollapsed]=useState(()=>localStorage.getItem('studio-feature-rail-collapsed')==='true');
  function toggleFeatureRail(){setFeatureRailCollapsed(value=>{localStorage.setItem('studio-feature-rail-collapsed',String(!value));return !value;});}
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  const analysis = useAnalysis();
  const refreshAccount = useRefreshAccount();
  const activityStamp = [...studio.snapshot.batches.flatMap(b => b.attempts).filter(a => !a.simulated).map(a => `${a.id}:${a.status}`),...analysis.jobs.map(j => `${j.id}:${j.status}:${j.billing.status}`)].join("|");
  useEffect(() => { void refreshAccount(); }, [activityStamp]);
  const [pending, setPending] = useState(() => !!localStorage.getItem(pendingKey));
  const [checking, setChecking] = useState(false);
  const [refreshing,setRefreshing]=useState(false);
  async function refreshWorkspace(){
    if(refreshing)return;
    setRefreshing(true);
    try{await Promise.all([studio.refresh(),refreshAccount(),analysis.refresh()]);}
    catch(error){toast.error((error as Error).message);}
    finally{setRefreshing(false);}
  }
  const attempts = studio.snapshot.batches.flatMap(b => b.attempts);
  const active = attempts.filter(a => ["generating", "saving"].includes(a.status)).length + analysis.jobs.filter(j => ["preparing", "submitting"].includes(j.status)).length;
  const queued=attempts.filter(a=>a.status==='queued').length+analysis.jobs.filter(j=>j.status==='queued').length;
  const waiting=attempts.filter(a=>['waiting_dependency','blocked_dependency','pending_verification'].includes(a.status)).length;
  const visibleSkills = studio.boot.skills.filter(s => s.id !== 'scene-recreate'&&!s.id.startsWith('ec-'));
  useEffect(() => {
    const update = () => setPending(!!localStorage.getItem(pendingKey));
    window.addEventListener("studio-pending", update); window.addEventListener("storage", update);
    return () => { window.removeEventListener("studio-pending", update); window.removeEventListener("storage", update); };
  }, []);
  async function verify() {
    setChecking(true);
    try {
      const request = JSON.parse(localStorage.getItem(pendingKey) || "null");
      if (!request) return;
      const result = await api<{ batch: Batch; draft: SavedDraft }>("/submit", request);
      if(!request.canvasNodeId)studio.acceptDraft(result.draft);
      localStorage.removeItem(pendingKey); setPending(false);
      toast.success("已核实接单结果，未重复创建任务"); await studio.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) { localStorage.removeItem(pendingKey); setPending(false); }
      toast.error((e as Error).message);
    } finally { setChecking(false); }
  }
  return <div className="app-shell">
    <aside className="sidebar"><NavLink to="/ecommerce/ec-product-01" className="brand"><span className="brand-mark"><Sparkles /></span><div>灵感工坊<small>CREATIVE STUDIO</small></div></NavLink>
      <StudioPrimaryNavigation/>
      <div className="sidebar-bottom"><div className="local-status"><i className={studio.disconnected ? "offline-dot" : ""} /><strong>{studio.disconnected ? "本地服务已断开" : "本地服务已连接"}</strong><Monitor /></div><div className="sidebar-storage"><span>可用存储</span><b>{studio.boot.health.freeBytes == null ? "未知" : bytes(studio.boot.health.freeBytes)}</b></div><NavLink className="help-button" to="/help"><CircleHelp />帮助中心<ArrowUpRight /></NavLink><VersionControl/></div>
    </aside>
    <div className="main-shell"><header className="topbar"><Tooltip><TooltipTrigger asChild><Button className="studio-feature-toggle" size="icon-sm" variant="ghost" aria-label={featureRailCollapsed?"展开功能导航":"收起功能导航"} aria-expanded={!featureRailCollapsed} aria-controls="studio-feature-navigation" onClick={toggleFeatureRail}>{featureRailCollapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</Button></TooltipTrigger><TooltipContent>{featureRailCollapsed?"展开功能导航":"收起功能导航"}</TooltipContent></Tooltip><StudioCategoryTabs/><div><span className="execution-indicator"><i />{active||queued||waiting? [active&&`执行中 ${active}`,queued&&`排队 ${queued}`,waiting&&`待处理 ${waiting}`].filter(Boolean).join(' · '):'后台队列就绪'}</span><AccountBalance />{location.pathname!=='/help'&&<Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" asChild><Link to={helpHref(location.pathname,location.search)} aria-label="查看当前页面帮助"><CircleHelp /></Link></Button></TooltipTrigger><TooltipContent>当前页面帮助</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="刷新任务与余额" aria-busy={refreshing} disabled={refreshing} onClick={() => void refreshWorkspace()}><RefreshCw className={refreshing?"spin":""}/></Button></TooltipTrigger><TooltipContent>刷新任务与余额 · 数据会自动更新</TooltipContent></Tooltip></div></header>
      {studio.disconnected && <Alert variant="destructive" className="global-alert"><Activity /><AlertTitle>后台连接中断</AlertTitle><AlertDescription>当前结果保留，恢复连接后自动更新。<Button variant="outline" size="sm" onClick={() => void studio.refresh()}>重新连接</Button></AlertDescription></Alert>}
      {pending && <Alert className="global-alert"><ShieldCheck /><AlertTitle>有一笔接单结果待核实</AlertTitle><AlertDescription>使用原接单凭据检查结果。<Button size="sm" onClick={() => void verify()} disabled={checking}>核实接单结果</Button></AlertDescription></Alert>}
      <div className={isCanvas?"studio-content-shell is-canvas":`studio-content-shell${featureRailCollapsed?" is-rail-collapsed":""}`}>{!isCanvas&&<StudioFeatureNavigation/>}<main key={location.pathname}><Routes><Route path="/studio/scene-recreate" element={<Navigate replace to="/studio/image-replica"/>}/><Route path="/" element={<Navigate replace to="/ecommerce/ec-product-01" />} /><Route path="/ecommerce/:featureId" element={<EcommerceFeatureRoute/>}/><Route path="/canvas" element={<InfiniteCanvas/>}/>{visibleSkills.map(skill => <Route key={skill.id} path={`/studio/${skill.id}`} element={skill.id==='model-outfit'?<WearWorkspace/>:<Workspace key={skill.id} skill={skill} />} />)}<Route path="/agents/prompt-workbench" element={<PromptWorkbenchPage/>}/><Route path="/agents/prompt-workbench/:creationId" element={<PromptWorkbenchPage/>}/><Route path="/catalog" element={<CatalogLibrary/>}/><Route path="/catalog/:id" element={<CatalogEditor/>}/><Route path="/video-reverse" element={<VideoReversePage />} /><Route path="/help" element={<HelpCenter />} /><Route path="/settings" element={<SettingsPage />} /><Route path="/models" element={<ModelsPage />} /><Route path="/skills" element={<SkillsPage />} /><Route path="/templates" element={<PromptLibraryPage />} /><Route path="/prompt-library" element={<Navigate replace to={{pathname:"/templates",search:location.search}} />} /><Route path="/usage" element={<AccountUsagePage />} /><Route path="/history" element={<HistoryPage />} /><Route path="/delivery" element={<DeliveryPage />} /><Route path="*" element={<Navigate replace to="/ecommerce/ec-product-01" />} /></Routes></main></div>
    </div>

  </div>;
}
function Heading({ title, tag }: { title: string; tag: string }) { return <section className="management-heading"><div className="page-eyebrow">工作台管理 <span>/</span> {tag}</div><h1>{title}</h1></section>; }
function SettingsPage() {
  const studio = useStudio(); const [value, setValue] = useState<Settings>(studio.boot.settings); const [busy, setBusy] = useState(false);
  return <div className="management-page"><Heading title="系统设置" tag="SETTINGS" /><VersionControl panel/><ProviderKeyInfoPanel /><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api('/settings', value, 'PUT'); await studio.refresh(); toast.success('设置已保存'); } catch(e) { toast.error((e as Error).message); } finally { setBusy(false); } }}><section className="settings-panel"><div className="panel-heading"><Layers3 /><div><h2>任务调度与素材</h2></div></div><FieldGroup className="property-grid">{([['imageConcurrency','图片生成并发上限',1,20],['videoConcurrency','视频生成并发上限',1,4],['maxBatch','单批最大成品数',1,100],['maxFileMb','单张上传上限（MB）',1,30]] as const).map(([key,label,min,max]) => <Field key={key}><FieldLabel htmlFor={key}>{label}</FieldLabel><NumberInput id={key} aria-label={label} min={min} max={max} value={value[key]} onValueChange={next => setValue({...value,[key]:Number(next)})} /></Field>)}<Field><FieldLabel htmlFor="quota">算力参考额度（仅提醒）</FieldLabel><NumberInput id="quota" aria-label="算力参考额度（仅提醒）" min={0} step={0.01} allowEmpty placeholder="未设置" value={value.referenceQuota ?? ''} onValueChange={next => setValue({...value,referenceQuota:next === '' ? null : Number(next)})} /></Field></FieldGroup><div className="modal-actions"><Button disabled={busy} type="submit"><Check />保存设置</Button></div></section></form><section className="settings-panel"><div className="panel-heading"><Database /><div><h2>本地数据与备份</h2></div></div><div className="backup-row"><div><strong>完整备份</strong></div><Button variant="outline" asChild><a href="/api/backup"><ArrowDownToLine />导出完整备份</a></Button></div><dl className="detail-list"><dt>数据库</dt><dd>SQLite · 本地文件</dd><dt>后台 Worker</dt><dd>{studio.boot.health.worker ? '运行中' : '未运行'}</dd><dt>可用磁盘</dt><dd>{studio.boot.health.freeBytes == null ? '未知' : bytes(studio.boot.health.freeBytes)}</dd></dl></section></div>;
}
function ModelsPage() {
  return <div className="management-page"><Heading title="模型配置" tag="MODELS"/><RelayModelSettings/></div>;
}
function SkillsPage() {
  const studio=useStudio(); const availableSkills=studio.boot.skills.filter(s=>s.id!=='scene-recreate'); const [id,setId]=useState(availableSkills[0].id); const skill=availableSkills.find(s=>s.id===id)||availableSkills[0]; const [source,setSource]=useState(skill.source); const [validated,setValidated]=useState(''); const [busy,setBusy]=useState(false); const [pendingSkill,setPendingSkill]=useState<Skill>(); const [skillSearch,setSkillSearch]=useState(''); const filteredSkills=availableSkills.filter(s=>`${s.name} ${s.id}`.toLowerCase().includes(skillSearch.trim().toLowerCase()));
  function applySkill(s:Skill){setId(s.id);setSource(s.source);setValidated('');}
  function choose(s:Skill){if(s.id===id)return;if(source!==skill.source){setPendingSkill(s);return;}applySkill(s);}
  async function validate(){setBusy(true);try{await api('/skills/validate',{source});setValidated(source);toast.success('技能格式校验通过');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  return <div className="management-page"><Heading title="技能管理" tag="SKILLS" /><div className="skill-layout"><div className="skill-list"><Input aria-label="搜索技能" placeholder="搜索技能名称或 ID" value={skillSearch} onChange={event=>setSkillSearch(event.target.value)}/><p className="muted skill-search-count">{filteredSkills.length} 个技能</p>{!filteredSkills.length&&<p role="status">暂无匹配技能</p>}{filteredSkills.map(s=><button key={s.id} className={s.id===id?'selected':''} onClick={()=>choose(s)}><Code2 /><span><strong>{s.name}</strong><small>{s.id}</small></span><ChevronRight /></button>)}</div><section className="settings-panel skill-editor"><div className="section-heading"><div><h2>{skill.name}</h2><p className="muted">{skill.unpublished ? '磁盘源文件有未发布修改' : '已发布配置'}</p></div><Badge variant="outline">Markdown + YAML</Badge></div><Textarea aria-label="技能源文件" spellCheck={false} value={source} onChange={e=>{setSource(e.target.value);setValidated('');}} /><div className="modal-actions"><Button variant="outline" onClick={()=>void validate()} disabled={busy}>校验技能</Button><Button disabled={busy || validated!==source || source===skill.source} onClick={async()=>{setBusy(true);try{await api(`/skills/${id}/publish`,{source,revision:skill.revision});await studio.refresh();setValidated('');toast.success('技能已发布');}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}}><Check />发布修改</Button></div></section></div><ConfirmDialog open={!!pendingSkill} onClose={()=>setPendingSkill(undefined)} title="放弃未发布的编辑？" description="切换技能会丢弃当前编辑内容，已发布的配置保持不变。" cancelLabel="继续编辑" confirmLabel="放弃并切换" onConfirm={()=>{if(pendingSkill)applySkill(pendingSkill);setPendingSkill(undefined);}} /></div>;
}
function HistoryPage(){
  const studio=useStudio(),[search,setSearch]=useState(''),[detail,setDetail]=useState<string>(),[reuse,setReuse]=useState<Batch>(),[expanded,setExpanded]=useState<string>(),[range,setRange]=useState('7');
  const compositions=useQuery({queryKey:['history-compositions'],queryFn:()=>api<{id:string;jobId:string;name:string;createdAt:string;asset?:import('../packages/contracts').Asset;prompt:string}[]>('/history/compositions'),refetchInterval:5000});
  const after=range==='all'?0:Date.now()-Number(range)*86400000;
  const rows=studio.snapshot.batches.filter(b=>Date.parse(b.createdAt)>=after&&`${b.id} ${b.skillName} ${b.draft.productContext?.name||''} ${b.draft.fields.productName||''} ${b.draft.requirements}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="management-page"><Heading title="全部任务" tag="创作记录"/>
    <div className="history-search-controls"><FormSelect aria-label="任务时间范围" value={range} onValueChange={setRange} options={[{value:"7",label:"最近 7 天"},{value:"30",label:"最近 30 天"},{value:"all",label:"全部时间"}]}/><Input className="history-search" aria-label="搜索全部任务" placeholder="搜索商品、批次、技能或创作要求…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <section className="settings-panel history-table-panel">{!rows.length?<Empty><EmptyHeader><EmptyTitle>暂无匹配任务</EmptyTitle><EmptyDescription>创建的媒体任务会显示在这里。</EmptyDescription></EmptyHeader></Empty>:<table><thead><tr><th>商品 / 批次</th><th>技能</th><th>创建时间</th><th>状态</th><th>保存 / 条目</th><th>操作</th></tr></thead><tbody>{rows.map(b=>{
      const original=b.attempts.filter(a=>a.attemptNumber===1),done=original.filter(a=>b.attempts.some(v=>v.itemId===a.itemId&&v.status==='completed')).length;
      const asset=studio.snapshot.assets.find(a=>a.id===(b.draft.inputRoles.product?.[0]||b.attempts.find(a=>a.assetId)?.assetId));
      return <Fragment key={b.id}><tr className="history-record"><td className="history-identity"><div className="history-product">{asset&&(asset.type==='video'?<video src={asset.url} muted preload="metadata" aria-label="视频结果缩略图"/>:<img src={asset.url} alt="商品或结果缩略图"/>)}<div><strong>{b.draft.productContext?.name||String(b.draft.fields.productName||`#${shortId(b.id)}`)}</strong><small>{b.simulated?'模拟记录':'真实调用'} · #{shortId(b.id)}</small></div></div></td><td data-label="技能">{b.skillName}</td><td data-label="创建时间">{dateTime(b.createdAt)}</td><td data-label="状态"><Status status={batchStatus(b)}/></td><td data-label="保存 / 条目">{done} / {original.length}</td><td className="history-actions"><Button variant="outline" size="sm" aria-expanded={expanded===b.id} onClick={()=>setExpanded(expanded===b.id?undefined:b.id)}>{expanded===b.id?"收起结果":"查看结果"}</Button><Button variant="ghost" size="sm" onClick={()=>setDetail(b.id)}>详情<ChevronRight/></Button><Button variant="ghost" size="sm" asChild><a href={`/api/batches/${b.id}/download`}><Download/>下载整组</a></Button><Button variant="ghost" size="sm" onClick={()=>void copy(b.attempts.map(a=>a.prompt).join("\n\n"))}><Copy/>复制提示词</Button><NavLink className="history-continue" to={ecommerceFeatureById.has(b.skillId)?`/ecommerce/${b.skillId}`:`/studio/${b.skillId}`}>进入工作区</NavLink></td></tr>{expanded===b.id&&<tr className="history-expanded"><td colSpan={6}><TaskMedia attempts={b.attempts}/></td></tr>}</Fragment>;
    })}</tbody></table>}</section>
    {!!compositions.data?.filter(c=>Date.parse(c.createdAt)>=after&&`${c.name} ${c.prompt}`.includes(search)).length&&<section className="settings-panel history-local-films"><h2>本地合成视频</h2><div className="task-history-media">{compositions.data.filter(c=>Date.parse(c.createdAt)>=after&&`${c.name} ${c.prompt}`.includes(search)).map(c=><article key={c.id} className="task-history-result"><div className="task-history-thumb">{c.asset&&<video src={c.asset.url} controls preload="metadata"/>}</div><div className="task-history-result-info"><strong>{c.name}</strong><small>{dateTime(c.createdAt)}</small><div>{c.asset&&<Button variant="outline" size="sm" asChild><a href={`/api/assets/${c.asset.id}/download`}><Download/>下载视频</a></Button>}<Button variant="ghost" size="sm" onClick={()=>void copy(c.prompt)}><Copy/>复制分镜</Button><Button variant="ghost" size="sm" onClick={async()=>{try{const r=await api<{url:string}>(`/video-remakes/${c.jobId}/export`,{compositionId:c.id});window.location.assign(r.url);}catch(e){toast.error((e as Error).message);}}}>下载成片与分镜</Button></div></div></article>)}</div></section>}
    <details className="history-secondary"><summary>AI 辅助记录</summary><AnalysisHistory/></details>
    <details className="history-secondary"><summary>高级查询 · 供应商任务号</summary><ProviderTaskPanel/></details>
    <BatchDetails batchId={detail} onClose={()=>setDetail(undefined)} onReuse={setReuse}/>
    <ConfirmDialog open={!!reuse} onClose={()=>setReuse(undefined)} title="使用历史设置？" description="将覆盖对应技能的当前草稿，不会直接开始生成。" confirmLabel="替换草稿" onConfirm={()=>{if(reuse)studio.updateDraft(reuse.skillId,reuse.draft);setReuse(undefined);setDetail(undefined);toast.success('已恢复到对应技能草稿');}}/>
  </div>;
}
