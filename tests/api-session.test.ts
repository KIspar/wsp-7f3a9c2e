import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
beforeEach(()=>vi.resetModules());afterEach(()=>vi.unstubAllGlobals());
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
describe('本地服务重启后的会话恢复',()=>{
 it('refreshes only a guard-rejected request and reuses its exact payload and idempotency key once',async()=>{
  const calls:{url:string;body:unknown;token:unknown}[]=[];let executed=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const token=(init.headers as Record<string,string>)['X-Studio-Token'];calls.push({url,body:init.body,token});if(url==='/api/bootstrap')return json({token:'restarted-session'});if(token!=='restarted-session')return json({code:'SESSION_EXPIRED',message:'会话已失效'},403);executed++;return json({batch:{id:'one-batch'}});}));
  const {api}=await import('../src/lib/api');const payload={idempotencyKey:'same-key',draft:{requirements:'保留我的草稿'}};
  expect(await api('/submit',payload)).toEqual({batch:{id:'one-batch'}});expect(executed).toBe(1);expect(calls.map(c=>c.url)).toEqual(['/api/submit','/api/bootstrap','/api/submit']);expect(calls[0].body).toBe(calls[2].body);
 });
 it('coalesces concurrent session refreshes before retrying independent draft saves',async()=>{
  let bootstraps=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{if(url==='/api/bootstrap'){bootstraps++;return json({token:'new'});}return (init.headers as Record<string,string>)['X-Studio-Token']==='new'?json({ok:true}):json({code:'SESSION_EXPIRED'},403);}));
  const {api}=await import('../src/lib/api');await Promise.all([api('/draft/post',{revision:1},'PUT'),api('/draft/video',{revision:2},'PUT')]);expect(bootstraps).toBe(1);
 });
 it('does not retry network-unknown paid submissions, server errors, or other forbidden requests',async()=>{
  for(const response of ['network',500,403] as const){const fetch=vi.fn(async()=>{if(response==='network')throw Error('offline');return json({message:'不允许此请求'},response);});vi.stubGlobal('fetch',fetch);const {api}=await import('../src/lib/api');await expect(api('/submit',{idempotencyKey:'keep'})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);}
 });
 it('bounds session retries to one and preserves a rejected request for user recovery',async()=>{
  const fetch=vi.fn(async(url:string)=>url==='/api/bootstrap'?json({token:'still-denied'}):json({code:'SESSION_EXPIRED',message:'会话已失效'},403));vi.stubGlobal('fetch',fetch);const {api}=await import('../src/lib/api');await expect(api('/draft',{requirements:'原文'},'PUT')).rejects.toThrow('会话已失效');expect(fetch).toHaveBeenCalledTimes(3);
 });
});
