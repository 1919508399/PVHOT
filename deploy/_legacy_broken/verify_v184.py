#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.4 E2E：紧凑时间线 + 日期头 ▾ 合并/分开切换 + 持久化
"""
import sys
from playwright.sync_api import sync_playwright

BASE =
PASS_STEP = []
def ok(s): PASS_STEP.append('✓ ' + s); print('✓ ' + s)
def bad(s): PASS_STEP.append('❌ ' + s); print('❌ ' + s); global FAILED; FAILED = True

FAILED = False

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    page.on('pageerror', lambda e: print('[PAGEERR]', str(e)[:200]))

    # 1. 进「全部动态」
    page.goto(BASE + '/?_=' + 'v184', wait_until='networkidle')
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .day-head', timeout=10000)
    page.wait_for_timeout(500)

    # 2. 第一个 day-head 信息
    day_key = page.get_attribute('.day-head', 'data-day')
    n_items = page.eval_on_selector_all('#feedTimeline .day-head:first-of-type ~ .timeline, #feedTimeline .timeline',
                                          'els => els.map(e => e.querySelectorAll(".tl-item").length)')
    print('[debug] day_key=', day_key, 'timeline item counts=', n_items)
    # 用更可靠的方式取第一个 day 下的 item 数
    n_sep = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        return tl ? tl.querySelectorAll('.tl-item').length : -1;
    }""")
    print('[debug] 第一天分开模式 item 数 =', n_sep)
    if n_sep <= 0:
        bad('第一天无新闻 item'); n_sep = 1
    else:
        ok('第一天分开模式渲染了 ' + str(n_sep) + ' 条新闻卡')

    # 3. 默认应是分开（无 .tl-card.merge）
    has_merge_default = page.evaluate("() => !!document.querySelector('#feedTimeline .tl-card.merge')")
    if has_merge_default:
        bad('默认不应是合并卡')
    else:
        ok('默认分开模式（无合并卡）')

    # 4. 至少有一个 ▾ toggle 按钮
    n_toggle = page.eval_on_selector_all('#feedTimeline .dh-toggle', 'els => els.length')
    if n_toggle > 0:
        ok('日期头 ▾ 切换按钮存在（' + str(n_toggle) + ' 个）')
    else:
        bad('未找到 ▾ 切换按钮')

    # 5. 时间线紧凑样式：padding-left=36px，tl-time font-size<=12px
    tl_pad = page.eval_on_selector('#feedTimeline .timeline', "el => getComputedStyle(el).paddingLeft")
    t_time_fs = page.eval_on_selector('#feedTimeline .tl-time', "el => parseFloat(getComputedStyle(el).fontSize)")
    print('[debug] timeline padding-left=', tl_pad, ' tl-time font-size=', t_time_fs)
    if tl_pad.replace('px','').strip() == '36':
        ok('时间线左留白已收紧到 36px')
    else:
        bad('时间线左留白不是 36px（当前 ' + tl_pad + '）')
    if t_time_fs <= 12:
        ok('时间标签字号紧凑（' + str(t_time_fs) + 'px）')
    else:
        bad('时间标签字号过大（' + str(t_time_fs) + 'px）')

    # 6. 点击第一个 ▾ → 合并
    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_selector('#feedTimeline .tl-card.merge', timeout=8000)
    page.wait_for_timeout(400)
    n_merge_rows = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        const card = tl.querySelector('.tl-card.merge');
        return card ? card.querySelectorAll('.tl-merge-row').length : -1;
    }""")
    print('[debug] 合并后该天 merge-row 数 =', n_merge_rows)
    if n_merge_rows == n_sep:
        ok('合并模式：' + str(n_merge_rows) + ' 条新闻合入一张大卡（与分开数一致）')
    else:
        bad('合并卡行数 ' + str(n_merge_rows) + ' ≠ 分开数 ' + str(n_sep))
    # toggle 高亮
    merged_cls = page.get_attribute('#feedTimeline .day-head:first-of-type .dh-toggle', 'class') or
    if 'merged' in merged_cls:
        ok('▾ 按钮切换为高亮（merged）态')
    else:
        bad('▾ 按钮未高亮')

    # 7. 再点一次 → 分开
    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_function("() => !document.querySelector('#feedTimeline .tl-card.merge')", timeout=8000)
    n_back = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        return tl ? tl.querySelectorAll('.tl-item').length : -1;
    }""")
    if n_back == n_sep:
        ok('再次点击恢复分开模式（' + str(n_back) + ' 条独立卡）')
    else:
        bad('恢复分开后 item 数异常 ' + str(n_back))

    # 8. 持久化：重新合并 → reload → 仍是合并
    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_selector('#feedTimeline .tl-card.merge', timeout=8000)
    page.wait_for_timeout(300)
    page.reload(wait_until='networkidle')
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .day-head', timeout=10000)
    page.wait_for_timeout(600)
    merged_after_reload = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        return !!tl.querySelector('.tl-card.merge');
    }""")
    if merged_after_reload:
        ok('刷新后合并状态持久化（localStorage 生效）')
    else:
        bad('刷新后未保持合并态')

    b.close()

print()
print('===== v18.4 E2E 结果 =====')
for s in PASS_STEP: print(s)
if FAILED:
    print('>>> 有失败项'); sys.exit(1)
print('>>> ALL v18.4 E2E PASSED')
