import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {CanvasAutosave,whenCanvasIdle} from './canvas-autosave';
import {cacheDraft,readCachedDraft,removeCachedDraft} from './background-persistence';
/** One quiet scheduler for workshop forms; transport encoding runs in the persistence worker. */
export function useCatalogDocument<T extends {revision:number}>(key:string,source:T,write:(current:T)=>Promise<T>){
  const [value,setValue]=useState<T>(()=>{try{const cached=JSON.parse(localStorage.getItem(key)||'null');return cached?.value||source;}catch{return source;}});
  const current=useRef(value),saved=useRef(source),writer=useRef(write),dirtyRef=useRef(value!==source),[dirty,setDirty]=useState(value!==source),[error,setError]=useState('');writer.current=write;
  const controller=useRef<CanvasAutosave<T>|undefined>(undefined);
  const accepted=useRef(0);
  const accept=useCallback((next:T)=>{accepted.current++;controller.current?.acknowledge();saved.current=next;current.current=next;dirtyRef.current=false;setValue(next);setDirty(false);setError('');removeCachedDraft(key);localStorage.removeItem(key);},[key]);
  useEffect(()=>{
    let active=true,closingSnapshot:T;const writeScope=writer.current;
    const saver=new CanvasAutosave<T>({read:()=>active?current.current:closingSnapshot,idle:whenCanvasIdle,save:async sending=>{
      const epoch=accepted.current;
      let next:T;try{next=await writeScope(sending);}catch(error){if(active&&epoch!==accepted.current)return;throw error;}
      if(epoch!==accepted.current){current.current={...current.current,revision:Math.max(current.current.revision,next.revision)};saved.current=current.current;return;}
      const latest=active?current.current:closingSnapshot;
      if(active)saved.current=next;
      if(latest===sending){if(active){current.current=next;dirtyRef.current=false;setDirty(false);}else closingSnapshot=next;removeCachedDraft(key);localStorage.removeItem(key);}
      else{const rebased={...latest,revision:next.revision};if(active)current.current=rebased;else closingSnapshot=rebased;cacheDraft(key,{value:rebased});}
    },onError:error=>{if(active)setError((error as Error).message);}});
    controller.current=saver;if(dirtyRef.current)saver.markDirty();
    void readCachedDraft<{value:T}>(key).then(cached=>{if(active&&cached&&!dirtyRef.current){current.current=cached.value;setValue(cached.value);dirtyRef.current=true;setDirty(true);saver.markDirty();}}).catch(e=>{if(active)setError(e.message);});
    return()=>{closingSnapshot=current.current;active=false;controller.current=undefined;void saver.close().catch(()=>{});};
  },[key]);
  useEffect(()=>{if(!dirtyRef.current&&source.revision!==saved.current.revision)accept(source);},[source.revision,key,accept]);
  const set=useCallback((next:T|((old:T)=>T))=>{const result=typeof next==='function'?(next as (old:T)=>T)(current.current):next;current.current=result;dirtyRef.current=true;setValue(result);setDirty(true);setError('');cacheDraft(key,{value:result});controller.current?.markDirty();},[key]);
  const save=useCallback(async():Promise<T>=>{await controller.current?.retry();setError('');return current.current;},[]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[]);
  return {value,current,set,save,accept,busy:false,dirty,error,reset:()=>accept(source)};
}
export function productChanges(p:import('../../packages/catalog').CatalogProduct){const {title,salePrice,sellingPoints,parameters,colors,sizes,skus,postTitle,postBody,archived}=p;return {title,salePrice,sellingPoints,parameters,colors,sizes,skus,postTitle,postBody,archived};}
export const uploadCatalogAsset=async(file:File,video=false)=>{const form=new FormData();form.append('file',file);return api<import('../../packages/contracts').Asset>(video?'/analysis/video':'/upload',form);};
