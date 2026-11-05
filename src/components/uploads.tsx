import { AiAssistButton } from './analysis';
import { useRef, useState } from "react";
import {Check,ImagePlus,Images,LoaderCircle,Plus,Trash2,X} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { IconButton, MediaModal, Modal } from "./common";
import { useStudio } from "@/lib/studio";
import { api } from "@/lib/api";
import type { Asset, Skill } from "../../packages/contracts";
import { ConfirmDialog } from "./confirm-dialog";
import { emptyImageDesign } from "../../packages/contracts";
import { uploadPastedImages } from "@/lib/paste-upload";
import { cn } from "@/lib/utils";

export function UploadRole({ skill, role, compact = false }: { skill: Skill; role: string; compact?: boolean }) {
  const studio = useStudio();
  const definition = skill.inputs[role];
  const draft = studio.draft(skill.id);
  const ids = draft.inputRoles[role] || [];
  const assets = [...studio.snapshot.assets, ...studio.boot.examples];
  const [replaceIds, setReplaceIds] = useState<string[]>();
  const [expanded, setExpanded] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [view, setView] = useState<Asset>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null), uploadLatch = useRef(false);
  const applyAdd = (newIds: string[]) => {
    const current = studio.draft(skill.id);
    if (skill.imageDesign === "edit" && newIds.some(id=>Object.entries(current.inputRoles).some(([key,ids])=>key!==role&&ids.includes(id)))) { toast.error("图片已在另一个入口中，请先移除再更换用途"); return; }
    const before = current.inputRoles[role] || [];
    if (definition.cardinality === "single" && newIds.length > 1) { toast.error("此入口只能添加一张图片"); return; }
    const value = definition.cardinality === "single" ? newIds : [...new Set([...before, ...newIds])];
    const design = current.imageDesign || emptyImageDesign();
    const bindings = [...design.bindings];
    let nextNumber = design.nextNumber;
    if (skill.imageDesign === "edit") for (const assetId of newIds) if (!bindings.some(b=>b.assetId===assetId)) bindings.push({assetId,number:nextNumber++});
    studio.updateDraft(skill.id, {
      ...current, inputRoles: { ...current.inputRoles, [role]: value },
      ...(skill.imageDesign === "edit" ? {imageDesign:{...design,bindings,nextNumber}} : {}),
      selectedTargetIds: definition.cardinality === "targets" ? [...new Set([...current.selectedTargetIds, ...newIds])] : current.selectedTargetIds,
    });
  };
  const add = (newIds:string[]) => {
    const before=studio.draft(skill.id).inputRoles[role] || [];
    if (definition.cardinality === "single" && before.length && newIds[0] !== before[0]) setReplaceIds(newIds);
    else applyAdd(newIds);
  };
  const pictureLabel = (id:string,index:number) => skill.imageDesign === "edit" ? `图${draft.imageDesign?.bindings.find(b=>b.assetId===id)?.number ?? "?"}` : `${role === "product" ? "产品图" : role === "targets" ? "目标图" : "参考图"} ${String(index+1).padStart(2,"0")}`;
  const remove = (id: string) => {
    const current = studio.draft(skill.id);
    const overrides = { ...current.overrides };
    delete overrides[id];
    studio.updateDraft(skill.id, {
      ...current, inputRoles: { ...current.inputRoles, [role]: (current.inputRoles[role] || []).filter((a) => a !== id) },
      selectedTargetIds: current.selectedTargetIds.filter((a) => a !== id), overrides,
    });
  };
  const upload = async (files: File[]) => {
    if (!files.length || uploadLatch.current) return;
    if (definition.cardinality === "single" && files.length > 1) {toast.error("参考图只能上传一张，请单独选择");return;}
    uploadLatch.current = true;
    setBusy(true);
    try {
    const uploaded: string[] = [];
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast.error("仅接受静态 JPG、PNG、WebP 图片"); continue; }
      if (file.size > studio.boot.settings.maxFileMb * 1024 * 1024) { toast.error(`单张图片不能超过 ${studio.boot.settings.maxFileMb} MB`); continue; }
      try {
        const form = new FormData();
        form.append("file", file);
        const asset = await api<Asset>("/upload", form);
        uploaded.push(asset.id);
      } catch (error) { toast.error((error as Error).message); }
    }
    if (uploaded.length) { add(uploaded); await studio.refresh(); }
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); uploadLatch.current = false; }
  };
  const body = <div className="upload-grid">
    {ids.map((id, index) => {
      const asset = assets.find((a) => a.id === id);
      const isTarget = definition.cardinality === "targets";
      const selected = draft.selectedTargetIds.includes(id);
      return <div className={cn("input-tile", isTarget && selected && "selected")} key={id}>
        {asset ? <button type="button" className="input-photo" onClick={() => setView(asset)} aria-label={`预览${definition.label} ${index + 1}`}><img src={asset.url} alt={`${definition.label} ${index + 1}`} /></button> : <span className="missing-asset">载入素材…</span>}
        {isTarget && <div className="tile-check"><Checkbox aria-label={`勾选目标图 ${index + 1}`} checked={selected} onCheckedChange={() => studio.updateDraft(skill.id, { ...draft, selectedTargetIds: selected ? draft.selectedTargetIds.filter((a) => a !== id) : [...draft.selectedTargetIds, id] })} /></div>}
        <span className="tile-number">{pictureLabel(id,index)}</span>
        <IconButton icon={X} label={`移除图片 ${index + 1}`} onClick={() => remove(id)} className="tile-remove" />
      </div>;
    })}
    <button type="button" className="add-tile" onClick={() => input.current?.click()} disabled={busy} aria-label={`添加${definition.label}`}>{busy ? <LoaderCircle className="spin" /> : <Plus />}<span>添加图片</span></button>
  </div>;
  return <>
    <div
      className={cn("upload-role", compact && "upload-role-compact", dragging && "dragging")}
      tabIndex={0} aria-label={`${definition.label}上传区`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void upload([...e.dataTransfer.files]); }}
      onPaste={e => uploadPastedImages(e, upload)}
    >
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple={definition.cardinality !== "single"} className="sr-only" aria-label={`上传${definition.label}`} onChange={(e) => { void upload([...(e.target.files || [])]); e.target.value = ""; }} />
      {compact ? <Popover open={expanded} onOpenChange={setExpanded}><PopoverTrigger asChild><button type="button" className="reference-stack" aria-label={`${definition.label}，${ids.length} 张`} aria-busy={busy}>
        {ids.length ? <div className="stack-photos">{ids.slice(0, 3).map((id, i) => <img key={id} src={assets.find((a) => a.id === id)?.url} alt="" style={{ transform: `rotate(${(i - 1) * 9}deg)` }} />)}</div> : <div className="stack-empty"><ImagePlus /></div>}
        <span>{role === "product" ? "商品图" : role === "targets" ? "目标图" : "参考图"}<small>{busy?<LoaderCircle className="spin"/>:ids.length ? `${ids.length} 张` : "添加"}</small></span>
      </button></PopoverTrigger>
        <PopoverContent onPaste={e => uploadPastedImages(e, upload)} side="top" align="start" className="upload-popover w-80" aria-label={definition.label}>
          <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3"><strong className="flex items-center gap-2 text-sm font-bold"><Images className="size-4 text-primary" />{definition.label}（{ids.length}）</strong><Button type="button" size="xs" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />}添加图片</Button></div>
          {skill.imageDesign && null}
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">{ids.map((id,index) => {
            const asset = assets.find(a => a.id === id);
            return <div key={id} className="upload-asset-row flex items-center gap-3 rounded-xl border bg-secondary/50 p-2"><button type="button" className="size-11 shrink-0 overflow-hidden rounded-lg border" aria-label={`预览${definition.label} ${index + 1}`} onClick={() => setView(asset)}>{asset && <img src={asset.url} alt="" className="size-full object-cover" />}</button><div className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold">{pictureLabel(id,index)}</strong><span className="mt-1 block text-caption text-muted-foreground">已添加 · {asset?.source === "example" ? "示例素材" : "本地素材"}</span></div><IconButton icon={Trash2} label={`移除图片 ${index+1}`} onClick={() => remove(id)} /></div>;
          })}{!ids.length && <p className="py-5 text-center text-sm text-muted-foreground">暂无图片，可上传、拖拽或粘贴添加</p>}</div>
          <div className="mt-3 flex justify-between gap-2 border-t pt-3"><Button type="button" size="sm" variant="ghost" onClick={() => { setSelection([]); setGallery(true); }}>选择示例素材</Button><Button type="button" size="sm" onClick={() => setExpanded(false)}>完成</Button></div>
        </PopoverContent></Popover> : <><div className="upload-label"><strong><Images />{definition.label}</strong><div><Badge variant="outline">{ids.length} 张</Badge><Button size="xs" variant="ghost" onClick={() => { setSelection([]); setGallery(true); }}>示例</Button></div></div>{skill.imageDesign && role === "product" && null}{body}</>}
    </div>
    {(role === "reference" || role === "references") && ids.length === 1 && <AiAssistButton skill={skill} action="reverse-image" assetIds={ids} label="反推提示词" />}
    <Modal open={gallery} onClose={() => setGallery(false)} title="原型示例素材" description="来自随附 Stitch 截图，仅供本地流程演示，不是生成结果。" wide>
      <div className="example-gallery" tabIndex={0} onPaste={e => uploadPastedImages(e, upload)}>{studio.boot.examples.map((asset, index) => <button key={asset.id} aria-label={`选择示例 ${index + 1}`} aria-pressed={selection.includes(asset.id)} className={cn("example-choice", selection.includes(asset.id) && "selected")} onClick={() => setSelection((old) => definition.cardinality === "single" ? [asset.id] : old.includes(asset.id) ? old.filter((id) => id !== asset.id) : [...old, asset.id])}><img src={asset.url} alt={`原型示例 ${index + 1}`} /><span>{selection.includes(asset.id) && <Check />}示例 {index + 1}</span></button>)}</div>
      <div className="modal-actions"><span className="muted">{selection.length} 张已选</span><Button disabled={!selection.length} onClick={() => { add(selection); setGallery(false); }}><Plus />添加所选</Button></div>
    </Modal>
    <ConfirmDialog open={!!replaceIds} onClose={()=>setReplaceIds(undefined)} title="替换参考图？" description="当前参考图会从草稿中移除，已提交任务保持原始引用。" confirmLabel="替换参考图" onConfirm={()=>{if(replaceIds)applyAdd(replaceIds);setReplaceIds(undefined);}} />
    <MediaModal asset={view} onClose={() => setView(undefined)} />
  </>;
}
