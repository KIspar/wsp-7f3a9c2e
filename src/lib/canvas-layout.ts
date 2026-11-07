export type CanvasAnchor={x:number;y:number;width:number;height:number};
export function mediaRatio(value?:string,fallback=1){
  const parts=value?.split(':').map(Number);
  const ratio=parts?.length===2?parts[0]/parts[1]:Number(value);
  return ratio>0&&Number.isFinite(ratio)?ratio:fallback;
}
/** All coordinates are in CSS pixels, independent of canvas zoom. */
export function placeCanvasOverlays(anchor:CanvasAnchor,stage:{width:number;height:number},panel:{width:number;height:number},leftInset=12,avoid:CanvasAnchor[]=[]){
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,Math.max(min,max)));
  const width=Math.min(panel.width,Math.max(0,stage.width-leftInset-12));
  const toolbarWidth=Math.min(350,Math.max(0,stage.width-leftInset-12));
  const height=Math.min(panel.height,Math.max(0,stage.height-140));
  const below=anchor.y+anchor.height+18,above=anchor.y-height-18;
  const candidates=[
    {left:anchor.x+anchor.width/2-width/2,top:below},
    {left:anchor.x+anchor.width/2-width/2,top:above},
    ...[72,anchor.y,anchor.y+anchor.height/2-height/2,anchor.y+anchor.height-height,stage.height-height-64].flatMap(top=>[
      {left:anchor.x+anchor.width+22,top},
      {left:anchor.x-width-22,top},
    ]),
  ].map(candidate=>({left:clamp(candidate.left,leftInset,stage.width-width-12),top:clamp(candidate.top,72,stage.height-height-64)}));
  const obstacles=[anchor,...avoid];
  const overlap=(candidate:{left:number;top:number})=>obstacles.reduce((sum,box,index)=>sum+(index===0?4:1)*Math.max(0,Math.min(candidate.left+width,box.x+box.width)-Math.max(candidate.left,box.x))*Math.max(0,Math.min(candidate.top+height,box.y+box.height)-Math.max(candidate.top,box.y)),0);
  const editor=candidates.reduce((best,candidate)=>overlap(candidate)<overlap(best)?candidate:best,candidates[0]);
  return {
    editor:{...editor,width,maxHeight:Math.max(0,stage.height-140)},
    toolbar:{left:clamp(anchor.x+anchor.width/2-toolbarWidth/2,leftInset,stage.width-toolbarWidth-12),top:clamp(anchor.y-52,72,stage.height-112),width:toolbarWidth},
  };
}
