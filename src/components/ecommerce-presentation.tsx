import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,ImagePlus,LoaderCircle,Upload, X,ZoomIn} from 'lucide-react';
import {toast} from 'sonner';
import referenceAssets from '@/lib/ecommerce-reference-assets.json';
import type {EcommerceFeature} from '@/lib/ecommerce-features';
import {useStudio} from '@/lib/studio';
import {uploadCatalogAsset} from '@/lib/catalog';
import {uploadPastedImages} from '@/lib/paste-upload';
import {emptyImageDesign,type Asset,type Skill} from '../../packages/contracts';
import {MaterialPicker} from './catalog/materials';
import {Button} from './ui/button';
import {Modal,MediaModal} from './common';
import {Tabs,TabsList,TabsTrigger,TabsContent} from './ui/tabs';
import {EcommerceSelection} from './ecommerce-selection';
import {ecommerceFields} from '@/lib/ecommerce-profiles';

export type ReferenceImage={src:string;alt:string};
type ReferencePage={recommendations:ReferenceImage[];choices:ReferenceImage[];cases:ReferenceImage[];cover:ReferenceImage|null;roles?:Record<string,ReferenceImage[]>};
export const ecommerceReferences=referenceAssets as Record<string,ReferencePage>;
export function EcommerceStepHeading({number,english,title,required,description}:{number:number;english:string;title:string;required?:boolean;description?:string}){
  return <div className="ecommerce-step-heading"><span className="ecommerce-step-number" aria-hidden="true">{String(number).padStart(2,'0')}</span><div><span className="ecommerce-step-english" aria-hidden="true">{english}</span><h2>{title}{description&&<small>{description}</small>}{required!==undefined&&<em className={required?'is-required':''}>{required?'（*必填）':'（非必填）'}</em>}</h2></div></div>;
}

export function FeatureShowcase({feature,onExample}:{feature:EcommerceFeature;onExample?:()=>void}){
  const reference=ecommerceReferences[feature.id];
  const [view,setView]=useState<ReferenceImage>();
  const images=reference?.cases||[];
  return <section className="ecommerce-showcase" aria-label={`${feature.name}创作案例`}>
    <div className="ecommerce-showcase-head"><span className="ecommerce-kicker">创作案例展示</span><h2>{feature.name}</h2></div>
    <div className={`ecommerce-case-images ${images.length>1?'is-comparison':''}`}>
      {images.length?images.map((item,i)=><figure key={item.src}><button type="button" aria-label={`放大${feature.name}案例 ${i+1}`} onClick={()=>setView(item)}><img src={item.src} alt={item.alt||`${feature.name}案例 ${i+1}`} loading="lazy"/><span><ZoomIn/>查看大图</span></button>{images.length>1&&<figcaption>{item.alt}</figcaption>}</figure>):<img className="ecommerce-case-fallback" src={`/ecommerce-art/${feature.id}.svg`} alt={`${feature.name}流程示意`}/>}
    </div>
    {!!reference?.choices.length&&<details className="ecommerce-reference-gallery"><summary>更多参考素材 <span>{reference.choices.length}</span></summary><div>{reference.choices.map(item=><button type="button" key={item.src} aria-label={`查看参考 ${item.alt}`} onClick={()=>setView(item)}><img src={item.src} alt={item.alt} loading="lazy"/><span>{item.alt}</span></button>)}</div></details>}
    {onExample&&<div className="ecommerce-showcase-actions"><Button variant="outline" size="sm" onClick={onExample}><ImagePlus/>使用示例素材</Button></div>}
    <Modal open={!!view} onClose={()=>setView(undefined)} title={`${feature.name} · 案例预览`} wide>{view&&<img className="ecommerce-case-preview" src={view.src} alt={view.alt||feature.name}/>}</Modal>
  </section>;
}

