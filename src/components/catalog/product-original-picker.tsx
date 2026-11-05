import {createContext,useContext,useMemo,useRef,useState,type ReactNode} from 'react';
import {Check,ImageIcon,LoaderCircle,Plus,ZoomIn,X} from 'lucide-react';
import {toast} from 'sonner';
import type {Asset} from '../../../packages/contracts';
import type {ProductMediaBinding,SourceSnapshot} from '../../../packages/catalog';
import {api} from '@/lib/api';
import {uploadCatalogAsset} from '@/lib/catalog';
import {uploadPastedImages} from '@/lib/paste-upload';
import {Button} from '../ui/button';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '../ui/tabs';
import {Modal,MediaModal,IconButton} from '../common';

type ImageScope={assets:Asset[];imageIds:string[];systemAssets:Asset[];remember:(asset:Asset)=>Promise<void>};
const ProductImagesContext=createContext<ImageScope|null>(null);
export const useProductImages=()=>useContext(ProductImagesContext);
export function ProductImagesProvider({productId,assets,imageIds,systemAssets,onUpload,children}:{productId:string;assets:Asset[];imageIds:string[];systemAssets:Asset[];onUpload:(asset:Asset)=>void;children:ReactNode}){
  const [added,setAdded]=useState<Asset[]>([]);
  const value=useMemo<ImageScope>(()=>({
    assets:[...new Map([...assets,...added].map(a=>[a.id,a])).values()],imageIds:[...new Set([...imageIds,...added.map(a=>a.id)])],systemAssets,
    remember:async asset=>{await api(`/catalog/products/${productId}/images`,{assetId:asset.id});setAdded(old=>[...old.filter(a=>a.id!==asset.id),asset]);onUpload(asset);},
  }),[assets,added,imageIds,systemAssets,productId,onUpload]);
  return <ProductImagesContext.Provider value={value}>{children}</ProductImagesContext.Provider>;
}

/** Shared by every product-image entry in a workshop, including per-shot overrides. */
export function ProductImageDialog({open,onClose,assets,selected,max,onChange,onUpload,fallbackIds=[],allowEmpty=true}:{open:boolean;onClose:()=>void;assets:Asset[];selected:string[];max:number;onChange:(ids:string[])=>void;onUpload:(a:Asset)=>void;fallbackIds?:string[];allowEmpty?:boolean}){
  const scope=useProductImages(),[tab,setTab]=useState('current'),[choice,setChoice]=useState(selected),[busy,setBusy]=useState(false),[view,setView]=useState<Asset>(),[added,setAdded]=useState<Asset[]>([]);
  const input=useRef<HTMLInputElement>(null),latch=useRef(false),latest=useRef({choice,onChange,onUpload,scope});latest.current={choice,onChange,onUpload,scope};
  // The parent mounts a fresh dialog for each opening, so cancel always discards only the pending selection.
  const all=[...new Map([...assets,...scope?.assets||[],...scope?.systemAssets||[],...added].map(a=>[a.id,a])).values()];
  const currentIds=new Set([...(scope?.imageIds||fallbackIds),...selected,...added.map(a=>a.id)]);
  const current=all.filter(a=>a.type==='image'&&currentIds.has(a.id)&&!['example','simulator'].includes(a.source));
  const system=all.filter(a=>a.type==='image'&&!['example','simulator'].includes(a.source));
  async function upload(files:File[]){
    if(latch.current||!files.length)return;
    if(files.length+latest.current.choice.length>max){toast.error(`本次最多选择 ${max} 张，请先取消部分图片`);return;}
    latch.current=true;setBusy(true);const result:string[]=[];
    try{for(const file of files){try{const asset=await uploadCatalogAsset(file);setAdded(old=>[...old,asset]);if(latest.current.scope)await latest.current.scope.remember(asset);latest.current.onUpload(asset);result.push(asset.id);}catch(e){toast.error((e as Error).message);}}if(result.length){setChoice(old=>[...new Set([...old,...result])]);setTab('current');}}finally{latch.current=false;setBusy(false);}
  }
  function toggle(id:string){if(latch.current)return;setChoice(old=>old.includes(id)?old.filter(x=>x!==id):old.length<max?[...old,id]:old);}
  async function confirm(){
    if(latch.current||choice.length>max||!allowEmpty&&!choice.length)return;latch.current=true;setBusy(true);
    try{const active=latest.current.scope;for(const id of choice){if(active&&!active.imageIds.includes(id)){const asset=all.find(a=>a.id===id);if(asset)await active.remember(asset);}}latest.current.onChange(choice);onClose();}catch(e){toast.error((e as Error).message);}finally{latch.current=false;setBusy(false);}
  }
  function grid(items:Asset[]){return <div className="product-image-grid" aria-busy={busy}><button type="button" className="product-image-add" disabled={busy||choice.length>=max} onClick={()=>input.current?.click()}>{busy?<LoaderCircle className="spin"/>:<Plus/>}<strong>{busy?'正在上传':'添加图片'}</strong><small>从电脑上传外来图片</small></button>{items.map((asset,i)=>{const order=choice.indexOf(asset.id);return <div className="product-image-tile" key={asset.id}><button type="button" className="product-image-choice" aria-label={`${order>=0?'取消选择':'选择'}图片 ${i+1}`} aria-pressed={order>=0} disabled={busy||order<0&&choice.length>=max} onClick={()=>toggle(asset.id)}><img src={asset.url} alt={`图片 ${i+1}`} loading="lazy"/><span className="product-image-check">{order>=0?<Check/>:null}</span><span className="product-image-caption">{order>=0?`已选 ${order+1}`:`图片 ${i+1}`}</span></button><IconButton className="product-image-preview" icon={ZoomIn} label={`放大图片 ${i+1}`} onClick={()=>setView(asset)}/></div>;})}{!items.length&&<div className="product-image-empty"><ImageIcon/><span>{tab==='current'?'当前商品还没有图片，可添加外来图片':'暂无系统图片，可添加外来图片'}</span></div>}</div>;}
  return <><Modal open={open} onClose={()=>!latch.current&&onClose()} title="选择商品图片" description="默认查看当前商品的全部图片；只将选中的图片用于本次制作。" wide><div className="product-image-picker" tabIndex={0} aria-label="商品图片选择区，支持粘贴图片" onPaste={e=>uploadPastedImages(e,upload)}>
    <Tabs value={tab} onValueChange={setTab}><TabsList variant="line" aria-label="图片来源"><TabsTrigger value="current">当前商品 <span>{current.length}</span></TabsTrigger><TabsTrigger value="system">系统图片 <span>{system.length}</span></TabsTrigger></TabsList><div className="product-image-toolbar"><span aria-live="polite">已选 {choice.length} / {max} 张</span><span>点击此区域后，可直接粘贴图片</span></div><TabsContent value="current">{grid(current)}</TabsContent><TabsContent value="system">{grid(system)}</TabsContent></Tabs>
    <div className="modal-actions"><Button variant="ghost" disabled={busy||!choice.length} onClick={()=>setChoice([])}>清空选择</Button><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy||choice.length>max||!allowEmpty&&!choice.length} onClick={()=>void confirm()}>{busy?<LoaderCircle className="spin"/>:<Check/>}{busy?'正在处理':`使用所选图片${choice.length?`（${choice.length}）`:''}`}</Button></div><input ref={input} hidden type="file" multiple={max>1} accept="image/jpeg,image/png,image/webp" onChange={e=>{void upload(Array.from(e.target.files||[]));e.target.value='';}}/>
  </div></Modal><MediaModal asset={view} onClose={()=>setView(undefined)}/></>;
}

