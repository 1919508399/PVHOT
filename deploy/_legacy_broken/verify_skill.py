import time
from playwright.sync_api import sync_playwright

BASE =
ADMIN = BASE +
def log(s): print(s)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    page.on('pageerror', lambda e: print('[PAGEERR]', str(e)[:200]))

    # 1. 登录后台
    page.goto(ADMIN, wait_until='domcontentloaded')
    page.wait_for_selector('#passInput', timeout=10000)
    page.fill('#passInput', 'pvhot2026')
    page.click('#loginBtn')
    page.wait_for_selector('.tab', timeout=10000)

    # 2. 进内容管理 → agent 区块
    page.click('.tab[data-tab="content"]')
    page.wait_for_selector('.text-block[data-key="agent"]', timeout=10000)
    # 等 fillTextPanels 异步填充完成（不再只等 DOM 出现）
    page.wait_for_function(
        "document.querySelector('.text-block[data-key=\"agent\"] textarea[data-field=\"skill_md\"]').value.indexOf('name: pvhot') >= 0",
        timeout=8000)
    md = page.input_value('.text-block[data-key="agent"] textarea[data-field="skill_md"]')
    log('[1] agent 区块 skill_md 长度=' + str(len(md)))
    assert 'name: pvhot' in md,
    # 3. 加唯一标记并保存
    ts = str(int(time.time()))
    mark = '# E2E_MARK_' + ts
    assert mark not in md,
    new_md = md.strip() + '\n' + mark +
    page.fill('.text-block[data-key="agent"] textarea[data-field="skill_md"]', new_md)
    page.click('#txtSaveAll')
    page.wait_for_timeout(2500)

    # 4. 验证线上 SKILL.md 已更新
    page2 = ctx.new_page()
    page2.goto(BASE + '/pvhot-skill/SKILL.md', wait_until='domcontentloaded')
    page2.wait_for_timeout(1500)
    txt = page2.text_content('body')
    log('[2] 线上 SKILL.md 含标记=' + str(mark in txt))
    assert mark in txt,
    log('  ✓ 后台编辑 → 线上 SKILL.md 同步成功')
    log('[3] 浏览器查看前 80 字: ' + txt[:80].replace('\n', ' '))
    assert '光伏' in txt,
    # 5. 还原（去掉标记）
    page.fill('.text-block[data-key="agent"] textarea[data-field="skill_md"]', md.strip())
    page.click('#txtSaveAll')
    page.wait_for_timeout(2500)
    page2.goto(BASE + '/pvhot-skill/SKILL.md?_=' + str(int(time.time())), wait_until='domcontentloaded')
    page2.wait_for_timeout(1200)
    txt2 = page2.text_content('body')
    assert mark not in txt2,
    log('[4] ✓ 已还原（标记移除）')

    # 6. 前台 /agent 页下载按钮
    page3 = ctx.new_page()
    page3.goto(BASE + '/?_=' + str(int(time.time())), wait_until='networkidle')
    page3.click('.sb-item[data-view="agent"]')
    page3.wait_for_selector('.agt-linkbtns', timeout=10000)
    html = page3.inner_html('.agt-linkbtns')
    has_md = '下载 SKILL.md' in html
    has_sh = '下载 install.sh' in html
    log('[5] /agent 页下载按钮: 下载SKILL.md=' + str(has_md) + ' / 下载install.sh=' + str(has_sh))
    assert has_md and has_sh,
    log('  ✓ 前台 /agent 页含下载按钮')

    b.close()
print('=== ALL SKILL E2E PASSED ===')
