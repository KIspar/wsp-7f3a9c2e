import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
/** Autosave a workshop document without sharing the ordinary skill draft namespace. */
export function useCatalogDocument<T extends {revision:number}>(key:string,source:T,write:(current:T)=>Promise<T>){
  const [value,setValue]=useState<T>(()=>{try{const cached=JSON.parse(localStorage.getItem(key)||'null');return cached?.value||source;}catch{return source;}});
  const current=useRef(value),saved=useRef(source),writer=useRef(write),pending=useRef<Promise<T>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(()=>!!localStorage.getItem(key));writer.current=write;
  const accept=useCallback((next:T)=>{saved.current=next;current.current=next;setValue(next);setDirty(false);setError('');localStorage.removeItem(key);},[key]);
  useEffect(()=>{if(!localStorage.getItem(key)&&!pending.current&&source.revision!==saved.current.revision)accept(source);},[source.revision,key,accept]);
  const set=useCallback((next:T|((old:T)=>T))=>{const result=typeof next==='function'?(next as (old:T)=>T)(current.current):next;current.current=result;setValue(result);setDirty(true);setError('');localStorage.setItem(key,JSON.stringify({value:result}));},[key]);
  const save=useCallback(async():Promise<T>=>{
    if(pending.current){await pending.current;if(localStorage.getItem(key))return save();return current.current;}
    if(!localStorage.getItem(key))return current.current;
    const sending=current.current;setBusy(true);
    const p=writer.current(sending).then(next=>{saved.current=next;if(current.current===sending){accept(next);}else{const rebased={...current.current,revision:next.revision};current.current=rebased;setValue(rebased);localStorage.setItem(key,JSON.stringify({value:rebased}));}return next;}).catch(e=>{setError((e as Error).message);throw e;}).finally(()=>{pending.current=null;setBusy(false);});pending.current=p;return p;
  },[accept,key]);
  useEffect(()=>{if(!dirty||error)return;const t=setTimeout(()=>void save().catch(()=>{}),850);return()=>clearTimeout(t);},[value,dirty,error,save]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(localStorage.getItem(key)){e.preventDefault();}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[key]);
  return {value,current,set,save,accept,busy,dirty,error,reset:()=>accept(source)};
}
export function productChanges(p:import('../../packages/catalog').CatalogProduct){const {title,salePrice,sellingPoints,parameters,colors,sizes,skus,postTitle,postBody,archived}=p;return {title,salePrice,sellingPoints,parameters,colors,sizes,skus,postTitle,postBody,archived};}
export const uploadCatalogAsset=async(file:File,video=false)=>{const form=new FormData();form.append('file',file);return api<import('../../packages/contracts').Asset>(video?'/analysis/video':'/upload',form);};