export function EcommerceOutput({feature,children,onExample,hasResults=false}:{feature:EcommerceFeature;children:ReactNode;onExample?:()=>void;hasResults?:boolean}){
  const [tab,setTab]=useState(hasResults?'results':'examples');
  useEffect(()=>{if(hasResults)setTab('results');},[hasResults]);
  return <div className="ecommerce-output"><Tabs value={tab} onValueChange={setTab} className="ecommerce-output-tabs"><TabsList aria-label="创作展示"><TabsTrigger value="results">AI 创作结果</TabsTrigger><TabsTrigger value="examples">创作案例展示</TabsTrigger></TabsList><TabsContent value="results">{children}</TabsContent><TabsContent value="examples"><FeatureShowcase feature={feature} onExample={onExample}/></TabsContent></Tabs></div>;
}

const exampleCache=new Map<string,Promise<Asset>>();
export async function importEcommerceExample(image:ReferenceImage){
  let pending=exampleCache.get(image.src);
  if(!pending){pending=(async()=>{const response=await fetch(image.src);if(!response.ok)throw new Error('示例素材未能载入，请重新选择');const blob=await response.blob();return uploadCatalogAsset(new File([blob],image.src.split('/').pop()||'example.webp',{type:'image/webp'}));})();exampleCache.set(image.src,pending);pending.catch(()=>exampleCache.delete(image.src));}
  return pending;
}

