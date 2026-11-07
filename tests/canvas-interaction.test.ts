import {describe,it,expect} from 'vitest';
import {arrangeCanvasNodes,canvasPanelLimits,frameCanvasBounds,layoutCanvasSelection,parseCanvasPreferences} from '../src/lib/canvas-interaction';
it('frames a large square and its editor inside the usable canvas area',()=>{
  const bounds={x:100,y:200,width:688,height:1032},size={width:1400,height:900},insets={left:368,right:32,top:84,bottom:90};
  const view=frameCanvasBounds(bounds,size,insets);
  expect(bounds.x*view.zoom+view.x).toBeGreaterThanOrEqual(insets.left);
  expect(bounds.y*view.zoom+view.y).toBeGreaterThanOrEqual(insets.top);
  expect((bounds.x+bounds.width)*view.zoom+view.x).toBeLessThanOrEqual(size.width-insets.right);
  expect((bounds.y+bounds.height)*view.zoom+view.y).toBeLessThanOrEqual(size.height-insets.bottom);
});
describe('canvas interaction preferences',()=>{
  it('retains valid choices and recovers safely from old or invalid settings',()=>{
    expect(parseCanvasPreferences(null).operation).toBe('design');
    expect(parseCanvasPreferences({operation:'trackpad',toolbar:'bottom',minimap:false,background:'url(unsafe)'})).toMatchObject({operation:'trackpad',toolbar:'bottom',minimap:false,background:'#fdfdfd'});
    expect(parseCanvasPreferences({operation:'unknown',snap:'yes'})).toMatchObject({operation:'design',snap:false});
    expect(parseCanvasPreferences({panelWidth:Infinity}).panelWidth).toBe(280);
    expect(parseCanvasPreferences({panelWidth:380}).panelWidth).toBe(380);
    expect(parseCanvasPreferences({panelWidth:10000}).panelWidth).toBe(440);
    expect(parseCanvasPreferences({panelWidth:-100}).panelWidth).toBe(220);
  });
});
it('leaves usable canvas space when the sidebar is resized on narrow and wide screens',()=>{
  for(const width of [0,320,480,768,1440,2560]){
    const limits=canvasPanelLimits(width);
    expect(limits.min).toBeGreaterThanOrEqual(0);
    expect(limits.max).toBeGreaterThanOrEqual(limits.min);
    expect(limits.max).toBeLessThanOrEqual(440);
    if(width>0)expect(width-limits.max).toBeGreaterThanOrEqual(Math.min(360,width*.55));
  }
});
describe('canvas automatic layout',()=>{
  const node=(id:string)=>({id,position:{x:20,y:30},measured:{width:640,height:400}});
  it('places downstream nodes after references, keeps groups together and does not mutate source data',()=>{
    const nodes=['a','b','c','d'].map(node);
    const arranged=arrangeCanvasNodes(nodes,[{source:'a',target:'c'},{source:'c',target:'d'}],[{id:'group',memberIds:['a','b']}]);
    expect(arranged[0].position.x).toBe(arranged[1].position.x);
    expect(arranged[1].position.y-arranged[0].position.y).toBeGreaterThan(400);
    expect(arranged[2].position.x-arranged[0].position.x).toBeGreaterThan(640);
    expect(arranged[3].position.x).toBeGreaterThan(arranged[2].position.x);
    expect(nodes.every(item=>item.position.x===20&&item.position.y===30)).toBe(true);
  });
  it('preserves every node and returns finite non-overlapping positions in a cycle',()=>{
    const nodes=['a','b','c'].map(node);
    const arranged=arrangeCanvasNodes(nodes,[{source:'a',target:'b'},{source:'b',target:'a'},{source:'b',target:'c'}],[]);
    expect(arranged.map(item=>item.id)).toEqual(['a','b','c']);
    expect(new Set(arranged.map(item=>JSON.stringify(item.position))).size).toBe(3);
    expect(arranged.every(item=>Number.isFinite(item.position.x)&&Number.isFinite(item.position.y))).toBe(true);
  });
});
it('aligns heterogeneous sizes and spaces only selected nodes without mutating originals',()=>{
  const nodes=[{id:'a',position:{x:0,y:0},measured:{width:100,height:120}},{id:'b',position:{x:300,y:20},measured:{width:200,height:80}},{id:'c',position:{x:800,y:100},measured:{width:50,height:60}},{id:'d',position:{x:900,y:300}}];
  const ids=new Set(['a','b','c']);
  const aligned=layoutCanvasSelection(nodes,ids,'right');
  expect(aligned.slice(0,3).map(node=>node.position.x+node.measured!.width)).toEqual([850,850,850]);
  const distributed=layoutCanvasSelection(nodes,ids,'distribute-x');
  expect(distributed[1].position.x-(distributed[0].position.x+100)).toBe(250);
  expect(distributed[2].position.x-(distributed[1].position.x+200)).toBe(250);
  const row=layoutCanvasSelection(nodes,ids,'row');
  expect(row.slice(0,3).map(node=>node.position)).toEqual([{x:0,y:0},{x:260,y:0},{x:620,y:0}]);
  expect(row[3]).toBe(nodes[3]);expect(nodes[1].position).toEqual({x:300,y:20});
});
