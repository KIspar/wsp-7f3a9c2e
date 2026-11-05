import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {credentialVault} from '../apps/server/credentials';
import {createProviderService} from '../apps/server/provider';
import {accountWindow,createAccountService,dailyConsumption} from '../apps/server/account';
import {createApp} from '../apps/server/app';
import fixtures from './fixtures/provider.json';

let dir:string,store:Store;
const fixed=Date.parse('2026-10-29T09:30:00+08:00');
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-account-'));store=createStore(dir,process.cwd());credentialVault(dir).set('tt-6.1-sol','sk-test-account-12345678901234567890');});
afterEach(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
function transport(){return vi.fn(async(raw:string)=>{
  const u=new URL(raw),data=u.pathname.endsWith('/balance')?fixtures.balance:u.searchParams.get('detail')==='1'?fixtures.records:fixtures.usage;
  return new Response(JSON.stringify({...data,...(u.pathname.endsWith('/usage')?{scope:'user'}:{})}));
});}
describe('account-wide billing',()=>{
  it('returns one shared account balance without exposing or adding key quotas',async()=>{
    credentialVault(dir).set('tt-image','sk-test-media-12345678901234567890');
    const read=transport(),service=createAccountService(store,createProviderService(store,read),()=>fixed);
    const values=await Promise.all([service.balance(),service.balance()]);
    expect(values[0]).toEqual({balance:123.456,unit:'算力',fetchedAt:expect.any(String)});
    expect(values[1]).toEqual(values[0]);expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(values)).not.toMatch(/quota|credential|sk-/);
    expect((read.mock.calls as any)[0][1].headers.Authorization).toContain('sk-test-media');
  });
  it('groups ALL models by Shanghai calendar day and does not subtract refunds twice',async()=>{
    const read=transport(),service=createAccountService(store,createProviderService(store,read),()=>fixed),result=await service.overview(7);
    expect(result.scope).toBe('user');expect(result.daily).toHaveLength(7);
    expect(result.daily.at(-1)).toEqual({date:'2026-10-29',cost:0,count:0});
    expect(result.daily.find(r=>r.date==='2026-10-28')).toEqual({date:'2026-10-28',cost:.125,count:2});
    expect(result.totals.cost).toBe(.125);
    for(const [raw]of read.mock.calls){const u=new URL(raw);expect(u.searchParams.get('scope')).toBe('user');expect(u.searchParams.has('model')).toBe(false);expect(u.searchParams.has('days')).toBe(false);}
    expect(accountWindow(7,fixed).from).toBe('2026-10-22T16:00:00.000Z');
  });
  it('loads every page before drawing a curve and preserves unknown fees as gaps',async()=>{
    const read=vi.fn(async(raw:string)=>{const u=new URL(raw),detailed=u.searchParams.get('detail')==='1',offset=Number(u.searchParams.get('offset'));
      return new Response(JSON.stringify(detailed?{...fixtures.records,scope:'user',total:3,records:offset?[{...fixtures.records.records[0],task_id:125,cost:undefined}]:fixtures.records.records}:{...fixtures.usage,scope:'user'}));
    });
    const result=await createAccountService(store,createProviderService(store,read),()=>fixed).overview(7);
    expect(read).toHaveBeenCalledTimes(3);expect(result.daily.find(r=>r.date==='2026-10-28')).toEqual({date:'2026-10-28',cost:null,count:3});
    expect(new URL(read.mock.calls[2][0]).searchParams.get('offset')).toBe('2');
  });
  it('never plots a truncated high-volume account; daily summaries include all records',async()=>{
    const read=vi.fn(async(raw:string)=>{const u=new URL(raw),detailed=u.searchParams.get('detail')==='1';return new Response(JSON.stringify(detailed?{...fixtures.records,scope:'user',total:2500}:{...fixtures.usage,scope:'user'}));});
    const result=await createAccountService(store,createProviderService(store,read),()=>fixed).overview(7);
    expect(result.daily.every(r=>r.cost===.125&&r.count===2)).toBe(true);expect(read).toHaveBeenCalledTimes(9);
  });
  it('rejects key-only responses, incomplete pagination and invalid timestamps instead of fabricating zero',async()=>{
    const wrong=vi.fn(async()=>new Response(JSON.stringify(fixtures.usage)));
    await expect(createAccountService(store,createProviderService(store,wrong),()=>fixed).overview(7)).rejects.toThrow('账户级');
    expect(()=>dailyConsumption([{task_id:1,model:'x',state:'success',cost:1}],accountWindow(7,fixed).from,new Date(fixed).toISOString())).toThrow('时间');
    const incomplete=vi.fn(async(raw:string)=>{const u=new URL(raw);return new Response(JSON.stringify(u.searchParams.get('detail')==='1'?{...fixtures.records,scope:'user',total:3,records:Number(u.searchParams.get('offset'))?[]:fixtures.records.records}:{...fixtures.usage,scope:'user'}));});
    await expect(createAccountService(store,createProviderService(store,incomplete),()=>fixed).overview(7)).rejects.toThrow('完整');
  });
  it('refreshes on expiry and credential rotation without falling back after provider failure',async()=>{
    let now=fixed;const read=transport(),service=createAccountService(store,createProviderService(store,read),()=>now);
    await service.balance();now+=30000;await service.balance();expect(read).toHaveBeenCalledTimes(2);
    credentialVault(dir).set('tt-6.1-sol','sk-test-rotated-12345678901234567890');await service.balance();expect(read).toHaveBeenCalledTimes(3);
    const failRead=vi.fn(async()=>new Response('{}',{status:401}));
    await expect(createAccountService(store,createProviderService(store,failRead),()=>fixed).balance()).rejects.toThrow('密钥');expect(failRead).toHaveBeenCalledTimes(1);
  });
  it('supports account records pagination and ignores browser attempts to narrow the account to a key',async()=>{
    const read=transport(),app=await createApp(store,{worker:false,providerTransport:read});
    try{
      const balance=await app.inject('/api/account?credentialId=gem-3.8-flash');expect(balance.statusCode).toBe(200);expect(balance.json().balance).toBe(123.456);
      const page=await app.inject('/api/account/records?days=30&offset=20&limit=10&scope=key&model=omni-flash');expect(page.statusCode).toBe(200);expect(page.json()).toMatchObject({offset:20,limit:10,total:2});
      const u=new URL(read.mock.calls[1][0]);expect(u.searchParams.get('scope')).toBe('user');expect(u.searchParams.get('offset')).toBe('20');expect(u.searchParams.has('model')).toBe(false);
      for(const url of ['/api/account/usage?days=31','/api/account/records?offset=-1','/api/account/records?limit=201'])expect((await app.inject(url)).statusCode).toBe(400);
      expect(balance.body).not.toMatch(/sk-|api_key|credentialId/);
    }finally{await app.close();}
  });
});
