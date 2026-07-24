#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v18.8 E2E：精选页日期头 2026年07月23 → 7月23日，与下方 day-head 一致"""
import sys
from playwright.sync_api import sync_playwright

BASE='https://pvhot.bbroot.com'
PASS=[]; FAILED=False
def ok(s): PASS.append('✓ '+s); print('✓ '+s)
def bad(s):
    global FAILED; PASS.append('❌ '+s); print('❌ '+s); FAILED=True

with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    ctx=b.new_context(viewport={'width':1366,'height':850})
    page=ctx.new_page()
    page.on('pageerror', lambda e: print('[PAGEERR]', str(e)[:200]))
    page.goto(BASE+'/?_=v188', wait_until='load', timeout=20000)
    page.wait_for_selector('#heroSub', state='attached', timeout=10000)
    # 等 heroSub 文本非空（等 DATA 加载完成）
    for _ in range(30):
        txt=page.eval_on_selector('#heroSub', 'el=>el.textContent.trim()')
        if txt: break
        page.wait_for_timeout(200)
    page.wait_for_selector('#feedTimeline .tl-item', timeout=15000)
    page.wait_for_timeout(500)

    sub=page.eval_on_selector('#heroSub', 'el => el.textContent.trim()')
    print('[debug] hero-sub=', sub)
    # 期望：以 "7月23日 星期四" 开头（无 2026年、无前导 0）
    import datetime as _dt
    m=_dt.datetime.now(); today=f'{m.month}月{m.day}日'
    m=__import__('datetime').datetime.now(); today=f'{m.month}月{m.day}日'
    expect_prefix=today+' 星期'
    if sub.startswith(expect_prefix):
        ok('精选 sub 改为「'+today+' 星期X」开头（无 2026年）')
    else:
        bad('精选 sub 格式不对：'+sub[:60])
    if '2026' not in sub and '07月' not in sub:
        ok('无年份、无前导 0')
    else:
        bad('仍含年份/前导 0：'+sub[:60])

    # 与 day-head 第一行格式一致
    dayHead=page.eval_on_selector('#feedTimeline .dh-date', 'el => el.textContent.replace(/\\s+/g," ").trim()')
    print('[debug] dayHead=', dayHead)
    if today in dayHead:
        ok('day-head 也用「'+today+'」')
    else:
        bad('day-head 格式：'+dayHead[:40])

    # 截图
    page.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/featured_v188.png', full_page=False, clip={'x':0,'y':0,'width':1366,'height':400})
    ok('已截图：deploy/featured_v188.png（顶部 400px）')

    b.close()

print()
print('===== v18.8 E2E 结果 =====')
for s in PASS: print(s)
if FAILED: print('>>> 有失败项'); sys.exit(1)
print('>>> ALL v18.8 E2E PASSED')
