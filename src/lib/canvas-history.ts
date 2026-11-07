/** Gesture history keeps one snapshot per drag/resize and coalesces consecutive typing. */
export class CanvasHistory<T> {
  private past: {value:T; signature:string}[] = [];
  private future: {value:T; signature:string}[] = [];
  private lastKey: string | undefined;
  private lastTime = 0;
  constructor(private readonly signature:(value:T)=>string, private readonly limit=60) {}
  get canUndo(){ return this.past.length>0; }
  get canRedo(){ return this.future.length>0; }
  record(value:T,key?:string,now=Date.now()){
    if(key&&key===this.lastKey&&now-this.lastTime<650){this.lastTime=now;this.future=[];return;}
    const signature=this.signature(value);
    if(this.past.at(-1)?.signature!==signature){
      this.past.push({value,signature});
      if(this.past.length>this.limit)this.past.shift();
    }
    this.future=[];this.lastKey=key;this.lastTime=now;
  }
  undo(current:T){
    const previous=this.past.pop();if(!previous)return;
    this.future.push({value:current,signature:this.signature(current)});this.lastKey=undefined;
    return previous.value;
  }
  redo(current:T){
    const next=this.future.pop();if(!next)return;
    this.past.push({value:current,signature:this.signature(current)});this.lastKey=undefined;
    return next.value;
  }
}
