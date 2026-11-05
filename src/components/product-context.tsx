import { useRef, useState } from 'react';
import { Archive, ArrowDownToLine, Check, ImagePlus, LoaderCircle, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Asset, ProductProfile, Skill } from '../../packages/contracts';
import { useStudio } from '@/lib/studio';
import { uploadPastedImages } from '@/lib/paste-upload';
import { api } from '@/lib/api';
import { loadProduct, productRole } from '@/lib/creative-workflow';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import { Badge } from './ui/badge';
import { Modal } from './common';
import { FormSelect } from './form-select';
import { ConfirmDialog } from './confirm-dialog';

export function ProductContext({skill}:{skill:Skill}) {
  const studio=useStudio(),draft=studio.draft(skill.id);
  const products=studio.snapshot.products||[];
  const linked=products.find(p=>p.id===draft.productContext?.id);
  const [open,setOpen]=useState(false),[chosen,setChosen]=useState('');
  const [name,setName]=useState(''),[facts,setFacts]=useState(''),[ids,setIds]=useState<string[]>([]);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false);
  const [replace,setReplace]=useState<ProductProfile>(),[discard,setDiscard]=useState(false);
  const [baseline,setBaseline]=useState('');
  const input=useRef<HTMLInputElement>(null),uploadLatch=useRef(false);
  const assets=studio.snapshot.assets;
  const signature=JSON.stringify({name,facts,ids});
  function select(product?:ProductProfile){
    const values={name:product?.name||'',facts:product?.facts||'',ids:product?.assetIds||[]};
    setChosen(product?.id||'');setRevision(product?.revision||0);setName(values.name);setFacts(values.facts);setIds(values.ids);setBaseline(JSON.stringify(values));
  }
  function show(){select(linked||products[0]);setOpen(true);}
  function close(){if(busy||uploading)return;if(signature!==baseline){setDiscard(true);return;}setOpen(false);}
  function apply(product:ProductProfile){
    const current=studio.draft(skill.id);
    studio.updateDraft(skill.id,loadProduct(current,skill,product));
    setReplace(undefined);setOpen(false);toast.success('商品资料已载入，当前技能要求与参数保留');
  }
  function requestLoad(product:ProductProfile){
    const current=studio.draft(skill.id),role=productRole(skill)!;
    if(current.inputRoles[role]?.length||String(current.fields.productName||'')||String(current.fields.sellingPoints||''))setReplace(product);
    else apply(product);
  }
  async function save(load=false){
    if(load&&chosen&&signature===baseline){const saved=products.find(p=>p.id===chosen);if(saved){requestLoad(saved);return;}}
    setBusy(true);
    try{
      const body={name,facts,assetIds:ids,...(chosen?{revision}:{})};
      const saved=await api<ProductProfile>(chosen?`/products/${chosen}`:'/products',body,chosen?'PUT':'POST');
      select(saved);await studio.refresh();toast.success('商品资料已保存，已提交任务保持原快照');
      if(load)requestLoad(saved);
    }catch(error){toast.error((error as Error).message);}finally{setBusy(false);}
  }
  async function upload(files:File[]){
    if(!files.length||uploadLatch.current||busy)return;
    if(ids.length+files.length>16){toast.error('商品资料最多16张图片，请减少后重试');return;}
    uploadLatch.current=true;setUploading(true);const added:string[]=[];
    try{
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>studio.boot.settings.maxFileMb*1024*1024){toast.error(`仅支持不超过${studio.boot.settings.maxFileMb}MB的JPG、PNG、WebP`);continue;}
        const form=new FormData();form.append('file',file);
        try{const asset=await api<Asset>('/upload',form);added.push(asset.id);}catch(error){toast.error((error as Error).message);}
      }
      setIds(old=>[...new Set([...old,...added])]);await studio.refresh();
    }finally{setUploading(false);uploadLatch.current=false;}
  }
  const supported=!!productRole(skill);
  return <>
    <section className="product-context-bar" aria-label="共享商品资料">
      <Archive/><div><strong>{draft.productContext?.name||'商品资料'}</strong><span>{draft.productContext?`已载入资料 v${draft.productContext.revision} · 本技能独立草稿`:'保存商品图片与已确认参数，在不同技能中按需载入'}</span></div>
      {linked&&linked.revision!==draft.productContext?.revision&&<Badge variant="outline">资料已更新</Badge>}
      <Button type="button" size="sm" variant="outline" onClick={show}>{products.length?'管理 / 载入':'建立商品资料'}</Button>
    </section>
    <Modal open={open} onClose={close} title="商品资料" description="共享商品原图、名称与已确认参数；各技能的创作要求分别保存。" wide>
      <div className="product-context-paste" tabIndex={0} aria-label="商品资料，支持粘贴图片" onPaste={e=>uploadPastedImages(e,files=>!busy?upload(files):undefined)}>
      <div className="product-library-tools"><FormSelect aria-label="选择商品资料" value={chosen||'new'} disabled={busy||uploading||signature!==baseline} options={[{value:'new',label:'新建商品资料'},...products.map(p=>({value:p.id,label:p.name}))]} onValueChange={id=>select(products.find(p=>p.id===id))}/><Button type="button" variant="outline" disabled={busy||uploading||signature!==baseline} onClick={()=>select()}><Plus/>新建</Button><span className="muted">{signature!==baseline?'有未保存更改；保存或关闭放弃后可切换商品':'保存后可在各图片技能中载入'}</span></div>
      <FieldGroup><Field><FieldLabel htmlFor="product-name">商品名称</FieldLabel><Input id="product-name" value={name} maxLength={200} onChange={e=>setName(e.target.value)} disabled={busy}/></Field><Field><FieldLabel htmlFor="product-facts">已确认参数与商品说明</FieldLabel><Textarea id="product-facts" value={facts} maxLength={8000} onChange={e=>setFacts(e.target.value)} disabled={busy} placeholder="填写已确认的尺码、面料成分、规格等；未知信息请留空。"/></Field></FieldGroup>
      <div className="product-image-heading"><strong>商品原图 · {ids.length}/16</strong><Button type="button" size="sm" variant="outline" disabled={busy||uploading} onClick={()=>input.current?.click()}>{uploading?<LoaderCircle className="spin"/>:<ImagePlus/>}上传图片</Button><Button type="button" size="sm" variant="ghost" disabled={busy||uploading||!draft.inputRoles.product?.length} onClick={()=>setIds([...new Set(draft.inputRoles.product||[])])}>使用本技能商品图</Button></div>
      
      <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{void upload([...e.target.files||[]]);e.target.value='';}}/>
      <div className="product-images">{ids.map((id,i)=><div key={id}>{assets.find(a=>a.id===id)?<img src={assets.find(a=>a.id===id)!.url} alt={`商品原图${i+1}`}/>:<span>素材不可用</span>}<Button type="button" variant="outline" size="icon-sm" aria-label={`移除资料图片${i+1}`} disabled={busy||uploading} onClick={()=>setIds(ids.filter(value=>value!==id))}><X/></Button></div>)}{!ids.length&&null}</div>
      {!supported&&<p className="muted">请在当前技能的素材区选择商品图。</p>}
      <div className="modal-actions"><Button type="button" variant="outline" onClick={close} disabled={busy||uploading}>关闭</Button><Button type="button" variant="outline" disabled={busy||uploading||!name.trim()||!ids.length||!!chosen&&signature===baseline} onClick={()=>void save()}><Check/>保存资料</Button><Button type="button" disabled={busy||uploading||!name.trim()||!ids.length||!supported} onClick={()=>void save(true)}>{busy?<LoaderCircle className="spin"/>:<ArrowDownToLine/>}{chosen&&signature===baseline?'载入当前技能':'保存并载入当前技能'}</Button></div>
      </div>
    </Modal>
    <ConfirmDialog open={!!replace} onClose={()=>setReplace(undefined)} title="替换本技能的商品资料？" description="将替换商品图片，以及本技能的商品名/商品说明字段；保留创作要求、参考图、模型与参数。白底依赖将解除，需重新选择。" confirmLabel="替换商品资料" onConfirm={()=>replace&&apply(replace)}/>
    <ConfirmDialog open={discard} onClose={()=>setDiscard(false)} title="放弃未保存的商品资料？" description="已保存的商品资料、当前技能草稿与历史任务不会改变。" cancelLabel="继续编辑" confirmLabel="放弃并关闭" onConfirm={()=>{setDiscard(false);setOpen(false);}}/>
  </>;
}
