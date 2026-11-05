const el=id=>document.getElementById(id),state=message=>{el('state').textContent=message;};
let jobs=[],checkedTab,checkedUrl;
const send=async args=>{const r=await chrome.runtime.sendMessage(args);if(r?.error)throw Error(r.error);return r;};
const tab=async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0];
async function refresh(){const r=await send({action:'jobs'});jobs=r.jobs;el('jobs').replaceChildren(...jobs.map(j=>{const o=document.createElement('option');o.value=j.id;o.textContent=`${j.title||j.url} · ${j.stage}`;return o;}));if(r.lastError)state(r.lastError);}
for(const id of ['pair','refresh','open','login','check','start','pause','supplement'])el(id).addEventListener('click',async()=>{try{
 const job=jobs.find(j=>j.id===el('jobs').value);
 if(id==='pair'){await send({action:'pair',origin:el('origin').value,code:el('code').value});el('code').value='';state('配对成功');await refresh();}
 if(id==='refresh')await refresh();
 if(id==='open'){if(!job)throw Error('请先在工作台添加链接');await chrome.tabs.create({url:job.url});el('start').disabled=true;}
 if(id==='login'){await chrome.tabs.create({url:'https://www.douyin.com'});el('start').disabled=true;}
 if(id==='check'){const t=await tab(),r=await send({action:'check',tabId:t.id});checkedTab=t.id;checkedUrl=r.url;el('start').disabled=r.login!=='ready';state(({ready:'已确认当前页登录，可开始采集','waiting-login':'请先完成抖音网页登录',paused:'出现访问验证，请先在网页处理',unconfirmed:'无法确认登录状态。请打开个人主页确认已登录后重试'})[r.login]);}
 if(id==='start'){if(!job)throw Error('没有待采集任务');const t=await tab();if(t.id!==checkedTab||t.url!==checkedUrl)throw Error('当前页发生变化，请重新检查登录');await send({action:'start',jobId:job.id,tabId:t.id});state('采集中，请保持浏览器打开。进度会保存到工作台。');}
 if(id==='pause'){if(job)await send({action:'pause',jobId:job.id});state('已请求暂停，当前操作完成后保留进度');}
 if(id==='supplement'){if(!job)throw Error('请先选择所属任务');await send({action:'supplement',jobId:job.id,tabId:(await tab()).id});state('已补充首屏截图，请在工作台核对');}
}catch(e){state(e.message);}});
chrome.storage.local.get('origin').then(r=>{if(r.origin)el('origin').value=r.origin;return refresh();}).catch(e=>state(e.message));
