"""Real browser journey against the disposable application. Provider output is controlled.
Run through npm run test:research:e2e; never target a production data directory.
"""
import json
import os
import re
import time
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('RESEARCH_TEST_OUTPUT', 'output/research-flow')).resolve()
INFO = json.loads((OUT / 'fixture.json').read_text())
URL = INFO['url']
PRODUCT = INFO['productId']
CHROME = os.environ.get('RESEARCH_CHROME')
if not CHROME and Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome').exists():
    CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
checks, errors, console_errors = [], [], []
expect.set_options(timeout=20000)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': CHROME} if CHROME else {}))
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    context.tracing.start(screenshots=True, snapshots=True, sources=True)
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)

    def api(route):
        response = context.request.get(URL + '/api' + route)
        assert response.ok, (route, response.status)
        return response.json()

    def research():
        return api('/catalog/products/' + PRODUCT + '/research')

    def select(label, option):
        page.get_by_role('combobox', name=label, exact=True).click()
        page.get_by_role('option', name=option, exact=True).click()

    def mark(name):
        checks.append(name)
        print('PASS ' + name, flush=True)

    def wait_for_outputs():
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            attempts = [a for b in api('/snapshot')['batches'] for a in b['attempts']]
            if len(attempts) == 17 and all(a['status'] == 'completed' for a in attempts):
                return attempts
            page.wait_for_timeout(500)
        raise AssertionError('17 outputs did not complete')

    try:
        page.goto(URL + '/catalog/' + PRODUCT)
        page.wait_for_load_state('networkidle')
        page.get_by_role('tab', name='选品之神', exact=True).click()
        expect(page.get_by_role('heading', name='选品之神', exact=True)).to_be_visible()
        assert research()['draft']['value']['productImageIds'] == []
        assert research()['jobs'] == []
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT / '01-empty.png'))
        page.get_by_role('button', name='开始分析 · 查询费用', exact=True).click()
        expect(page.get_by_text('请先选择自有商品图片', exact=True)).to_be_visible()
        assert research()['jobs'] == []
        mark('空资料拒绝分析，不创建任务')

        page.get_by_role('button', name='添加自有商品图片', exact=True).click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_role('button', name='选择图片 1', exact=True).click()
        dialog.get_by_role('button', name=re.compile('使用所选图片')).click()
        page.get_by_role('button', name='添加一家同行', exact=True).click()
        peer = page.get_by_role('region', name='同行1图片上传区，支持粘贴图片', exact=True)
        peer.locator('input[type=file]').set_input_files(INFO['uploads'])
        expect(peer.locator('.promotion-material-tile')).to_have_count(3)
        # Save via the real quote action; cancelling must not submit an analysis.
        page.get_by_role('button', name='开始分析 · 查询费用', exact=True).click()
        expect(page.get_by_role('dialog', name='确认商品研究', exact=True)).to_be_visible()
        page.get_by_role('dialog').get_by_role('button', name='取消', exact=True).click()
        assert research()['jobs'] == []
        page.reload()
        expect(page.get_by_role('button', name='查看自有商品图片第1张', exact=True)).to_be_visible()
        expect(page.get_by_role('region', name='同行1图片上传区，支持粘贴图片', exact=True).locator('.promotion-material-tile')).to_have_count(3)
        mark('选择自有图、真实上传三张同行图、保存刷新、取消报价')

        page.get_by_role('button', name='开始分析 · 查询费用', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='确认开始', exact=True).click(click_count=2)
        page.wait_for_timeout(1000)
        page.reload()
        expect(page.get_by_role('button', name='立领外观', exact=True)).to_be_visible(timeout=65000)
        assert len([j for j in research()['jobs'] if j['kind'] == 'analysis']) == 1
        expect(page.get_by_role('button', name=re.compile('^防水声明'))).to_be_disabled()
        page.get_by_role('button', name='查看立领外观的依据', exact=True).click()
        expect(page.get_by_role('dialog', name='结论依据', exact=True)).to_contain_text('自有商品资料')
        page.get_by_role('dialog').get_by_role('button', name='关闭', exact=True).click()
        page.get_by_role('button', name='立领外观', exact=True).click()
        page.reload()
        expect(page.get_by_role('button', name='立领外观', exact=True)).to_have_attribute('aria-pressed', 'true')
        mark('分析双击去重、进行中刷新恢复、证据追溯、待核实标签禁用、选择记忆')

        page.get_by_role('button', name='编排三套创作方案', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='确认开始', exact=True).click()
        expect(page.locator('.research-plan-options button')).to_have_count(3, timeout=50000)
        expect(page.locator('.research-delivery-checks [role=checkbox][data-state=checked]')).to_have_count(0)
        expect(page.get_by_role('button', name='制作所选内容 · 查询报价', exact=True)).to_be_disabled()
        page.locator('.research-deliverable-preview').get_by_role('button', name=re.compile('商品套图')).click()
        expect(page.locator('.research-prompts p')).to_have_count(7)
        for name in ['商品套图', 'A+详情', '图文', '视频']:
            page.get_by_role('checkbox', name=name, exact=True).check()
        select('图片生成模型', next(m['name'] for m in api('/bootstrap')['models'] if m['id']=='tt-image'))
        select('视频生成模型', next(m['name'] for m in api('/bootstrap')['models'] if m['id']=='omni'))
        select('视频时长', '4秒')
        page.get_by_role('switch').check()
        page.reload()
        expect(page.get_by_role('combobox', name='视频时长', exact=True)).to_contain_text('4秒')
        expect(page.get_by_role('checkbox', name='视频', exact=True)).to_be_checked()
        mark('三套方案、七张提示词、交付默认不选、四类勾选和模型参数持久化')

        before = api('/snapshot')
        page.get_by_role('button', name='制作所选内容 · 查询报价', exact=True).click()
        expect(page.get_by_role('dialog', name='确认制作清单', exact=True)).to_be_visible()
        expect(page.locator('.research-quote-items > div')).to_have_count(4)
        page.get_by_role('dialog').get_by_role('button', name='取消', exact=True).click()
        assert api('/snapshot')['batches'] == before['batches'] == []
        mark('四类报价清单、取消制作不接单')

        for width in [1280, 1440, 1920]:
            page.set_viewport_size({'width': width, 'height': 1000})
            page.wait_for_timeout(300)
            page.locator('.research-main').evaluate('(e) => e.scrollTop=0')
            page.screenshot(timeout=60000, animations='disabled', path=str(OUT / ('02-plans-%s.png' % width)))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            footer = page.locator('.research-sidebar-footer').bounding_box()
            assert footer and footer['y'] >= 0 and footer['y'] + footer['height'] <= 1000, footer
        mark('1280／1440／1920 无页面横向溢出，固定操作区可见')
        page.locator('.research-main').evaluate('(e)=>e.scrollTop=e.scrollHeight')
        page.locator('.research-sidebar-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT/'02b-plans-config.png'))

        page.get_by_role('button', name='制作所选内容 · 查询报价', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='确认配置并生成', exact=True).click(click_count=2)
        expect(page.get_by_role('heading', name='制作执行清单', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='打开制作页', exact=True)).to_have_count(4)
        attempts = wait_for_outputs()
        mark('确认制作双击去重，7套图＋3详情＋6图文＋1视频全部保存')
        for index, batch_id in enumerate(dict.fromkeys(a['batchId'] for a in attempts)):
            with page.expect_download() as event:
                page.evaluate('(id) => { const a=document.createElement("a"); a.href="/api/batches/"+id+"/download"; document.body.appendChild(a); a.click(); a.remove(); }', batch_id)
            target = OUT / ('delivery-%s.zip' % index)
            event.value.save_as(str(target))
            with zipfile.ZipFile(target) as archive:
                assert 'task-snapshot.json' in archive.namelist()
                assert archive.testzip() is None
        page.reload()
        expect(page.get_by_role('heading', name='制作执行清单', exact=True)).to_be_visible()
        assert len(api('/snapshot')['ledger']) == 17
        mark('四批实际浏览器下载、ZIP完整性、账本和刷新后的制作记录')

        # A genuine GET failure is injected at the network boundary; last rendered results must remain.
        pattern = '**/api/catalog/products/' + PRODUCT + '/research'
        page.evaluate('''() => { window.__researchManualRecovery=false; document.addEventListener('click', e => { if(e.target.closest('button')?.textContent.includes('重试更新')) window.__researchManualRecovery=true; }, true); }''')
        def research_fault(route):
            if page.evaluate('window.__researchManualRecovery === true'):
                route.continue_()
            else:
                route.fulfill(status=503, content_type='application/json', body='{"message":"隔离网络失败"}')
        page.route(pattern, research_fault)
        expect(page.get_by_role('button', name='重试更新', exact=True)).to_be_visible(timeout=20000)
        expect(page.locator('.research-plan-options button')).to_have_count(3)
        page.get_by_role('button', name='重试更新', exact=True).click()
        expect(page.get_by_role('button', name='重试更新', exact=True)).to_have_count(0)
        page.unroute(pattern)
        mark('轮询失败保留结果并可手动恢复')

        page.get_by_role('tab', name='深度分析', exact=True).click()
        expect(page.get_by_text('研究资料已调整', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='制作所选内容 · 查询报价', exact=True)).to_be_disabled()
        page.get_by_role('textbox', name='抖音素材链接', exact=True).fill('https://www.douyin.com/video/123456789')
        page.get_by_role('button', name='添加到采集队列', exact=True).click()
        expect(page.get_by_text('等待采集', exact=True)).to_be_visible()
        page.get_by_role('button', name='获取配对码', exact=True).click()
        expect(page.locator('.research-pair-code')).to_contain_text('五分钟内')
        with page.expect_download() as event:
            page.get_by_role('link', name='下载插件', exact=True).click()
        event.value.save_as(str(OUT / 'douyin-research.zip'))
        with zipfile.ZipFile(OUT / 'douyin-research.zip') as archive:
            assert any(n.endswith('/manifest.json') for n in archive.namelist())
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT / '03-deep-queue.png'))
        mark('资料过期阻止制作、深度采集队列、配对码、插件下载')

        page.get_by_role('tab', name='快速分析', exact=True).click()
        page.get_by_role('button', name='打开制作页', exact=True).first.click()
        expect(page.get_by_role('heading', name='商品套图', exact=True)).to_be_visible()
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT / '04-workshop.png'))
        page.get_by_role('link', name='全部任务', exact=True).click()
        expect(page.get_by_role('heading', name='全部任务', exact=True)).to_be_visible()
        expect(page.locator('.history-product video')).to_have_count(1)
        page.wait_for_function('Array.from(document.querySelectorAll(".history-product img")).every(e=>e.complete && e.naturalWidth>0) && Array.from(document.querySelectorAll(".history-product video")).every(e=>e.readyState>=1 && !e.error)')
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT / '05-history.png'))
        mark('选品之神交接实际制作页与全部任务')
        assert not errors, errors
    except Exception:
        page.screenshot(timeout=60000, animations='disabled', path=str(OUT / 'failure.png'), full_page=True)
        (OUT / 'failure-dom.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        (OUT / 'browser.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'consoleErrors': console_errors, 'provider': 'controlled; no live paid calls'}, ensure_ascii=False, indent=2))
        context.tracing.stop(path=str(OUT / 'trace.zip'))
        browser.close()
