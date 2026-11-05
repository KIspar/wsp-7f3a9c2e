import https from 'node:https';
import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {fail} from './errors';
const blocked=new BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['2002::',16],['2001::',32],['64:ff9b::',96]] as const)blocked.addSubnet(ip,prefix,'ipv6');
export function publicAddress(ip:string){const family=isIP(ip);if(family===6&&ip.toLowerCase().includes('ffff:'))return false;return !!family&&!blocked.check(ip,family===4?'ipv4':'ipv6');}
export type RemoteRequest={method?:'GET'|'POST';headers?:Record<string,string>;body?:string;maxBytes?:number;domains?:readonly string[];httpsOnly?:boolean};
export type RemoteReader=(url:string,options?:RemoteRequest)=>Promise<{bytes:Buffer;mime:string;url:string}>;
/** Pin DNS on every request and redirect. Never pass a user URL to a local browser or proxy. */
export const readRemote:RemoteReader=(url,options={})=>requestRemote(url,options,0);
async function requestRemote(url:string,options:RemoteRequest,redirects:number):ReturnType<RemoteReader>{
  const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||options.httpsOnly&&u.protocol!=='https:'||u.username||u.password||u.port&&!['80','443'].includes(u.port))fail('资源地址不被允许');
  if(options.domains&&!options.domains.includes(u.hostname))fail(`资源域名不在采集白名单：${u.hostname}`);
  const addresses=await lookup(u.hostname,{all:true,verbatim:false});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))fail('拒绝访问本机、私网或保留地址');
  const selected=addresses.find(a=>a.family===4)||addresses[0];
  return new Promise((resolve,reject)=>{
    const req=(u.protocol==='https:'?https:http).request(u,{method:options.method||'GET',headers:{'User-Agent':'CreativeStudio/1.0',...options.headers},lookup:((_host:string,opts:unknown,cb:Function)=>{if((opts as {all?:boolean})?.all)cb(null,[selected]);else cb(null,selected.address,selected.family);}) as never},res=>{
      if(res.statusCode&&res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();if(redirects>=3){reject(new Error('资源重定向过多'));return;}void requestRemote(new URL(res.headers.location,u).href,{...options,method:'GET',body:undefined},redirects+1).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();reject(new Error(`远端资源返回 HTTP ${res.statusCode}`));return;}
      const limit=options.maxBytes||30*1024*1024,parts:Buffer[]=[];let size=0;
      res.on('data',(part:Buffer)=>{size+=part.length;if(size>limit){req.destroy(new Error('远端资源超过大小限制'));return;}parts.push(part);});
      res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(parts),mime:res.headers['content-type']||'',url:u.href}));
    });
    const timer=setTimeout(()=>req.destroy(new Error('远端读取超时')),45000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);if(options.body)req.write(options.body);req.end();
  });
}
