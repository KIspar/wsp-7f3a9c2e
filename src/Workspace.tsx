import {ProductDesignForm} from './components/product-design-form';
import {GenerationCost} from './components/generation-cost';
import {useGenerationQuote} from './lib/generation-quote';
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useState } from "react";
import {ArrowRight,Check,Layers3,Plus,Settings2,Sparkles,WandSparkles} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-select";
import { NumberInput } from "@/components/ui/number-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import { defaultDraft, restoreDraft, type Batch, type Draft, type Skill } from "../packages/contracts";
import {IconButton,Modal,Properties,Status} from "@/components/common";
import { UploadRole } from "@/components/uploads";
import { ResultFeed, AttemptTile, BatchDetails } from "@/components/results";
import { useSubmission } from "@/components/submission";
import { useStudio } from "@/lib/studio";
import { CreativeComposer } from "@/components/creative-composer";
import { ProductContext } from './components/product-context';
import { api, shortId } from "@/lib/api";

export function Workspace({ skill }: { skill: Skill }) {
  const studio = useStudio();
  const draft = studio.draft(skill.id);
  const [parameters, setParameters] = useState(false);
  const [reset, setReset] = useState(false);
  const [reuse, setReuse] = useState<Batch>();
  const submit = useSubmission(skill);
  const model = studio.boot.models.find((m) => m.id === draft.modelId);
  const update = (patch: Partial<Draft>) => studio.updateDraft(skill.id, { ...studio.draft(skill.id), ...patch });
  const liveCost=useGenerationQuote(skill);
  const unified = skill.imageDesign === "kit" || skill.imageDesign === "detail" || skill.id === "image-replica";
  const batches = studio.snapshot.batches.filter((b) => b.skillId === skill.id);
  const saved = batches.flatMap((b) => b.attempts).filter((a) => a.status === "completed").length;
  function example() {
    const refs = studio.boot.examples;
    const inputs: Record<string, string[]> = skill.imageDesign === "edit" ? {targets:refs.slice(0,2).map(a=>a.id),reference:refs.slice(2,3).map(a=>a.id)} : skill.imageDesign === "detail" ? {product:refs.slice(4,6).map(a=>a.id)} : skill.imageDesign ? {product:refs.slice(4,6).map(a=>a.id),...(skill.id==="image-replica"?{targets:refs.slice(0,2).map(a=>a.id)}:{reference:skill.imageDesign==="replica"?refs.slice(0,1).map(a=>a.id):[]})} : skill.batch.mode === "repeat" ? {references:refs.slice(0,1).map(a=>a.id)} : {product:refs.slice(4,6).map(a=>a.id),targets:refs.slice(0,3).map(a=>a.id)};
    update({
      ...defaultDraft(skill, studio.boot.models), count: skill.batch.mode === "repeat" ? 4 : 1,
      requirements: skill.category === "video" ? "男装秋冬穿搭，保持商品款式不变，镜头缓慢推进，画面干净自然。" : "秋冬男装商品图，保留服装版型与面料细节，光线自然，突出穿着质感，不添加宣传文字。",
      inputRoles: inputs, selectedTargetIds: inputs.targets || [],
      ...(skill.imageDesign === "edit" ? {requirements:"将图2中的人物改为图1中的同一人，保留服装与场景。",imageDesign:{groupCount:1,screens:[],bindings:Object.values(inputs).flat().map((assetId,i)=>({assetId,number:i+1})),nextNumber:Object.values(inputs).flat().length+1}} : {}),
      ...(skill.imageDesign === "detail" ? {fields:{...defaultDraft(skill,studio.boot.models).fields,productName:"秋冬男士外套",sellingPoints:"以产品图为准，呈现外套版型与可见细节。干净自然的都市休闲风格。"}} : {}),
    });
    toast.success("示例已载入草稿，尚未提交");
  }
  const useBatch = (batch: Batch) => {
    const current = studio.draft(skill.id);
    const defaults = defaultDraft(skill, studio.boot.models);
    if (JSON.stringify(current) !== JSON.stringify(defaults)) setReuse(batch);
    else restoreBatch(batch);
  };
  function restoreBatch(batch: Batch) {
    studio.updateDraft(skill.id, restoreDraft(skill, studio.boot.models, batch.draft));
    toast.success(batch.skillRevision === skill.revision ? "已恢复到草稿，尚未提交" : "已按当前技能恢复，请检查图片、参数和要求后预览");
  }
  return <div className={skill.executor === "workflow" ? "workspace agent-workspace" : "workspace unified-image-workspace"}>
    <section className="workspace-heading">
      <div><div className="page-eyebrow">创作工作台 <span>/</span> {skill.category === "video" ? "视频创作" : skill.executor === "workflow" ? "自动化流程" : "图片创作"}</div><h1>{skill.name}<Badge variant="outline">{skill.id === "benchmark-agent" ? "AGENT" : skill.category === "video" ? "VIDEO" : "IMAGE"}</Badge></h1></div>
      <div className="workspace-metric"><small>已保存成品</small><strong>{String(saved).padStart(2, "0")}<span> / {batches.length} 批次</span></strong><span className="metric-note"><i />{batches.every(b=>b.simulated)&&batches.length?'历史模拟记录':'真实调用 · 后台保存'}</span></div>
    </section>
    {skill.category!=='video'&&<ProductContext skill={skill}/>}
    {unified ? <div className="unified-image-layout"><aside className="unified-image-sidebar" aria-label={`${skill.name}操作区`}><ProductDesignForm skill={skill} draft={draft} onChange={update} models={studio.boot.models} assets={[...studio.snapshot.assets,...studio.boot.examples]} onUpload={()=>void studio.refresh()} maxBatch={studio.boot.settings.maxBatch} storageKey={`image-design:${skill.id}`} footer={<><GenerationCost state={liveCost}/><Button disabled={submit.pending||!liveCost.canSubmit||!model?.enabled||!model.credentialConfigured} onClick={()=>void submit.prepare()}>{submit.pending?<span className="inline-loading">准备报价…</span>:<><Sparkles/>预览并查询算力</>}</Button></>}/></aside><div className="unified-image-results"><ResultFeed skill={skill} onExample={example} onReuse={useBatch}/></div></div> : skill.executor === "workflow" ? <AgentWorkspace skill={skill} onParameters={() => setParameters(true)} submit={submit} /> : <>
      <div className="unified-image-layout creative-workspace-layout">
        
        <aside className="unified-image-sidebar" aria-label={`${skill.name}操作区`} data-testid="composer">
          <CreativeComposer skill={skill} pending={submit.pending} onSubmit={() => void submit.prepare()} onParameters={() => setParameters(true)} onReset={() => setReset(true)} />
        </aside><div className="unified-image-results"><ResultFeed skill={skill} onExample={example} onReuse={useBatch} /></div>
      </div>
    </>}
    <Modal open={parameters} onClose={() => setParameters(false)} title="参数矩阵" description="技能规则与模型专有参数" wide>
      <div className="matrix-section"><h3>技能参数</h3><Properties definitions={Object.fromEntries(Object.entries(skill.fields).filter(([key])=>!skill.imageDesign || !["language","productName","sellingPoints","platform"].includes(key)))} values={draft.fields} onChange={(fields) => update({ fields })} exclude={skill.executor === "workflow" ? ["sourceUrl", "whiteMode"] : []} /></div>
      {model && <div className="matrix-section"><h3>{model.name}</h3><Properties definitions={Object.fromEntries(Object.entries(model.parameters).filter(([key])=>!skill.imageDesign || key!=="resolution"))} values={draft.parameters} onChange={(parameters) => update({ parameters })} /></div>}
      <div className="modal-actions"><Button onClick={() => setParameters(false)}><Check />完成</Button></div>
    </Modal>
    <ConfirmDialog open={reset} onClose={() => setReset(false)} title="重置当前草稿？" description="已创建的任务和历史结果不会受影响。" confirmLabel="重置全部输入" onConfirm={() => { studio.updateDraft(skill.id, defaultDraft(skill, studio.boot.models)); setReset(false); }} />
    <ConfirmDialog open={!!reuse} onClose={() => setReuse(undefined)} title="替换现有草稿？" description="当前工作区已有未提交内容，将使用历史批次设置覆盖。" confirmLabel="替换草稿" cancelLabel="保留当前草稿" onConfirm={() => { if (reuse) restoreBatch(reuse); setReuse(undefined); }} />
    {submit.dialog}
  </div>;
}

