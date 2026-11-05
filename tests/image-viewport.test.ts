import { describe, expect, it } from 'vitest';
import { fitImageScale, zoomImageViewport } from '../src/lib/image-viewport';

describe('image preview viewport',()=>{
  it('fits portrait and landscape images inside the same fixed viewport',()=>{
    const viewport={width:1000,height:600};
    expect(fitImageScale({width:400,height:1000},viewport)).toBe(.552);
    expect(fitImageScale({width:2000,height:1000},viewport)).toBe(.476);
  });
  it('keeps a cursor point stationary when zooming a scrolled image',()=>{
    const result=zoomImageViewport({width:2000,height:1000},{width:1000,height:600},{left:400,top:200},{x:300,y:200},1,2);
    expect(result).toEqual({left:1076,top:576});
  });
  it('moves from a centered fit to overflow without losing the image center',()=>{
    const result=zoomImageViewport({width:400,height:1000},{width:1000,height:600},{left:0,top:0},{x:500,y:300},.552,2);
    expect(result.left).toBe(0);
    expect(result.top).toBeCloseTo(724);
  });
  it('clamps every edge when shrinking below the viewport',()=>{
    expect(zoomImageViewport({width:2000,height:1000},{width:1000,height:600},{left:1000,top:500},{x:900,y:500},2,.1)).toEqual({left:0,top:0});
  });
});
