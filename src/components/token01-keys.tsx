import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus,RefreshCw,Trash2,LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';
import type {Token01KeyProfile,Token01RoutingConfig} from '../../packages/token01';
import {api} from '@/lib/api';
import {useStudio} from '@/lib/studio';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Field,FieldLabel,FieldDescription} from './ui/field';
import {FormSelect} from './form-select';
export function useToken01Keys(){return useQuery({queryKey:['token01-keys'],queryFn:()=>api<Token01KeyProfile[]>('/token01/keys'),retry:false});}
export function Token01AdditionalKeys(){
 const query=useToken01Keys(),studio=useStudio(),cache=useQueryClient();
 const config=useQuery({queryKey:['token01-routing'],queryFn:()=>api<Token01RoutingConfig>('/token01/routing'),retry:false});
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[key,setKey]=useState(''),[group,setGroup]=useState('unknown'),[busy,setBusy]=useState(false);
 const groups=[...new Set(config.data?.models.flatMap(model=>model.groups.map(group=>group.group))||[])];
 async function action(run:()=>Promise<unknown>,message:string){setBusy(true);try{await run();toast.success(message);}catch(error){toast.error((error as Error).message);}finally{await Promise.all([cache.invalidateQueries({queryKey:['token01-keys']}),cache.invalidateQueries({queryKey:['model-setup']}),cache.invalidateQueries({queryKey:['relays']}),studio.refresh()]);setBusy(false);}}
 return <div className="mt-5 flex flex-col gap-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="muted">附加 API Key · {query.data?.length||0} 把</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>setOpen(!open)}><Plus data-icon="inline-start"/>{open?'收起添加':'添加 API Key'}</Button></div>
  {open&&<div className="flex flex-col gap-4 rounded-lg border p-4">
   <Field><FieldLabel htmlFor="token01-extra-name">密钥名称</FieldLabel><Input id="token01-extra-name" value={name} maxLength={80} placeholder="例如：视频专用密钥" disabled={busy} onChange={event=>setName(event.target.value)}/></Field>
   <Field><FieldLabel htmlFor="token01-extra-key">附加 API Key</FieldLabel><Input id="token01-extra-key" type="password" autoComplete="new-password" value={key} disabled={busy} onChange={event=>setKey(event.target.value)}/></Field>
   <Field><FieldLabel htmlFor="token01-extra-group">平台绑定分组（可选标注）</FieldLabel><FormSelect id="token01-extra-group" value={group} disabled={busy} options={[{value:'unknown',label:'未标注 · 跟随此密钥在平台的设置'},...groups.map(group=>({value:group,label:group}))]} onValueChange={setGroup}/><FieldDescription>分组标注须与平台绑定一致。</FieldDescription></Field>
   <Button disabled={busy||!name.trim()||!key.trim()} onClick={()=>void action(async()=>{await api('/token01/keys',{name:name.trim(),key:key.trim(),group:group==='unknown'?undefined:group});setName('');setKey('');setGroup('unknown');setOpen(false);},'附加密钥已保存并查询模型')}>{busy&&<LoaderCircle className="spin"/>}保存并查询模型</Button>
  </div>}
  {query.data?.map(row=><div key={row.id} className="flex flex-col gap-2 rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{row.name}</strong><p className="muted">{row.group||'跟随平台分组'} · {row.modelNames.length} 个已查询模型 · {row.modelIds.length} 个工作台支持</p></div><div className="flex gap-2"><Button variant="ghost" size="icon-sm" aria-label={`同步 ${row.name}`} disabled={busy} onClick={()=>void action(()=>api(`/token01/keys/${row.id}/sync`,{}),'模型权限已更新')}><RefreshCw/></Button><Button variant="ghost" size="icon-sm" aria-label={`删除 ${row.name}`} disabled={busy} onClick={()=>void action(()=>api(`/token01/keys/${row.id}`,undefined,'DELETE'),'附加密钥已删除')}><Trash2/></Button></div></div>{row.error&&<p role="alert" className="error-text">{row.error}</p>}{!!row.modelNames.length&&<details><summary className="text-xs cursor-pointer">查看此密钥的模型</summary><p className="muted mt-2">{row.modelNames.join('、')}</p></details>}</div>)}
  {query.error&&<p role="alert" className="error-text">{(query.error as Error).message}</p>}
 </div>;
}
