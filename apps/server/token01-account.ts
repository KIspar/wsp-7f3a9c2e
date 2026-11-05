import {z} from 'zod';
import type {Store} from './store';
import {credentialVault} from './credentials';
import {token01Bytes} from './token01';
import {redactProvider,type ProviderTransport} from './provider';
import {token01ModelIds,token01Origin} from '../../packages/token01';
import type {RelayBalance,Token01AccountState,Token01LoginConfig} from '../../packages/relays';
import {fail} from './errors';

const numeric=z.union([z.number(),z.string().trim().max(128).regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite()),sessionSlot='token01-user-session';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const token01PhoneSchema=z.string().regex(/^1[3-9]\d{9}$/,'请输入有效的 11 位手机号');
export const token01SmsSchema=z.object({phone:token01PhoneSchema,captcha_ticket:z.string().max(4096).optional(),captcha_randstr:z.string().max(1024).optional()});
export const token01PhoneLoginSchema=z.object({phone:token01PhoneSchema,code:z.string().regex(/^\d{4,8}$/,'请输入短信验证码')});

// Only display explicitly denominated amounts. Raw quota is never assumed to be money.
export function token01Balance(raw:unknown):Pick<RelayBalance,'balance'|'unit'>{
  const result=z.object({success:z.literal(true),data:z.object({remaining:z.unknown(),currency:z.unknown()})}).safeParse(raw);
  if(!result.success)fail('Token01 余额响应不完整，请到钱包核对',502);
  const {remaining,currency}=result.data.data,r=object(remaining),c=object(currency);
  const denomination=[currency,c.display_type,c.code,c.unit,c.currency].find(value=>typeof value==='string') as string|undefined;
  const code=denomination?.trim().toUpperCase();
  const cny=numeric.safeParse(r.cny??r.CNY),usd=numeric.safeParse(r.usd);
  if(cny.success)return {balance:cny.data,unit:'元（人民币）'};
  // remaining.amount is already converted by Token01 for currency.display_type.
  const amount=numeric.safeParse(typeof remaining==='object'?r.amount:remaining);
  if(amount.success&&code&&['CNY','RMB','元','¥','￥'].includes(code))return {balance:amount.data,unit:'元（人民币）'};
  if(usd.success)return {balance:usd.data,unit:'美元'};
  if(amount.success&&code==='USD')return {balance:amount.data,unit:'美元'};
  fail('Token01 已返回额度，但未提供可识别的金额与单位，请到钱包核对',502);
}

type Session={accessToken:string;sessionId?:string};
export function createToken01Account(store:Store,transport:ProviderTransport=fetch){
  const vault=credentialVault(store.dataDir),pending=new Map<string,Promise<RelayBalance>>(),smsTimes=new Map<string,number>();
  let cached:{signature:string;until:number;data:RelayBalance}|undefined,loggingIn=false;
  const state=():Token01AccountState=>({...store.get<Token01AccountState>('token01-account','session'),authenticated:!!vault.current(sessionSlot),revision:vault.current(sessionSlot)});
  const session=():Session|undefined=>{const version=vault.current(sessionSlot);return version?JSON.parse(vault.get(sessionSlot,version)):undefined;};
  const headers=(s:Session)=>({Authorization:`Bearer ${s.accessToken}`,...(s.sessionId?{'X-Auth-Session':s.sessionId}:{})});
  async function request(path:string,init:RequestInit={},secrets:string[]=[]){
    try{
      const response=await transport(token01Origin+path,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
      let raw:unknown;try{raw=JSON.parse((await token01Bytes(response,1024*1024)).toString('utf8'));}catch{fail('Token01 返回内容异常，请稍后重试',502);}
      const body=object(raw);
      if(response.status===401||response.status===403||body.code==='AUTH_UNAUTHORIZED')fail('Token01 登录已失效或当前密钥没有 User 权限，请重新登录账户',401);
      if(!response.ok||body.success!==true){let message=String(body.message||`HTTP ${response.status}`);for(const secret of secrets)message=String(redactProvider(message,secret));fail('Token01：'+message.slice(0,300),[409,429].includes(response.status)?response.status:502);}
      return body;
    }catch(error){if((error as {statusCode?:number}).statusCode)throw error;fail('Token01 请求暂不可用，请稍后操作',502);}
  }
  async function config():Promise<Token01LoginConfig>{
    const raw=await request('/api/status'),data=object(raw.data);
    if(typeof data.phone_login_enabled!=='boolean'||typeof data.sms_captcha_enabled!=='boolean')fail('Token01 登录配置暂不可用',502);
    return {phoneEnabled:data.phone_login_enabled,captchaEnabled:data.sms_captcha_enabled,captchaAppId:typeof data.sms_captcha_app_id==='string'?data.sms_captcha_app_id:undefined};
  }
  async function send(input:z.infer<typeof token01SmsSchema>){
    const settings=await config();if(!settings.phoneEnabled)fail('Token01 暂未开放手机号登录');
    if(settings.captchaEnabled&&(!input.captcha_ticket||!input.captcha_randstr))fail('请先完成图形验证');
    const now=Date.now();if(now-(smsTimes.get(input.phone)||0)<60000)fail('验证码已请求，请稍后再试',429);
    // Reserve before sending so a timeout cannot trigger duplicate SMS requests.
    smsTimes.set(input.phone,now);for(const [phone,time] of smsTimes)if(now-time>60000)smsTimes.delete(phone);
    await request('/api/sms/code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},[input.phone,input.captcha_ticket||'',input.captcha_randstr||'']);
    return {sent:true,retryAfter:60};
  }
  async function login(input:z.infer<typeof token01PhoneLoginSchema>){
    if(loggingIn)fail('正在登录，请稍候',409);if(vault.current(sessionSlot))fail('请先退出当前 Token01 账户',409);loggingIn=true;
    try{
      const raw=await request('/api/user/login/phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},[input.phone,input.code]);
      const data=object(raw.data),auth=[data,object(data.auth),raw,object(raw.auth)].find(value=>typeof value.access_token==='string')||{};
      const token=z.string().min(12).max(8192).regex(/^[A-Za-z0-9._~+\/-]+=*$/).safeParse(auth.access_token);
      if(!token.success)fail('Token01 登录响应未包含有效访问令牌，请到平台检查登录会话',502);
      const next:Session={accessToken:token.data,...(typeof auth.session_id==='string'?{sessionId:auth.session_id}:{})};
      vault.setPrivate(sessionSlot,JSON.stringify(next));cached=undefined;
      store.put('token01-account','session',{authenticated:true,phone:input.phone.slice(0,3)+'****'+input.phone.slice(-4),loggedAt:new Date().toISOString()} satisfies Token01AccountState);
      return state();
    }finally{loggingIn=false;}
  }
  async function logout(){
    if(loggingIn)fail('正在登录，请稍候',409);
    const version=vault.current(sessionSlot),s=session();
    if(s)try{await request('/api/user/auth/logout',{method:'POST',headers:headers(s)},[s.accessToken]);}catch(error){if((error as {statusCode?:number}).statusCode!==401)throw error;}
    if(vault.current(sessionSlot)!==version)fail('账户状态已变化，请刷新后操作',409);
    vault.removePrivate(sessionSlot);store.put('token01-account','session',{authenticated:false});cached=undefined;return state();
  }
  async function balance():Promise<RelayBalance>{
    const slot=[sessionSlot,'relay-token01',...token01ModelIds].find(id=>vault.current(id));
    if(!slot)fail('请先登录 Token01 账户，再查询余额');
    const version=vault.current(slot)!,signature=slot+':'+version;
    if(cached?.signature===signature&&cached.until>Date.now())return cached.data;
    if(pending.has(signature))return pending.get(signature)!;
    const s=slot===sessionSlot?session()!:{accessToken:vault.get(slot,version)};
    const running=(async()=>{
      try{
        const raw=await request('/api/user/self/quota/overview',{headers:headers(s)},[s.accessToken]);
        const data={...token01Balance(raw),fetchedAt:new Date().toISOString()};
        if(vault.current(slot)!==version)fail('Token01 账户或密钥已变化，请重新查询余额',409);
        cached={signature,until:Date.now()+2000,data};return data;
      }catch(error){
        if(slot===sessionSlot&&(error as {statusCode?:number}).statusCode===401&&vault.current(slot)===version){vault.removePrivate(sessionSlot);store.put('token01-account','session',{authenticated:false,expired:true});cached=undefined;}
        throw error;
      }
    })().finally(()=>pending.delete(signature));
    pending.set(signature,running);return running;
  }
  return {state,config,send,login,logout,balance};
}
