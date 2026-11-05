import {useId,useRef,useState,type PointerEvent} from 'react';

export type ImageRegion={x:number;y:number;width:number;height:number};
export type ImageAnnotation={x:number;y:number;x2:number;y2:number;text:string;kind:'arrow'|'dimension'|'text'};
type Point={x:number;y:number};
export function EcommerceImageEditor({src,region,onRegion,annotations=[],onAnnotation,mode='crop',text='',color}:{src:string;region?:ImageRegion;onRegion?:(region:ImageRegion)=>void;annotations?:ImageAnnotation[];onAnnotation?:(annotation:ImageAnnotation)=>void;mode?:'crop'|'arrow'|'dimension'|'text';text?:string;color?:string}){
  const id=useId().replace(/:/g,''),svg=useRef<SVGSVGElement>(null),[start,setStart]=useState<Point>(),[end,setEnd]=useState<Point>();
  const point=(e:PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-box.left)/box.width*100)),y:Math.max(0,Math.min(100,(e.clientY-box.top)/box.height*100))};};
  const rect=start&&end?{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)}:region;
  return <div className="ecommerce-image-editor" style={color?{color}:undefined}><img src={src} alt="当前编辑图片" draggable={false}/><svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={mode==='crop'?'拖拽框选裁剪区域':'拖拽绘制标注，文字模式点击添加'} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const p=point(e);setStart(p);setEnd(p);}} onPointerMove={e=>{if(start)setEnd(point(e));}} onPointerUp={e=>{if(!start)return;const p=point(e);if(mode==='crop'){const selection={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};if(selection.width>1&&selection.height>1)onRegion?.(selection);}else if(mode==='text'||Math.hypot(p.x-start.x,p.y-start.y)>1)onAnnotation?.({...start,x2:p.x,y2:p.y,text,kind:mode});setStart(undefined);setEnd(undefined);}} onPointerCancel={()=>{setStart(undefined);setEnd(undefined);}}>
    <defs><marker id={`${id}-arrow`} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto-start-reverse"><path d="M0,0 L4,2 L0,4 Z" fill="currentColor"/></marker></defs>
    {mode==='crop'&&rect&&<><path d={`M0 0H100V100H0Z M${rect.x} ${rect.y}V${rect.y+rect.height}H${rect.x+rect.width}V${rect.y}Z`} fill="rgba(0,0,0,.4)" fillRule="evenodd"/><rect {...rect} fill="none" stroke="white" strokeWidth=".6" vectorEffect="non-scaling-stroke"/></>}
    {annotations.map((a,i)=><g key={i} className="ecommerce-image-annotation">{a.kind!=='text'&&<line x1={a.x} y1={a.y} x2={a.x2} y2={a.y2} stroke="currentColor" strokeWidth=".45" markerEnd={`url(#${id}-arrow)`} markerStart={a.kind==='dimension'?`url(#${id}-arrow)`:undefined}/>}<text x={a.kind==='text'?a.x:(a.x+a.x2)/2} y={a.kind==='text'?a.y:(a.y+a.y2)/2-1} fontSize="3.4" textAnchor={a.kind==='text'?'start':'middle'} fill="currentColor">{a.text}</text></g>)}
    {mode!=='crop'&&start&&end&&<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="currentColor" strokeWidth=".5"/>}
  </svg></div>;
}
