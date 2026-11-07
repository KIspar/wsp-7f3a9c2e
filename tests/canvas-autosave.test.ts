import {afterEach,describe,expect,it,vi} from 'vitest';
import {CanvasAutosave} from '../src/lib/canvas-autosave';
import {canvasSaveContent} from '../src/lib/canvas-save-protocol';

afterEach(()=>vi.useRealTimers());
const deferred=()=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup(save=vi.fn(async(_snapshot:{value:number})=>{})){
  vi.useFakeTimers();let value=0;
  const read=vi.fn(()=>({value})),onError=vi.fn();
  const controller=new CanvasAutosave({read,save,onError,delay:1500});
  return {controller,read,save,onError,edit:()=>{value++;controller.markDirty();}};
}
describe('silent canvas autosave',()=>{
  it('does not resurrect pending writes after accepting or resetting a document',async()=>{
    const first=deferred(),test=setup(vi.fn(()=>first.promise));test.edit();await vi.advanceTimersByTimeAsync(1500);test.edit();test.controller.acknowledge();first.resolve();await vi.advanceTimersByTimeAsync(5000);expect(test.controller.dirty).toBe(false);expect(test.save).toHaveBeenCalledTimes(1);
  });
  it('does not snapshot on edits; batches the latest content after the quiet period',async()=>{
    const test=setup();test.edit();await vi.advanceTimersByTimeAsync(1000);test.edit();
    expect(test.read).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1499);expect(test.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(test.save).toHaveBeenCalledExactlyOnceWith({value:2});expect(test.controller.dirty).toBe(false);
  });
  it('cancels pending idle work and saves nothing while dragging, resizing or zooming',async()=>{
    const test=setup();test.edit();await vi.advanceTimersByTimeAsync(1400);
    test.controller.setInteracting(true,'pointer');test.controller.setInteracting(true);
    await vi.advanceTimersByTimeAsync(10000);expect(test.read).not.toHaveBeenCalled();
    test.controller.setInteracting(false,'pointer');await vi.advanceTimersByTimeAsync(2000);expect(test.read).not.toHaveBeenCalled();
    test.controller.setInteracting(false);await vi.advanceTimersByTimeAsync(1500);expect(test.save).toHaveBeenCalledTimes(1);
  });
  it('cancels an idle callback when a gesture starts',async()=>{
    vi.useFakeTimers();let idleRun!:()=>void;const cancel=vi.fn(),save=vi.fn(async()=>{});
    const controller=new CanvasAutosave({read:()=>1,save,onError:vi.fn(),idle:run=>{idleRun=run;return cancel;}});
    controller.markDirty();await vi.advanceTimersByTimeAsync(1500);expect(save).not.toHaveBeenCalled();
    controller.setInteracting(true);expect(cancel).toHaveBeenCalledOnce();
    // Even a stale callback must not write during a gesture.
    idleRun();await Promise.resolve();expect(save).not.toHaveBeenCalled();
  });
  it('serializes writes and preserves edits made during an in-flight save',async()=>{
    const first=deferred(),second=deferred();
    const save=vi.fn().mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise);
    const test=setup(save);test.edit();await vi.advanceTimersByTimeAsync(1500);
    test.edit();await vi.advanceTimersByTimeAsync(3000);expect(save).toHaveBeenCalledTimes(1);
    const flush=test.controller.flush();first.resolve();await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenNthCalledWith(2,{value:2});expect(test.controller.dirty).toBe(true);
    second.resolve();await flush;expect(test.controller.dirty).toBe(false);
  });
  it('retains dirty content on conflicts/errors, stops retry loops, and retries only explicitly',async()=>{
    const error=new Error('revision conflict');const save=vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const test=setup(save);test.edit();await vi.advanceTimersByTimeAsync(1500);
    expect(test.controller.dirty).toBe(true);expect(test.onError).toHaveBeenCalledExactlyOnceWith(error);
    test.edit();await vi.advanceTimersByTimeAsync(10000);expect(save).toHaveBeenCalledTimes(1);
    await expect(test.controller.flush()).rejects.toThrow('revision conflict');
    await test.controller.retry();expect(save).toHaveBeenLastCalledWith({value:2});expect(test.controller.dirty).toBe(false);
  });
  it('flushes immediately before a board switch and finishes queued changes on route cleanup',async()=>{
    const test=setup();test.edit();await test.controller.flush();expect(test.save).toHaveBeenCalledExactlyOnceWith({value:1});
    test.edit();await test.controller.close();expect(test.save).toHaveBeenLastCalledWith({value:2});
    await vi.advanceTimersByTimeAsync(10000);expect(test.save).toHaveBeenCalledTimes(2);
  });
  it('refuses a flush during an active gesture instead of dropping unsaved content',async()=>{
    const test=setup();test.edit();test.controller.setInteracting(true);
    await expect(test.controller.flush()).rejects.toThrow('请先结束');expect(test.save).not.toHaveBeenCalled();
  });
});
describe('worker persistence projection',()=>{
  it('stores content, connections, groups and viewport without selection or measurement fields',()=>{
    const node={id:'node',data:{kind:'text' as const,title:'  Title  ',text:'prompt'},position:{x:40,y:-25},style:{width:400},width:280,selected:true,measured:{width:300},dragging:true};
    const graph={nodes:[node],edges:[{id:'edge',source:'node',target:'next',selected:true}],groups:[{id:'group',title:'Group',memberIds:['node']}],viewport:{x:10,y:20,zoom:.5}};
    const content=canvasSaveContent(graph);
    expect(content.nodes[0]).toMatchObject({id:'node',title:'Title',text:'prompt',x:40,y:-25,width:400});
    expect(content.nodes[0]).not.toHaveProperty('selected');expect(content.nodes[0]).not.toHaveProperty('measured');
    expect(content.edges).toEqual([{id:'edge',source:'node',target:'next'}]);expect(content.groups).toEqual(graph.groups);expect(content.viewport).toEqual(graph.viewport);
    expect(node.data.title).toBe('  Title  ');
  });
});
