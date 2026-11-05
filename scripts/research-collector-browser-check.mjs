import fs from 'node:fs';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.RESEARCH_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage();
const core=fs.readFileSync('extensions/douyin-research/collector-core.js','utf8'),collector=fs.readFileSync('extensions/douyin-research/content.js','utf8');
try{
 await page.setContent('<main><div data-e2e="login-dialog">扫码登录</div></main>');await page.addScriptTag({content:core});let state=await page.evaluate(collector);if(state.login!=='waiting-login')throw Error('登录弹窗未阻止采集');
 await page.setContent(`<a href="/user/self">我的主页</a><main data-e2e="note-detail"><h1>隔离DOM验收样例</h1><div data-e2e="note-desc">原始内容文案</div><div data-e2e="comment-list"><article data-e2e="comment-item" data-comment-id="p1"><div data-e2e="comment-content">一级问题</div><section data-e2e="comment-reply-item" data-comment-id="r1"><div data-e2e="comment-content">二级回复</div><section data-e2e="comment-reply-item" data-comment-id="r2"><div data-e2e="comment-content">不采集的第三级</div></section></section></article>没有更多评论</div></main>`);
 state=await page.evaluate(collector);if(state.login!=='ready'||state.comments.length!==2||state.comments[1].parentId!=='p1'||!state.atBottom)throw Error('登录、二级评论或到底判定失败：'+JSON.stringify(state));
 const result={scope:'真实Chrome执行采集脚本，隔离DOM样例；不代表抖音线上选择器验收',checks:['登录弹窗阻止采集','明确账号标记才允许','一级/二级正确归属','不递归第三级','评论到底识别'],extensionInstall:'当前系统Chrome忽略加载未打包扩展参数；扩展安装与真实已登录抖音采集未验收'};
 fs.writeFileSync('output/research-acceptance/collector-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
