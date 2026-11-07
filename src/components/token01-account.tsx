import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {LoaderCircle,LogIn} from 'lucide-react';
import {toast} from 'sonner';
import type {Token01AccountState,Token01LoginConfig} from '../../packages/relays';
import {api} from '@/lib/api';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Field,FieldLabel,FieldDescription} from './ui/field';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
import {Sheet,SheetContent,SheetHeader,SheetTitle} from './ui/sheet';

type CaptchaResult={ret:number;ticket?:string;randstr?:string};
let captchaScript:Promise<void>|undefined;
async function captcha(appId?:string){
  if(!appId)throw Error('平台未提供图形验证配置，请到 Token01 登录');
  type CaptchaWindow=Window&{TencentCaptcha?:new(id:string,done:(result:CaptchaResult)=>void)=>{show:()=>void}};
  const host=window as CaptchaWindow;
  if(!host.TencentCaptcha){
    captchaScript??=new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://turing.captcha.qcloud.com/TCaptcha.js';script.async=true;
      const timer=window.setTimeout(()=>{script.remove();captchaScript=undefined;reject(Error('图形验证加载超时，请重试'));},15000);
      script.onload=()=>{window.clearTimeout(timer);resolve();};script.onerror=()=>{window.clearTimeout(timer);script.remove();captchaScript=undefined;reject(Error('图形验证加载失败，请重试'));};document.head.appendChild(script);
    });
    await captchaScript;
  }
  if(!host.TencentCaptcha)throw Error('图形验证不可用，请到 Token01 登录');
  return new Promise<{captcha_ticket:string;captcha_randstr:string}>((resolve,reject)=>{
    const widget=new host.TencentCaptcha!(appId,result=>result.ret===0&&result.ticket&&result.randstr?resolve({captcha_ticket:result.ticket,captcha_randstr:result.randstr}):reject(Error('图形验证已取消，请重试')));widget.show();
  });
}

export function useToken01Account(enabled=true){
  return useQuery({queryKey:['token01-account'],queryFn:()=>api<Token01AccountState>('/token01/account'),enabled,retry:false,staleTime:5000,refetchInterval:30000});
}
export function Token01AccountLogin(){
  const account=useToken01Account(),cache=useQueryClient();
  const [open,setOpen]=useState(false),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState<'sms'|'login'|'logout'>(),[sentPhone,setSentPhone]=useState<string>(),[until,setUntil]=useState(0),[seconds,setSeconds]=useState(0),[error,setError]=useState('');
  const config=useQuery({queryKey:['token01-login-config'],queryFn:()=>api<Token01LoginConfig>('/token01/account/login-config'),enabled:open&&!account.data?.authenticated,retry:false,staleTime:60000});
  useEffect(()=>{const update=()=>setSeconds(Math.max(0,Math.ceil((until-Date.now())/1000)));update();if(until<=Date.now())return;const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);},[until]);
  const valid=/^1[3-9]\d{9}$/.test(phone);
  async function send(){
    setBusy('sms');setError('');setSentPhone(undefined);try{
      const settings=config.data||await config.refetch().then(result=>{if(!result.data)throw result.error;return result.data;});
      if(!settings)throw Error('登录配置读取失败，请重试');
      const challenge=settings.captchaEnabled?await captcha(settings.captchaAppId):{};
      const result=await api<{retryAfter:number}>('/token01/account/sms',{phone,...challenge});
      setSentPhone(phone);setCode('');setUntil(Date.now()+result.retryAfter*1000);toast.success('验证码已发送');
    }catch(e){setError((e as Error).message);}finally{setBusy(undefined);}
  }
  async function login(){
    setBusy('login');setError('');try{
      const state=await api<Token01AccountState>('/token01/account/login',{phone,code});cache.setQueryData(['token01-account'],state);await cache.invalidateQueries({queryKey:['account','token01-balance']});setCode('');setPhone('');setSentPhone(undefined);setOpen(false);toast.success('Token01 账户已登录');
    }catch(e){setError((e as Error).message);setCode('');}finally{setBusy(undefined);}
  }
  async function logout(){
    setBusy('logout');setError('');try{const state=await api<Token01AccountState>('/token01/account/logout',{});cache.setQueryData(['token01-account'],state);cache.removeQueries({queryKey:['account','token01-balance']});setOpen(false);toast.success('已退出 Token01 账户');}catch(e){setError((e as Error).message);}finally{setBusy(undefined);}
  }
  return <><Button size="sm" variant="outline" onClick={()=>{setError('');setOpen(true);}}><LogIn data-icon="inline-start"/>{account.data?.authenticated?`账户 ${account.data.phone||'已登录'}`:'登录同步余额'}</Button>
    <Sheet open={open} onOpenChange={next=>{if(!busy){setOpen(next);if(!next)setCode('');}}}><SheetContent aria-describedby={undefined} className="analysis-sheet"><SheetHeader><SheetTitle>登录 Token01 账户</SheetTitle></SheetHeader><div className="analysis-sheet-body">
      {account.data?.authenticated?<><p>已登录 {account.data.phone}</p><Button variant="outline" disabled={!!busy} onClick={()=>void logout()}>{busy&&<LoaderCircle className="spin"/>}退出账户登录</Button></>:<>
        {account.data?.expired&&<p role="status" className="muted">登录已过期，请重新获取验证码。</p>}
        <Field><FieldLabel htmlFor="token01-login-phone">手机号</FieldLabel><Input id="token01-login-phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={11} placeholder="输入 Token01 账户手机号" value={phone} disabled={!!busy} onChange={event=>{setPhone(event.target.value);setCode('');setSentPhone(undefined);}}/><FieldDescription>未注册手机号将由平台自动注册。</FieldDescription></Field>
        <Field><FieldLabel htmlFor="token01-login-code">短信验证码</FieldLabel><div className="flex items-center gap-3"><Input id="token01-login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} disabled={!!busy} placeholder="输入验证码" onChange={event=>setCode(event.target.value)}/><Button variant="outline" disabled={!valid||!!busy||seconds>0||config.isPending||config.data?.phoneEnabled===false||config.isError} onClick={()=>void send()}>{busy==='sms'&&<LoaderCircle className="spin"/>}{seconds?`${seconds} 秒后重发`:'获取验证码'}</Button></div>{valid&&sentPhone===phone&&<FieldDescription>验证码已发送，请查看短信。</FieldDescription>}</Field>
        <Button disabled={!valid||!/^\d{4,8}$/.test(code)||!!busy||config.data?.phoneEnabled===false} onClick={()=>void login()}>{busy==='login'&&<LoaderCircle className="spin"/>}登录并查询余额</Button>
        {config.data?.phoneEnabled===false&&<p role="status">Token01 当前未开放手机号登录，请前往平台登录。</p>}
        {config.error&&<p role="alert">{(config.error as Error).message}<Button variant="link" onClick={()=>void config.refetch()}>重新读取</Button></p>}
        
      </>}
      {error&&<Alert variant="destructive"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    </div></SheetContent></Sheet>
  </>;
}