export function EcommerceImageInput({feature,skill,role,number,hideHeading=false,hideRecommendations=false}:{feature:EcommerceFeature;skill:Skill;role:string;number:number;hideHeading?:boolean;hideRecommendations?:boolean}){
  const studio=useStudio(),definition=skill.inputs[role],draft=studio.draft(skill.id);
  const [added,setAdded]=useState<Asset[]>([]),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[examples,setExamples]=useState(true),[view,setView]=useState<Asset>();
  const input=useRef<HTMLInputElement>(null),latch=useRef(false);
  const ids=draft.inputRoles[role]||[],max=definition.cardinality==='single'?1:6;
  const assets=[...studio.snapshot.assets,...studio.boot.examples,...added];
  const reference=ecommerceReferences[feature.id];
  const recommendations=hideRecommendations?[]:(reference?.roles?.[role]??(role==='reference'&&reference?.choices.length?reference.choices:reference?.recommendations||[])).slice(0,12);
  const setIds=(next:string[])=>{
    if(next.length>max){toast.error(`最多选择 ${max} 张图片`);return;}
    const current=studio.draft(skill.id);
    if(skill.imageDesign==='edit'&&next.some(id=>Object.entries(current.inputRoles).some(([key,values])=>key!==role&&values.includes(id)))){toast.error('同一图片已用于其他入口，请先移除');return;}
    const design=current.imageDesign||emptyImageDesign(),bindings=[...design.bindings];let nextNumber=design.nextNumber;
    if(skill.imageDesign==='edit')for(const assetId of next)if(!bindings.some(b=>b.assetId===assetId))bindings.push({assetId,number:nextNumber++});
    const fields={...current.fields};for(const [key,field] of Object.entries(ecommerceFields(feature)))if(field.control?.assetRole===role)fields[key]='';
    studio.updateDraft(skill.id,{...current,fields,...(role==='reference'?{ecommerceTemplateAssets:{}}:{}),inputRoles:{...current.inputRoles,[role]:next},selectedTargetIds:definition.cardinality==='targets'?next:current.selectedTargetIds,...(role==='targets'&&current.editMasks?{editMasks:Object.fromEntries(Object.entries(current.editMasks).filter(([id])=>next.includes(id)))}:{}),...(skill.imageDesign==='edit'?{imageDesign:{...design,bindings,nextNumber}}:{})});
  };
  const remember=(asset:Asset)=>setAdded(old=>[...old,asset]);
  async function upload(files:File[]){
    if(latch.current||!files.length)return;
    const current=studio.draft(skill.id).inputRoles[role]||[];
    if(files.length+current.length>max){toast.error(`此入口最多 ${max} 张，请先移除已选图片`);return;}
    latch.current=true;setBusy(true);const addedIds:string[]=[];
    try{for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast.error('仅支持 JPG、PNG、WebP');continue;}if(file.size>studio.boot.settings.maxFileMb*1024*1024){toast.error(`单张图片不能超过 ${studio.boot.settings.maxFileMb} MB`);continue;}try{const asset=await uploadCatalogAsset(file);remember(asset);addedIds.push(asset.id);}catch(error){toast.error((error as Error).message);}}
      if(addedIds.length){setIds([...new Set([...(studio.draft(skill.id).inputRoles[role]||[]),...addedIds])]);await studio.refresh();}
    }finally{latch.current=false;setBusy(false);}
  }
  async function chooseExample(image:ReferenceImage){if(latch.current)return;if((studio.draft(skill.id).inputRoles[role]||[]).length>=max){toast.error(`此入口最多 ${max} 张，请先移除已选图片`);return;}latch.current=true;setBusy(true);try{const asset=await importEcommerceExample(image);remember(asset);setIds([...new Set([...(studio.draft(skill.id).inputRoles[role]||[]),asset.id])]);await studio.refresh();toast.success('示例已添加');}catch(error){toast.error((error as Error).message);}finally{latch.current=false;setBusy(false);}}
  const english=role==='targets'?'ORIGINAL':role==='reference'?'REFERENCE':role==='model'?'MODEL':role==='scene'?'SCENE':'PRODUCT';
  return <section className="ecommerce-input-section">{!hideHeading&&<EcommerceStepHeading number={number} english={english} title={definition.label} required={definition.required}/>}
    <div className={`ecommerce-upload-card ${dragging?'is-dragging':''}`} tabIndex={0} aria-label={`${definition.label}上传区`} aria-busy={busy} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);void upload(Array.from(e.dataTransfer.files));}} onPaste={e=>uploadPastedImages(e,upload)}>
      <div className="ecommerce-upload-card-caption"><span>{max===1?'单张图片':`支持多图（最多 ${max} 张）`}</span><span>{ids.length} / {max}</span></div>
      {!!ids.length&&<div className="ecommerce-selected-images">{ids.map((id,i)=>{const asset=assets.find(a=>a.id===id);return <div key={id}><button type="button" aria-label={`预览${definition.label} ${i+1}`} onClick={()=>setView(asset)}>{asset?<img src={asset.url} alt={`${definition.label} ${i+1}`}/>:<span>载入中</span>}</button><Button size="icon-xs" variant="secondary" aria-label={`移除${definition.label} ${i+1}`} disabled={busy} onClick={()=>setIds(ids.filter(value=>value!==id))}><X/></Button><small>{i+1}</small></div>;})}</div>}
      <div className="ecommerce-upload-actions"><Button variant="outline" size="sm" disabled={busy||ids.length>=max} onClick={()=>input.current?.click()}>{busy?<LoaderCircle className="spin"/>:<Upload/>}本地上传</Button><MaterialPicker label="从素材库导入" assets={assets} selected={ids} max={max} disabled={busy} onChange={setIds} onUpload={asset=>{remember(asset);void studio.refresh();}}/></div>
      {!ids.length&&<span className="ecommerce-upload-hint">拖拽图片至此，或粘贴图片</span>}
      {!!recommendations.length&&<><button type="button" className="ecommerce-example-toggle" aria-expanded={examples} onClick={()=>setExamples(!examples)}><span>推荐示例</span>{examples?<ChevronUp/>:<ChevronDown/>}</button>{examples&&<div className="ecommerce-recommendations">{recommendations.map((item,i)=><button type="button" key={item.src} aria-label={`使用${definition.label}示例 ${i+1}`} disabled={busy||ids.length>=max} onClick={()=>void chooseExample(item)}><img src={item.src} alt={item.alt||`示例 ${i+1}`} loading="lazy"/></button>)}</div>}</>}
    </div>{role==='targets'&&['消除笔','无痕改字','AI 消除','服饰修复','鞋靴修复','手脚修复','局部替换','局部改款','AI 万能改图'].includes(feature.name)&&ids.map(id=>{const asset=assets.find(a=>a.id===id);return asset?<EcommerceSelection key={id} asset={asset} skill={skill}/>:null;})}<input ref={input} type="file" hidden multiple={max>1} accept="image/jpeg,image/png,image/webp" aria-label={`上传${definition.label}`} onChange={e=>{void upload(Array.from(e.target.files||[]));e.target.value='';}}/><MediaModal asset={view} onClose={()=>setView(undefined)}/>
  </section>;
}
