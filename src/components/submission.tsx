import { useState } from "react";
import { ArrowRight, Check, Copy, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Modal, copy } from "./common";
import { api, ApiError } from "@/lib/api";
import { useStudio } from "@/lib/studio";
import {quoteAmount,quoteRange} from '@/lib/generation-quote';
import {useRefreshAccount} from '@/lib/account';
import type { Batch, Draft, Plan, SavedDraft, Skill, Submission } from "../../packages/contracts";

export const pendingKey = "studio-pending-submission";
export function useSubmission(skill: Skill) {
  const studio = useStudio();
  const refreshAccount=useRefreshAccount();
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{ plan: Plan; draft: Draft; revision: number; key: string }>();
  const [expanded, setExpanded] = useState(0);
  async function prepare(action: Submission["action"] = "generate") {
    setPending(true);
    try {
      if (localStorage.getItem(pendingKey)) throw new Error("上一笔接单结果尚未核实，请先在顶部核实接单结果");
      const saved = await studio.flushDraft(skill.id);
      const plan = await api<Plan>("/plan", { skillId: skill.id, draft: saved.value, action });
      setPreview({ plan, draft: saved.value, revision: saved.revision, key: crypto.randomUUID() });
      setExpanded(0);
    } catch (error) { toast.error((error as Error).message); }
    finally { setPending(false); }
  }
  async function confirm() {
    if (!preview || pending||!preview.plan.quote?.affordable) return;
    setPending(true);
    const request: Submission = {
      skillId: skill.id, draft: preview.draft, action: preview.plan.action,
      expectedDraftRevision: preview.revision, idempotencyKey: preview.key, planHash: preview.plan.hash,
      maximumCost:preview.plan.quote.maximum,
    };
    localStorage.setItem(pendingKey, JSON.stringify(request));
    window.dispatchEvent(new Event("studio-pending"));
    try {
      const result = await api<{ batch: Batch; draft: SavedDraft }>("/submit", request);
      studio.acceptDraft(result.draft);
      localStorage.removeItem(pendingKey);
      window.dispatchEvent(new Event("studio-pending"));
      setPreview(undefined);
      toast.success(`已接单 ${result.batch.attempts.length} 项，后台继续执行`);
      await studio.refresh();
      await refreshAccount();
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        localStorage.removeItem(pendingKey);
        window.dispatchEvent(new Event("studio-pending"));
      }
      toast.error((error as Error).message);
      if(error instanceof ApiError&&[402,409].includes(error.status))setPreview(undefined);
    } finally { setPending(false); }
  }
  const dialog = <Modal open={!!preview} onClose={() => { if (!pending) setPreview(undefined); }} title="确认生成计划" description={`${skill.name} · 技能 v${skill.revision} · 配置将在接单时锁定`} wide>
    {preview && <>
      <Alert className="simulation-alert"><ShieldCheck /><AlertTitle>真实模型生成</AlertTitle><AlertDescription>确认后提交付费生成，任务在后台执行。</AlertDescription></Alert>
      <div className="plan-summary"><div><small>本次任务</small><strong>{preview.plan.total}<span> 项</span></strong></div><div><small>接口参考费用</small><strong>{preview.plan.quote?quoteRange(preview.plan.quote):'报价不可用'}<span> {preview.plan.quote?.unit}</span></strong></div><div><small>账户余额 / 当前可用</small><strong>{preview.plan.quote?`${quoteAmount(preview.plan.quote.balance)} / ${quoteAmount(preview.plan.quote.available)}`:'—'}<span> {preview.plan.quote?.unit}</span></strong></div></div>
      {preview.plan.quote&&!preview.plan.quote.affordable&&<Alert variant="destructive"><AlertTitle>可用算力不足</AlertTitle><AlertDescription>本次按最高报价需要 {quoteAmount(preview.plan.quote.maximum)} {preview.plan.quote.unit}。请减少生成数量或补充余额后重新预览。</AlertDescription></Alert>}
      
      {preview.plan.quote?.note&&<Alert><AlertTitle>Token01 计费说明</AlertTitle><AlertDescription>{preview.plan.quote.note}</AlertDescription></Alert>}
      <div className="plan-items">{preview.plan.items.map((item, i) => <div className="plan-item" key={i}><button className="plan-item-head" aria-expanded={expanded===i} aria-controls={`plan-prompt-${i}`} onClick={() => setExpanded(i === expanded ? -1 : i)}><span className="index-label">{String(item.index).padStart(2, "0")}</span><strong>{item.targetLabel || "独立成品"} · 第 {item.variant} 张</strong><span>{item.references.length} 张参考</span><Badge variant="outline">{String(item.parameters.aspectRatio)}</Badge><ArrowRight /></button>{expanded === i && <div className="plan-prompt" id={`plan-prompt-${i}`}><p>{item.prompt}</p><Button variant="ghost" size="sm" onClick={() => void copy(item.prompt)}><Copy />复制提示词</Button></div>}</div>)}</div>
      <div className="modal-actions"><Button variant="outline" onClick={() => setPreview(undefined)} disabled={pending}>返回编辑</Button><Button onClick={() => void confirm()} disabled={pending||!preview.plan.quote?.affordable}>{pending ? <LoaderCircle className="spin" /> : <Check />}确认接单 {preview.plan.total} 项</Button></div>
    </>}
  </Modal>;
  return { prepare, pending, dialog };
}
