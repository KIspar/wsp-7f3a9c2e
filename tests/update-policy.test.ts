import {describe,it,expect} from 'vitest';
import {blocksUpdate,newerUpdate} from '../apps/server/update-policy';
describe('local update task protection',()=>{
  it('checks persisted attempts and work in other task families',()=>{
    for(const [kind,status] of [['attempt','generating'],['attempt','pending_verification'],['product-research','running'],['research-collection','collecting'],['research-quote','executing'],['analysis-job','unknown'],['video-remake','composing']])expect(blocksUpdate(kind,{status})).toBe(true);
  });
  it('protects catalog collection and recalculates availability after installation',()=>{
    expect(blocksUpdate('catalog-product',{collectionStatus:'collecting'})).toBe(true);
    expect(blocksUpdate('catalog-product',{collectionStatus:'completed'})).toBe(false);
    expect(newerUpdate('0.2.0','0.1.9')).toBe(true);expect(newerUpdate('0.2.0','0.2.0')).toBe(false);expect(newerUpdate('0.1.9','0.2.0')).toBe(false);
  });
  it('permits completed and idle documents',()=>{
    for(const [kind,status] of [['attempt','completed'],['video-remake','ready'],['research-quote','quoted'],['product-research','paused'],['draft','running']])expect(blocksUpdate(kind,{status})).toBe(false);
  });
});
