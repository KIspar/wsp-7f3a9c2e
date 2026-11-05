"""Load the real unpacked extension in a disposable Chrome profile.
The Douyin document below is an intercepted synthetic DOM, not a live platform test.
"""
import json
import os
import tempfile
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT=Path(os.environ.get('RESEARCH_TEST_OUTPUT','output/research-flow')).resolve()
INFO=json.loads((OUT/'fixture.json').read_text())
CHROME=os.environ.get('RESEARCH_CHROME')
if not CHROME and Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome').exists():
    CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
checks=[]
profile=tempfile.mkdtemp(prefix='research-extension-chrome-')
try:
    with sync_playwright() as p:
        context=p.chromium.launch_persistent_context(profile,headless=True,ignore_default_args=['--disable-extensions'],args=['--enable-unsafe-extension-debugging'],**({'executable_path':CHROME} if CHROME else {}))
        try:
            cdp=context.browser.new_browser_cdp_session()
            extension=cdp.send('Extensions.loadUnpacked',{'path':str(Path('extensions/douyin-research').resolve())})['id']
            popup=context.new_page()
            popup.goto('chrome-extension://'+extension+'/popup.html')
            popup.wait_for_load_state('networkidle')
            request=context.request
            token=request.get(INFO['url']+'/api/bootstrap').json()['token']
            code=request.post(INFO['url']+'/api/research-extension-code',headers={'x-studio-token':token},data={}).json()['code']
            def message(payload):
                return popup.evaluate('(m)=>new Promise(r=>chrome.runtime.sendMessage(m,r))',payload)
            paired=message({'action':'pair','origin':INFO['url'],'code':code})
            assert paired=={'ok':True}, paired
            checks.append('真正加载扩展并通过后台Service Worker完成配对')
            jobs=message({'action':'jobs'})
            assert 'error' not in jobs, jobs
            checks.append('后台GET队列通过插件身份校验')
            if not jobs['jobs']:
                root=INFO['url']+'/api/catalog/products/'+INFO['productId']+'/research'
                draft=request.get(root).json()['draft']
                draft['value']['method']='deep'
                if not draft['value']['groups']:
                    draft['value']['groups']=[{'id':'extension-browser-peer','imageIds':[],'collectionIds':[]}]
                request.put(root+'/draft',headers={'x-studio-token':token},data={'revision':draft['revision'],'value':draft['value']})
                request.post(root+'/collections',headers={'x-studio-token':token},data={'url':'https://www.douyin.com/video/123456789','groupId':draft['value']['groups'][0]['id'],'idempotencyKey':'extension-browser-fixture'})
                jobs=message({'action':'jobs'})
            assert jobs['jobs'], jobs
            job=jobs['jobs'][0]
            target=context.new_page()
            target.route('https://www.douyin.com/**',lambda route:route.fulfill(status=200,content_type='text/html; charset=utf-8',body='''<!doctype html><a href="/user/self">我的主页</a><main data-e2e="note-detail"><h1>隔离DOM采集测试</h1><div data-e2e="note-desc">完整原始文案，未采集真实平台数据</div><div data-e2e="comment-list"><article data-e2e="comment-item" data-comment-id="p1"><div data-e2e="comment-content">尺码怎么选？</div><section data-e2e="comment-reply-item" data-comment-id="r1"><div data-e2e="comment-content">这是二级回复</div><section data-e2e="comment-reply-item" data-comment-id="third"><div data-e2e="comment-content">不应取得第三级</div></section></section></article>没有更多评论</div></main>'''))
            target.goto(job['url'])
            target.wait_for_load_state('networkidle')
            # Find the real tab id with the extension tabs API; the profile contains no user tabs.
            tab=popup.evaluate('(url)=>chrome.tabs.query({}).then(t=>t.find(v=>v.url===url))',job['url'])
            assert tab, 'Extension cannot see fixture tab'
            login=message({'action':'check','tabId':tab['id']})
            assert login.get('login')=='ready', login
            start=message({'action':'start','jobId':job['id'],'tabId':tab['id']})
            assert start.get('started'), start
            result=None
            for _ in range(60):
                popup.wait_for_timeout(250)
                result=request.get(INFO['url']+'/api/catalog/products/'+INFO['productId']+'/research').json()['collections'][0]
                if result['status'] in ['partial','completed','failed','paused','waiting-login']:
                    break
            assert result['status']=='partial', result
            assert len(result['comments'])==2 and result['comments'][1]['parentId']=='p1', result
            assert result['text']=='完整原始文案，未采集真实平台数据', result
            assert result['warnings'], result
            checks.append('实际后台注入采集脚本、一级二级评论、停止条件与缺失媒体警告落入本地数据库（受控DOM）')
            # Read the actual job after completion and revoke the extension.
            request.post(INFO['url']+'/api/research-extension-revoke',headers={'x-studio-token':token},data={'extensionId':extension})
            assert 'error' in message({'action':'jobs'})
            checks.append('实际浏览器撤销后拒绝读取队列')
            message({'action':'start','jobId':job['id'],'tabId':tab['id']})
            popup.wait_for_timeout(500)
            fresh=request.post(INFO['url']+'/api/research-extension-code',headers={'x-studio-token':token},data={}).json()['code']
            assert message({'action':'pair','origin':INFO['url'],'code':fresh})=={'ok':True}
            assert message({'action':'jobs'})['active']==[], '读取任务失败后采集锁没有释放'
            checks.append('任务读取失败释放采集锁，重新配对可恢复')
            print('PASS extension: '+'；'.join(checks),flush=True)
        finally:
            (OUT/'extension-browser.json').write_text(json.dumps({'checks':checks,'scope':'Real extension + local API + intercepted synthetic Douyin DOM. Live login/selectors/media remain unverified.'},ensure_ascii=False,indent=2))
            context.close()
finally:
    shutil.rmtree(profile,ignore_errors=True)
