"""v18.1 E2E: 反馈端到端 + offline-tip 不再出现"""
import paramiko, time, json
from playwright.sync_api import sync_playwright

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
def run(cmd):
    si,so,se = c.exec_command(cmd)
    return so.read().decode(errors='replace')

# 1) 重置
run('echo [] > /var/www/pvhot/feedback.json')
time.sleep(0.3)
before = json.loads(run('cat /var/www/pvhot/feedback.json'))
print(f"[before] feedback.json = {before}")
assert before == [],
print()

# 2) Playwright 提交
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    page.on('console', lambda m: print(f"  [console.{m.type}] {m.text}") if m.type in ('error','warning') else None)
    page.on('pageerror', lambda e: print(f"  [pageerror] {e.message}"))
    page.goto(f"http://pvhot.bbroot.com/?v={int(time.time())}", wait_until="domcontentloaded", timeout=20000)
    try:
        page.wait_for_function("typeof DATA !== 'undefined' && !!DATA", timeout=20000)
    except Exception as e:
        print(f"[warn] DATA 未就绪（可能 fallback 已加载），继续: {e}")
        # 即便 fallback 也能跳到 feedback 视图，因为 renderInfoView 不依赖 DATA
    page.wait_for_timeout(1500)
    # 跳到反馈页
    page.locator('a.sb-item[data-view=feedback]').first.click()
    page.wait_for_timeout(800)
    # 填表
    page.locator('#fbMsg').fill('E2E 测试：这条反馈应该出现在站长后台')
    page.locator('#fbEmail').fill('e2e@pvhot.test')
    page.locator('#fbSubmit').click()
    # 等 success 卡显示
    page.wait_for_selector('#fbSent:not([hidden])', timeout=8000)
    page.wait_for_timeout(500)
    # 验证 success 文案是新版
    sent_body = page.locator('#fbSentBody').inner_text()
    sent_title = page.locator('#fbSentTitle').inner_text()
    hint = page.locator('#fbHint').inner_text()
    print(f"[front] fbSentTitle: {sent_title!r}")
    print(f"[front] fbSentBody:  {sent_body!r}")
    print(f"[front] fbHint:      {hint!r}")
    assert "已发送到站长后台" in sent_body, f"success 文案未更新: {sent_body!r}"
    assert "localStorage" not in sent_body, f"仍包含 localStorage 字样: {sent_body!r}"
    # 验证无 offline-tip
    offline_cnt = page.locator('.offline-tip').count()
    print(f"[front] offline-tip count: {offline_cnt}")
    assert offline_cnt == 0, f"offline-tip 仍存在 ({offline_cnt} 个)"
    # 截图存档
    page.screenshot(path=r"C:\Users\HUASUN\Desktop\新闻\deploy\fb_success.png", full_page=False)
    print("[shot] fb_success.png")
    b.close()

# 3) 验证后台
time.sleep(0.5)
after = json.loads(run('cat /var/www/pvhot/feedback.json'))
print(f"[after] feedback.json:")
print(json.dumps(after, ensure_ascii=False, indent=2))
assert len(after) == 1, f"应该 1 条，实际 {len(after)}"
rec = after[0]
assert rec['msg'].startswith('E2E 测试'), f"消息内容不匹配: {rec['msg']!r}"
assert rec['email'] == 'e2e@pvhot.test', f"邮箱不匹配: {rec['email']!r}"
assert rec['read'] is False, f"应未读: {rec}"
print("\n=== ALL E2E PASSED ===")
c.close()
