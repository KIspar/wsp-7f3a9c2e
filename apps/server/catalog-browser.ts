import {lookup} from 'node:dns/promises';
import type {Browser} from 'playwright';
import {publicAddress} from './remote';
import {aliAccessMessage,aliMediaDomains,aliPageDomains} from './catalog-1688';
import {fail} from './errors';
const domains=[...aliPageDomains,...aliMediaDomains,'g.alicdn.com','o.alicdn.com','i.alicdn.com','lang.alicdn.com','h5api.m.1688.com','h5api.m.taobao.com','acs.m.1688.com','air.1688.com'];
/** A fresh, unauthenticated browser for the canonical 1688 URL only. No user profile or credentials. */
export async function renderAliPage(url:string):Promise<string>{
 const u=new URL(url);if(u.origin!=='https://detail.1688.com'||!/^\/offer\/\d+\.html$/.test(u.pathname)||u.search||u.hash)fail('浏览器只读取已标准化的 1688 商品链接');
 const resolved=await Promise.all(domains.map(async host=>{try{const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return;const address=addresses.find(a=>a.family===4)||addresses[0];return {host,address:address.family===6?`[${address.address}]`:address.address};}catch{return;}}));
 const allowed=resolved.filter((r):r is {host:string;address:string}=>!!r);
 if(!allowed.some(r=>r.host===u.hostname))fail('1688 商品域名无法安全解析，请稍后再试');
 const rules=[...allowed.map(r=>`MAP ${r.host} ${r.address}`),'MAP * ~NOTFOUND'].join(',');
 let browser:Browser;
 try{const {chromium}=await import('playwright');browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000,args:[`--host-resolver-rules=${rules}`,'--no-proxy-server','--disable-background-networking','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});}catch{fail('本机缺少可用的 Chrome 浏览器，无法渲染 1688 商品页。可安装 Chrome，或使用“补充页面文件”导入已保存的 HTML。');}
 try{
  const context=await browser.newContext({locale:'zh-CN',acceptDownloads:false,serviceWorkers:'block',permissions:[]});
  await context.routeWebSocket('**/*',socket=>socket.close());
  let bytes=0;await context.route('**/*',async route=>{try{const request=route.request(),target=new URL(request.url());if(!['https:'].includes(target.protocol)||target.username||target.password||target.port||!allowed.some(r=>r.host===target.hostname)||/_____tmd_____/.test(target.pathname)||!['GET','POST'].includes(request.method())){await route.abort();return;}if(request.isNavigationRequest()&&request.frame()===request.frame().page().mainFrame()&&(target.hostname!==u.hostname||target.pathname!==u.pathname)){await route.abort();return;}if(['image','media','font'].includes(request.resourceType())){await route.abort();return;}await route.continue();}catch{await route.abort().catch(()=>{});}});
  const page=await context.newPage();page.on('response',r=>{const n=Number(r.headers()['content-length']||0);if(Number.isFinite(n))bytes+=n;if(bytes>32*1024*1024)void context.close().catch(()=>{});});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  // Ordinary page rendering only: a login, CAPTCHA or verification page is left for the user.
  await page.waitForFunction(()=>Array.from(document.scripts).some(s=>/window\.context\s*=/.test(s.textContent||'')&&s.textContent?.includes('"result"')),{},{timeout:12000}).catch(()=>{});
  const html=await page.content();if(Buffer.byteLength(html)>8*1024*1024)fail('1688 商品页面超过大小限制');return html;
 }catch(e){if((e as {statusCode?:number}).statusCode)throw e;fail(aliAccessMessage);}finally{await browser.close();}
}
