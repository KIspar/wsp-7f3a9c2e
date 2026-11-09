import {describe,it,expect} from 'vitest';
import {downloadMetrics,formatUpdateBytes,updateStageLabel} from '../packages/update-progress';
describe('update progress feedback',()=>{
 const now=Date.parse('2026-11-09T10:00:00Z');
 const base={receivedBytes:25*1024*1024,totalBytes:100*1024*1024,bytesPerSecond:1024*1024,startedAt:new Date(now-30000).toISOString(),updatedAt:new Date(now).toISOString()};
 it('derives measured percentage and remaining time from incoming bytes',()=>{
  expect(downloadMetrics(base,now)).toMatchObject({percent:25,speed:1024*1024,remainingSeconds:75,stale:false});
  expect(formatUpdateBytes(base.receivedBytes)).toBe('25.0 MB');
 });
 it('does not show old speed or ETA after a stalled connection',()=>{
  expect(downloadMetrics(base,now+16000)).toMatchObject({percent:25,speed:0,remainingSeconds:undefined,stale:true,idleSeconds:16});
 });
 it('distinguishes download completion from verification, extraction and dependency preparation',()=>{
  expect(downloadMetrics({...base,receivedBytes:base.totalBytes},now)).toMatchObject({percent:100,remainingSeconds:undefined});
  expect(updateStageLabel({phase:'preparing',step:'verifying'})).toBe('正在校验更新包');
  expect(updateStageLabel({phase:'preparing',step:'extracting'})).toBe('正在解压更新包');
  expect(updateStageLabel({phase:'preparing',step:'dependencies'})).toBe('正在准备运行依赖');
 });
});
