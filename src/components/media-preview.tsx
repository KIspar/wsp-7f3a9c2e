import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ImageOff, LoaderCircle, Maximize, Minus, Plus, X } from 'lucide-react';
import type { Asset } from '../../packages/contracts';
import { bytes } from '@/lib/api';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { VideoPlayer } from './video-player';
import { fitImageScale, zoomImageViewport } from '@/lib/image-viewport';

export function MediaModal({asset,onClose}:{asset?:Asset;onClose:()=>void}) {
  return <Dialog open={!!asset} onOpenChange={open=>{if(!open)onClose();}}>
    {asset&&<MediaPreview key={asset.id} asset={asset}/>}
  </Dialog>;
}

function MediaPreview({asset}:{asset:Asset}) {
  const [stage,setStage]=useState<HTMLDivElement|null>(null);
  const [size,setSize]=useState<{width:number;height:number}>();
  const [area,setArea]=useState({width:0,height:0});
  const [zoom,setZoom]=useState<number|null>(null);
  const [failed,setFailed]=useState(false);
  const [dragging,setDragging]=useState(false);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|undefined>(undefined);
  const pendingScroll=useRef<{left:number;top:number}|null>(null);
  const image=asset.type==='image';
  const fit=size&&area.width&&area.height?fitImageScale(size,area):0;
  const scale=zoom??fit;
  const source=asset.source==='simulator'?'本地模拟素材 · 非模型生成结果':asset.source==='example'?'示例素材 · 非生成结果':asset.source==='provider'?'真实模型生成':asset.source==='collection'?'采集原始素材':'上传原始素材';
  useLayoutEffect(()=>{
    const node=stage;if(!node)return;
    const measure=()=>setArea({width:node.clientWidth,height:node.clientHeight});
    const observer=new ResizeObserver(measure);observer.observe(node);measure();
    return ()=>observer.disconnect();
  },[stage]);
  const ready=!!size&&!!fit&&!failed;
  const minimum=Math.min(.1,fit||.1),maximum=8;
  function changeZoom(next:number|null,point?:{x:number;y:number}){
    if(!stage||!size||!ready)return;
    const destination=next===null?fit:Math.max(minimum,Math.min(maximum,next));
    pendingScroll.current=next===null?{left:0,top:0}:zoomImageViewport(size,area,{left:stage.scrollLeft,top:stage.scrollTop},point??{x:area.width/2,y:area.height/2},scale,destination);
    if(destination===scale){stage.scrollTo(pendingScroll.current);pendingScroll.current=null;}
    setZoom(next===null?null:destination);
  }
  useLayoutEffect(()=>{if(stage&&pendingScroll.current){stage.scrollTo(pendingScroll.current);pendingScroll.current=null;}},[scale,stage]);
  useEffect(()=>{
    if(!stage||!image||!ready)return;
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();
      if(!event.deltaY)return;
      const rect=stage.getBoundingClientRect();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?area.height:1);
      changeZoom(scale*Math.exp(-Math.max(-120,Math.min(120,delta))*.0025),{x:event.clientX-rect.left,y:event.clientY-rect.top});
    };
    stage.addEventListener('wheel',wheel,{passive:false});
    return ()=>stage.removeEventListener('wheel',wheel);
  },[stage,image,ready,scale,size,area]);
  function endDrag(){
    const pointer=drag.current;drag.current=undefined;setDragging(false);
    if(stage&&pointer&&stage.hasPointerCapture(pointer.id))stage.releasePointerCapture(pointer.id);
  }
  useEffect(()=>{window.addEventListener('blur',endDrag);return()=>window.removeEventListener('blur',endDrag);},[stage]);
  return <DialogContent className="media-preview-dialog" showCloseButton={false}>
    <header className="media-preview-heading">
      <div><DialogTitle>素材预览</DialogTitle><DialogDescription>{source}</DialogDescription></div>
      <DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭素材预览"><X/></Button></DialogClose>
    </header>
    <div ref={setStage} className="media-preview-stage" data-image={image} data-dragging={dragging} role="region" aria-label={image?'图片查看区域，滚轮缩放，拖拽移动；加减键缩放，0 原始尺寸，F 适应窗口':'视频查看区域'} tabIndex={0}
      onPointerDown={event=>{
        if(!image||!ready||event.button!==0||drag.current||!stage)return;
        if(stage.scrollWidth<=stage.clientWidth&&stage.scrollHeight<=stage.clientHeight)return;
        event.preventDefault();stage.focus({preventScroll:true});stage.setPointerCapture(event.pointerId);
        drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};setDragging(true);
      }}
      onPointerMove={event=>{const start=drag.current;if(!start||start.id!==event.pointerId)return;stage?.scrollTo({left:start.left+start.x-event.clientX,top:start.top+start.y-event.clientY});}}
      onPointerUp={event=>{if(drag.current?.id===event.pointerId)endDrag();}}
      onPointerCancel={event=>{if(drag.current?.id===event.pointerId)endDrag();}} onLostPointerCapture={endDrag}
      onKeyDown={event=>{if(!image||!ready||event.ctrlKey||event.metaKey||event.altKey)return;const key=event.key.toLowerCase();if(['+','=','-','0','f'].includes(key)){event.preventDefault();changeZoom(key==='f'?null:key==='0'?1:scale*(key==='-'?1/1.25:1.25));}}}>
      {image?<>
        {!size&&!failed&&<div className="media-preview-feedback" role="status"><LoaderCircle className="spin"/><span>正在载入原图</span></div>}
        {failed&&<div className="media-preview-feedback" role="alert"><ImageOff/><strong>图片暂时无法显示</strong><span>可下载原文件查看，或关闭后重新打开。</span></div>}
        <div className="media-preview-image-space" style={{visibility:ready?'visible':'hidden'}}><img src={asset.url} alt="素材完整预览" draggable={false} style={size?{width:size.width*scale,height:size.height*scale}:undefined} onLoad={event=>{setFailed(false);setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});}} onError={()=>setFailed(true)}/></div>
      </>:<VideoPlayer src={asset.url}/>}
    </div>
    <footer className="media-preview-toolbar">
      <div className="media-preview-file"><strong>{size?`${size.width} × ${size.height}`:image?'图片原文件':'视频原文件'}</strong><span>{asset.mime.split('/')[1]?.toUpperCase()}{asset.bytes>0?` · ${bytes(asset.bytes)}`:''}{image?' · 滚轮缩放，拖拽查看':''}</span></div>
      {image&&<div className="media-preview-zoom" role="group" aria-label="图片缩放">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="缩小图片" disabled={!ready||scale<=minimum} onClick={()=>changeZoom(scale/1.25)}><Minus/></Button>
        <Button type="button" variant="ghost" size="sm" aria-label="以原始尺寸查看" disabled={!ready} aria-pressed={zoom===1} onClick={()=>changeZoom(1)}>{ready?`${Math.round(scale*100)}%`:'—'}</Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="放大图片" disabled={!ready||scale>=maximum} onClick={()=>changeZoom(scale*1.25)}><Plus/></Button>
        <span className="media-preview-divider"/>
        <Button type="button" variant="ghost" size="sm" disabled={!ready} aria-pressed={zoom===null} onClick={()=>changeZoom(null)}><Maximize/>适应窗口</Button>
      </div>}
      <Button variant="default" size="sm" asChild><a href={`/api/assets/${asset.id}/download`}><ArrowDownToLine/>下载原文件</a></Button>
    </footer>
  </DialogContent>;
}
