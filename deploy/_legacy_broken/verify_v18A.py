#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v18.10 E2E 验证：
  1) .tl-body 详细正文渲染（有内容就显示）
  2) .tl-reason 推荐理由渲染，含"推荐理由"前缀
  3) .tl-divider 分隔线渲染
  4) 无 .tl-summary（旧类名已删）
  5) reason 不含重复数字（如 "15%15"）
  6) 截图
"""
import os, sys, time, json, re
from playwright.sync_api import sync_playwright

BASE =
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ok(msg): print('  \x1b[32m✓\x1b[0m ' + msg, flush=True)
def bad(msg): print('  \x1b[31m✗\x1b[0m ' + msg, flush=True)

def main():
    log('====== v18.10 E2E 开始 ======')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1366, 'height': 850})
        page = ctx.new_page()
        page.goto(BASE + '/?_=v18A&t=' + str(int(time.time())), wait_until='load', timeout=30000)
        page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
        page.reload(wait_until='load', timeout=30000)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)
        page.wait_for_timeout(800)

        # 切到「全部动态」
        page.click('.sb-item[data-view="all"]')
        page.wait_for_timeout(800)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=10000)

        items = page.query_selector_all('#feedTimeline .tl-item')
        log(f'首页可见卡片: {len(items)}  张')

        # A. .tl-body 详细正文
        body_count = page.evaluate("() => document.querySelectorAll('.tl-body').length")
        if body_count >= 20:
            ok(f'.tl-body 详细正文渲染 {body_count} 个')
        else:
            bad(f'.tl-body 仅 {body_count} 个，期望 ≥20')

        # B. .tl-reason 推荐理由
        reason_count = page.evaluate("() => document.querySelectorAll('.tl-reason').length")
        if reason_count >= 30:
            ok(f'.tl-reason 推荐理由渲染 {reason_count} 个')
        else:
            bad(f'.tl-reason 仅 {reason_count} 个，期望 ≥30')

        # C. .tl-divider 分隔线
        divider_count = page.evaluate("() => document.querySelectorAll('.tl-divider').length")
        if divider_count >= 30:
            ok(f'.tl-divider 分隔线渲染 {divider_count} 个')
        else:
            bad(f'.tl-divider 仅 {divider_count} 个，期望 ≥30')

        # D. 无旧类名 .tl-summary
        old_count = page.evaluate("() => document.querySelectorAll('.tl-summary').length")
        if old_count == 0:
            ok('无旧类名 .tl-summary（已改 .tl-body）')
        else:
            bad(f'发现 {old_count} 个残留 .tl-summary，应为 0')

        # E. 推荐理由含"推荐理由"前缀
        first_reason_text = page.evaluate("() => { const el = document.querySelector('.tl-reason'); return el ? el.textContent.trim() : ''; }")
        if first_reason_text and '推荐理由' in first_reason_text:
            ok(f'推荐理由含前缀：{first_reason_text[:70]}...')
        else:
            bad(f'推荐理由无"推荐理由"前缀：{first_reason_text[:70]}')

        # F. reason 不含重复数字（如 "15%15"）
        reasons = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.tl-reason')).map(el => el.textContent.trim());
        }""")
        dup_num = 0
        for r in reasons:
            nums = re.findall(r'\d+(?:\.\d+)?\s*(?:%|MW|GW|kWh|亿|万)', r)
            seen = set()
            for n in nums:
                if n in seen:
                    dup_num += 1
                    log(f'  [DUP NUM] {n} in: {r[:60]}')
                seen.add(n)
        if dup_num == 0:
            ok(f'reason 无重复数字（{len(reasons)} 条全部通过）')
        else:
            bad(f'reason 有 {dup_num} 处重复数字')

        # G. 抽 3 张卡展示完整结构
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('#feedTimeline .tl-item')).slice(0, 3).map(c => ({
                title: (c.querySelector('.tl-title')||{}).textContent || '',
                body: (c.querySelector('.tl-body')||{}).textContent || '',
                tags: Array.from(c.querySelectorAll('.tl-tag')).map(t => t.textContent.trim()),
                reason: (c.querySelector('.tl-reason')||{}).textContent ||
            }));
        }""")
        for i, c in enumerate(cards):
            log(f'  --- 卡片 #{i+1} ---')
            log(f'  标题: {c["title"][:50]}')
            if c['body']:
                log(f'  正文: {c["body"][:80]}...')
            else:
                log(f'  正文: (无)')
            log(f'  标签: {" ".join(c["tags"])}')
            if c['reason']:
                log(f'  理由: {c["reason"][:80]}')
            else:
                log(f'  理由: (无)')

        # H. 截图
        page.evaluate("() => window.scrollTo(0, document.querySelector('#feedTimeline').offsetTop)")
        page.wait_for_timeout(500)
        timeline = page.query_selector('#feedTimeline .day-head:first-child + .timeline') or page.query_selector('#feedTimeline')
        timeline.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v18A_timeline.png')
        log('已截图：deploy/v18A_timeline.png')
        # 截单张卡特写
        if items:
            items[0].screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v18A_card.png')
            log('已截图：deploy/v18A_card.png')

        b.close()

    log('====== v18.10 E2E 完成 ======')

if __name__ == '__main__':
    main()
