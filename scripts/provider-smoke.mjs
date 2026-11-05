/** Provider UI regression uses isolated data and intercepted GET fixtures; no paid calls. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/provider.json','utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'provider-ui-'));
const server=spawn(process.execPath,['dist-server/index.js'],{env:{...process.env,PORT:'0',STUDIO_DATA:dir},stdio:['ignore','pipe','pipe']});
let browser;
try{
 const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),15000);server.stdout.on('data',b=>{const u=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(u){clearTimeout(timeout);resolve(u);}});server.once('exit',()=>reject(Error('Server exited')));});
 const boot=await(await fetch(base+'/api/bootstrap')).json();
 for(const id of ['tt-6.1-sol','gem-3.8-flash'])await fetch(base+'/api/analysis/models/'+id,{method:'PUT',headers:{'Content-Type':'application/json','X-Studio-Token':boot.token},body:JSON.stringify({key:'sk-test-browser-12345678901234567890'})});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 let partialError=false,taskFinal=false,hold;
 let accountFailure=false,accountBalance=123.456; const accountCalls=[];
 await page.route('**/api/account{,/**,?*}',async route=>{
  const u=new URL(route.request().url());accountCalls.push(u);
  if(accountFailure)return route.fulfill({status:502,json:{message:'测试账户服务暂不可用'}});
  const fetchedAt=new Date().toISOString();
  if(u.pathname==='/api/account')return route.fulfill({json:{balance:accountBalance,unit:'算力',fetchedAt}});
  const days=Number(u.searchParams.get('days')||7),from='2026-10-22T16:00:00Z',to='2026-10-29T01:00:00Z';
  if(u.pathname.endsWith('/usage'))return route.fulfill({json:{from,to,fetchedAt,scope:'user',unit:'算力',totals:fixtures.usage.grand_total,daily:Array.from({length:days},(_,i)=>({date:new Date(Date.UTC(2026,9,30-days+i)).toISOString().slice(0,10),cost:i===days-2?.125:0,count:i===days-2?2:0}))}});
  const offset=Number(u.searchParams.get('offset'));return route.fulfill({json:{from,to,fetchedAt,total:21,limit:10,offset,records:Array.from({length:offset===20?1:10},(_,i)=>({...fixtures.records.records[i%2],task_id:123+offset+i}))}});
 });
 await page.route('**/api/provider/**',async route=>{
  const u=new URL(route.request().url());calls.push(u);assert.equal(route.request().method(),'GET');
  if(u.pathname.endsWith('/balance')&&hold){const release=hold;hold=undefined;await release;}
  if(u.pathname.endsWith('/key')&&partialError)return route.fulfill({status:502,json:{message:'测试密钥信息暂不可用'}});
  let data;
  if(u.pathname.endsWith('/balance'))data={...fixtures.balance,balance:u.searchParams.get('credentialId')==='tt-6.1-sol'?123.456:999};
  else if(u.pathname.endsWith('/key')){data={...fixtures.key};delete data.api_key;}
  else if(u.pathname.endsWith('/usage')){const detailed=u.searchParams.get('detail')==='1';data=structuredClone(detailed?fixtures.records:fixtures.usage);data.scope=u.searchParams.get('scope');if(detailed){const offset=Number(u.searchParams.get('offset'));data.total=21;data.offset=offset;data.records=Array.from({length:offset?1:20},(_,i)=>({...fixtures.records.records[i%2],task_id:123+offset+i}));}}
  else if(u.pathname.endsWith('/task'))data={...fixtures.task,state:taskFinal?'failed':'running',is_final:taskFinal,cost:taskFinal?0:.125,refunded:taskFinal,refunded_amount:taskFinal?.125:0,result_urls:['javascript:alert(1)'],result_url:'https://example.com/result.png',...(!taskFinal?{input_tokens:undefined,output_tokens:undefined}:{})};
  else if(u.pathname.endsWith('/models'))data=fixtures.models;
  else if(u.pathname.endsWith('/pricing'))data=fixtures.pricing;
  else data={...fixtures.model,name:u.searchParams.get('model')};
  return route.fulfill({json:{credentialId:u.searchParams.get('credentialId'),fetchedAt:new Date().toISOString(),data}});
 });
 fs.mkdirSync('output/playwright/provider',{recursive:true});
 async function go(url){await page.goto(base+url);await page.locator('.management-heading, .usage-page-heading').waitFor();}
 async function choose(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
 async function shot(name){await page.screenshot({path:'output/playwright/provider/'+name+'.png',fullPage:!name.startsWith('pricing-')});}
 async function layout(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('select:not([aria-hidden=true]):visible, input[type=date]:visible, input[type=number]:visible').count(),0);}
 await page.clock.install();
 await go('/usage');await page.getByRole('link',{name:'账户算力余额 123.456',exact:true}).waitFor();
 await page.getByText('第 1–10 条，共 21 条',{exact:true}).waitFor();
 assert.equal(await page.getByRole('table').count(),1);assert.equal(await page.getByRole('combobox').count(),0);assert.equal(calls.length,0);
 await page.getByRole('button',{name:'下一页消费明细',exact:true}).click();await page.getByText('第 11–20 条，共 21 条',{exact:true}).waitFor();
 await page.getByRole('button',{name:'下一页消费明细',exact:true}).click();await page.getByText('第 21–21 条，共 21 条',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一页消费明细',exact:true}).isEnabled(),false);
 await page.getByRole('radio',{name:'近 30 天',exact:true}).click();await page.getByText('第 1–10 条，共 21 条',{exact:true}).waitFor();await page.getByRole('img',{name:/共 30 天/}).waitFor();
 assert.ok(accountCalls.some(u=>u.searchParams.get('days')==='30'));assert.ok(accountCalls.every(u=>!u.searchParams.has('credentialId')));
 await page.getByRole('button',{name:'2026-10-28，净消费 0.125 算力，2 次调用',exact:true}).focus();await page.getByRole('tooltip').waitFor();await page.keyboard.press('Escape');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本页',exact:true}).click();assert.equal(await(await download).failure(),null);
 accountFailure=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByText('测试账户服务暂不可用',{exact:false}).first().waitFor();await page.getByRole('link',{name:'账户算力余额 123.456，更新失败',exact:true}).waitFor();
 assert.equal(await page.getByRole('table').count(),1);accountFailure=false;accountBalance=99;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('link',{name:'账户算力余额 99',exact:true}).waitFor();
 // Virtual time verifies polling without a 30-second blocking wait. No paid endpoints are called.
 const beforeRefresh=accountCalls.length;accountBalance=98;await page.clock.runFor(31000);await page.getByRole('link',{name:'账户算力余额 98',exact:true}).waitFor();assert.ok(accountCalls.length>beforeRefresh);
 await page.getByRole('radio',{name:'近 7 天',exact:true}).click();await page.getByRole('img',{name:/共 7 天/}).waitFor();
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:900});await layout();await shot('usage-'+width);}
 await go('/settings');await page.getByRole('button',{name:'查询密钥信息',exact:true}).click();await page.getByText('测试查询密钥 / 17',{exact:true}).waitFor();assert.equal(await page.getByText('不限额 / 2.345 算力',{exact:true}).count(),1);
 await go('/history');const before=calls.length;await page.getByLabel('供应商任务号',{exact:true}).fill('123');assert.equal(calls.length,before);await page.getByRole('button',{name:'查询供应商任务',exact:true}).click();await page.getByText('尚未结束 · 可手动刷新',{exact:true}).waitFor();await page.getByText('未提供 / 未提供',{exact:true}).waitFor();taskFinal=true;await page.getByRole('button',{name:'查询供应商任务',exact:true}).click();await page.getByText('终态 · 费用以此为准',{exact:true}).waitFor();await page.getByLabel('文字结果',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'打开结果 2',exact:true}).getAttribute('href'),'https://example.com/result.png');assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:900});await layout();await shot('task-'+width);}
 await go('/models');const beforeModels=calls.length;await page.getByRole('button',{name:'查询模型目录',exact:true}).click();await page.getByText('Kimi Code',{exact:true}).waitFor();assert.equal(calls.length,beforeModels+1);await page.getByText('未开通',{exact:true}).waitFor();await page.getByLabel('直接查询模型',{exact:true}).fill('kimi/kimi-k2.7-code');await page.getByRole('button',{name:'查看能力与价格',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('测试暂停线路',{exact:true}).waitFor();await page.getByText('输入单价（算力 / 百万文本单元）',{exact:true}).first().waitFor();assert.equal(calls.at(-1).searchParams.has('status'),false);assert.equal(calls.at(-1).searchParams.get('model'),'kimi/kimi-k2.7-code');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByLabel('直接查询模型',{exact:true}).fill('tt-6.1-sol');await page.getByRole('button',{name:'查看能力与价格',exact:true}).click();await page.getByText('测试暂停线路',{exact:true}).waitFor();
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:900});await layout();await shot('pricing-'+width);}
 await page.getByRole('tab',{name:'功能与参数',exact:true}).click();await page.getByRole('heading',{name:'最大输出长度',exact:true}).waitFor();await page.getByRole('button',{name:'完整功能、端点与渠道约束',exact:true}).click();await page.getByText(/channel_constraints/).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await layout();assert.deepEqual(errors,[]);
 console.log('PASS: account-wide balance and consumption; chart/table; 7/30 days; pagination; CSV; stale errors/recovery; automatic 30-second refresh; no balance model selector; pending vs final task/token fields; slash model lookup; unavailable catalog and paused full pricing; complete rules; no native controls; 1280/1440/1920. Zero paid calls.');
}finally{if(browser)await browser.close();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill('SIGTERM');});fs.rmSync(dir,{recursive:true,force:true});}
