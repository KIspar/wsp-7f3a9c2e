/** Price UI acceptance in an isolated database; fixture transport rejects paid requests. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studio-price-browser-'));
const server=spawn(process.execPath,['--import','tsx','scripts/fixture-server.ts'],{env:{...process.env,STUDIO_DATA:directory},stdio:['ignore','pipe','pipe']});
let browser;
try{
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),15000);server.stdout.on('data',chunk=>{const url=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited: '+code));});});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let estimates=0;
 page.on('request',request=>{if(request.url().endsWith('/api/generation/estimate'))estimates++;});
 const amount=page.locator('.generation-cost strong');
 const send=page.getByRole('button',{name:/确认发送/});
 async function cost(value){await page.waitForFunction(value=>document.querySelector('.generation-cost strong')?.textContent===value,value);}
 async function select(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}

 await page.goto(base+'/studio/image-generate');
 await cost('0.0395–0.0858 算力');
 assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'','Price is available before content');
 const before=estimates;
 await page.getByLabel('创作要求',{exact:true}).fill('价格验收，保留草稿');
 await page.waitForTimeout(650);assert.equal(estimates,before,'Text edits do not query per-call price');
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('3');await cost('0.1185–0.2574 算力');

 // Hold an obsolete response while the user changes quantity again.
 let release,started;
 const delayed=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/generation/estimate',async route=>{
  const payload=route.request().postDataJSON();
  if(payload.draft.count===2){const response=await route.fetch();started();await gate;await route.fulfill({response});}
  else await route.continue();
 });
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('2');await delayed;
 assert.equal(await send.isDisabled(),true,'Stale quote cannot submit');
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('1');await cost('0.0395–0.0858 算力');
 release();await page.waitForTimeout(200);assert.equal(await amount.innerText(),'0.0395–0.0858 算力');
 await page.unroute('**/api/generation/estimate');

 // Quote failure and insufficient funds retain the draft and prevent generation.
 await page.route('**/api/generation/estimate',route=>route.fulfill({status:502,json:{message:'报价接口暂时不可用'}}));
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('4');await cost('报价查询失败');
 assert.equal(await send.isDisabled(),true);assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'价格验收，保留草稿');
 await page.unroute('**/api/generation/estimate');
 await page.route('**/api/generation/estimate',async route=>{const response=await route.fetch(),quote=await response.json();await route.fulfill({json:{...quote,balance:0,available:0,affordable:false}});});
 await page.getByRole('button',{name:'重新查询生成报价'}).click();await page.getByText('可用算力不足',{exact:true}).waitFor();assert.equal(await send.isDisabled(),true);
 await page.unroute('**/api/generation/estimate');
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('1');await cost('0.0395–0.0858 算力');
 await send.click();await page.getByRole('dialog',{name:'确认生成计划'}).waitFor();
 await page.route('**/api/submit',route=>route.fulfill({status:409,json:{message:'接口报价已变化，请重新预览本次算力后确认'}}));
 await page.getByRole('button',{name:/确认接单/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'价格验收，保留草稿');
 assert.equal(await page.evaluate(()=>localStorage.getItem('studio-pending-submission')),null);
 await page.unroute('**/api/submit');

 fs.mkdirSync('output/playwright/pricing',{recursive:true});
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:900});await page.screenshot({path:`output/playwright/pricing/image-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('.composer-submit').evaluate(el=>{const elements=[...el.children].filter(el=>el.getBoundingClientRect().width);return elements.some((el,i)=>elements.slice(i+1).some(other=>{const a=el.getBoundingClientRect(),b=other.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}));}),false,`${width}: price and submit overlap`);
 }

 await page.goto(base+'/studio/video-generate');await cost('0.4118 算力');
 for(const [duration,price] of [['6 秒','0.6177 算力'],['10 秒','1.0296 算力'],['4 秒','0.4118 算力']]){await select('视频时长',duration);await cost(price);}
 await page.goto(base+'/studio/detail-design');await cost('0.0395–0.0858 算力');
 await page.getByRole('button',{name:'添加一屏',exact:true}).click();
 await page.getByRole('spinbutton',{name:'生成组数',exact:true}).fill('3');await cost('0.237–0.5148 算力');
 assert.deepEqual(errors,[]);
 console.log('PASS: price before content, quantity, video duration, detail screens × groups, late response isolation, query failure/recovery, insufficient funds, changed quote preserves draft, 1280/1440/1920 layout, no paid requests.');
}finally{
 await browser?.close();
 if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});
 fs.rmSync(directory,{recursive:true,force:true});
}
