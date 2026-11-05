import {describe,it,expect} from 'vitest';
import {polishResult} from '../src/lib/polish-result';
describe('直接润色结果写入保护',()=>{
  it('automatically replaces unchanged text with the completed result',()=>{expect(polishResult('原文','原文','  保留商品外观，使用柔和光线。\n')).toEqual({kind:'apply',text:'保留商品外观，使用柔和光线。'});});
  it('preserves edits or a cleared field made while analysis was running',()=>{expect(polishResult('原文','原文\n新要求','旧候选').kind).toBe('changed');expect(polishResult('原文','','旧候选').kind).toBe('changed');});
  it('keeps the original when a provider returns blank content',()=>{expect(polishResult('原文','原文',undefined).kind).toBe('empty');expect(polishResult('原文','原文',' \n ').kind).toBe('empty');});
  it('enforces the draft length boundary before applying a completed result',()=>{expect(polishResult('原文','原文','图'.repeat(16000)).kind).toBe('apply');expect(polishResult('原文','原文','图'.repeat(16001)).kind).toBe('too-long');});
});
