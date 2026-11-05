import {useState} from 'react';
import {Check,ImagePlus,Images,LoaderCircle} from 'lucide-react';
import type {Asset} from '../../packages/contracts';
import {roleLabels,type WorkbenchContent,type WorkbenchPromptSegment} from '../../packages/prompt-workbench';
import {Button} from './ui/button';
import {Modal} from './common';

export type ReferenceSlot={directionId:string;segmentId:string;key:string;role:WorkbenchPromptSegment['refs'][number]['role'];label:string;tag:string;context:string;assetId:string|null;scope:string};
export function referenceSlots(content:WorkbenchContent,step:number,directionId?:string,segmentId?:string,whole=false):ReferenceSlot[]{
  return content.plans.filter(p=>step===5?content.directions.some(d=>d.id===p.directionId&&d.selected):p.directionId===directionId).flatMap(p=>{
    const numbers=new Map<string,number>();
    return p.segments.flatMap((s,i)=>{
      if(!whole)numbers.clear();
      for(const r of s.refs)if(r.assetId&&content.materials.some(m=>m.assetId===r.assetId&&m.role===r.role)&&!numbers.has(`${r.role}:${r.assetId}`))numbers.set(`${r.role}:${r.assetId}`,numbers.size+1);
      if(step!==5&&!whole&&s.id!==segmentId)return [];
      return s.refs.map(r=>({...r,directionId:p.directionId,segmentId:s.id,context:`${content.directions.find(d=>d.id===p.directionId)?.title||'方案'} · 第 ${i+1} 段`,tag:r.assetId&&numbers.has(`${r.role}:${r.assetId}`)?`【${roleLabels[r.role]}参考图${numbers.get(`${r.role}:${r.assetId}`)}】`:`【待补${roleLabels[r.role]}图】`}));
    });
  });
}

export function WorkbenchReferences({slots,assets,materials,replaceableAssetIds,disabled,busy,onBind,onUpload,onRefresh}:{slots:ReferenceSlot[];assets:Asset[];materials:WorkbenchContent['materials'];replaceableAssetIds:string[];disabled:boolean;busy:boolean;onBind:(slot:ReferenceSlot,asset:Asset,replaceAssetId?:string)=>Promise<boolean>;onUpload:(slot:ReferenceSlot,file:File,replaceAssetId?:string)=>Promise<boolean>;onRefresh:()=>Promise<unknown>}){
  const [replacement,setReplacement]=useState<{slot:ReferenceSlot;source:Asset|File}>(),[picker,setPicker]=useState<ReferenceSlot>(),[limit,setLimit]=useState(36),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const imageMap=new Map(assets.map(a=>[a.id,a])),images=assets.filter(a=>a.type==='image'&&!['example','simulator'].includes(a.source));
  async function open(slot:ReferenceSlot){setPicker(slot);setLimit(36);setError('');setLoading(true);try{await onRefresh();}catch{setError('图片库刷新失败，请重试');}finally{setLoading(false);}}
  async function select(slot:ReferenceSlot,source:Asset|File){
    if(materials.length>=9&&(source instanceof File||!materials.some(m=>m.assetId===source.id))){setReplacement({slot,source});setPicker(undefined);return;}
    const ok=source instanceof File?await onUpload(slot,source):await onBind(slot,source);if(ok)setPicker(undefined);
  }
  if(!slots.length)return null;
  const missing=slots.filter(s=>!s.assetId).length;
  return <section className="pwb-reference-panel" aria-label="提示词参考图片"><div className="pwb-panel-title"><Images/><h2>参考图片</h2><span role="status">{missing?`${missing} 项待补齐`:'已全部绑定'}</span></div><div className="pwb-reference-grid">{slots.map((s,i)=><article className={`pwb-reference-card ${s.assetId?'':'missing'}`} key={`${s.directionId}:${s.segmentId}:${s.key}`}><div className="pwb-reference-preview">{s.assetId?<img src={imageMap.get(s.assetId)?.url} alt={s.label}/>:<ImagePlus aria-hidden="true"/>}</div><div className="pwb-reference-info"><strong>{s.tag}</strong><p>{s.label}</p><small>{s.context}</small><small title={s.scope}>{s.scope}</small><div className="pwb-reference-actions"><Button variant="outline" size="sm" disabled={disabled} asChild><label><ImagePlus/>{s.assetId?'替换图片':'上传图片'}<input className="pwb-reference-file" aria-label={`上传${s.label} ${i+1}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void select(s,file);}}/></label></Button><Button variant="ghost" size="sm" aria-label={`从图片库选择 ${s.label} ${i+1}`} disabled={disabled} onClick={()=>void open(s)}>图片库</Button></div></div></article>)}</div>
    <Modal title={`选择${picker?roleLabels[picker.role]:''}参考图`} description={picker?`${picker.label} · ${picker.context}`:undefined} open={!!picker} onClose={()=>!busy&&setPicker(undefined)} wide>
      {loading?<div className="pwb-inline-loading" role="status"><LoaderCircle className="spin"/>正在读取图片库…</div>:error?<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>picker&&void open(picker)}>重试</Button></div>:!images.length?<div className="pwb-empty"><ImagePlus/><h3>图片库暂无图片</h3><p>关闭后可通过“上传图片”添加。</p></div>:<><div className="pwb-reference-library">{images.slice(0,limit).map((a,i)=>{const material=materials.find(m=>m.assetId===a.id),incompatible=!!material&&material.role!==picker?.role;return <button key={a.id} type="button" disabled={disabled||incompatible} aria-label={`选择图片 ${i+1}${incompatible?'（已用于其他角色）':''}`} title={incompatible?'已用于其他角色':a.id} onClick={()=>picker&&void select(picker,a)}><img src={a.url} alt={`图片 ${i+1}`} loading="lazy"/>{picker?.assetId===a.id&&<Check/>}{incompatible&&<span>其他角色</span>}</button>;})}</div>{images.length>limit&&<Button variant="outline" disabled={busy} onClick={()=>setLimit(v=>v+36)}>加载更多（{limit} / {images.length}）</Button>}</>}
      <div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setPicker(undefined)}>取消</Button></div>
    </Modal>
    <Modal title="替换一张未使用的素材" description="本项目已有 9 张素材。选择一张替换为本次参考图，原图仍保留在图片库。" open={!!replacement} onClose={()=>!busy&&setReplacement(undefined)} wide>
      {!replaceableAssetIds.length?<p className="pwb-error-text" role="alert">现有素材均已被引用或参与识图，暂时无法替换。</p>:<div className="pwb-reference-library">{materials.filter(m=>replaceableAssetIds.includes(m.assetId)).map(m=><button key={m.assetId} disabled={disabled} aria-label={`替换素材 ${m.label}`} title={m.label} onClick={()=>{if(!replacement)return;const {slot,source}=replacement;void (source instanceof File?onUpload(slot,source,m.assetId):onBind(slot,source,m.assetId)).then(ok=>{if(ok)setReplacement(undefined);});}}><img src={imageMap.get(m.assetId)?.url} alt={m.label}/><span>{m.label}</span></button>)}</div>}
      <div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setReplacement(undefined)}>取消</Button></div>
    </Modal>
  </section>;
}
