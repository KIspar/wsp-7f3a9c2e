import {PromptTemplatePicker} from './prompt-library';
import {applySkillTemplate,imagePromptKinds,videoPromptKinds} from '@/lib/prompt-templates';
import { AiAssistButton } from './analysis';
import {GenerationCost} from './generation-cost';
import {useGenerationQuote} from '@/lib/generation-quote';
import { EditImageBindings, ImageGenerationControls } from "./image-design";
import { Box, Check, CloudUpload, CloudOff, Eraser, Images, LoaderCircle, Plus, RectangleVertical, Settings2, Shuffle, Zap } from "lucide-react";
import type { Draft, Skill } from "../../packages/contracts";
import { useStudio } from "@/lib/studio";
import {parameterOptions,parameterValueLabel} from '@/lib/parameter-labels';
import { Button } from "@/components/ui/button";
import {InputGroup,InputGroupAddon,InputGroupTextarea} from '@/components/ui/input-group';
import {ToggleGroup,ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip,TooltipTrigger,TooltipContent} from '@/components/ui/tooltip';
import {creationSuggestions} from '@/lib/creation-suggestions';
import {toast} from 'sonner';
import { FormSelect } from "@/components/form-select";
import { IconButton } from "@/components/common";
import { UploadRole } from "@/components/uploads";

const ratioLabels: Record<string, string> = { "3:4": "电商主图", "1:1": "方形", "9:16": "竖屏", "16:9": "横屏" };
const resolutionLabels: Record<string, string> = { "1K": "标准", "2K": "超清", "4K": "极清", auto: "自动" };

