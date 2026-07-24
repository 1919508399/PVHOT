#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.2 E2E 验证：内容管理精简 + 二维码上传 + 后台入口新窗口
每个 step 用独立 context 防止 JS 状态污染
"""
import os, sys, time, json
from playwright.sync_api import sync_playwright

BASE =
ADMIN = BASE +
TS = str(int(time.time() * 1000))
HOME_URL = BASE + '/?_=' + TS

def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

# 1x1 透明 PNG
TEST_PNG = (
)

def fresh_ctx(p, **kwargs):
    return p.chromium.launch(headless=True).new_context(viewport={'width':1366,'height':850}, **kwargs)

def upload_qrcode(p, page, data_b64):
    """用 evaluate 注入 base64 触发后端 POST"""
    return page.evaluate("""(async (b64) => {
        const r = await fetch('/admin/api/qrcode', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ data: 'data:image/png;base64,' + b64, filename: 'test.png', type: 'image/png' })
        });
        return await r.json();
    })""", data_b64)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ====== Step 1-4: 后台登录 + 内容管理精简验证 ======
        log('1-4) 登录后台验证内容管理')
        ctx1 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx1.new_page()
        page.goto(ADMIN, wait_until='domcontentloaded')
        page.wait_for_selector('#passInput', timeout=10000)
        page.fill('#passInput', 'pvhot2026')
        page.click('#loginBtn')
        page.wait_for_selector('.tab', timeout=10000)
        page.click('.tab[data-tab="content"]')
        page.wait_for_selector('.text-block[data-key="about"]', timeout=10000)
        time.sleep(0.5)

        blocks = page.locator('#panelContent .text-block')
        keys = [b.get_attribute('data-key') for b in blocks.all()]
        log('   内容管理 block: ' + str(keys))
        assert keys == ['about', 'qrcode'], '❌ 应是 [about, qrcode]，实际 ' + str(keys)
        log('   ✓ 只剩 about + qrcode')

        about_block = page.locator('.text-block[data-key="about"]')
        about_fields = [ta.get_attribute('data-field') for ta in about_block.locator('textarea').all()]
        log('   about 字段: ' + str(about_fields))
        for need in ['eyebrow', 'title_html', 'sub', 'poem', 'fineprint_html']:
            assert need in about_fields, '❌ about 缺 ' + need
        log('   ✓ 5 个字段齐全')
        ctx1.close()

        # ====== Step 5: 后台入口新窗口 ======
        log('5) 验证侧栏后台按钮 target=_blank')
        ctx2 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx2.new_page()
        page.goto(HOME_URL, wait_until='networkidle')
        page.wait_for_selector('.sb-item[data-view="about"]', timeout=10000)
        target = page.get_attribute('.sb-foot a[href="/admin/"]', 'target')
        rel = page.get_attribute('.sb-foot a[href="/admin/"]', 'rel')
        log('   target=' + str(target) + ' rel=' + str(rel))
        assert target == '_blank',
        assert 'noopener' in (rel or ''),
        log('   ✓ 侧栏后台按钮新窗口打开')
        ctx2.close()

        # ====== Step 6: 关于页未上传时二维码区隐藏 ======
        log('6) 关于页：未上传时二维码区应隐藏')
        ctx3 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx3.new_page()
        page.goto(HOME_URL, wait_until='networkidle')
        page.wait_for_selector('.sb-item[data-view="about"]', timeout=10000)
        # 等 useData 渲染
        page.wait_for_function("document.getElementById('viewBody').innerHTML.length > 100", timeout=10000)
        page.click('.sb-item[data-view="about"]')
        # 等 #abtQrBlock 出现在 DOM（即使 display:none）
        page.wait_for_selector('#abtQrBlock', state='attached', timeout=8000)
        page.wait_for_timeout(1200)  # 等 fetch /admin/api/qrcode
        display = page.evaluate("document.getElementById('abtQrBlock').style.display")
        log('   abtQrBlock display=' + str(display))
        assert display == 'none',
        log('   ✓ 未上传时二维码区隐藏')
        ctx3.close()

        # ====== Step 7: 后台上传测试二维码 ======
        log('7) 后台上传测试二维码')
        ctx4 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx4.new_page()
        page.goto(ADMIN, wait_until='domcontentloaded')
        page.wait_for_selector('#passInput', timeout=10000)
        page.fill('#passInput', 'pvhot2026')
        page.click('#loginBtn')
        page.wait_for_selector('.tab', timeout=10000)
        page.click('.tab[data-tab="content"]')
        page.wait_for_selector('#qrFile', state='attached', timeout=10000)

        ret = upload_qrcode(p, page, TEST_PNG)
        log('   上传返回: ' + json.dumps(ret, ensure_ascii=False))
        assert ret.get('ok') is True,
        log('   ✓ 上传成功 size=' + str(ret.get('size')))

        # 刷新看预览
        page.reload()
        page.wait_for_selector('.tab', timeout=10000)
        page.click('.tab[data-tab="content"]')
        page.wait_for_selector('#qrPreview img', timeout=10000)
        meta = page.text_content('#qrMeta')
        log('   qrMeta=' + str(meta))
        assert '已上传' in (meta or ''),
        log('   ✓ 后台预览显示已上传')
        ctx4.close()

        # ====== Step 8: /uploads/qrcode.png 公开 200 ======
        log('8) 验证 /uploads/qrcode.png 200')
        ctx5 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx5.new_page()
        page.goto(HOME_URL, wait_until='networkidle')
        page.wait_for_selector('.sb-item[data-view="about"]', timeout=10000)
        r = page.request.get(BASE + '/uploads/qrcode.png')
        log('   状态: ' + str(r.status) + ' body_len=' + str(len(r.body())))
        assert r.status == 200,
        log('   ✓ /uploads/qrcode.png 200')

        # ====== Step 9: 关于页前台显示二维码 ======
        log('9) 关于页前台显示二维码')
        page.wait_for_function("document.getElementById('viewBody').innerHTML.length > 100", timeout=10000)
        page.click('.sb-item[data-view="about"]')
        page.wait_for_selector('#abtQrBlock', state='attached', timeout=8000)
        page.wait_for_function("document.getElementById('abtQrImg').src.indexOf('qrcode.png') >= 0", timeout=5000)
        display = page.evaluate("document.getElementById('abtQrBlock').style.display")
        img_src = page.get_attribute('#abtQrImg', 'src')
        log('   display=' + str(display) + ' src=' + str(img_src)[:80])
        assert display == '',
        assert 'qrcode.png' in (img_src or ''),
        log('   ✓ 关于页二维码区显示')
        ctx5.close()

        # ====== Step 10: 后台删除二维码 ======
        log('10) 后台删除二维码')
        ctx6 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx6.new_page()
        page.goto(ADMIN, wait_until='domcontentloaded')
        page.wait_for_selector('#passInput', timeout=10000)
        page.fill('#passInput', 'pvhot2026')
        page.click('#loginBtn')
        page.wait_for_selector('.tab', timeout=10000)
        page.click('.tab[data-tab="content"]')
        page.wait_for_selector('#qrDel', state='attached', timeout=10000)
        page.on('dialog', lambda d: d.accept())
        page.click('#qrDel')
        page.wait_for_function("document.getElementById('qrMeta').textContent.indexOf('暂无') >= 0", timeout=5000)
        log('   ✓ 删除成功')
        r = page.request.get(BASE + '/uploads/qrcode.png')
        log('   删除后 /uploads/qrcode.png: ' + str(r.status))
        assert r.status == 404,
        ctx6.close()

        # ====== Step 11: 关于页前台自动隐藏 ======
        log('11) 删除后关于页前台二维码区自动隐藏')
        ctx7 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx7.new_page()
        page.goto(HOME_URL, wait_until='networkidle')
        page.wait_for_selector('.sb-item[data-view="about"]', timeout=10000)
        page.wait_for_function("document.getElementById('viewBody').innerHTML.length > 100", timeout=10000)
        page.click('.sb-item[data-view="about"]')
        page.wait_for_selector('#abtQrBlock', state='attached', timeout=8000)
        page.wait_for_timeout(1000)
        display = page.evaluate("document.getElementById('abtQrBlock').style.display")
        log('   display=' + str(display))
        assert display == 'none',
        log('   ✓ 前台自动隐藏')
        ctx7.close()

        # ====== Step 12: about 字段保存 ======
        log('12) 验证 about 字段保存→前台生效')
        ctx8 = browser.new_context(viewport={'width':1366,'height':850})
        page = ctx8.new_page()
        page.goto(ADMIN, wait_until='domcontentloaded')
        page.wait_for_selector('#passInput', timeout=10000)
        page.fill('#passInput', 'pvhot2026')
        page.click('#loginBtn')
        page.wait_for_selector('.tab', timeout=10000)
        page.click('.tab[data-tab="content"]')
        page.wait_for_selector('.text-block[data-key="about"]', timeout=10000)

        sub_textarea = page.locator('.text-block[data-key="about"] [data-field="sub"]')
        original = sub_textarea.input_value()
        new_sub = original +
        sub_textarea.fill(new_sub)
        page.click('#txtSaveAll')
        page.wait_for_timeout(1500)

        # 验证前台
        ctx9 = browser.new_context(viewport={'width':1366,'height':850})
        page2 = ctx9.new_page()
        page2.goto(HOME_URL, wait_until='networkidle')
        page2.wait_for_selector('.sb-item[data-view="about"]', timeout=10000)
        page2.wait_for_function("document.getElementById('viewBody').innerHTML.length > 100", timeout=10000)
        page2.click('.sb-item[data-view="about"]')
        page2.wait_for_selector('.abt-sub', timeout=5000)
        sub_text = page2.text_content('.abt-sub')
        log('   前台 sub=' + str(sub_text))
        assert '[v18.2测试]' in (sub_text or ''),
        log('   ✓ about 字段保存→前台生效')
        ctx9.close()

        # 还原
        sub_textarea.fill(original)
        page.click('#txtSaveAll')
        page.wait_for_timeout(1500)
        log('   ✓ 还原原始内容')
        ctx8.close()

        browser.close()
        log('=== ALL E2E PASSED ===')

if __name__ == '__main__':
    try:
        run()
    except AssertionError as e:
        log('❌ E2E 失败: ' + str(e))
        sys.exit(1)
    except Exception as e:
        log('❌ E2E 异常: ' + str(e))
        import traceback; traceback.print_exc()
        sys.exit(1)
