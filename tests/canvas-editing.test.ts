import {describe,it,expect} from 'vitest';
import {CanvasHistory} from '../src/lib/canvas-history';
import {mediaRatio,placeCanvasOverlays} from '../src/lib/canvas-layout';

describe('canvas editing history',()=>{
  const graph=(nodes:string[],edges:string[]=[])=>({nodes,edges});
  it('restores a deleted subgraph including its connections and permits redo',()=>{
    const history=new CanvasHistory<ReturnType<typeof graph>>(JSON.stringify);
    const before=graph(['source','generator'],['source->generator']);
    history.record(before);
    const after=graph(['source']);
    expect(history.undo(after)).toEqual(before);
    expect(history.redo(before)).toEqual(after);
    expect(history.canRedo).toBe(false);
  });
  it('groups typing but separates distinct fields, gestures and divergent edits',()=>{
    const history=new CanvasHistory<string>(JSON.stringify);
    history.record('', 'prompt',0);history.record('a','prompt',100);history.record('ab','prompt',400);
    expect(history.undo('abc')).toBe('');
    history.record('', 'name',500);
    expect(history.canRedo).toBe(false);
    history.record('name','prompt',600);
    expect(history.undo('prompt')).toBe('name');
    expect(history.undo('name')).toBe('');
  });
  it('limits snapshots and deduplicates an atomic nodes-and-edges edit',()=>{
    const history=new CanvasHistory<number>(String,2);
    history.record(0);history.record(0);history.record(1);history.record(2);
    expect(history.undo(3)).toBe(2);expect(history.undo(2)).toBe(1);expect(history.undo(1)).toBeUndefined();
  });
});
describe('canvas media and screen-space controls',()=>{
  it('keeps portrait and landscape geometry and rejects malformed ratios',()=>{
    expect(mediaRatio('9:16')).toBe(9/16);expect(mediaRatio('16:9')).toBe(16/9);
    expect(mediaRatio('0:1',1)).toBe(1);expect(mediaRatio('1:0')).toBe(1);expect(mediaRatio('bad')).toBe(1);
  });
  it('keeps the editor in view at every screen edge and away from open asset panels',()=>{
    for(const stage of [{width:1950,height:1150},{width:850,height:700},{width:334,height:650}]){
      for(const anchor of [{x:-180,y:-100,width:300,height:500},{x:stage.width-50,y:stage.height-20,width:300,height:500},{x:350,y:200,width:300,height:300}]){
        const leftInset=stage.width<640?62:368;
        const {editor,toolbar}=placeCanvasOverlays(anchor,stage,{width:440,height:320},leftInset);
        expect(toolbar.left).toBeGreaterThanOrEqual(leftInset);
        expect(toolbar.left+toolbar.width).toBeLessThanOrEqual(stage.width-12);
        expect(editor.left).toBeGreaterThanOrEqual(leftInset);
        expect(editor.left+editor.width).toBeLessThanOrEqual(stage.width-12);
        expect(editor.top).toBeGreaterThanOrEqual(72);
        expect(editor.top+Math.min(editor.maxHeight,320)).toBeLessThanOrEqual(stage.height-64);
      }
    }
  });
  it('moves the editor to the clearest screen-space position around nearby nodes',()=>{
    const stage={width:1900,height:1000},anchor={x:600,y:120,width:400,height:270};
    const adjacent=[{x:600,y:440,width:420,height:500},{x:70,y:170,width:500,height:400}];
    const {editor}=placeCanvasOverlays(anchor,stage,{width:440,height:320},88,adjacent);
    for(const other of adjacent){
      const overlap=Math.max(0,Math.min(editor.left+editor.width,other.x+other.width)-Math.max(editor.left,other.x))*Math.max(0,Math.min(editor.top+320,other.y+other.height)-Math.max(editor.top,other.y));
      expect(overlap).toBeLessThan(1000);
    }
  });
});
