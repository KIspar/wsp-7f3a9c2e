import { useEffect, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, GripVertical, LoaderCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { Batch, LongImageLayout } from '../../packages/contracts';
import { api } from '@/lib/api';
import { useStudio } from '@/lib/studio';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { NumberInput } from './ui/number-input';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import {Sheet,SheetContent,SheetHeader,SheetTitle} from './ui/sheet';
import { FormSelect } from './form-select';
import {Modal} from './common';
import {LoadingState} from './loading-state';

type Entry={itemId:string;attemptId:string;included:boolean};
export function LongImageLayoutSheet({batch,group,onClose}:{batch:Batch;group:number;onClose:()=>void}) {
  const studio=useStudio();
  const attempts=batch.attempts.filter(a=>a.groupIndex===group);
  const originals=attempts.filter(a=>a.attemptNumber===1).sort((a,b)=>(a.screenOrder||0)-(b.screenOrder||0));
  const [entries,setEntries]=useState<Entry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[drag,setDrag]=useState<number>();
  const [options,setOptions]=useState<Omit<LongImageLayout,'attemptIds'>>({width:750,gap:0,background:'white',format:'png'});
  const [dimensions,setDimensions]=useState<Record<string,{width:number;height:number}>>({});
  const [download,setDownload]=useState<string>();
  const [baseline,setBaseline]=useState(''),[confirmClose,setConfirmClose]=useState(false);
  const base=`/batches/${batch.id}/groups/${group}`;
  useEffect(()=>{let ignore=false;
    api<{layout:LongImageLayout|null}>(base+'/layout').then(({layout})=>{
      if(ignore)return;
      const initial=originals.map(a=>{const latest=attempts.filter(v=>v.itemId===a.itemId&&v.status==='completed'&&v.assetId).sort((a,b)=>b.attemptNumber-a.attemptNumber)[0];return {itemId:a.itemId,attemptId:latest?.id||'',included:!!latest};});
      if(layout){
        const sorted:Entry[]=layout.attemptIds.map(id=>{const a=attempts.find(v=>v.id===id);if(!a)throw new Error('已保存布局中的图片不可用，请检查任务结果');return {itemId:a.itemId,attemptId:initial.find(e=>e.itemId===a.itemId)?.attemptId||id,included:true};});
        setEntries([...sorted,...initial.filter(e=>!sorted.some(s=>s.itemId===e.itemId)).map(e=>({...e,included:false}))]);
        setOptions({width:layout.width,gap:layout.gap,background:layout.background,format:layout.format});setBaseline(JSON.stringify(layout));
      }else {setEntries(initial);setBaseline(JSON.stringify({...options,attemptIds:initial.filter(e=>e.included).map(e=>e.attemptId)}));}
    }).catch(e=>{if(!ignore)setError((e as Error).message);}).finally(()=>{if(!ignore)setLoading(false);});return ()=>{ignore=true;};
  },[base]);
  const resultsStamp=attempts.map(a=>`${a.id}:${a.status}`).join('|');
  useEffect(()=>{setEntries(old=>old.map(e=>{const latest=attempts.filter(a=>a.itemId===e.itemId&&a.status==='completed'&&a.assetId).sort((a,b)=>b.attemptNumber-a.attemptNumber)[0];return latest&&latest.id!==e.attemptId?{...e,attemptId:latest.id}:e;}));setDownload(undefined);},[resultsStamp]);
  const selected=entries.filter(e=>e.included&&e.attemptId);
  const layout:LongImageLayout={...options,attemptIds:selected.map(e=>e.attemptId)};
  const incomplete=originals.filter(a=>!attempts.some(v=>v.itemId===a.itemId&&v.status==='completed'&&v.assetId)).length;
  const previewHeight=selected.every(e=>dimensions[e.attemptId])?selected.reduce((sum,e)=>sum+Math.max(1,Math.round(dimensions[e.attemptId].height*options.width/dimensions[e.attemptId].width)),0)+Math.max(0,selected.length-1)*options.gap:undefined;
  const upscale=selected.some(e=>dimensions[e.attemptId]&&dimensions[e.attemptId].width<options.width);
  function move(from:number,to:number){if(to<0||to>=entries.length)return;const next=[...entries];const [entry]=next.splice(from,1);next.splice(to,0,entry);setEntries(next);setDownload(undefined);}
  const dirty=!!baseline&&JSON.stringify(layout)!==baseline;
  function requestClose(){if(busy)return;if(dirty)setConfirmClose(true);else onClose();}
  async function save(exporting=false){setBusy(true);setError('');try{
    if(exporting){const result=await api<{url:string;width:number;height:number}>(base+'/export',layout);setDownload(result.url);const link=document.createElement('a');link.href=result.url;link.download='';link.click();toast.success('长图已导出，排版已保存');}
    else{await api<{width:number;height:number}>(base+'/layout',layout,'PUT');toast.success('排版已保存');}
  setBaseline(JSON.stringify(layout));return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
  return <><Sheet open onOpenChange={open=>!open&&requestClose()}><SheetContent aria-describedby={undefined} className="long-image-sheet"><SheetHeader><SheetTitle>第 {group} 组 · 长图排版</SheetTitle></SheetHeader>
    <div className="layout-sheet-body" inert={busy}>{loading?<LoadingState label="正在读取排版…"/>:<>
      <FieldGroup className="layout-settings"><Field><FieldLabel>导出宽度（px）</FieldLabel><NumberInput aria-label="长图宽度" min={320} max={4096} value={options.width} onValueChange={width=>{setOptions({...options,width:Number(width)||750});setDownload(undefined);}}/></Field><Field><FieldLabel>图片间距（px）</FieldLabel><NumberInput aria-label="长图间距" min={0} max={80} value={options.gap} onValueChange={gap=>{setOptions({...options,gap:Number(gap)||0});setDownload(undefined);}}/></Field><Field><FieldLabel>背景</FieldLabel><FormSelect aria-label="长图背景" value={options.background} options={[{value:'white',label:'白色'},{value:'gray',label:'浅灰'},{value:'black',label:'深色'}]} onValueChange={background=>{setOptions({...options,background:background as typeof options.background});setDownload(undefined);}}/></Field><Field><FieldLabel>文件格式</FieldLabel><FormSelect aria-label="长图格式" value={options.format} options={[{value:'png',label:'PNG'},{value:'jpg',label:'JPG'}]} onValueChange={format=>{setOptions({...options,format:format as typeof options.format});setDownload(undefined);}}/></Field></FieldGroup>
      <div className="layout-summary"><strong>{dirty?'未保存 · ':''}{selected.length} / {originals.length} 屏已选</strong><span>{previewHeight?`${options.width} × ${previewHeight}px`:'尺寸将在读取图片后显示'}</span></div>{!selected.length&&<p className="muted">暂无可排版图片。生成成功后自动使用最新结果，可勾选本次需要的详情屏。</p>}
      {incomplete>0&&<p className="layout-warning">有 {incomplete} 屏尚无成功结果。本次只导出已勾选的 {selected.length} 屏。</p>}
      {upscale&&<p className="layout-warning">当前宽度会放大部分图片，可能降低清晰度。</p>}
      <div className="layout-items">{entries.map((entry,index)=>{const item=originals.find(a=>a.itemId===entry.itemId)!;const versions=attempts.filter(a=>a.itemId===entry.itemId&&a.status==='completed'&&a.assetId);const a=attempts.find(a=>a.id===entry.attemptId),asset=studio.snapshot.assets.find(v=>v.id===a?.assetId);return <div key={entry.itemId} className="layout-item" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag!==undefined)move(drag,index);setDrag(undefined);}}>
        <span draggable onDragStart={()=>setDrag(index)} onDragEnd={()=>setDrag(undefined)} title="拖动排序"><GripVertical /></span><Checkbox aria-label={`排版包含${item.screenType}第${item.screenOrder}屏`} disabled={!versions.length||!entry.attemptId} checked={entry.included} onCheckedChange={included=>{setEntries(entries.map((e,i)=>i===index?{...e,included:!!included}:e));setDownload(undefined);}}/>{asset?<img src={asset.url} alt={item.screenType} />:<span className="layout-no-image">{versions.length?'未选择':'未完成'}</span>}<div><strong>{item.screenType}</strong><small>{versions.length?'当前生成结果':'完成生成后重新打开'}</small></div><div><Button aria-label={`排版上移第${index+1}项`} variant="ghost" size="icon-sm" disabled={index===0} onClick={()=>move(index,index-1)}><ArrowUp /></Button><Button aria-label={`排版下移第${index+1}项`} variant="ghost" size="icon-sm" disabled={index===entries.length-1} onClick={()=>move(index,index+1)}><ArrowDown /></Button></div>
      </div>;})}</div>
      <div className={`long-image-preview preview-${options.background}`} style={{gap:options.gap*300/options.width}} aria-label="长图预览">{selected.map(e=>{const a=attempts.find(a=>a.id===e.attemptId),asset=studio.snapshot.assets.find(v=>v.id===a?.assetId);return asset&&<img key={e.attemptId} src={asset.url} alt={a?.screenType} onLoad={event=>{const img=event.currentTarget;setDimensions(old=>({...old,[e.attemptId]:{width:img.naturalWidth,height:img.naturalHeight}}));}}/>;})}</div>
      {error&&<p className="error-text" role="alert">{error}</p>}

    </>}</div>
      <div className="layout-actions"><Button variant="outline" disabled={busy||!selected.length} onClick={()=>void save()}><Save />保存排版</Button><Button disabled={busy||!selected.length} onClick={()=>void save(true)}>{busy?<LoaderCircle className="spin"/>:<ArrowDownToLine/>}保存并下载长图</Button>{download&&<a href={download} className="text-sm text-primary">再次下载</a>}</div>
  </SheetContent></Sheet><Modal open={confirmClose} onClose={()=>!busy&&setConfirmClose(false)} title="排版尚未保存" description="保存后关闭，或放弃本次排版更改。已生成图片不会删除。"><div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setConfirmClose(false)}>继续编辑</Button><Button variant="outline" disabled={busy} onClick={()=>{setConfirmClose(false);onClose();}}>放弃更改</Button><Button disabled={busy||!selected.length} onClick={async()=>{if(await save()){setConfirmClose(false);onClose();}}}>保存并关闭</Button></div></Modal></>;
}
