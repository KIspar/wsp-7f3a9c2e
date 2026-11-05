import './collector-core.js';
const core=globalThis.ResearchCollectorCore;
const config=async()=>chrome.storage.local.get(['origin','token']);
async function api(route,body,method=body===undefined?'GET':'POST'){
 const {origin,token}=await config();if(!origin)throw Error('请先配对本地工作台');const r=await fetch(origin+'/api/research-extension'+route,{method,headers:{'X-Research-Token':token||'','X-Research-Extension-Id':chrome.runtime.id,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(!r.ok)throw Error((await r.json().catch(()=>({message:'本地服务连接失败'}))).message);return r.json();
}
async function page(tabId,operation='snapshot',repliesOnly=false){await chrome.scripting.executeScript({target:{tabId},func:(op,only)=>{globalThis.__researchOperation=op;globalThis.__researchRepliesOnly=only;},args:[operation,repliesOnly]});await chrome.scripting.executeScript({target:{tabId},files:['collector-core.js']});return (await chrome.scripting.executeScript({target:{tabId},files:['content.js']}))[0].result;}
async function uploadBlob(jobId,blob,label){const f=new FormData();f.append('file',blob,label);return api('/assets?jobId='+encodeURIComponent(jobId)+'&label='+encodeURIComponent(label),f);}
const active=new Set();
async function collect(jobId,tabId){
 if(active.size)throw Error('已有任务正在采集，请先暂停');active.add(jobId);const warnings=[],media=[];let comments=[],empty=0,loops=0,stopReason='',commentAtBottom=false;
 try{
  const checkpoint=await api('/jobs/'+jobId);warnings.push(...checkpoint.warnings);media.push(...checkpoint.media);comments=checkpoint.comments;
  const tab=await chrome.tabs.get(tabId),expected=core.contentId(checkpoint.url),actual=core.contentId(tab.url);if(!tab.url?.startsWith('https://')||!new URL(tab.url).hostname.endsWith('.douyin.com')||expected&&expected!==actual)throw Error('请先打开该任务对应的抖音素材页');
  let initial=await page(tabId);if(initial.login!=='ready'){await api('/jobs/'+jobId,{status:initial.login==='paused'?'paused':'waiting-login',stage:initial.login==='unconfirmed'?'无法确认登录状态，请打开个人主页确认已登录后重新检查':'请先在当前浏览器登录抖音网页版',stopReason:'登录检查未通过'},'PATCH');return;}
  await api('/jobs/'+jobId,{status:'collecting',stage:'采集内容与评论'},'PATCH');
  const seenUrls=new Set((await chrome.storage.local.get('media-'+jobId))['media-'+jobId]||[]);
  async function mediaFiles(snapshot){for(const m of snapshot.media){if(seenUrls.has(m.url))continue;try{const response=await fetch(m.url,{credentials:'include',redirect:'error'});if(!response.ok)throw Error('HTTP '+response.status);const length=Number(response.headers.get('content-length'));if(length>30*1024*1024)throw Error('文件超过30MB');const blob=await response.blob();if(blob.size>30*1024*1024)throw Error('文件超过30MB');const a=await uploadBlob(jobId,blob,m.label);media.push({assetId:a.id,role:m.role,label:m.label});seenUrls.add(m.url);await api('/jobs/'+jobId,{status:'collecting',stage:'已保存素材',media:[media.at(-1)]},'PATCH');}catch(e){warnings.push(m.label+'未取得：'+e.message);}}await chrome.storage.local.set({['media-'+jobId]:[...seenUrls]});}
  await mediaFiles(initial);
  while(active.has(jobId)){
   const snapshot=await page(tabId);if(snapshot.login!=='ready'){await api('/jobs/'+jobId,{status:'waiting-login',stage:'登录或验证状态发生变化，已暂停',comments,stopReason:'请重新登录并检查后继续'},'PATCH');return;}
   commentAtBottom=snapshot.atBottom;const count=comments.length;comments=core.mergeComments(comments,snapshot.comments);empty=comments.length===count?empty+1:0;loops++;
   const first=comments.filter(c=>c.level==='1').length,repliesOnly=first>=100||snapshot.atBottom;
   await api('/jobs/'+jobId,{status:'collecting',stage:`一级${first}/100 · 二级${comments.length-first}`,title:snapshot.title,text:snapshot.text,comments:snapshot.comments.filter(c=>comments.some(x=>x.id===c.id)),sort:snapshot.sort},'PATCH');
   if(empty>=5){stopReason=snapshot.atBottom?'已到评论底部':first>=100?'一级已达100条，当前可访问二级回复已停止新增':'评论连续没有新增，无法确认已到底';break;}
   if(loops>=160){stopReason='本轮达到操作上限，保留结果，可继续采集';break;}
   await page(tabId,'advance',repliesOnly);await new Promise(r=>setTimeout(r,900));
  }
  if(!active.has(jobId)){await api('/jobs/'+jobId,{status:'paused',stage:'用户暂停，已保存进度',stopReason:'用户暂停'},'PATCH');return;}
  const opened=await page(tabId,'open-product');if(opened?.reason)warnings.push(opened.reason);
  await new Promise(r=>setTimeout(r,1200));const product=await page(tabId);
  if(product.login!=='ready'){await api('/jobs/'+jobId,{status:'waiting-login',stage:'商品页要求登录，已保存内容和评论',warnings:warnings.slice(-30)},'PATCH');return;}
  if(product.hasProduct){
   await mediaFiles(product);
   // Capture the actual product panel in the active tab; never capture another app/tab.
   const current=await chrome.tabs.query({active:true,windowId:tab.windowId});if(current[0]?.id===tabId){const uri=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}),a=await uploadBlob(jobId,await (await fetch(uri)).blob(),'商品首屏截图.png');media.push({assetId:a.id,role:'first-impression',label:'点击商品后的实际首屏截图'});}else warnings.push('目标标签页不在前台，未拍摄首屏截图');
  }else warnings.push('未取得商品承接页，请手动打开商品后使用“补采商品页”');
  if(!media.length)warnings.push('未取得可下载媒体；可在系统补充图片，不把页面封面冒充视频');
  const complete=comments.filter(c=>c.level==='1').length>=100||commentAtBottom;
  await api('/jobs/'+jobId,{status:warnings.length||!complete?'partial':'completed',stage:'采集包已保存，返回工作台主动分析',title:initial.title,text:initial.text,productInfo:product.productInfo,comments:[],media,warnings:[...new Set(warnings)].slice(-30),stopReason},'PATCH');
 }catch(e){await api('/jobs/'+jobId,{status:'paused',stage:'采集中断，已有内容保留',stopReason:e.message,warnings:[...new Set(warnings)].slice(-30)},'PATCH').catch(()=>{});await chrome.storage.local.set({lastError:e.message});}finally{active.delete(jobId);}
}
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{(async()=>{
 if(message.action==='pair'){const u=new URL(message.origin);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password)throw Error('仅支持本机HTTP工作台地址');await chrome.storage.local.set({origin:u.origin});const result=await api('/pair',{code:message.code.trim()});await chrome.storage.local.set({token:result.token});return {ok:true};}
 if(message.action==='jobs')return {jobs:await api('/jobs'),active:[...active],...(await chrome.storage.local.get('lastError'))};
 if(message.action==='check'){const state=await page(message.tabId);return {login:state.login,url:state.url};}
 if(message.action==='start'){void collect(message.jobId,message.tabId).catch(e=>chrome.storage.local.set({lastError:e.message}));return {started:true};}
 if(message.action==='pause'){active.delete(message.jobId);return {paused:true};}
 if(message.action==='supplement'){const s=await page(message.tabId);if(s.login!=='ready'||!s.hasProduct)throw Error('请先登录并打开目标商品面板');const tab=await chrome.tabs.get(message.tabId),visible=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];if(visible?.id!==tab.id)throw Error('请将目标商品标签页置于前台');const uri=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}),a=await uploadBlob(message.jobId,await(await fetch(uri)).blob(),'商品首屏截图.png');return api('/jobs/'+message.jobId,{status:'partial',stage:'已补充商品首屏，请核对资料完整性',productInfo:s.productInfo,media:[{assetId:a.id,role:'first-impression',label:'用户补充的商品首屏截图'}]},'PATCH');}
 throw Error('未知操作');
})().then(reply,e=>reply({error:e.message}));return true;});
