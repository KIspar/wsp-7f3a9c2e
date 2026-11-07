import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {cacheDraft,readCachedDraft,removeCachedDraft} from './background-persistence';
import {toast} from 'sonner';
/** Async IDB recovery never overwrites edits made while the cache is loading. */
export function useBackgroundDraft<T>(key:string,initial:()=>T,codec?:{encode:(value:T)=>unknown;decode:(cached:any)=>T|undefined}){
  const [value,setValue]=useState(initial),current=useRef(value),edits=useRef(0),codecs=useRef(codec),scope=useRef(key),initializer=useRef(initial);codecs.current=codec;initializer.current=initial;
  useEffect(()=>{let active=true;if(scope.current!==key){scope.current=key;edits.current=0;current.current=initializer.current();setValue(current.current);}void readCachedDraft<unknown>(key).then(cached=>{
    if(!active||edits.current||cached===undefined)return;
    const restored=codecs.current?codecs.current.decode(cached):cached as T;
    if(restored!==undefined){current.current=restored;setValue(restored);}
  }).catch(e=>toast.error('草稿恢复失败：'+e.message));return()=>{active=false;};},[key]);
  const set=useCallback((action:SetStateAction<T>)=>{
    const next=typeof action==='function'?(action as (previous:T)=>T)(current.current):action;
    current.current=next;edits.current++;setValue(next);cacheDraft(key,codecs.current?codecs.current.encode(next):next);
  },[key]);
  return [value,set,()=>removeCachedDraft(key)] as const;
}
