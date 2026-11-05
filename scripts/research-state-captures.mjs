import fs from 'node:fs';import {chromium} from 'playwright';
const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),dir='output/research-acceptance',url='http://127.0.0.1:4311/catalog/fixture-research-product',pattern='**/api/catalog/products/fixture-research-product/research';
try{
 const p=await b.newPage({viewport:{width:1440,height:1000}});await p.goto(url);await p.getByText('通勤搭配',{exact:true}).waitFor();await p.getByRole('tab',{name:'深度分析',exact:true}).click();await p.locator('.research-sidebar-scroll').evaluate(e=>{const h=[...e.querySelectorAll('h3')].find(x=>x.textContent==='抖音采集助手');e.scrollTop=h.offsetTop-e.offsetTop-16});await p.locator('.research-main').evaluate(e=>e.scrollTop=0);await p.screenshot({path:`${dir}/deep-login-1440.png`});
 await p.locator('.research-main').evaluate(e=>{const h=e.querySelector('.research-plans');e.scrollTop=h.offsetTop-e.offsetTop-20;});await p.screenshot({path:`${dir}/strategies-1440.png`});await p.close();
 for(const state of ['loading','error','empty','progress']){
 const p=await b.newPage({viewport:{width:1440,height:1000}});let release;
 await p.route(pattern,async route=>{if(state==='loading'){await new Promise(r=>release=r);return route.continue();}if(state==='error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'隔离验收：临时读取失败，原研究资料保留'})});const res=await route.fetch(),data=await res.json();if(state==='empty'){data.jobs=[];data.executions=[];}if(state==='progress'){const source=data.jobs.find(j=>j.kind==='analysis');data.jobs.unshift({...source,id:'fixture-progress',status:'running',steps:[{id:'evidence-0',label:'商品图片 · 第1批',kind:'evidence',evidenceIds:[],assetIds:[],modelId:'gem-3.8-flash',action:'research-evidence',attempt:0}]});}return route.fulfill({response:res,json:data});});
 await p.goto(url);if(state==='loading')await p.getByRole('status',{name:'正在读取商品研究…'}).waitFor();else if(state==='error')await p.getByRole('heading',{name:'研究资料读取失败'}).waitFor({timeout:20000});else if(state==='empty')await p.getByText('先找到购买理由，再开始制作',{exact:true}).waitFor();else await p.getByText('商品研究 · 0/1 步',{exact:true}).waitFor();
 await p.screenshot({path:`${dir}/${state}-1440.png`});release?.();await p.close();
 }
 console.log('state captures complete');
}finally{await b.close();}
