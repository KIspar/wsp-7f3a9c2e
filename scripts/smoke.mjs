import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-browser-'));
let server;
let base=process.env.STUDIO_WEB;
if(!base){
 server=spawn(process.execPath,['--import','tsx','scripts/fixture-server.ts'],{env:{...process.env,PORT:'0',STUDIO_DATA:dataDir},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Test server startup timeout')),15000);server.stdout.on('data',chunk=>{const url=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timeout);resolve(url);}});server.once('exit',code=>{clearTimeout(timeout);reject(new Error('Test server exited: '+code));});});
}
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('Native dialog: '+dialog.type());await dialog.dismiss();});

fs.mkdirSync('output/playwright',{recursive:true});
async function navigate(path){await page.goto(base+path);await page.locator('.management-heading, .workspace-heading, .usage-page-heading').waitFor();assert.equal(await page.locator('input[type=date],input[type=time],input[type=datetime-local],input[type=number],input[type=range],video[controls],select:not([aria-hidden=true]),input[type=checkbox]:not([aria-hidden=true])').count(),0,'No native visible widgets');}
async function select(label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
async function complete(){await page.locator('.status-completed').first().waitFor({timeout:20000});await page.waitForFunction(()=>!document.querySelector('.status-generating,.status-saving,.status-queued'),{timeout:20000});}
async function submit(){await page.getByRole('button',{name:/确认发送/}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:/确认接单/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
try{
 await navigate('/studio/image-generate');
 await select('画面比例','3:2');const ratio=page.getByRole('combobox',{name:'画面比例',exact:true});await ratio.focus();await ratio.press('ArrowDown');await page.getByRole('option',{name:'3:4',exact:true}).press('Home');await page.keyboard.press('Enter');assert.match(await ratio.innerText(),/3:4/);
 await select('输出分辨率','2K');await page.getByRole('button',{name:'参数矩阵',exact:true}).click();
 for(const [label,options,selected]of [['模型版本',['标准版','增强版'],'增强版'],['质量档位',['自动','低','中','高','超高','极致'],'高'],['背景模式',['不透明背景','透明背景','自动'],'自动']]){
  await page.getByRole('combobox',{name:label,exact:true}).click();assert.deepEqual(await page.getByRole('option').allTextContents(),options);await page.getByRole('option',{name:selected,exact:true}).click();
 }
 await page.getByRole('dialog').screenshot({path:'output/playwright/custom-parameters.png'});await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('产品图片，0 张').click();
 await page.getByLabel('上传产品图片',{exact:true}).setInputFiles('public/examples/10-1.jpg');await page.getByLabel('预览产品图片 1',{exact:true}).waitFor();await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('创作要求',{exact:true}).fill('浏览器验收：男装秋冬商品图，保留商品质感。');
 await page.getByRole('spinbutton',{name:'生成数量',exact:true}).fill('2');
 await page.waitForTimeout(900);await page.reload();await page.getByLabel('创作要求',{exact:true}).waitFor();assert.match(await page.getByLabel('创作要求',{exact:true}).inputValue(),/浏览器验收/);
 const saved=(await(await fetch(base+'/api/bootstrap')).json()).drafts.find(row=>row.skillId==='image-generate').value.parameters;assert.deepEqual({version:saved.version,quality:saved.quality,background:saved.background},{version:'sunburst',quality:'high',background:'auto'},'Chinese labels preserve API values');
 await submit();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('spinbutton',{name:'生成数量',exact:true}).inputValue(),'1');await complete();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'output/playwright/image-results.png',fullPage:true});
 await page.getByRole('button',{name:'按日期筛选',exact:true}).click();await page.getByRole('dialog',{name:'选择筛选日期'}).screenshot({path:'output/playwright/custom-calendar.png'});await select('选择年份','2024 年');await select('选择月份','2 月');await page.getByRole('button',{name:'2024-02-29',exact:true}).click();assert.match(await page.getByRole('button',{name:'按日期筛选'}).innerText(),/2024 \/ 02 \/ 29/);await page.getByRole('button',{name:'按日期筛选'}).click();await page.getByRole('button',{name:'清除日期',exact:true}).click();
 await page.reload();await page.locator('.status-completed').first().waitFor();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'');
 await page.getByLabel('提示词 1',{exact:true}).first().click();assert.match(await page.getByLabel('完整提示词').inputValue(),/浏览器验收/);await page.getByRole('button',{name:'复制',exact:true}).click();await page.keyboard.press('Escape');
 const count=await page.locator('.attempt-tile').count();await page.getByRole('button',{name:'重新生成 1',exact:true}).first().click();await page.waitForFunction(n=>document.querySelectorAll('.attempt-tile').length>n,count);await complete();assert.equal(await page.locator('.attempt-tile').count(),count+1);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'ZIP',exact:true}).first().click();const download=await downloadEvent;assert.equal(await download.failure(),null);
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`output/playwright/image-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}: horizontal overflow`);const overlaps=await page.locator('.composer-footer').evaluate(el=>{const a=el.querySelector('.composer-controls').getBoundingClientRect(),b=el.querySelector('.composer-submit').getBoundingClientRect();return a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});assert.equal(overlaps,false,`${width}: composer controls overlap`);}
 await page.setViewportSize({width:1440,height:1000});
 for(const id of ['model-outfit','scene-recreate','video-generate']){
  await navigate('/studio/'+id);await page.getByRole('button',{name:'载入示例到草稿'}).click();await submit();await complete();assert.equal(await page.getByLabel('创作要求',{exact:true}).inputValue(),'');if(id==='video-generate'){await page.getByRole('button',{name:/预览成品/}).first().click();await page.locator('.media-viewer video').waitFor();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'output/playwright/video-preview.png'});await page.keyboard.press('Escape');}
 }
 await navigate('/studio/detail-design');await page.getByRole('button',{name:'载入示例到草稿'}).click();await page.getByRole('button',{name:'添加一屏',exact:true}).click();await page.getByRole('spinbutton',{name:'生成组数',exact:true}).fill('2');await page.getByRole('button',{name:'预览生成',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.plan-item').count(),4);await page.getByRole('button',{name:/确认接单 4 项/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await complete();assert.equal(await page.locator('.detail-result-group').count(),2);await page.screenshot({path:'output/playwright/detail-design.png',fullPage:true});
 await page.getByRole('button',{name:'排版',exact:true}).first().click();await page.getByRole('button',{name:'保存排版',exact:true}).waitFor();await page.getByRole('button',{name:'排版下移第1项',exact:true}).click();await page.getByRole('button',{name:'保存排版',exact:true}).click();await page.getByText('排版已保存',{exact:true}).waitFor();const longEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载长图',exact:true}).click();const long=await longEvent;assert.equal(await long.failure(),null);assert.match(long.suggestedFilename(),/\.png$/);await page.screenshot({path:'output/playwright/long-image-layout.png'});await page.keyboard.press('Escape');
 await navigate('/studio/image-edit');await page.getByRole('button',{name:'载入示例到草稿'}).click();await page.getByRole('spinbutton',{name:'每图版本数',exact:true}).fill('2');await submit();await complete();assert.equal(await page.locator('.attempt-tile').count(),4);await page.screenshot({path:'output/playwright/image-edit.png',fullPage:true});
 await navigate('/studio/benchmark-agent');assert.equal(await page.getByTestId('composer').count(),0);await page.getByRole('button',{name:'载入示例素材'}).click();
 await page.getByRole('button',{name:'单独生成白底图'}).click();await page.getByRole('button',{name:/确认接单/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await select('商品参考来源','使用白底任务结果');await page.getByRole('combobox',{name:'指定白底任务',exact:true}).click();await page.getByRole('option').first().click();
 await page.getByRole('checkbox',{name:'工作台勾选目标 4',exact:true}).uncheck();await page.getByRole('button',{name:/一键替换 3 项/}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.plan-item').count(),3);await page.getByRole('button',{name:/确认接单 3 项/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await complete();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'output/playwright/agent-results.png',fullPage:true});
 await page.getByLabel('编辑目标 1',{exact:true}).click();await page.getByLabel('本图提示词覆盖').fill('逐图覆盖验收：仅替换外套。');await page.getByRole('button',{name:'保存到草稿'}).click();assert.match(await page.locator('.agent-binding').first().innerText(),/逐图覆盖验收/);
 await navigate('/models');assert.equal(await page.getByLabel('每次生成参考点数').count(),0);await page.getByRole('button',{name:'保存配置',exact:true}).first().click();await page.getByText('模型设置已保存',{exact:true}).waitFor();await page.reload();await page.getByText('生成报价由接口按模型、参数及数量自动计算，无需手工配置点数。',{exact:true}).first().waitFor();
 await navigate('/skills');await page.getByRole('button',{name:'校验技能',exact:true}).click();await page.getByText('技能格式校验通过',{exact:true}).waitFor();
 const editor=page.getByLabel('技能源文件');const before=await editor.inputValue();await editor.fill(before+'\n编辑保留测试');await page.locator('.skill-list button').nth(1).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.match(await editor.inputValue(),/编辑保留测试/);await page.locator('.skill-list button').nth(1).click();await page.getByRole('button',{name:'放弃并切换',exact:true}).click();assert.equal((await editor.inputValue()).includes('编辑保留测试'),false);
 for(const path of ['/history','/usage','/skills','/models','/settings']){await navigate(path);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`output/playwright/${path.slice(1)}.png`,fullPage:true});}
 await page.getByLabel('图片生成并发上限',{exact:true}).fill('4');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByText('设置已保存',{exact:true}).waitFor();await page.reload();await page.getByLabel('图片生成并发上限',{exact:true}).waitFor();assert.equal(await page.getByLabel('图片生成并发上限',{exact:true}).inputValue(),'4');await page.getByLabel('图片生成并发上限',{exact:true}).fill('20');await page.getByRole('button',{name:'保存设置',exact:true}).click();
 const backupEvent=page.waitForEvent('download');await page.getByRole('link',{name:'导出完整备份'}).click();const backup=await backupEvent;assert.equal(await backup.failure(),null);
 assert.deepEqual(errors,[]);console.log('PASS: seven skills, detail groups, stable edit references, saved layouts and PNG export, upload, persisted drafts/reset, model settings, skill validation, custom Select/Calendar/Checkbox/number inputs, regeneration, ZIP/backup, white dependencies, target overrides, management routes, 1280/1440/1920 layout, zero browser errors.');
}finally{await browser.close();if(server){await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});}fs.rmSync(dataDir,{recursive:true,force:true});}
