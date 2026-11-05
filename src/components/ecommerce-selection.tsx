import {useRef,useState,type PointerEvent} from 'react';
import {Brush,Check,LoaderCircle,Scan,Trash2,Undo2} from 'lucide-react';
import {toast} from 'sonner';
import {useStudio} from '@/lib/studio';
import {uploadCatalogAsset} from '@/lib/catalog';
import type {Asset,Skill} from '../../packages/contracts';
import {Modal} from './common';
import {Button} from './ui/button';
import {NumberInput} from './ui/number-input';
import type {ImageRegion} from './ecommerce-image-editor';

type Point={x:number;y:number};
type Stroke={points:Point[];width:number};
export function EcommerceSelection({asset,skill}:{asset:Asset;skill:Skill}){
  const studio=useStudio(),mask=studio.draft(skill.id).editMasks?.[asset.id];
  const [open,setOpen]=useState(false),[mode,setMode]=useState<'rect'|'brush'>('rect'),[region,setRegion]=useState<ImageRegion>(),[strokes,setStrokes]=useState<Stroke[]>([]),[current,setCurrent]=useState<Point[]>([]),[start,setStart]=useState<Point>(),[brushWidth,setBrushWidth]=useState(5),[busy,setBusy]=useState(false),[size,setSize]=useState({width:1000,height:1000});
  const drawing=useRef(false),points=useRef<Point[]>([]);
  const point=(event:PointerEvent<SVGSVGElement>)=>{const box=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(event.clientX-box.left)/box.width*100)),y:Math.max(0,Math.min(100,(event.clientY-box.top)/box.height*100))};};
  const remove=()=>{const draft=studio.draft(skill.id),next={...draft.editMasks};delete next[asset.id];studio.updateDraft(skill.id,{...draft,editMasks:next});};
  async function save(){
    if(busy||!region&&!strokes.length)return;setBusy(true);
    try{
      const factor=Math.min(1,2048/size.width,2048/size.height),canvas=document.createElement('canvas');canvas.width=Math.round(size.width*factor);canvas.height=Math.round(size.height*factor);const ctx=canvas.getContext('2d')!;
      ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';
      if(region)ctx.fillRect(region.x/100*canvas.width,region.y/100*canvas.height,region.width/100*canvas.width,region.height/100*canvas.height);
      ctx.strokeStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';for(const stroke of strokes){ctx.lineWidth=stroke.width/100*canvas.width;ctx.beginPath();stroke.points.forEach((p,i)=>i?ctx.lineTo(p.x/100*canvas.width,p.y/100*canvas.height):ctx.moveTo(p.x/100*canvas.width,p.y/100*canvas.height));if(stroke.points.length===1){const p=stroke.points[0];ctx.arc(p.x/100*canvas.width,p.y/100*canvas.height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}else ctx.stroke();}
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('选区保存失败')),'image/png'));
      const uploaded=await uploadCatalogAsset(new File([blob],`selection-${asset.id}.png`,{type:'image/png'})),draft=studio.draft(skill.id);
      studio.updateDraft(skill.id,{...draft,editMasks:{...draft.editMasks,[asset.id]:{assetId:uploaded.id,description:region?`框选范围：左 ${region.x.toFixed(1)}%，上 ${region.y.toFixed(1)}%，宽 ${region.width.toFixed(1)}%，高 ${region.height.toFixed(1)}%；${strokes.length} 笔补充涂抹。`:`共 ${strokes.length} 笔涂抹，白色区域为操作对象。`}}});
      await studio.refresh();setOpen(false);toast.success('编辑选区已保存');
    }catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
  }
  return <div className="ecommerce-selection-entry"><img src={asset.url} alt="选区原图"/><span>{mask?'已设置编辑选区':'框选或涂抹编辑区域'}</span><Button variant="outline" size="sm" onClick={()=>{setRegion(undefined);setStrokes([]);setOpen(true);}}><Scan/>{mask?'重新选择':'选择区域'}</Button>{mask&&<Button size="icon-xs" variant="ghost" aria-label="移除编辑选区" onClick={remove}><Trash2/></Button>}
    <Modal open={open} onClose={()=>!busy&&setOpen(false)} title="选择编辑区域" description="拖拽框选，或用画笔涂抹需要修改的部分。" wide><div className="ecommerce-selection-tools"><Button size="sm" variant={mode==='rect'?'secondary':'outline'} aria-pressed={mode==='rect'} onClick={()=>setMode('rect')}><Scan/>框选</Button><Button size="sm" variant={mode==='brush'?'secondary':'outline'} aria-pressed={mode==='brush'} onClick={()=>setMode('brush')}><Brush/>画笔</Button>{mode==='brush'&&<label>画笔大小<NumberInput aria-label="画笔大小" value={brushWidth} min={1} max={20} onValueChange={v=>setBrushWidth(Number(v)||1)}/></label>}<Button size="sm" variant="ghost" disabled={!region&&!strokes.length} onClick={()=>strokes.length?setStrokes(old=>old.slice(0,-1)):setRegion(undefined)}><Undo2/>撤销</Button><Button size="sm" variant="ghost" onClick={()=>{setRegion(undefined);setStrokes([]);}}><Trash2/>清空</Button></div>
      <div className="ecommerce-mask-editor" style={{maxWidth:`min(100%, ${size.width/size.height*53}vh)`}}><img src={asset.url} alt="拖拽选择要修改的区域" draggable={false} onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="框选或涂抹编辑区域" onPointerDown={e=>{if(busy)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drawing.current=true;const p=point(e);setStart(p);points.current=[p];setCurrent([p]);}} onPointerMove={e=>{if(!drawing.current)return;const p=point(e);if(mode==='brush'){points.current.push(p);setCurrent([...points.current]);}else if(start)setRegion({x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)});}} onPointerUp={e=>{if(!drawing.current)return;drawing.current=false;const p=point(e);if(mode==='brush')setStrokes(old=>[...old,{points:[...points.current,p],width:brushWidth}]);else if(start&&Math.abs(start.x-p.x)>1&&Math.abs(start.y-p.y)>1)setRegion({x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)});setCurrent([]);setStart(undefined);}} onPointerCancel={()=>{drawing.current=false;setCurrent([]);setStart(undefined);}}>
        {region&&<rect {...region} fill="rgba(79,70,229,.3)" stroke="white" strokeWidth=".4"/>}{[...strokes,...(current.length&&mode==='brush'?[{points:current,width:brushWidth}]:[])].map((s,i)=><polyline key={i} points={s.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(79,70,229,.55)" strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round"/>)}
      </svg></div><div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button disabled={busy||!region&&!strokes.length} onClick={()=>void save()}>{busy?<LoaderCircle className="spin"/>:<Check/>}保存选区</Button></div>
    </Modal>
  </div>;
}
