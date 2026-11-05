import type { Bootstrap, Snapshot } from "../../packages/contracts";
import { currentWorkspaceId } from "./workspace-scope";

let token = "";
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
let sessionRefresh: Promise<Bootstrap & {token:string}> | undefined;
async function request<T>(url:string,body:unknown,method:string,canRefresh:boolean):Promise<T>{
  const requestToken=token;
  let response:Response;
  try{response=await fetch(`/api${url}`,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Studio-Token':requestToken,'X-Studio-Workspace':currentWorkspaceId()},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}
  catch{throw new ApiError('连接中断，本地输入已保留。请检查后台服务。',0);}
  if(!response.ok){
    const error=await response.json().catch(()=>({message:`请求失败 (${response.status})`}));
    // Only the authentication guard's explicit rejection is safe to replay: no route or paid handler ran.
    if(canRefresh&&response.status===403&&error.code==='SESSION_EXPIRED'){
      if(token===requestToken)await bootstrap();
      return request<T>(url,body,method,false);
    }
    throw new ApiError(error.message||'操作失败',response.status);
  }
  return response.json();
}
export function api<T>(url:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{return request<T>(url,body,method,true);}
export function bootstrap():Promise<Bootstrap & {token:string}>{
  if(!sessionRefresh)sessionRefresh=request<Bootstrap & {token:string}>('/bootstrap',undefined,'GET',false).then(value=>{token=value.token;return value;}).finally(()=>{sessionRefresh=undefined;});
  return sessionRefresh;
}
export const snapshot = () => api<Snapshot>("/snapshot");
export const dateTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export const shortId = (id: string) => id.split("-")[1]?.slice(0, 8).toUpperCase() || id;
export const bytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
