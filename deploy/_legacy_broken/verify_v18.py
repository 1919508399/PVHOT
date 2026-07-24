"""v18 E2E 验证（修正版：click .first() + 等首页渲染完）"""
from playwright.sync_api import sync_playwright
import time, os

OUT = r"C:\Users\HUASUN\Desktop\新闻\deploy\verify_v18"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    base =
    # ============ 前台 4 视图 ============
    print('=== 1. 前台 4 视图 ===')
    page.goto(base + '/?v=' + str(time.time()), wait_until='domcontentloaded', timeout=20000)
    # 等首页真正渲染（viewBody 出现 .top5 或 .feed）
    page.wait_for_selector('#viewBody .top5, #viewBody .feed', timeout=20000)
    page.wait_for_timeout(800)

    # about
    page.locator('a.sb-item[data-view="about"]').first.click()
    page.wait_for_selector('#viewBody .abt-h1', timeout=8000)
    txt = page.locator('.abt-h1').first.inner_text()
    print('about h1:', txt)
    assert '清洁能源蛋黄派' in txt,
    assert page.locator('.abt-qrframe').count() == 1,
    page.screenshot(path=f'{OUT}/01_about.png')

    # agent
    page.locator('a.sb-item[data-view="agent"]').first.click()
    page.wait_for_selector('#viewBody .agt-note', timeout=8000)
    note = page.locator('.agt-note').first.inner_text()
    print('agent note:', note[:60])
    assert 'PV HOT Skill' in note,
    page.screenshot(path=f'{OUT}/02_agent.png')

    # changelog
    page.locator('a.sb-item[data-view="changelog"]').first.click()
    page.wait_for_selector('#viewBody .info-list li', timeout=8000)
    items = page.locator('.info-list li').count()
    print('changelog items:', items)
    assert items >= 3,
    page.screenshot(path=f'{OUT}/03_changelog.png')

    # feedback（提交测试）
    page.locator('a.sb-item[data-view="feedback"]').first.click()
    page.wait_for_selector('#fbForm', timeout=8000)
    page.locator('#fbMsg').fill('E2E 测试反馈：在 v18 验证自动提交。')
    page.locator('#fbEmail').fill('e2e@example.com')
    page.screenshot(path=f'{OUT}/04_feedback_form.png')
    page.locator('#fbSubmit').click()
    page.wait_for_function('document.getElementById("fbHint").textContent.includes("已发送") || document.getElementById("fbHint").textContent.includes("失败")', timeout=8000)
    hint = page.locator('#fbHint').inner_text()
    print('feedback hint:', hint)
    assert '已发送' in hint, f'提交后 hint 异常：{hint}'
    page.screenshot(path=f'{OUT}/05_feedback_sent.png')

    # ============ 后台 ============
    print('\n=== 2. 后台 3 tab ===')
    page.goto(base + '/admin/', wait_until='domcontentloaded', timeout=20000)
    page.wait_for_selector('#passInput', timeout=8000)
    page.locator('#passInput').fill('pvhot2026')
    page.locator('#loginBtn').click()
    page.wait_for_selector('#panelNews', timeout=8000)
    print('news tab visible OK')
    page.screenshot(path=f'{OUT}/06_admin_news.png')

    # 切到内容
    page.locator('.tab[data-tab="content"]').first.click()
    page.wait_for_selector('.text-block', timeout=8000)
    page.wait_for_timeout(500)  # 等 4 个 block 填值完成
    blocks = page.locator('.text-block').count()
    print('content blocks:', blocks)
    assert blocks == 4, f'应有 4 个 text-block，实际 {blocks}'
    ab = page.locator('.text-block[data-key="about"] [data-field="eyebrow"]').input_value()
    ag_eb = page.locator('.text-block[data-key="agent"] [data-field="eyebrow"]').input_value()
    fb_eb = page.locator('.text-block[data-key="feedback"] [data-field="eyebrow"]').input_value()
    print('about eyebrow:', ab)
    print('agent eyebrow:', ag_eb)
    print('feedback eyebrow:', fb_eb)
    assert ab == '关于这个站', f'about eyebrow 错：{ab!r}'
    assert ag_eb == 'AGENT 与开发者接入', f'agent eyebrow 错：{ag_eb!r}'
    assert fb_eb == '反 馈', f'feedback eyebrow 错：{fb_eb!r}'
    # agent 的 note 应该包含"温馨提示"
    an = page.locator('.text-block[data-key="agent"] [data-field="note_html"]').input_value()
    print('agent note first 60:', an[:60])
    assert '温馨提示' in an
    page.screenshot(path=f'{OUT}/07_admin_content.png')

    # 改一个字段试试（about.sub），保存
    ta = page.locator('.text-block[data-key="about"] [data-field="sub"]')
    new_sub =
    ta.fill(new_sub)
    page.locator('#txtSaveAll').click()
    page.wait_for_function('document.getElementById("toast").textContent.includes("已保存")', timeout=8000)
    page.screenshot(path=f'{OUT}/08_admin_content_saved.png')
    print('content saved OK')

    # 切到反馈 tab
    page.locator('.tab[data-tab="feedback"]').first.click()
    page.wait_for_selector('.fb-card', timeout=8000)
    cards = page.locator('.fb-card').count()
    print('feedback cards:', cards)
    assert cards >= 1, f'应该至少 1 条反馈（刚提交的），实际 {cards}'
    unread_badge = page.locator('#fbUnreadBadge')
    if unread_badge.is_visible():
        print('unread badge:', unread_badge.inner_text())
    msg = page.locator('.fb-card .fb-msg').first.inner_text()
    print('first fb msg:', msg[:50])
    assert 'E2E' in msg
    page.screenshot(path=f'{OUT}/09_admin_feedback.png')

    # 标为已读
    page.locator('.fb-card .btn[data-fb-act="toggle"]').first.click()
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{OUT}/10_admin_feedback_read.png')

    # 验证前端 /about 反映编辑
    page.goto(base + '/?v=' + str(time.time()), wait_until='domcontentloaded', timeout=20000)
    page.wait_for_selector('#viewBody .top5, #viewBody .feed', timeout=15000)
    page.wait_for_timeout(500)
    page.locator('a.sb-item[data-view="about"]').first.click()
    page.wait_for_selector('#viewBody .abt-h1', timeout=8000)
    sub = page.locator('.abt-sub').first.inner_text()
    print('前端 /about sub:', sub)
    assert 'v18 E2E' in sub, f'前端没反映后台编辑：{sub}'
    page.screenshot(path=f'{OUT}/11_frontend_after_edit.png')

    b.close()
    print('\n=== ALL PASS ===')
