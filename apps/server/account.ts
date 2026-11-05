import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {AccountBalance,AccountRecords,AccountUsage,DailyConsumption} from '../../packages/account';
import {providerCredentialIds,type ProviderUsage,type ProviderCredentialId,usageQuerySchema} from '../../packages/provider';
import type {ProviderService} from './provider';
import type {Store} from './store';
import {credentialVault} from './credentials';
import {fail} from './errors';

const DAY=86400000;
const rounded=(n:number)=>Math.round(n*1e8)/1e8;
export const shanghaiDay=(time:number)=>new Date(time+8*3600000).toISOString().slice(0,10);
export function accountWindow(days:number,now:number){
  const today=Date.parse(shanghaiDay(now)+'T00:00:00+08:00');
  return {from:new Date(today-(days-1)*DAY).toISOString(),to:new Date(now).toISOString()};
}
export function dailyConsumption(records:NonNullable<ProviderUsage['records']>,from:string,to:string):DailyConsumption[]{
  const start=Date.parse(from),end=Date.parse(to),rows:DailyConsumption[]=[];
  for(let t=start;t<=end;t+=DAY)rows.push({date:shanghaiDay(t),cost:0,count:0});
  const map=new Map(rows.map(r=>[r.date,r]));
  for(const record of records){
    const t=Date.parse(record.created_at||'');
    // Never silently omit a record or turn an unknown amount into zero.
    if(!Number.isFinite(t)||t<start||t>end)fail('消费记录的时间与查询范围不一致，请刷新重查',502);
    const row=map.get(shanghaiDay(t))!;row.count++;
    if(record.cost===undefined)row.cost=null;
    else if(row.cost!==null)row.cost=rounded(row.cost+record.cost);
  }
  return rows;
}

export function createAccountService(store:Store,provider:ProviderService,clock=Date.now){
  const vault=credentialVault(store.dataDir);
  const cache=new Map<string,{until:number;value:unknown}>();
  const pending=new Map<string,Promise<unknown>>();
  // All configured keys in this local workspace belong to the same supplier account.
  // One canonical key authenticates account queries; balances are never added across keys.
  function credential():ProviderCredentialId{return providerCredentialIds.find(id=>vault.current(id))||fail('请先在模型配置中配置账户密钥，再刷新账户余额',400);}
  async function cached<T>(key:string,ttl:number,read:()=>Promise<T>):Promise<T>{
    const old=cache.get(key);if(old&&old.until>clock())return old.value as T;
    const running=pending.get(key);if(running)return running as Promise<T>;
    const promise=read().then(value=>{cache.set(key,{value,until:clock()+ttl});if(cache.size>100)for(const [k,v]of cache)if(v.until<=clock())cache.delete(k);return value;}).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  }
  function key(id:ProviderCredentialId){return id+':'+vault.current(id);}
  async function usage(id:ProviderCredentialId,from:string,to:string,detail:'0'|'1',offset=0,limit=200){
    const result=await provider.usage(usageQuerySchema.parse({credentialId:id,scope:'user',start_time:from,end_time:to,detail,offset,limit}));
    const data=result.data as ProviderUsage;
    if(data.scope!=='user')fail('供应商未返回账户级消费，请检查查询权限',502);
    return data;
  }
  async function balance():Promise<AccountBalance>{
    const id=credential();return cached('balance:'+key(id),2000,async()=>{
      const result=await provider.balance(id);const data=result.data as {balance:number};
      return {balance:data.balance,unit:'算力',fetchedAt:result.fetchedAt};
    });
  }
  async function overview(days:number):Promise<AccountUsage>{
    const id=credential(),window=accountWindow(days,clock());
    return cached('overview:'+key(id)+':'+days,10000,async()=>{
      const [summary,first]=await Promise.all([usage(id,window.from,window.to,'0'),usage(id,window.from,window.to,'1')]);
      if(!summary.grand_total||!first.records||first.total===undefined)fail('供应商消费汇总或明细不完整，请刷新重查',502);
      let daily:DailyConsumption[];
      if(first.total<=2000){
        const records=[...first.records];
        for(let offset=records.length;offset<first.total;){
          const page=await usage(id,window.from,window.to,'1',offset);
          if(!page.records?.length)fail('消费记录尚未完整返回，请刷新重查',502);
          records.push(...page.records);offset+=page.records.length;
        }
        if(new Set(records.map(r=>String(r.task_id))).size!==first.total)fail('消费明细在更新中，请刷新重查',502);
        daily=dailyConsumption(records,window.from,window.to);
      }else{
        // Large accounts use complete daily summaries instead of plotting a truncated page.
        daily=dailyConsumption([],window.from,window.to);
        let cursor=0;
        await Promise.all(Array.from({length:3},async()=>{while(cursor<daily.length){
          const index=cursor++,row=daily[index],start=Date.parse(row.date+'T00:00:00+08:00');
          const end=Math.min(start+DAY-1,Date.parse(window.to));
          const result=await usage(id,new Date(start).toISOString(),new Date(end).toISOString(),'0');
          row.cost=result.grand_total?.cost??null;row.count=result.grand_total?.count??0;
        }}));
      }
      return {...window,fetchedAt:new Date(clock()).toISOString(),scope:'user',unit:'算力',totals:summary.grand_total,daily};
    });
  }
  async function records(days:number,offset:number,limit:number):Promise<AccountRecords>{
    const id=credential(),window=accountWindow(days,clock());
    return cached('records:'+key(id)+':'+days+':'+offset+':'+limit,10000,async()=>{
      const result=await usage(id,window.from,window.to,'1',offset,limit);
      if(!result.records||result.total===undefined)fail('供应商消费明细不完整，请刷新重查',502);
      return {...window,fetchedAt:new Date(clock()).toISOString(),records:result.records,total:result.total,limit,offset};
    });
  }
  return {balance,overview,records};
}
export function registerAccountRoutes(app:FastifyInstance,store:Store,provider:ProviderService){
  const service=createAccountService(store,provider);
  const period=z.object({days:z.coerce.number().refine(n=>n===7||n===30,'仅支持近 7 天或近 30 天').default(7)});
  app.get('/api/account',()=>service.balance());
  app.get('/api/account/usage',request=>service.overview(period.parse(request.query).days));
  app.get('/api/account/records',request=>{
    const q=period.extend({offset:z.coerce.number().int().min(0).max(10_000_000).default(0),limit:z.coerce.number().int().min(1).max(100).default(10)}).parse(request.query);
    return service.records(q.days,q.offset,q.limit);
  });
  return service;
}
