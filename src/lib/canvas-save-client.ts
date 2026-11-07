import {ApiError,apiRequestContext,bootstrap} from './api';
import type {CanvasSaveGraph,CanvasSaveReply} from './canvas-save-protocol';
export class CanvasSaveClient {
  private worker:Worker|undefined;
  private nextId=0;
  private workspace=apiRequestContext().workspace;
  private pending=new Map<number,{resolve:(revision:number)=>void;reject:(error:Error)=>void}>();
  constructor(private boardId:string,private revision:number){}
  private send(graph:CanvasSaveGraph):Promise<number>{
    if(!this.worker){
      this.worker=new Worker(new URL('../workers/canvas-save.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=(event:MessageEvent<CanvasSaveReply>)=>{
        const {id,revision,error}=event.data,request=this.pending.get(id);if(!request)return;
        this.pending.delete(id);
        if(error){const failure=Object.assign(new ApiError(error.message,error.status),{code:error.code});request.reject(failure);}
        else request.resolve(revision!);
      };
      this.worker.onerror=()=>{
        for(const request of this.pending.values())request.reject(new Error('后台保存线程异常，请重试'));
        this.pending.clear();this.worker?.terminate();this.worker=undefined;
      };
    }
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending.set(id,{resolve,reject});
      try{this.worker!.postMessage({id,url:new URL('/api/canvas/'+this.boardId,window.location.origin).href,...apiRequestContext(),workspace:this.workspace,revision:this.revision,graph});}
      catch(error){this.pending.delete(id);reject(error);}
    });
  }
  async save(graph:CanvasSaveGraph){
    try{this.revision=await this.send(graph);}
    catch(error){
      // Replay only an explicit auth-guard rejection; never replay an uncertain write.
      if(error instanceof ApiError&&error.status===403&&'code' in error&&error.code==='SESSION_EXPIRED'){
        await bootstrap();this.revision=await this.send(graph);
      }else throw error;
    }
  }
  destroy(){this.worker?.terminate();this.worker=undefined;}
}
