import type {ReactNode} from 'react';
import {AlertCircle,RotateCw} from 'lucide-react';
import {Skeleton} from '../ui/skeleton';
import {Button} from '../ui/button';
import {LoadingState} from '../loading-state';

/** Match the pending surface so data loading never removes its spatial context. */
export function WorkspaceLoading({label,layout='tasks'}:{label:string;layout?:'tasks'|'composer'|'shots'}){
 return <div className={`workspace-loading workspace-loading-${layout}`} role="status" aria-busy="true" aria-label={label}>
  <LoadingState label={label} placement="inline" className="workspace-state-message"/>
  <div aria-hidden="true" className="workspace-loading-shapes">
   {layout==='composer'?<><Skeleton className="h-5 w-28"/><div className="flex gap-3">{[0,1,2].map(i=><Skeleton key={i} className="h-24 w-20"/>)}</div><Skeleton className="h-4 w-32"/><Skeleton className="h-32 w-full"/><div className="grid grid-cols-2 gap-3"><Skeleton className="h-10"/><Skeleton className="h-10"/></div><Skeleton className="h-10 w-full"/></>:layout==='shots'?<><div className="grid grid-cols-4 gap-3">{[0,1,2,3].map(i=><Skeleton key={i} className="h-10"/>)}</div><Skeleton className="h-16 w-40"/><div className="grid grid-cols-3 gap-3">{[0,1,2].map(i=><Skeleton key={i} className="aspect-[9/16] max-h-80 w-full"/>)}</div></>:<>{[0,1].map(i=><div key={i} className="workspace-loading-task"><Skeleton className="h-5 w-2/3"/><Skeleton className="h-3 w-1/3"/><div className="flex gap-3">{[0,1,2].map(n=><Skeleton key={n} className="h-28 w-24"/>)}</div><Skeleton className="h-3 w-4/5"/></div>)}</>}
  </div>
 </div>;
}

export function WorkspaceError({title,message,onRetry,children}:{title:string;message:string;onRetry:()=>void;children?:ReactNode}){
 return <div className="workspace-error" role="alert"><AlertCircle/><div><h3>{title}</h3><p>{message}</p><div className="workspace-state-actions"><Button variant="outline" size="sm" onClick={onRetry}><RotateCw/>重新加载</Button>{children}</div></div></div>;
}

export function CatalogEditorLoading(){
 return <div className="catalog-page catalog-editor-page catalog-editor-loading"><div aria-hidden="true" className="catalog-loading-heading"><Skeleton className="h-7 w-3/5"/><Skeleton className="h-3 w-52"/></div><div className="catalog-loading-tabs" aria-hidden="true"><span>选品之神</span><span>产品编辑</span><span>内容创作</span><span>爆款复刻</span></div><div className="catalog-loading-columns"><WorkspaceLoading label="正在读取商品与素材…" layout="composer"/><WorkspaceLoading label="正在准备商品预览…" layout="shots"/></div></div>;
}
