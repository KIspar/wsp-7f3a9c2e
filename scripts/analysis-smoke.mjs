/** Browser interaction regression; analysis transport is mocked, never paid. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'analysis-ui-'));
const server=spawn(process.execPath,['dist-server/index.js'],{env:{...process.env,PORT:'0',STUDIO_DATA:dir},stdio:['ignore','pipe','pipe']});
const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),15000);server.stdout.on('data',b=>{const url=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timeout);resolve(url);}});server.once('exit',()=>reject(Error('Server exited')));});
const boot=await (await fetch(base+'/api/bootstrap')).json();
for(const id of ['tt-6.1-sol','gem-3.8-flash'])await fetch(base+'/api/analysis/models/'+id,{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({key:'sk-test-browser-12345678901234567890'})});
const config=await (await fetch(base+'/api/analysis/config')).json();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let jobs=[],postCount=0;
await page.route('**/api/analysis/jobs',async route=>{
 if(route.request().method()==='GET')return route.fulfill({json:jobs});
 postCount++;const input=route.request().postDataJSON();const model=config.models.find(m=>m.id===config.settings.defaultModelId);
 const job={id:'mock-job-'+postCount,input,model,fingerprint:'test',credentialVersion:'test',assets:[],status:'submitting',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),simulated:false,billing:{status:'pending'}};jobs.unshift(job);return route.fulfill({json:job});
});
fs.mkdirSync('output/playwright/analysis',{recursive:true});
async function go(url){await page.goto(base+url);await page.locator('.management-heading, .workspace-heading').waitFor();}
async function closeSheet(){await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
try{
 await go('/studio/image-generate');await page.getByLabel('创作要求',{exact:true}).fill('原始创作要求');assert.equal(postCount,0);
 assert.equal(await page.getByRole('button',{name:'AI 润色',exact:true}).innerText(),'','Polish uses an accessible icon without a text row');
 await page.getByRole('button',{name:'白底商品图',exact:true}).click();assert.match(await page.getByLabel('创作要求',{exact:true}).inputValue(),/^原始创作要求\n制作服装白底商品图/);assert.equal(postCount,0);
 await page.getByRole('button',{name:'白底商品图',exact:true}).click();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'原始创作要求');
 await page.getByRole('button',{name:'AI 润色',exact:true}).click();assert.equal(postCount,0);await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'原始创作要求');
 await page.getByRole('button',{name:'AI 润色',exact:true}).click();await page.getByRole('button',{name:'开始分析',exact:true}).dblclick();await page.getByText('分析中',{exact:true}).waitFor();assert.equal(postCount,1);
 await page.getByRole('button',{name:'关闭面板，后台继续',exact:true}).click();await page.getByLabel('创作要求',{exact:true}).fill('用户后续的新输入');
 await page.getByRole('button',{name:'AI 润色',exact:true}).click();jobs[0]={...jobs[0],status:'completed',result:'候选润色内容',usage:{inputTokens:100,outputTokens:30,totalTokens:130},billing:{status:'final',cost:0.001},upstreamTaskId:'mock-task'};
 await page.getByRole('button',{name:'替换原文',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'替换原文',exact:true}).isEnabled(),false);
 assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'用户后续的新输入');
 await page.getByRole('button',{name:'插入当前文本',exact:true}).click();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'用户后续的新输入\n候选润色内容');assert.equal(postCount,1);
 await page.getByRole('button',{name:'AI 润色',exact:true}).click();await page.getByRole('button',{name:'开始分析',exact:true}).click();await page.getByText('分析中',{exact:true}).waitFor();jobs[0]={...jobs[0],status:'failed',error:'模拟供应商失败，原文保留'};await page.getByText('模拟供应商失败，原文保留',{exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'用户后续的新输入\n候选润色内容');
 // Reference reversal launches its own sheet and never submits the generation form.
 await page.locator('input[type=file]').nth(1).setInputFiles('docs/reports/henley-live-20261028/inputs/product-1.jpg');
 await page.getByRole('button',{name:'反推提示词',exact:true}).waitFor();await page.getByRole('button',{name:'反推提示词',exact:true}).click();await page.getByRole('dialog',{name:'反推提示词',exact:true}).waitFor();assert.equal(postCount,2);await closeSheet();
 await go('/studio/detail-design');assert.equal(await page.getByRole('button',{name:'AI 编写',exact:true}).isEnabled(),true);assert.equal(await page.getByRole('button',{name:'AI 润色',exact:true}).count(),1);
 for(const id of ['image-generate','scene-recreate','image-edit','model-outfit']){await go('/studio/'+id);assert.equal(await page.getByRole('button',{name:'AI 润色',exact:true}).count(),1);assert.equal(await page.getByRole('combobox',{name:'AI 辅助模型',exact:true}).count(),0);}
 assert.deepEqual(await page.locator('.composer-suggestions button').allTextContents(),['自然换装','保留原模特','服装版型一致','真实面料质感']);
 await go('/settings');await page.getByRole('combobox',{name:'AI 辅助模型',exact:true}).click();await page.getByRole('option',{name:'GEM 3.8 flash',exact:true}).click();await page.getByText('AI 辅助模型已切换，新请求立即生效',{exact:true}).waitFor();assert.equal((await (await fetch(base+'/api/analysis/config')).json()).settings.defaultModelId,'gem-3.8-flash');
 await go('/video-reverse');await page.getByLabel('单个 MP4 / WebM',{exact:true}).setInputFiles('docs/reports/analysis-live-20261028/motion-sequence.mp4');await page.getByText(/6.00 秒 · 上传完成/).waitFor();assert.equal(postCount,2);
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:900});
  for(const url of ['/settings','/models','/video-reverse']){await go(url);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${url} ${width}: overflow`);await page.screenshot({path:`output/playwright/analysis/${url.slice(1)}-${width}.png`,fullPage:true});}
  for(const id of ['image-generate','model-outfit']){await go('/studio/'+id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`output/playwright/analysis/shortcuts-${id}-${width}.png`});}
  await go('/studio/image-generate');await page.getByRole('button',{name:'AI 润色',exact:true}).click();await page.getByRole('dialog',{name:'AI 润色',exact:true}).waitFor();await page.screenshot({path:`output/playwright/analysis/panel-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await closeSheet();
 }
 assert.deepEqual(errors,[]);console.log('PASS: optional explicit actions only; double-click once; cancel/failure retains input; late result cannot replace new text; insert uses latest text; all five skill entries; reference sheet; global model switch; native video upload; custom controls and 1280/1440/1920 layouts. Analysis POSTs were mocked; zero paid calls.');
}finally{await browser.close();await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(dir,{recursive:true,force:true});}
