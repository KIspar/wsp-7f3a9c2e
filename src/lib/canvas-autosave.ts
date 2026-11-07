import {registerBackgroundSave} from './background-save-registry';
/** Coalesces commits without React state updates; only starts work after interaction stops. */
export class CanvasAutosave<T> {
  private version=0;
  private savedVersion=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private cancelIdle:(()=>void)|undefined;
  private active=new Set<string>();
  private running:Promise<void>|undefined;
  private failure:unknown;
  private stopped=false;
  private unregister:()=>void;
  constructor(private options:{read:()=>T;save:(snapshot:T)=>Promise<void>;onError:(error:unknown)=>void;delay?:number;idle?:(run:()=>void)=>()=>void}){this.unregister=registerBackgroundSave(()=>this.flush());}
  get dirty(){return this.version!==this.savedVersion;}
  markDirty(){this.version++;this.schedule();}
  acknowledge(){this.cancel();this.savedVersion=this.version;this.failure=undefined;}
  activity(){if(this.dirty)this.schedule();}
  setInteracting(value:boolean,key='gesture'){
    if(value){this.active.add(key);this.cancel();}
    else{this.active.delete(key);this.schedule();}
  }
  private cancel(){clearTimeout(this.timer);this.timer=undefined;this.cancelIdle?.();this.cancelIdle=undefined;}
  private schedule(){
    this.cancel();
    if(this.stopped||!this.dirty||this.active.size||this.failure)return;
    this.timer=setTimeout(()=>{
      this.timer=undefined;
      const run=()=>{this.cancelIdle=undefined;void this.write().catch(()=>{});};
      if(this.options.idle)this.cancelIdle=this.options.idle(run);else run();
    },this.options.delay??1500);
  }
  private write():Promise<void>{
    if(this.running)return this.running;
    if(this.failure)return Promise.reject(this.failure);
    if(!this.dirty||this.active.size)return Promise.resolve();
    const version=this.version;
    // Snapshot creation/structured cloning happens only here, after debounce + browser idle.
    const task=Promise.resolve().then(()=>this.options.save(this.options.read())).then(()=>{this.savedVersion=Math.max(this.savedVersion,version);}).catch(error=>{
      this.failure=error;this.options.onError(error);throw error;
    }).finally(()=>{this.running=undefined;this.schedule();});
    this.running=task;
    return task;
  }
  async flush(){
    this.cancel();
    if(this.active.size&&this.dirty)throw new Error('请先结束当前拖动，再继续操作');
    while(this.dirty){await this.write();this.cancel();}
    if(this.failure)throw this.failure;
  }
  async retry(){this.failure=undefined;await this.flush();}
  /** Route changes finish queued writes before the worker is released. */
  async close(){this.unregister();this.stopped=true;this.active.clear();this.cancel();await this.flush();}
}

export function whenCanvasIdle(run:()=>void){
  if(typeof window.requestIdleCallback==='function'){
    const id=window.requestIdleCallback(deadline=>{
      if(deadline.timeRemaining()>5)run();else cancel=whenCanvasIdle(run);
    });
    let cancel=()=>window.cancelIdleCallback(id);
    return ()=>cancel();
  }
  const id=globalThis.setTimeout(run,50);
  return ()=>globalThis.clearTimeout(id);
}
