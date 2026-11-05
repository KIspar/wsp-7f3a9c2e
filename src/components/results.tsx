import {TaskMedia} from './task-media';
import {SavePromptButton} from './prompt-library';
import { LongImageLayoutSheet } from "./long-image-layout";
import { ConfirmDialog } from "./confirm-dialog";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Maximize2, Check, ChevronRight, Copy, FileText, Hourglass, LoaderCircle, RefreshCw, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker, localDate } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IconButton, MediaModal, Modal, PromptText, Status, copy } from "./common";
import { useStudio } from "@/lib/studio";
import {api,dateTime,shortId} from "@/lib/api";
import { batchStatus, defaultDraft, editableStatuses, type Asset, type Attempt, type Batch, type Skill, type GenerationQuote } from "../../packages/contracts";
import { quoteRange,quoteAmount } from '@/lib/generation-quote';
import { cn } from "@/lib/utils";
import {parameterLabel,parameterValueLabel} from '@/lib/parameter-labels';
import { itemVersions } from '@/lib/creative-workflow';

export function AttemptTile({ attempt, compact = false, onDetails }: { attempt: Attempt; compact?: boolean; onDetails?: () => void }) {
  const studio = useStudio();
  const [view, setView] = useState<Asset>();
  const [edit, setEdit] = useState(false);
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(false);
  const [text, setText] = useState(attempt.prompt);
  const [busy, setBusy] = useState(false);
  const [retryQuote,setRetryQuote]=useState<GenerationQuote>();
  const asset = studio.snapshot.assets.find((a) => a.id === attempt.assetId);
  const editable = editableStatuses.includes(attempt.status);
  const finished = ["completed", "failed"].includes(attempt.status);
  async function action(kind: "retry" | "edit" | "rebind",confirmed=false) {
    setBusy(true);
    try {
      if(kind==='retry'&&attempt.step!=='保存失败'&&!confirmed){
        setRetryQuote(await api<GenerationQuote>(`/attempts/${attempt.id}/retry-quote`,{revision:attempt.revision}));
        setPrompt(false);return;
      }
      await api(`/attempts/${attempt.id}${kind === "retry" ? "/retry" : ""}`, {
        revision: attempt.revision, prompt: text, ...(kind === "rebind" ? { rebindOriginal: true } : {}),...(kind==='retry'&&retryQuote?{maximumCost:retryQuote.maximum}:{}),
      }, kind === "retry" ? "POST" : "PATCH");
      toast.success(kind === "retry" ? attempt.step === "保存失败" ? "已安排仅重试保存" : "已提交生成任务，完成后自动更新当前结果" : "已更新未提交任务");
      setPrompt(false);
      setRetryQuote(undefined);
      await studio.refresh();
    } catch (e) { setRetryQuote(undefined);toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <article className={cn("attempt-tile", compact && "attempt-tile-compact")}>
      <div className="attempt-meta"><strong>#{String(attempt.index).padStart(2, "0")}<span></span></strong><span>{String(attempt.parameters.aspectRatio)}</span></div>
      {asset ? <div className="result-media">
        <button className="result-media-trigger" onClick={() => setView(asset)} aria-label={`预览成品 ${attempt.index} 当前结果`}>
          {asset.type === "video" ? <video src={asset.url} muted preload="metadata" /> : <img src={asset.url} alt={`${attempt.simulated?'历史模拟':'生成'}成品 ${attempt.index}`} loading="lazy" />}
          <span className="media-hover"><span className="media-zoom"><Maximize2 /></span></span>
          {asset.type === "video" && <span className="video-play">播放</span>}
        </button>
        <Badge className="simulated-tag" variant="secondary">{attempt.simulated?'历史模拟素材':'真实生成'}</Badge>
      </div> : <div className={cn("result-media", "task-placeholder", `placeholder-${attempt.status}`)}>
        {attempt.status === "failed" || attempt.status === "blocked_dependency" ? <TriangleAlert /> : attempt.status === "queued" || attempt.status === "waiting_dependency" ? <Hourglass /> : <LoaderCircle className="spin" />}
        <strong>{attempt.step}</strong><small>{attempt.status === "generating" ? attempt.simulated?"历史模拟执行":"供应商生成中 · 自动查询进度" : attempt.status === "queued" ? "后台会自动开始" : "切换工作区不会中断"}</small>
      </div>}
      {attempt.model.provider==='token01'&&<p className="muted">Token01 · 费用与退款请在平台日志核对</p>}<div className="attempt-footer"><Status status={attempt.status} /><div>
        <IconButton icon={FileText} label={`提示词 ${attempt.index}`} onClick={() => { setText(attempt.prompt); setPrompt(true); }} />
        {asset&&!attempt.simulated&&<SavePromptButton iconOnly label={`成品${attempt.index}存为模板`} source={{kind:"attempt",id:attempt.id}}/>}{asset && <Button variant="ghost" size="icon-sm" asChild aria-label={`下载成品 ${attempt.index}`}><a href={`/api/assets/${asset.id}/download`}><ArrowDownToLine /></a></Button>}
        {asset?.type === "image" && <IconButton icon={SlidersHorizontal} label={`编辑图片 ${attempt.index}`} onClick={()=>setEdit(true)}/>}
        {finished && <IconButton icon={RefreshCw} label={attempt.step === "保存失败" ? "重试保存" : `重新生成 ${attempt.index}`} onClick={() => void action("retry")} disabled={busy} />}
      </div></div>
    </article>
    <ConfirmDialog open={edit} onClose={()=>setEdit(false)} title="将成品载入图像编辑？" description="将此成品作为图1待编辑图片，替换图像编辑中的现有草稿。原成品保留。" confirmLabel="载入图像编辑" onConfirm={()=>{const skill=studio.boot.skills.find(s=>s.imageDesign==="edit");if(!skill||!asset)return;const draft=defaultDraft(skill,studio.boot.models);draft.productContext=studio.snapshot.batches.find(b=>b.id===attempt.batchId)?.draft.productContext;draft.inputRoles={targets:[asset.id],reference:[]};draft.selectedTargetIds=[asset.id];draft.imageDesign={groupCount:1,screens:[],bindings:[{assetId:asset.id,number:1}],nextNumber:2};studio.updateDraft(skill.id,draft);setEdit(false);navigate(`/studio/${skill.id}`);}}/>
    
    <MediaModal asset={view} onClose={() => setView(undefined)} />
    <Modal open={!!retryQuote} onClose={()=>!busy&&setRetryQuote(undefined)} title="确认重新生成" description="仅为当前条目创建新尝试，当前结果将被新结果替换，历史任务仍可在全部任务中查找。">
      {retryQuote&&<><p>模型：{attempt.model.name} · 预计消耗 <strong>{quoteRange(retryQuote)} {retryQuote.unit}</strong></p><p className="muted">账户余额 {quoteAmount(retryQuote.balance)} · 当前可用 {quoteAmount(retryQuote.available)}。提交前重新核价，价格上涨需再次确认。</p>{retryQuote.note&&<p className="muted">{retryQuote.note}</p>}{!retryQuote.affordable&&<p className="error-text">可用算力不足，请调整设置或补充余额。</p>}<div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setRetryQuote(undefined)}>取消</Button><Button disabled={busy||!retryQuote.affordable} onClick={()=>void action('retry',true)}>{busy?<LoaderCircle className="spin"/>:<RefreshCw/>}确认重新生成</Button></div></>}
    </Modal>
    <Modal open={prompt} onClose={() => setPrompt(false)} title={`第 ${attempt.index} 项 · 提示词`} description={`${attempt.model.name} · 技能配置为接单时的快照`} wide>
      <PromptText value={text} onChange={editable || finished ? setText : undefined} />
      {attempt.error && <p className="error-text">{attempt.error}</p>}
      <div className="modal-actions">{asset&&!attempt.simulated&&<SavePromptButton source={{kind:"attempt",id:attempt.id}}/>}<Button variant="outline" onClick={() => void copy(text)}><Copy />复制</Button>{onDetails && <Button variant="ghost" onClick={() => { setPrompt(false); onDetails(); }}>任务详情<ChevronRight /></Button>}
        {attempt.status === "blocked_dependency" && <Button variant="outline" onClick={() => void action("rebind")} disabled={busy}>明确改用商品原图</Button>}
        {editable && <Button onClick={() => void action("edit")} disabled={busy}><Check />保存到排队项</Button>}
        {finished && <Button onClick={() => void action("retry")} disabled={busy}><RefreshCw />{attempt.step === "保存失败" ? "仅重试保存" : "以此创建新尝试"}</Button>}
      </div>
    </Modal>
  </>;
}

function ResultItems({attempts,onDetails}:{attempts:Attempt[];onDetails:()=>void}){
  const studio=useStudio();
  return <div className="batch-media-grid">{itemVersions(attempts).map(versions=>{
    const latest=versions.at(-1)!;
    const display=versions.filter(a=>a.status==='completed'&&a.assetId).at(-1)||latest;
    return <div key={latest.itemId} className="result-item-group">{display.screenType&&<p className="screen-result-label">{display.screenOrder}. {display.screenType}</p>}{latest.id!==display.id&&<p className="screen-result-label">更新任务：{latest.step}</p>}<AttemptTile attempt={display} onDetails={onDetails}/></div>;
  })}</div>;
}

export function BatchDetails({ batchId, onClose, onReuse }: { batchId?: string; onClose: () => void; onReuse: (batch: Batch) => void }) {
  const studio = useStudio();
  const batch = studio.snapshot.batches.find((b) => b.id === batchId);
  return <Sheet open={!!batchId} onOpenChange={(v) => !v && onClose()}><SheetContent className="detail-sheet"><SheetHeader><SheetTitle>任务详情</SheetTitle><SheetDescription>接单配置、输入素材与历史生成记录</SheetDescription></SheetHeader>
    {batch && <div className="sheet-body"><div className="detail-heading"><div><small>批次</small><h2>#{shortId(batch.id)}</h2></div><Status status={batchStatus(batch)} /></div>
      <dl className="detail-list"><dt>使用技能</dt><dd>{batch.skillName}</dd><dt>创建时间</dt><dd>{dateTime(batch.createdAt)}</dd><dt>执行环境</dt><dd>{batch.simulated?'历史本地模拟':'真实供应商调用'}</dd><dt>已保存</dt><dd>{new Set(batch.attempts.filter(a=>a.status==="completed").map(a=>a.itemId)).size} / {batch.attempts.filter((a) => a.attemptNumber === 1).length} 项</dd><dt>{batch.simulated?'模拟记账':'调用记录'}</dt><dd>{studio.snapshot.ledger.filter((e) => e.batchId === batch.id).length} 次已保存；{batch.simulated?'无真实费用':'最终费用以供应商结算为准'}</dd></dl>
      <div className="detail-actions"><Button variant="outline" onClick={() => onReuse(batch)}><SlidersHorizontal />使用这组设置</Button><Button variant="outline" asChild><a href={`/api/batches/${batch.id}/download`}><ArrowDownToLine />批次 ZIP</a></Button></div>
      <h3>原始输入</h3><p className="detail-requirements">{batch.draft.requirements || "未填写额外要求"}</p>
      <h3>参数快照</h3><dl className="detail-list"><dt>生成模型</dt><dd>{batch.attempts[0]?.model.name||studio.boot.models.find(m=>m.id===batch.draft.modelId)?.name||'历史模型'}</dd><dt>画面比例</dt><dd>{parameterValueLabel('aspectRatio',batch.draft.aspectRatio)}</dd><dt>生成数量</dt><dd>{batch.draft.count}</dd>{batch.attempts[0]?.model.category==='video'&&<><dt>视频时长</dt><dd>{parameterValueLabel('duration',batch.draft.duration)}</dd></>}{Object.entries({...batch.draft.fields,...batch.draft.parameters}).map(([name,value])=><div key={name} className="contents"><dt>{parameterLabel(name,batch.attempts[0]?.model.parameters[name]?.label||studio.boot.skills.find(s=>s.id===batch.skillId)?.fields[name]?.label)}</dt><dd>{parameterValueLabel(name,value)||'未填写'}</dd></div>)}</dl>
      <h3>生成内容</h3><TaskMedia attempts={batch.attempts}/><h3>逐项执行记录</h3>{batch.attempts.map((attempt) => <div className="attempt-record" key={attempt.id}><div><strong>#{attempt.index} · {dateTime(attempt.createdAt)}</strong><Status status={attempt.status} /></div><p>{attempt.step}</p><small>{dateTime(attempt.createdAt)} 创建 → {dateTime(attempt.updatedAt)} 更新</small><details><summary>完整提示词与绑定<ChevronRight /></summary><p>{attempt.prompt}</p><div className="detail-reference-images">{attempt.references.map((id,index)=>{const asset=studio.snapshot.assets.find(a=>a.id===id);return asset?<a key={id} href={`/api/assets/${id}/download`}><img src={asset.url} alt={`原始参考${index+1}`}/><span>参考 {index+1}</span></a>:<span key={id}>参考{index+1}不可用</span>;})}</div><details><summary>诊断素材编号</summary><code>{attempt.references.join("\n")}</code></details>{attempt.dependencyTaskId && <p>白底绑定：{shortId(attempt.dependencyTaskId)}</p>}</details>{attempt.error && <p className="error-text">{attempt.error}</p>}</div>)}
    </div>}
  </SheetContent></Sheet>;
}

export function ResultFeed({ skill, onExample, onReuse }: { skill: Skill; onExample: () => void; onReuse: (batch: Batch) => void }) {
  const studio = useStudio();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const [detail, setDetail] = useState<string>();
  const [layout, setLayout] = useState<{batchId:string;group:number}>();
  const layoutBatch=studio.snapshot.batches.find(b=>b.id===layout?.batchId);
  const all = studio.snapshot.batches.filter((b) => b.skillId === skill.id);
  const filtered = all.filter((b) => {
    const status = batchStatus(b);
    return (filter === "all" || filter === "completed" && status === "completed" || filter === "active" && !["completed", "failed", "blocked_dependency", "pending_verification"].includes(status) || filter === "error" && ["failed", "blocked_dependency", "pending_verification"].includes(status))
      && (!search || `${b.id} ${b.draft.productContext?.name||""} ${b.draft.fields.productName||""} ${b.draft.requirements}`.toLowerCase().includes(search.toLowerCase()))
      && (!day || localDate(new Date(b.createdAt)) === day);
  });
  return <section className="result-section" aria-label={`${skill.name}结果`}>
    <div className="feed-toolbar"><ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v)} aria-label="任务状态筛选">
      <ToggleGroupItem value="all">全部批次 <span>{all.length}</span></ToggleGroupItem><ToggleGroupItem value="active">进行中</ToggleGroupItem><ToggleGroupItem value="completed">已完成</ToggleGroupItem><ToggleGroupItem value="error">异常</ToggleGroupItem>
    </ToggleGroup><div className="feed-search"><DatePicker value={day} onValueChange={setDay} /><div><Search /><Input aria-label="搜索批次或创作要求" placeholder="搜索批次或创作要求" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div></div>
    {!filtered.length ? <Empty className="workspace-empty"><EmptyHeader><EmptyMedia variant="icon"><FileText /></EmptyMedia><EmptyTitle>{all.length ? "没有匹配的批次" : "这一组创作，从这里开始"}</EmptyTitle><EmptyDescription>{all.length ? "当前筛选下暂无任务" : "暂无生成记录"}</EmptyDescription></EmptyHeader>{!all.length && <><div className="sample-strip">{studio.boot.examples.slice(0, 4).map((asset) => <img src={asset.url} alt="原型服装示例" key={asset.id} />)}</div><Button variant="outline" onClick={onExample}><ArrowUpRight />载入示例到草稿</Button><small className="muted">原型素材 · 非生成结果</small></>}</Empty> : <div className="batches">
      {filtered.map((batch) => {
        const originals = batch.attempts.filter((a) => a.attemptNumber === 1);
        const completed = originals.filter(original=>batch.attempts.some(a=>a.itemId===original.itemId&&a.status==="completed")).length;
        return <section className="batch-block" key={batch.id}><header className="batch-header"><div className="batch-identity"><strong>{batch.draft.productContext?.name||String(batch.draft.fields.productName||`#${shortId(batch.id)}`)}</strong><time>{dateTime(batch.createdAt)}</time><Status status={batchStatus(batch)} /><span>{completed}/{originals.length} 项</span><Badge variant="outline">{batch.simulated?"模拟":"真实调用"}</Badge></div><div><Button variant="ghost" size="sm" asChild><a href={`/api/batches/${batch.id}/download`}><ArrowDownToLine />ZIP</a></Button><Button variant="ghost" size="sm" onClick={() => setDetail(batch.id)}>详情<ChevronRight /></Button></div></header>{batch.attempts.some(a=>a.groupIndex)?<div className="detail-result-groups">{[...new Set(batch.attempts.map(a=>a.groupIndex!))].map(group=><section className="detail-result-group" key={group}><div className="section-heading"><h3>第 {group} 组 <span className="muted">{originals.filter(a=>a.groupIndex===group).length} 屏</span></h3><Button variant="outline" size="sm" disabled={!batch.attempts.some(a=>a.groupIndex===group&&a.status==="completed")} onClick={()=>setLayout({batchId:batch.id,group})}><SlidersHorizontal />排版</Button></div><ResultItems attempts={batch.attempts.filter(a=>a.groupIndex===group)} onDetails={()=>setDetail(batch.id)}/></section>)}</div>:<ResultItems attempts={batch.attempts} onDetails={()=>setDetail(batch.id)}/>}</section>;
      })}
    </div>}
    {layout && layoutBatch && <LongImageLayoutSheet key={`${layout.batchId}-${layout.group}`} batch={layoutBatch} group={layout.group} onClose={()=>setLayout(undefined)}/>}
    <BatchDetails batchId={detail} onClose={() => setDetail(undefined)} onReuse={(batch) => { onReuse(batch); setDetail(undefined); }} />
  </section>;
}