export function CreativeComposer({ skill, pending, onSubmit, onParameters, onReset }: {
  skill: Skill; pending: boolean; onSubmit: () => void; onParameters: () => void; onReset: () => void;
}) {
  const studio = useStudio();
  const draft = studio.draft(skill.id);
  const cost=useGenerationQuote(skill);
  const status = studio.draftStatus(skill.id);
  const models = studio.boot.models.filter((m) => m.category === skill.model.category && m.enabled);
  const model = studio.boot.models.find((m) => m.id === draft.modelId);
  const isVideo = skill.category === "video";
  const perTarget = skill.batch.mode === "per-target";
  const total = perTarget ? draft.selectedTargetIds.length * draft.count : draft.count;
  const referenceCount = new Set(Object.values(draft.inputRoles).flat()).size;
  const resolution = String(draft.parameters.resolution || "auto");
  const variation = skill.fields.variation;
  const update = (patch: Partial<Draft>) => studio.updateDraft(skill.id, { ...studio.draft(skill.id), ...patch });
  const savedTime = status.savedAt && new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(status.savedAt);
  const saveLabel = status.error ? "草稿已存本地，服务同步失败" : status.pending ? "正在自动保存草稿…" : `草稿已自动保存${savedTime ? `于 ${savedTime}` : ""}`;
  const suggestions=creationSuggestions(skill,draft);
  const selected=suggestions.filter(s=>draft.requirements.split(/\r?\n/).includes(s.prompt)).map(s=>s.label);
  const toggleSuggestions=(labels:string[])=>{
    const current=studio.draft(skill.id).requirements;
    const removed=suggestions.filter(s=>selected.includes(s.label)&&!labels.includes(s.label));
    const kept=current.split(/\r?\n/).filter(line=>!removed.some(s=>s.prompt===line)).join('\n');
    const added=suggestions.filter(s=>labels.includes(s.label)&&!selected.includes(s.label)).map(s=>s.prompt);
    const next=[kept,...added].filter(Boolean).join('\n');
    if(next.length>16000){toast.error('创作要求已达到字数上限，请精简后添加');return;}
    update({requirements:next});
  };

  return <form className="composer creative-sidebar-composer" aria-label={`${skill.name}创作设置`} onSubmit={(event) => { event.preventDefault(); if (!pending && models.length && total > 0&&cost.canSubmit) onSubmit(); }}>
    <div className="composer-header">
      <div className="composer-context">
        <h2>创作设置</h2>
        <span className={`composer-save${status.error ? " save-error" : ""}`} role="status">
          {status.error ? <CloudOff /> : status.pending ? <LoaderCircle className="spin" /> : <CloudUpload />}<span>{saveLabel}</span>
        </span>
      </div>
      <div className="composer-header-actions"><PromptTemplatePicker categories={[isVideo?'video':'image']} kinds={isVideo?videoPromptKinds:imagePromptKinds} productName={draft.productContext?.name} disabled={pending} onApply={(a,o)=>{studio.updateDraft(skill.id,applySkillTemplate(studio.draft(skill.id),a,o,skill,studio.boot.models));}}/></div>
    </div>
    <div className="creative-sidebar-scroll">
    <div className="composer-main">
      <div className="design-section-heading"><h3>{isVideo?'视频素材':'图片素材'}</h3><span className={`composer-capacity${model && referenceCount > model.maxReferences ? " over-capacity" : ""}`}><b>{referenceCount}/{model?.maxReferences ?? "—"}</b> 张参考</span></div>
      <div className="composer-references">{Object.entries(skill.inputs).map(([role,input]) => <div className="creative-material-slot" key={role}><span>{input.label}</span><UploadRole skill={skill} role={role} compact /></div>)}</div>
      {skill.imageDesign === 'edit' && <EditImageBindings skill={skill}/>}
      <div className="composer-editor">
        <label className="creative-input-label" htmlFor={`creative-requirements-${skill.id}`}>创作要求</label>
        <InputGroup className="composer-input"><InputGroupTextarea id={`creative-requirements-${skill.id}`} rows={5} aria-label="创作要求" placeholder={isVideo ? "描述你想呈现的动作、镜头与场景…" : "描述这次的商品、画面和创作要求…"} value={draft.requirements} maxLength={16000} onChange={(event) => update({ requirements: event.target.value })} disabled={pending} onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!pending && models.length && total > 0&&cost.canSubmit) onSubmit(); }
        }} />{!isVideo&&<InputGroupAddon><AiAssistButton skill={skill} disabled={pending}/></InputGroupAddon>}</InputGroup>
        <ToggleGroup type="multiple" spacing={2} variant="outline" size="sm" className="composer-suggestions" aria-label="快捷创作要求" value={selected} onValueChange={toggleSuggestions} disabled={pending}>{suggestions.map(suggestion=><Tooltip key={suggestion.label}><TooltipTrigger asChild><ToggleGroupItem value={suggestion.label}>{selected.includes(suggestion.label)?<Check aria-hidden="true"/>:<Plus aria-hidden="true"/>}{suggestion.label}</ToggleGroupItem></TooltipTrigger><TooltipContent className="max-w-72">{suggestion.prompt}</TooltipContent></Tooltip>)}</ToggleGroup>
      </div>
    </div>

    <section className="creative-generation-settings" aria-label="生成参数"><h3>生成参数</h3>
      <div className="composer-controls">
        <FormSelect className="composer-model" icon={Box} aria-label="生成模型" disabled={pending} value={draft.modelId} onValueChange={(value) => {
          const selected = models.find((item) => item.id === value);
          if (selected) update({ modelId: selected.id, aspectRatio: selected.aspectRatios.includes(draft.aspectRatio) ? draft.aspectRatio : selected.aspectRatios[0], duration: selected.durations[0] || 6, parameters: Object.fromEntries(Object.entries(selected.parameters).map(([key, field]) => [key, field.default ?? ""])) });
        }} options={models.map((item) => ({ value: item.id, label: item.name }))} />
        <FormSelect icon={RectangleVertical} aria-label="画面比例" disabled={pending} value={draft.aspectRatio} displayValue={<>{draft.aspectRatio}{ratioLabels[draft.aspectRatio] ? `（${ratioLabels[draft.aspectRatio]}）` : ""}</>} onValueChange={(value) => update({ aspectRatio: value })} options={model?.aspectRatios || []} />
        {!skill.imageDesign && !!model?.parameters.resolution?.options?.length && <FormSelect className="composer-resolution" aria-label="输出分辨率" disabled={pending} value={resolution} displayValue={<><b className="resolution-value">{parameterValueLabel('resolution',resolution)}</b> {resolutionLabels[resolution] || "分辨率"}</>} onValueChange={(value) => update({ parameters: { ...draft.parameters, resolution: value } })} options={parameterOptions('resolution',model.parameters.resolution.options)} />}
        {skill.imageDesign ? <ImageGenerationControls skill={skill} /> : <FormSelect icon={Images} className="composer-count" aria-label={perTarget ? "每图生成数量" : "生成数量"} disabled={pending} value={String(draft.count)} displayValue={<><b>{perTarget ? `每图 ${draft.count} 张` : `${draft.count} ${isVideo ? "段" : "张"}`}</b><small>（展开）</small></>} onValueChange={(value) => update({ count: Number(value) })} options={Array.from({ length: studio.boot.settings.maxBatch }, (_, index) => ({ value: String(index + 1), label: perTarget ? `每图 ${index + 1} 张` : `生成 ${index + 1} ${isVideo ? "段" : "张"}` }))} />}

        {variation?.options && <FormSelect icon={Shuffle} className="composer-variation" aria-label="多图差异" disabled={pending} value={String(draft.fields.variation)} displayValue={draft.fields.variation === "独立构图" ? "独立不同构图" : String(draft.fields.variation)} onValueChange={(value) => update({ fields: { ...draft.fields, variation: value } })} options={variation.options} />}
        {isVideo && <FormSelect aria-label="视频时长" disabled={pending} value={String(draft.duration)} onValueChange={(value) => update({ duration: Number(value) })} options={(model?.durations || []).map((duration) => ({ value: String(duration), label: `${duration} 秒` }))} />}
        <Button className="composer-parameters" variant="outline" type="button" onClick={onParameters}><Settings2 />高级参数</Button>
      </div>
    </section>
    </div>
      <div className="composer-submit">
        <IconButton className="composer-reset" icon={Eraser} variant="ghost" label="重置草稿" onClick={onReset} />
        <GenerationCost state={cost}/>
        <Button className="composer-send" type="submit" disabled={pending || !models.length || total === 0||!cost.canSubmit} title="预览生成计划，确认后提交后台执行" aria-keyshortcuts="Control+Enter Meta+Enter">{pending ? <LoaderCircle className="spin" /> : <Zap />}<span>预览生成<span className="composer-send-count">（{total} 项）</span></span><kbd>Ctrl+Enter</kbd></Button>
      </div>
  </form>;
}
