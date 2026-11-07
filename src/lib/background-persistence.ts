import {currentWorkspaceId} from './workspace-scope';
import {whenCanvasIdle} from './canvas-autosave';
import {toast} from 'sonner';
let worker:Worker|undefined,id=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
function call<T>(message:object):Promise<T>{
  if(!worker){
    worker=new Worker(new URL('../workers/persistence.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=event=>{const request=pending.get(event.data.id);if(!request)return;pending.delete(event.data.id);if(event.data.error)request.reject(new Error(event.data.error));else request.resolve(event.data.value);};
    worker.onerror=()=>{for(const request of pending.values())request.reject(new Error('后台存储线程异常，请刷新后重试'));pending.clear();worker?.terminate();worker=undefined;};
  }
  return new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});try{worker!.postMessage({id:requestId,...message});}catch(error){pending.delete(requestId);reject(error);}});
}
export const backgroundRequest=<T>(url:string,method:string,headers:Record<string,string>,body:unknown)=>call<{status:number;ok:boolean;value:T&{message?:string;code?:string}}>({kind:'http',url:new URL(url,window.location.origin).href,method,headers,body});
const memory=new Map<string,unknown>(),queued=new Map<string,unknown>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),idle=new Map<string,()=>void>();
const scoped=(key:string)=>currentWorkspaceId()+':'+key;
const cacheError=(error:Error)=>toast.error('本地草稿暂存失败：'+error.message,{id:'background-cache-error'});
function cancel(key:string){clearTimeout(timers.get(key));timers.delete(key);idle.get(key)?.();idle.delete(key);}
const writing=new Set<Promise<unknown>>();
function write(key:string){cancel(key);if(!queued.has(key))return;const value=queued.get(key);queued.delete(key);const task=call({kind:'cache',action:'set',key,value});writing.add(task);void task.catch(cacheError).finally(()=>writing.delete(task));}
export function cacheDraft(key:string,value:unknown){
  key=scoped(key);memory.set(key,value);queued.set(key,value);cancel(key);
  timers.set(key,setTimeout(()=>{timers.delete(key);idle.set(key,whenCanvasIdle(()=>write(key)));},500));
}
export async function readCachedDraft<T>(key:string):Promise<T|undefined>{
  key=scoped(key);if(memory.has(key))return memory.get(key) as T|undefined;
  const value=await call<T|undefined>({kind:'cache',action:'get',key});
  if(!memory.has(key))memory.set(key,value);return memory.get(key) as T|undefined;
}
export function removeCachedDraft(key:string){key=scoped(key);memory.set(key,undefined);queued.delete(key);cancel(key);void call({kind:'cache',action:'remove',key}).catch(cacheError);}
// The browser owns the IDB transaction once posted; no synchronous JSON/localStorage on exit.
if(typeof window!=='undefined'){
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')for(const key of queued.keys())write(key);});
  window.addEventListener('pagehide',()=>{for(const key of queued.keys())write(key);});
}

export async function flushDraftCache(){for(const key of queued.keys())write(key);await Promise.all([...writing]);}
