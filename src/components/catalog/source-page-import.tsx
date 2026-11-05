import {useRef,useState} from 'react';
import {FileUp,LoaderCircle,ExternalLink} from 'lucide-react';
import {toast} from 'sonner';
import {api} from '@/lib/api';
import type {CatalogProduct,CollectionJob} from '../../../packages/catalog';
import {Button} from '../ui/button';
import {Modal} from '../common';
export function SourcePageImport({product,onDone}:{product:CatalogProduct;onDone:()=>void|Promise<unknown>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null),latch=useRef(false);
 async function upload(file?:File){if(!file||latch.current)return;if(!/\.html?$/i.test(file.name)||file.size>8*1024*1024){setError('请选择不超过 8MB 的 .html 或 .htm 页面文件');return;}latch.current=true;setBusy(true);setError('');try{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),key=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');const form=new FormData();form.append('file',file);await api<CollectionJob>(`/catalog/products/${product.id}/source-page?idempotencyKey=${key}`,form);setOpen(false);await onDone();toast.success('页面已解析，正在后台下载商品素材');}catch(e){setError((e as Error).message);}finally{setBusy(false);latch.current=false;if(input.current)input.current.value='';}}
 if(product.site!=='1688')return null;
 return <><Button size="sm" variant="outline" onClick={e=>{e.stopPropagation();setOpen(true);}}> <FileUp/>补充页面文件</Button><Modal open={open} onClose={()=>{if(!busy)setOpen(false);}} title="补充 1688 商品页面" description="上传当前商品的 HTML 页面文件。"><div className="flex flex-col gap-4"><Button variant="outline" asChild><a href={product.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink/>打开来源商品</a></Button><input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={e=>void upload(e.target.files?.[0])}/>{error&&<p role="alert" className="catalog-error">{error}</p>}<div className="modal-actions"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button disabled={busy} onClick={()=>input.current?.click()}>{busy?<LoaderCircle className="spin"/>:<FileUp/>}{busy?'正在解析页面…':'选择页面文件'}</Button></div></div></Modal></>;
}
