import {useState} from 'react';
import {Copy,Download,Image as ImageIcon,Film} from 'lucide-react';
import type {Asset,Attempt} from '../../packages/contracts';
import {useStudio} from '@/lib/studio';
import {dateTime} from '@/lib/api';
import {Button} from './ui/button';
import {MediaModal,copy,Status} from './common';

/** All saved results remain reachable here, including superseded outputs. */
export function TaskMedia({attempts}:{attempts:Attempt[]}){
 const {snapshot}=useStudio();const [view,setView]=useState<Asset>();
 return <><div className="task-history-media">{[...attempts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.attemptNumber-a.attemptNumber).map(a=>{const asset=snapshot.assets.find(x=>x.id===a.assetId);return <article className="task-history-result" key={a.id}><button className="task-history-thumb" disabled={!asset} onClick={()=>setView(asset)} aria-label={`预览第${a.index}项 ${dateTime(a.createdAt)}`}>{asset?.type==='image'?<img src={asset.url} alt={`生成图片 ${a.index}`} loading="lazy"/>:asset?.type==='video'?<><video src={asset.url+'#t=0.1'} preload="metadata" muted/><Film/></>:<ImageIcon/>}</button><div className="task-history-result-info"><strong>第 {a.index} 项</strong><Status status={a.status}/><small>{dateTime(a.createdAt)}</small>{a.error&&<p role="alert">{a.error}</p>}<div>{asset&&<Button variant="outline" size="sm" asChild><a href={`/api/assets/${asset.id}/download`}><Download/>下载</a></Button>}<Button variant="ghost" size="sm" onClick={()=>void copy(a.prompt)}><Copy/>复制提示词</Button></div></div></article>;})}</div><MediaModal asset={view} onClose={()=>setView(undefined)}/></>;
}
