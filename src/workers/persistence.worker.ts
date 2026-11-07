export {};
type Request={id:number;kind:'http';url:string;method:string;headers:Record<string,string>;body:unknown}|{id:number;kind:'cache';action:'get'|'set'|'remove';key:string;value?:unknown};
let database:Promise<IDBDatabase>|undefined;
function openDatabase(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('studio-background-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=undefined;reject(request.error);};
});}
async function cache(action:'get'|'set'|'remove',key:string,value:unknown){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('drafts',action==='get'?'readonly':'readwrite'),store=transaction.objectStore('drafts');
    const request=action==='get'?store.get(key):action==='set'?store.put(value,key):store.delete(key);
    let result:unknown;request.onsuccess=()=>{result=request.result;};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });
}
self.onmessage=async(event:MessageEvent<Request>)=>{
  const request=event.data;
  try{
    if(request.kind==='cache')self.postMessage({id:request.id,value:await cache(request.action,request.key,request.value)});
    else{
      const response=await fetch(request.url,{method:request.method,headers:request.headers,body:request.body===undefined?undefined:JSON.stringify(request.body)});
      const value=await response.json().catch(()=>({message:`请求失败 (${response.status})`}));
      self.postMessage({id:request.id,value:{status:response.status,ok:response.ok,value}});
    }
  }catch(error){self.postMessage({id:request.id,error:(error as Error).message});}
};
