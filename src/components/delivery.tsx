import { useState } from 'react';
import {ArrowDownToLine,Check,Layers3,LoaderCircle,Copy} from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from '@/lib/studio';
import { api, dateTime } from '@/lib/api';

import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { FormSelect } from './form-select';
import {copy} from './common';
import { LongImageLayoutSheet } from './long-image-layout';

export function DeliveryPage(){
  const studio=useStudio(),[filter,setFilter]=useState('all'),[excluded,setExcluded]=useState<string[]>([]),[busy,setBusy]=useState(false);
  const [layout,setLayout]=useState<{batchId:string;group:number}>();
  const batches=studio.snapshot.batches.filter(b=>filter==='all'||(filter==='unlinked'?!b.draft.productContext:b.draft.productContext?.id===filter));
  const attempts=batches.flatMap(b=>b.attempts),chosen=studio.snapshot.selections||[];
  const entries=chosen.flatMap(s=>{const attempt=attempts.find(a=>a.id===s.attemptId),batch=batches.find(b=>b.id===attempt?.batchId),asset=studio.snapshot.assets.find(a=>a.id===attempt?.assetId);return attempt&&batch&&asset?.type==='image'&&attempt.status==='completed'?[{attempt,batch,asset}]:[];});
  const selected=entries.filter(e=>!excluded.includes(e.attempt.id));
  const totalItems=new Set(attempts.filter(a=>a.model.category==='image').map(a=>a.itemId)).size;
  const unresolved=totalItems-entries.length;
  const groups=batches.flatMap(batch=>[...new Set(batch.attempts.filter(a=>a.groupIndex&&a.status==='completed').map(a=>a.groupIndex!))].map(group=>({batch,group})));
  const layoutBatch=studio.snapshot.batches.find(b=>b.id===layout?.batchId);
  async function download(){
    setBusy(true);
    try{const result=await api<{url:string;count:number}>('/deliveries/export',{attemptIds:selected.map(e=>e.attempt.id)});const link=document.createElement('a');link.href=result.url;link.download='';link.click();toast.success(`已导出${result.count}张所选图片，附任务清单`);}catch(error){toast.error((error as Error).message);await studio.refresh();}finally{setBusy(false);}
  }
  return <div className="management-page delivery-page"><section className="management-heading"><h1>成套交付</h1></section>
    <div className="delivery-toolbar"><FormSelect aria-label="交付商品筛选" value={filter} onValueChange={value=>{setFilter(value);setExcluded([]);}} options={[{value:'all',label:'全部商品'},...(studio.snapshot.products||[]).map(p=>({value:p.id,label:p.name})),{value:'unlinked',label:'未关联商品的历史结果'}]}/><span><strong>{entries.length}</strong> 张当前结果 · {unresolved} 项待完成</span><Button type="button" disabled={busy||!selected.length} onClick={()=>void download()}>{busy?<LoaderCircle className="spin"/>:<ArrowDownToLine/>}下载所选 {selected.length} 张</Button></div>
    {unresolved>0&&<Alert><Layers3/><AlertTitle>本次仅导出明确选中的图片</AlertTitle><AlertDescription>当前范围有 {unresolved} 项尚无成功结果，完成后会自动显示。</AlertDescription></Alert>}
    {!entries.length?<Empty><EmptyHeader><EmptyTitle>暂无生成结果</EmptyTitle><EmptyDescription>生成完成后，当前结果会自动显示在这里。旧任务可在“全部任务”中下载或复制。</EmptyDescription></EmptyHeader></Empty>:<div className="delivery-grid">{entries.map(({attempt,batch,asset})=><article className="delivery-card" key={attempt.id}><div className="delivery-card-heading"><Checkbox aria-label={`本次下载包含${batch.skillName}第${attempt.index}项`} checked={!excluded.includes(attempt.id)} disabled={busy} onCheckedChange={included=>setExcluded(old=>included?old.filter(id=>id!==attempt.id):[...old,attempt.id])}/><strong>{batch.draft.productContext?.name||String(batch.draft.fields.productName||'未关联商品')}</strong><Badge variant="secondary"><Check/>当前结果</Badge></div><a href={`/api/assets/${asset.id}/download`} className="delivery-image" aria-label={`查看${batch.skillName}第${attempt.index}项`}><img src={asset.url} alt={`${batch.skillName}当前结果`} loading="lazy"/></a><div className="delivery-card-body"><strong>{attempt.screenType||batch.skillName}</strong><p>{dateTime(batch.createdAt)}{attempt.simulated?' · 模拟素材':''}</p><div><Button type="button" size="sm" variant="outline" onClick={()=>void copy(attempt.prompt)}><Copy/>复制提示词</Button></div></div></article>)}</div>}
    {!!groups.length&&<section className="delivery-layouts"><h2>详情长图</h2>{groups.map(({batch,group})=><div key={`${batch.id}-${group}`}><div><strong>{batch.draft.productContext?.name||String(batch.draft.fields.productName||'历史详情图')} · 第 {group} 组</strong><span>{dateTime(batch.createdAt)}</span></div><Button type="button" variant="outline" size="sm" onClick={()=>setLayout({batchId:batch.id,group})}><Layers3/>排版长图</Button></div>)}</section>}
    
    {layout&&layoutBatch&&<LongImageLayoutSheet key={`${layout.batchId}-${layout.group}`} batch={layoutBatch} group={layout.group} onClose={()=>setLayout(undefined)}/>}
  </div>;
}
