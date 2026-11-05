import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {createApp} from '../apps/server/app';
import {createToken01Account,token01Balance} from '../apps/server/token01-account';
import {credentialVault} from '../apps/server/credentials';
import type {ProviderTransport} from '../apps/server/provider';
let dir:string,s:Store;
const phone='13800138000',code='123456',access='test-user-access-token-1234567890';
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'token01-account-'));s=createStore(dir,process.cwd());});
afterEach(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
const overview={success:true,data:{remaining:{amount:'12.340000',quota:6170000},currency:{display_type:'CNY',symbol:'¥',exchange_rate:1,quota_per_unit:500000}}};
function upstream():ProviderTransport{return vi.fn(async(url,init)=>{
 const path=new URL(url).pathname;
 if(path==='/api/status')return Response.json({success:true,data:{phone_login_enabled:true,sms_captcha_enabled:false}});
 if(path==='/api/sms/code')return Response.json({success:true});
 if(path==='/api/user/login/phone'){expect(JSON.parse(String(init.body))).toEqual({phone,code});return Response.json({success:true,data:{access_token:access,session_id:'session-test'}});}
 expect(init.headers).toMatchObject({Authorization:'Bearer '+access,'X-Auth-Session':'session-test'});
 if(path==='/api/user/auth/logout')return Response.json({success:true});
 expect(path).toBe('/api/user/self/quota/overview');return Response.json(overview);
 });}
describe('Token01 user login and independent wallet',()=>{
 it('keeps access tokens encrypted and separate from generation keys across restart, and revokes only its own session',async()=>{
  const vault=credentialVault(dir),modelVersion=vault.set('minimax-h3','sk-generation-only-123456789012345');
  const read=upstream(),account=createToken01Account(s,read);await account.send({phone});await expect(account.send({phone})).rejects.toMatchObject({statusCode:429});
  const state=await account.login({phone,code});expect(state).toMatchObject({authenticated:true,phone:'138****8000'});expect(JSON.stringify(state)).not.toContain(access);
  expect(await account.balance()).toMatchObject({balance:12.34,unit:'元（人民币）'});expect(vault.current('minimax-h3')).toBe(modelVersion);
  expect(fs.readFileSync(path.join(dir,'private/credentials.json'),'utf8')).not.toContain(access);
  expect(JSON.stringify(s.list('token01-account'))).not.toContain(access);expect(JSON.stringify(s.list('token01-account'))).not.toContain(phone);
  s.close();s=createStore(dir,process.cwd());const restarted=createToken01Account(s,read);expect(restarted.state().authenticated).toBe(true);expect((await restarted.balance()).balance).toBe(12.34);
  await restarted.logout();expect(restarted.state().authenticated).toBe(false);expect(vault.current('token01-user-session')).toBeUndefined();expect(vault.current('minimax-h3')).toBe(modelVersion);
 });
 it('requires local session authorization before sending SMS or logging in and never returns upstream credentials',async()=>{
  const read=upstream(),app=await createApp(s,{worker:false,providerTransport:read});
  try{
   expect((await app.inject({method:'POST',url:'/api/token01/account/sms',payload:{phone}})).statusCode).toBe(403);expect(read).not.toHaveBeenCalled();
   const headers={'x-studio-token':(await app.inject('/api/bootstrap')).json().token};
   expect((await app.inject({method:'POST',url:'/api/token01/account/login',headers,payload:{phone,code}})).body).not.toContain(access);
   const response=await app.inject('/api/relays/token01/balance');expect(response.json()).toMatchObject({balance:12.34,unit:'元（人民币）'});expect(response.body).not.toContain(access);
  }finally{await app.close();}
 });
 it('rejects SMS without a required captcha, redacts login errors and clears an expired session without affecting models',async()=>{
  const required=createToken01Account(s,async()=>Response.json({success:true,data:{phone_login_enabled:true,sms_captcha_enabled:true}}));
  await expect(required.send({phone})).rejects.toThrow('图形验证');
  const failed=createToken01Account(s,async()=>Response.json({success:false,message:phone+' '+code}));await expect(failed.login({phone,code})).rejects.not.toThrow(phone);
  const account=createToken01Account(s,upstream());await account.login({phone,code});
  const expired=createToken01Account(s,async()=>Response.json({success:false,code:'AUTH_UNAUTHORIZED'},{status:401}));await expect(expired.balance()).rejects.toMatchObject({statusCode:401});expect(expired.state()).toMatchObject({authenticated:false,expired:true});
 });
 it('does not turn raw or unknown quota into a currency balance, supports zero and explicit denominations',()=>{
  expect(token01Balance({success:true,data:{remaining:0,currency:'CNY'}})).toEqual({balance:0,unit:'元（人民币）'});
  expect(token01Balance({success:true,data:{remaining:{amount:12.34},currency:{code:'CNY'}}})).toEqual({balance:12.34,unit:'元（人民币）'});
  expect(()=>token01Balance({success:true,data:{remaining:{quota:500000},currency:{}}})).toThrow('金额与单位');
  expect(()=>token01Balance({success:true,data:{remaining:500000,currency:{}}})).toThrow('金额与单位');
  expect(()=>token01Balance({success:true,data:{remaining:{},currency:{}}})).toThrow('金额与单位');
 });
 it('reads the actual decimal amount and display denomination instead of exposing internal quota or converting it twice',()=>{
  expect(token01Balance({success:true,data:{remaining:{quota:500000,amount:'1.000000'},currency:{display_type:'CNY',symbol:'¥',exchange_rate:1,quota_per_unit:500000}}})).toEqual({balance:1,unit:'元（人民币）'});
  expect(token01Balance({success:true,data:{remaining:{quota:500000,amount:'7.200000'},currency:{display_type:'CNY',exchange_rate:7.2,quota_per_unit:500000}}})).toEqual({balance:7.2,unit:'元（人民币）'});
  expect(token01Balance({success:true,data:{remaining:{quota:0,amount:'0.000000'},currency:{display_type:'CNY'}}})).toEqual({balance:0,unit:'元（人民币）'});
  expect(token01Balance({success:true,data:{remaining:{amount:'2.500000'},currency:{display_type:'USD'}}})).toEqual({balance:2.5,unit:'美元'});
 });
 it.each(['', ' ', 'NaN', 'Infinity', '0x10', '1,000', null, false])('rejects invalid currency amounts %j without falling back to quota',amount=>{
  expect(()=>token01Balance({success:true,data:{remaining:{amount,quota:500000},currency:{display_type:'CNY'}}})).toThrow('金额与单位');
 });
 it('discards a wallet response if the local account changes while it is pending',async()=>{
  const account=createToken01Account(s,upstream());await account.login({phone,code});let finish!:(r:Response)=>void;
  const slow=createToken01Account(s,()=>new Promise(resolve=>{finish=resolve;}));const pending=slow.balance();await account.logout();finish(Response.json(overview));await expect(pending).rejects.toMatchObject({statusCode:409});
 });
});
