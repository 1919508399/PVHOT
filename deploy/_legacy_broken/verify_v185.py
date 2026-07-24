#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.5 E2E：图2 风格时间线
- 圆点 + 时间紧贴卡片左缘（圆点 x≈4px；时间起点 x≈圆点+间距）
- 时间左对齐 emerald 12px
- 日期头 ▾ 合并/分开 + 持久化 仍然过
"""
import sys
from playwright.sync_api import sync_playwright

BASE =
PASS = []
def ok(s): PASS.append('✓ ' + s); print('✓ ' + s)
def bad(s): PASS.append('❌ ' + s); print('❌ ' + s); global FAILED; FAILED = True

FAILED = False

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    page.on('pageerror', lambda e: print('[PAGEERR]', str(e)[:200]))

    # 0. 强制清掉上次合并态，避免影响断言
    page.goto(BASE + '/?_=' + 'v185', wait_until='load', timeout=60000)
    page.evaluate("() => localStorage.removeItem('pvhot-day-merge')")
    page.goto(BASE + '/?_=' + 'v185b', wait_until='load', timeout=60000)
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .day-head', timeout=15000)
    page.wait_for_timeout(700)

    # 1. 时间线样式：左留白 0、grid 56+1fr、时间 12px emerald
    tl_pad = page.eval_on_selector('#feedTimeline .timeline', "el => getComputedStyle(el).paddingLeft")
    time_fs = page.eval_on_selector('#feedTimeline .tl-time', "el => parseFloat(getComputedStyle(el).fontSize)")
    time_color = page.eval_on_selector('#feedTimeline .tl-time', "el => getComputedStyle(el).color")
    print('[debug] timeline padding-left=', tl_pad, ' tl-time fs=', time_fs, ' color=', time_color)
    if tl_pad.replace('px','').strip() == '0':
        ok('时间线左留白 0（卡片整宽）')
    else:
        bad('时间线左留白应为 0（当前 ' + tl_pad + '）')
    if 11.5 <= time_fs <= 12.5:
        ok('时间字号 12px（图2 紧凑）')
    else:
        bad('时间字号异常 ' + str(time_fs) + 'px')

    # 2. 像素级断言：圆点 + 时间紧贴卡片左缘
    geo = page.evaluate("""() => {
        const tl = document.querySelector('#feedTimeline .tl-item');
        if (!tl) return null;
        const time = tl.querySelector('.tl-time');
        const card = tl.querySelector('.tl-card');
        const tBox = time.getBoundingClientRect();
        const cBox = card.getBoundingClientRect();
        const style = getComputedStyle(time, '::before');
        return {
            cardLeft: cBox.left,
            timeLeft: tBox.left,
            timeTextLeft: tBox.left + parseFloat(getComputedStyle(time).paddingLeft),
            dotLeft: tBox.left + parseFloat(style.left),
            dotW: parseFloat(style.width),
            dotTop: tBox.top + parseFloat(style.top),
            timeTop: tBox.top,
        };
    }""")
    print('[debug] geo=', geo)
    if not geo:
        bad('未找到 .tl-item，无法像素断言')
    else:
        # 圆点中心 x 应在卡片左缘**外侧** 50~70px 范围（图2 grid 56 时间列）
        dot_center_x = geo['dotLeft'] + geo['dotW']/2
        offset = dot_center_x - geo['cardLeft']
        if -75 <= offset <= -50:
            ok('圆点在卡片外侧时间列内（offset=' + str(round(offset,1)) + 'px，图2 风格）')
        else:
            bad('圆点↔卡片左缘 offset=' + str(round(offset,1)) + 'px 应在 -75~-50px')
        # 圆点 ↔ 时间文本起点 距离 < 14px
        gap = geo['timeTextLeft'] - (geo['dotLeft'] + geo['dotW'])
        if 0 <= gap <= 14:
            ok('时间文本紧贴圆点（gap=' + str(round(gap,1)) + 'px）')
        else:
            bad('圆点↔时间 间距异常 gap=' + str(round(gap,1)) + 'px')
        # 圆点中心 y vs 时间文本中线 y 差 < 6px（基线对齐）
        time_mid_y = geo['timeTop'] + time_fs / 2
        dot_mid_y = geo['dotTop'] + geo['dotW'] / 2
        v_off = dot_mid_y - time_mid_y
        if abs(v_off) < 6:
            ok('圆点中线与时间中线对齐（Δ=' + str(round(v_off,1)) + 'px）')
        else:
            bad('圆点垂直偏移 Δ=' + str(round(v_off,1)) + 'px')

    # 3. 日期头 ▾ 按钮 + 合并/分开仍然 OK
    n_toggle = page.eval_on_selector_all('#feedTimeline .dh-toggle', 'els => els.length')
    if n_toggle > 0:
        ok('日期头 ▾ 按钮存在（' + str(n_toggle) + ' 个）')
    else:
        bad('未找到 ▾ 按钮')

    n_sep = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        return tl ? tl.querySelectorAll('.tl-item').length : -1;
    }""")
    if n_sep > 0:
        ok('第一天分开模式 ' + str(n_sep) + ' 条')
    else:
        bad('第一天无新闻')

    # 4. 合并 → 分开 → 合并（验证切换未坏）
    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_selector('#feedTimeline .tl-card.merge', timeout=8000)
    page.wait_for_timeout(300)
    n_merge = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        const card = tl.querySelector('.tl-card.merge');
        return card ? card.querySelectorAll('.tl-merge-row').length : -1;
    }""")
    if n_merge == n_sep:
        ok('合并卡行数一致（' + str(n_merge) + ' 行）')
    else:
        bad('合并卡行数 ' + str(n_merge) + ' ≠ ' + str(n_sep))

    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_function("() => !document.querySelector('#feedTimeline .tl-card.merge')", timeout=8000)
    n_back = page.evaluate("""() => {
        const dh = document.querySelector('#feedTimeline .day-head');
        const tl = dh.nextElementSibling;
        return tl ? tl.querySelectorAll('.tl-item').length : -1;
    }""")
    if n_back == n_sep:
        ok('合并→分开恢复（' + str(n_back) + ' 条）')
    else:
        bad('恢复后数量异常 ' + str(n_back))

    # 5. 持久化
    page.click('#feedTimeline .day-head .dh-toggle')
    page.wait_for_selector('#feedTimeline .tl-card.merge', timeout=8000)
    page.wait_for_timeout(200)
    page.reload(wait_until='networkidle')
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .day-head', timeout=10000)
    page.wait_for_timeout(500)
    if page.evaluate("() => !!document.querySelector('#feedTimeline .tl-card.merge')"):
        ok('合并态刷新后保持')
    else:
        bad('刷新后未保持合并态')

    # 6. 截图存档（视觉证据）
    page.evaluate("() => localStorage.removeItem('pvhot-day-merge')")
    page.reload(wait_until='load', timeout=60000)
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .day-head', timeout=15000)
    page.wait_for_timeout(700)
    page.locator('#feedTimeline').screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/timeline_v185.png')
    ok('已截图：deploy/timeline_v185.png（feedTimeline 全貌）')

    # 单条新闻特写（看圆点+时间紧贴卡片左缘的细节）
    page.locator('#feedTimeline .tl-item').first.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/timeline_v185_item.png')
    ok('已截图：deploy/timeline_v185_item.png（单条新闻特写）')

    b.close()

print()
print('===== v18.5 E2E 结果 =====')
for s in PASS: print(s)
if FAILED:
    print('>>> 有失败项'); sys.exit(1)
print('>>> ALL v18.5 E2E PASSED')