function AgentWorkspace({ skill, onParameters, submit }: { skill: Skill; onParameters: () => void; submit: ReturnType<typeof useSubmission> }) {
  const studio = useStudio();
  const draft = studio.draft(skill.id);
  const [detail, setDetail] = useState<string>();
  const [reuse, setReuse] = useState<Batch>();
  const [targetEdit, setTargetEdit] = useState<string>();
  const [overrideText, setOverrideText] = useState("");
  const [overrideDescription, setOverrideDescription] = useState("");
  const [draftPreview, setDraftPreview] = useState<import("../packages/contracts").Plan>();
  const update = (patch: Partial<Draft>) => studio.updateDraft(skill.id, { ...studio.draft(skill.id), ...patch });
  const whiteCost=useGenerationQuote(skill,'prepareWhite');
  const replaceCost=useGenerationQuote(skill,'replaceSelected');
  const targets = draft.inputRoles.targets || [];
  const assets = [...studio.snapshot.assets, ...studio.boot.examples];
  const whites = studio.snapshot.batches.filter((b) => b.skillId === skill.id && b.action === "prepareWhite").flatMap((b) => b.attempts);
  const white = whites.find((a) => a.id === draft.whiteTaskId);
  const batches = studio.snapshot.batches.filter((b) => b.skillId === skill.id && b.action === "replaceSelected");
  const latest = batches[0];
  async function previewTarget(id: string) {
    try {
      const plan = await api<import("../packages/contracts").Plan>("/plan", { skillId: skill.id, draft: { ...draft, selectedTargetIds: [id] }, action: "replaceSelected" });
      setDraftPreview(plan);
      setOverrideText(draft.overrides[id]?.promptOverride || plan.items[0].prompt);
      setOverrideDescription(draft.overrides[id]?.targetDescription || String(draft.fields.targetDescription || ""));
      setTargetEdit(id);
    } catch (e) { toast.error((e as Error).message); }
  }
  function loadExamples() {
    update({ inputRoles: { product: studio.boot.examples.slice(4, 7).map((a) => a.id), targets: studio.boot.examples.slice(0, 4).map((a) => a.id) }, selectedTargetIds: studio.boot.examples.slice(0, 4).map((a) => a.id), fields: { ...draft.fields, targetDescription: "人物身上的外套" } });
    toast.success("示例已载入，尚未提交");
  }
  return <div className="agent-body"><aside className="agent-control-panel" aria-label="对标创作设置">
    <section className="agent-section"><div className="section-heading"><h2><span className="step-index">01</span>素材准备</h2><Button size="sm" variant="outline" onClick={loadExamples}><Plus />载入示例素材</Button></div>
      <div className="agent-inputs"><UploadRole skill={skill} role="product" /><div className="target-ingest"><UploadRole skill={skill} role="targets" /><label className="source-url"><span>商品来源</span><Input aria-label="商品来源链接" placeholder="粘贴来源链接（仅记录，不抓取）" value={String(draft.fields.sourceUrl || "")} onChange={(e) => update({ fields: { ...draft.fields, sourceUrl: e.target.value } })} /></label></div></div>
    </section>
    <section className="agent-section white-section"><div className="section-heading"><h2><span className="step-index">02</span>商品参考与白底任务</h2><Badge variant="outline">独立生成 · 手动绑定</Badge></div>
      <div className="white-controls"><FieldGroup className="white-fields"><Field><FieldLabel>替换时的商品参考来源</FieldLabel><FormSelect aria-label="商品参考来源" value={String(draft.fields.whiteMode)} onValueChange={(value) => update({ fields: { ...draft.fields, whiteMode: value } })} options={skill.fields.whiteMode.options || []} /></Field>
        {draft.fields.whiteMode === "使用白底任务结果" && <Field><FieldLabel>指定白底任务</FieldLabel><FormSelect aria-label="指定白底任务" value={draft.whiteTaskId || ""} placeholder="请选择任务" onValueChange={(value) => update({ whiteTaskId: value })} options={whites.map((a) => ({ value: a.id, label: `#${shortId(a.id)} · ${a.step}` }))} /></Field>}
        {draft.fields.whiteMode === "使用已有" && <UploadRole skill={skill} role="whiteAsset" compact />}
      </FieldGroup><div className="white-task-action">{white ? <Status status={white.status} /> : <span className="muted">尚未绑定白底任务</span>}<GenerationCost state={whiteCost}/><Button variant="outline" disabled={submit.pending||!whiteCost.canSubmit} onClick={() => void submit.prepare("prepareWhite")}><WandSparkles />单独生成白底图</Button></div></div>
      {whites.length > 0 && <div className="white-task-strip">{whites.slice(-3).map((attempt) => <button key={attempt.id} onClick={() => setDetail(attempt.batchId)}><span>白底 #{shortId(attempt.id)}</span><Status status={attempt.status} /><ArrowRight /></button>)}</div>}
    </section>
    <section className="agent-section"><div className="section-heading"><h2><span className="step-index">03</span>生成设置</h2></div>      <div className="agent-action-bar"><FieldGroup className="agent-config"><Field><FieldLabel>替换对象</FieldLabel><Input aria-label="统一替换对象" placeholder="例如：人物身上的外套" value={String(draft.fields.targetDescription || "")} onChange={(e) => update({ fields: { ...draft.fields, targetDescription: e.target.value } })} /></Field><Field><FieldLabel>每图生成数量</FieldLabel><NumberInput aria-label="每图生成数量" min={1} max={studio.boot.settings.maxBatch} value={draft.count} onValueChange={(value) => update({ count: Number(value) || 1 })} /></Field><Field><FieldLabel>画幅</FieldLabel><FormSelect aria-label="对标生成画幅" value={draft.aspectRatio} onValueChange={(value) => update({ aspectRatio: value })} options={studio.boot.models.find((m) => m.id === draft.modelId)?.aspectRatios || []} /></Field></FieldGroup>
        <div className="agent-submit"><GenerationCost state={replaceCost}/><Button variant="outline" size="sm" onClick={onParameters}><Settings2 />公共参数</Button><Button disabled={submit.pending || !draft.selectedTargetIds.length||!replaceCost.canSubmit} onClick={() => void submit.prepare("replaceSelected")}><Sparkles />一键替换 {draft.selectedTargetIds.length * draft.count} 项<ArrowRight /></Button></div></div>
      <Textarea className="agent-requirements" aria-label="对标补充要求" placeholder="补充本批的商品保留要求、场景细节或宣传文案要求…" value={draft.requirements} onChange={(e) => update({ requirements: e.target.value })} />
</section></aside><div className="agent-output-panel"><section className="agent-section"><div className="section-heading"><h2>逐图创作结果</h2><span className="muted">已选 {draft.selectedTargetIds.length} / {targets.length} 张</span></div>
      {!targets.length ? <div className="agent-empty"><Layers3 /><strong>尚未添加对标图</strong><span>0 项待生成</span></div> : <><div className="agent-columns"><span>对标原图</span><span>商品绑定与逐图要求</span><span>最近一批结果</span></div><div className="agent-item-list">{targets.map((id, index) => {
        const selected = draft.selectedTargetIds.includes(id);
        const source = assets.find((a) => a.id === id);
        const attempts = latest?.attempts.filter((a) => a.targetId === id) || [];
        const newest = attempts.at(-1);
        const productCount = draft.inputRoles.product?.length || 0;
        return <article className={cnAgent(selected)} key={id}><div className="agent-source"><Checkbox aria-label={`工作台勾选目标 ${index + 1}`} checked={selected} onCheckedChange={() => update({ selectedTargetIds: selected ? draft.selectedTargetIds.filter((a) => a !== id) : [...draft.selectedTargetIds, id] })} /><img src={source?.url} alt={`对标原图 ${index + 1}`} /><div><strong>目标 {String(index + 1).padStart(2, "0")}</strong><small>独立出图</small><Badge variant="outline">{draft.aspectRatio}</Badge></div></div><div className="agent-binding"><div><Badge variant="secondary">商品参考 {productCount} 张</Badge>{draft.fields.whiteMode !== "直接使用商品原图" && <Badge variant="outline">白底辅助</Badge>}<IconButton icon={Settings2} label={`编辑目标 ${index + 1}`} onClick={() => void previewTarget(id)} /></div><p>{draft.overrides[id]?.promptOverride || `替换对象：${draft.overrides[id]?.targetDescription || draft.fields.targetDescription || "未填写"}。${draft.fields.replacementMode}；保留人物、姿态与场景，商品外观以自有商品图为准。`}</p><small>{draft.overrides[id]?.promptOverride ? "已覆盖本图提示词" : "使用公共参数"} · {draft.count} 张结果</small></div><div className="agent-result">{newest ? <AttemptTile attempt={newest} compact onDetails={() => setDetail(latest.id)} /> : <><Layers3 /><strong>{selected ? "准备就绪，尚未接单" : "未勾选"}</strong><small>{selected ? `${draft.count} 项待生成` : "不生成，不计入本批"}</small></>}</div></article>;
      })}</div></>}
    </section>
    {batches.length > 0 && <section className="agent-section"><div className="section-heading"><h2>执行批次</h2><span className="muted">{batches.length} 个批次</span></div>{batches.slice(0, 8).map((batch) => <div className="agent-batch-row" key={batch.id}><strong>#{shortId(batch.id)}</strong><span>{batch.attempts.filter((a) => a.status === "completed").length} 项已保存</span><Badge variant="outline">{batch.simulated?'历史模拟':'真实调用'}</Badge><Button size="sm" variant="ghost" onClick={() => setDetail(batch.id)}>查看全部尝试<ArrowRight /></Button></div>)}</section>}
    </div><Modal open={!!targetEdit} onClose={() => setTargetEdit(undefined)} title="逐图覆盖" description="只影响当前目标的新任务，已接单的请求保持不变。" wide>
      <FieldGroup><Field><FieldLabel>本图替换对象</FieldLabel><Input aria-label="本图替换对象" value={overrideDescription} onChange={(e) => setOverrideDescription(e.target.value)} /></Field><Field><FieldLabel>完整提示词覆盖</FieldLabel><Textarea className="prompt-text" aria-label="本图提示词覆盖" value={overrideText} onChange={(e) => setOverrideText(e.target.value)} /></Field></FieldGroup>
      <div className="modal-actions"><Button variant="outline" onClick={() => { if (targetEdit) { const overrides = { ...draft.overrides }; delete overrides[targetEdit]; update({ overrides }); } setTargetEdit(undefined); }}>恢复公共配置</Button><Button onClick={() => { if (targetEdit) update({ overrides: { ...draft.overrides, [targetEdit]: { targetDescription: overrideDescription, promptOverride: overrideText } } }); setTargetEdit(undefined); }}><Check />保存到草稿</Button></div>
    </Modal>
    <BatchDetails batchId={detail} onClose={() => setDetail(undefined)} onReuse={setReuse} />
    <ConfirmDialog open={!!reuse} onClose={() => setReuse(undefined)} title="替换当前对标草稿？" description="用历史批次设置覆盖当前草稿，不会立即开始生成。" cancelLabel="保留当前草稿" confirmLabel="替换草稿" onConfirm={() => { if (reuse) update(reuse.draft); setReuse(undefined); setDetail(undefined); }} />
  </div>;
}
function cnAgent(selected: boolean) { return selected ? "agent-item selected" : "agent-item"; }
