import {useId,useState} from 'react';
import {Check,Eye,LoaderCircle} from 'lucide-react';
import type {EcommerceChoice,ReferenceControl} from '../../packages/ecommerce/controls';
import {Button} from './ui/button';
import {Modal} from './common';

function ChoiceArtwork({choice,large=false}:{choice:EcommerceChoice;large?:boolean}){
  if(choice.diagram?.length)return <div className={`ecommerce-layout-diagram ${large?'is-large':''}`} role="img" aria-label={`${choice.value}布局图示`}>
    {choice.diagram.map((region,i)=><span key={i} className={region.hero?'is-hero':''} style={{left:`${region.x}%`,top:`${region.y}%`,width:`${region.width}%`,height:`${region.height}%`,borderRadius:region.round?'50%':3}}/>)}
  </div>;
  if(choice.images?.length)return <div className={`ecommerce-choice-artwork ${large?'is-large':''} ${choice.images.length>1?'is-multiple':''}`}>{choice.images.map((image,i)=><img key={`${image.src}-${i}`} src={image.src} alt={image.alt||choice.value} loading={large?'eager':'lazy'}/>)}</div>;
  return null;
}

export function EcommerceChoicePicker({control,value,multiple=false,disabled=false,onChange,onAssetChoice}:{control:ReferenceControl;value:string;multiple?:boolean;disabled?:boolean;onChange:(value:string)=>void;onAssetChoice?:(choice:EcommerceChoice)=>Promise<void>}){
  const id=useId(),[category,setCategory]=useState('全部'),[preview,setPreview]=useState<EcommerceChoice>(),[busy,setBusy]=useState(false);
  const choices=control.choices||[],selected=multiple?value.split('、').filter(Boolean):value?[value]:[];
  const visual=choices.some(c=>c.diagram?.length||c.images?.length),described=choices.some(c=>c.description),cards=visual||described;
  const visible=category==='全部'?choices:choices.filter(c=>c.category===category);
  async function select(choice:EcommerceChoice){
    if(busy||disabled)return;
    if(control.assetRole&&onAssetChoice){setBusy(true);try{await onAssetChoice(choice);}finally{setBusy(false);}return;}
    onChange(multiple?(selected.includes(choice.value)?selected.filter(v=>v!==choice.value):[...selected,choice.value]).join('、'):control.optional&&selected.includes(choice.value)?'':choice.value);
  }
  return <div className="ecommerce-control-picker" aria-busy={busy}>
    {!!control.categories?.length&&<div className="ecommerce-choice-categories" role="group" aria-label={`${control.label}分类`}>{['全部',...control.categories].map(item=><Button key={item} variant={category===item?'secondary':'ghost'} size="xs" aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</Button>)}</div>}
    {(multiple||control.categories?.length)&&<div className="ecommerce-choice-summary" aria-live="polite"><span>{multiple?`已选 ${selected.length} 项`:`${visible.length} 种布局`}</span><span>{selected.length?selected.join('、'):'尚未选择'}</span></div>}
    <div id={id} className={cards?`ecommerce-visual-choices ${visual?'has-artwork':''}`:'ecommerce-choice-options'} role="group" aria-label={control.label}>
      {visible.map(choice=>{
        const active=selected.includes(choice.value),canPreview=!!(choice.diagram?.length||choice.images?.length);
        return cards?<div className={`ecommerce-visual-choice ${active?'is-selected':''}`} key={choice.value}>
          <Button variant="outline" className="ecommerce-visual-choice-select" aria-pressed={active} aria-label={choice.value} disabled={disabled||busy} onClick={()=>void select(choice)}>
            <ChoiceArtwork choice={choice}/><span className="ecommerce-visual-choice-title">{choice.value}{active&&<Check aria-hidden="true"/>}</span>{choice.description&&<span className="ecommerce-visual-choice-description">{choice.description}</span>}
          </Button>
          {canPreview&&<Button variant="secondary" size="icon-xs" className="ecommerce-choice-preview" aria-label={`预览${choice.value}`} onClick={()=>setPreview(choice)}><Eye/></Button>}
        </div>:<Button key={choice.value} size="sm" variant={active?'secondary':'outline'} aria-pressed={active} disabled={disabled||busy} onClick={()=>void select(choice)}>{choice.value}</Button>;
      })}
    </div>
    {busy&&<span className="ecommerce-choice-loading" role="status"><LoaderCircle className="spin"/>正在添加参考图…</span>}
    <Modal open={!!preview} onClose={()=>setPreview(undefined)} title={`${control.label} · ${preview?.value||''}`} description={preview?.description||'查看选项图示'} wide>{preview&&<div className="ecommerce-choice-full-preview"><ChoiceArtwork choice={preview} large/>{preview.description&&<p>{preview.description}</p>}<div className="modal-actions"><Button variant="outline" onClick={()=>setPreview(undefined)}>关闭</Button><Button disabled={disabled||busy} onClick={()=>{void select(preview).then(()=>setPreview(undefined));}}>选择此项</Button></div></div>}</Modal>
  </div>;
}