/** Source images are independent from output positions. */
export function ProductOriginalPicker({snapshots,productBindings=[],assets,selected,max,onChange,onUpload}:{snapshots:SourceSnapshot[];sourceSnapshotId?:string;productBindings?:ProductMediaBinding[];assets:Asset[];selected:string[];max:number;onChange:(ids:string[])=>void;onUpload:(a:Asset)=>void}){
  const [open,setOpen]=useState(false),[view,setView]=useState<Asset>(),[busy,setBusy]=useState(false);const latch=useRef(false),scope=useProductImages(),latest=useRef({selected,onChange,onUpload,scope});latest.current={selected,onChange,onUpload,scope};
  const all=[...new Map([...assets,...scope?.assets||[],...scope?.systemAssets||[]].map(a=>[a.id,a])).values()];
  async function upload(files:File[]){if(latch.current||!files.length)return;if(files.length+latest.current.selected.length>max){toast.error(`本次最多选择 ${max} 张，请先取消部分图片`);return;}latch.current=true;setBusy(true);const added:string[]=[];try{for(const file of files){try{const a=await uploadCatalogAsset(file);if(latest.current.scope)await latest.current.scope.remember(a);latest.current.onUpload(a);added.push(a.id);}catch(e){toast.error((e as Error).message);}}if(added.length)latest.current.onChange([...new Set([...latest.current.selected,...added])]);}finally{latch.current=false;setBusy(false);}}
  return <section className="catalog-originals" tabIndex={0} aria-label="商品原图上传区，支持粘贴图片" onPaste={e=>uploadPastedImages(e,upload)}><div className="catalog-originals-heading"><div><h3>商品原图 <span aria-live="polite">本次已选 {selected.length} / {max} 张</span></h3></div><div className="catalog-originals-actions"><Button variant="ghost" size="sm" disabled={!selected.length||busy} onClick={()=>onChange([])}>清空选择</Button><Button variant="outline" size="sm" disabled={busy} onClick={()=>setOpen(true)}>{busy?<LoaderCircle className="spin"/>:<Plus/>}{busy?'正在上传':'添加图片'}</Button></div></div><div className="catalog-originals-strip">{selected.map((id,i)=>{const a=all.find(a=>a.id===id);return <div className="catalog-original-tile is-selected" key={id}><button className="catalog-original-toggle" aria-label={`查看商品原图 ${i+1}`} onClick={()=>setView(a)}>{a?<img src={a.url} alt={`商品原图 ${i+1}`}/>:<span>素材缺失</span>}<span className="catalog-original-caption">原图 {i+1}</span></button><IconButton className="catalog-original-remove" icon={X} label={`移除商品原图 ${i+1}`} onClick={()=>onChange(selected.filter(x=>x!==id))}/></div>;})}{!selected.length&&<button className="catalog-originals-empty" onClick={()=>setOpen(true)}><ImageIcon/><span>添加商品原图，也可以直接粘贴图片</span></button>}</div>{selected.length>max&&<p role="alert" className="catalog-error">已选图片超过当前模型上限，请取消部分图片。</p>}{open&&<ProductImageDialog open onClose={()=>setOpen(false)} assets={all} selected={selected} max={max} onChange={onChange} onUpload={onUpload} fallbackIds={[...snapshots.flatMap(s=>s.media.flatMap(m=>m.assetId?[m.assetId]:[])),...productBindings.map(b=>b.assetId)]}/>}<MediaModal asset={view} onClose={()=>setView(undefined)}/></section>;
}
