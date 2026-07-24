#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.0 多信源 E2E 验证：Playwright 截图 + 校验卡片结构"""
import time, json, re
from playwright.sync_api import sync_playwright

BASE =
def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1366, 'height': 850})
        page = ctx.new_page()

        # 1. 加载首页
        page.goto(BASE + '/?_=v3&t=' + str(int(time.time())), wait_until='load', timeout=30000)
        page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
        page.reload(wait_until='load', timeout=30000)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)
        page.click('.sb-item[data-view="all"]')
        page.wait_for_timeout(800)

        # 2. 统计卡片
        stats = page.evaluate("""() => {
            const cards = document.querySelectorAll('#feedTimeline .tl-item');
            const sources = {};
            const cats = {};
            let withBody = 0, withReason = 0, withDivider = 0, withTags = 0;
            cards.forEach(c => {
                const src = c.getAttribute('data-source') || '';
                // 从卡片的 source 标签提取
                const sourceEl = c.querySelector('.tl-source, .source-label');
                const cat = c.getAttribute('data-category') || '';
                if (c.querySelector('.tl-body')) withBody++;
                if (c.querySelector('.tl-reason')) withReason++;
                if (c.querySelector('.tl-divider')) withDivider++;
                if (c.querySelector('.tl-tags')) withTags++;
            });
            return {total: cards.length, withBody, withReason, withDivider, withTags};
        }""")
        print('=== Card stats ===')
        print(json.dumps(stats, indent=2))

        # 3. 检查 data.json 源分布
        page.goto(BASE + '/data.json?t=' + str(int(time.time())), wait_until='load', timeout=15000)
        raw = page.evaluate("() => document.body.innerText"), [])
        
        sources = {}
        langs = {}
        cats = {}
        for it in items:
            s = it.get('source', 'unknown')
            sources[s] = sources.get(s, 0) + 1
            l = it.get('lang', 'unknown')
            langs[l] = langs.get(l, 0) + 1
            c = it.get('category', 'unknown')
            cats[c] = cats.get(c, 0) + 1
        
        print('\n=== Source distribution ===')
        for s, c in sorted(sources.items(), key=lambda x: -x[1]):
            print(f'  {s}: {c}')
        
        print('\n=== Language distribution ===')
        for l, c in sorted(langs.items(), key=lambda x: -x[1]):
            print(f'  {l}: {c}')
        
        print('\n=== Category distribution ===')
        for cat, c in sorted(cats.items(), key=lambda x: -x[1]):
            print(f'  {cat}: {c}')

        # 4. 抽样不同源各一条
        print('\n=== Samples (one per source) ===')
        seen_sources = set()
        for it in items:
            s = it.get('source', '')
            if s not in seen_sources:
                seen_sources.add(s)
                title = it.get('title', '')[:60]
                cat = it.get('category', '')
                lang = it.get('lang', '')
                src = it.get('source', '')
                body = it.get('summary', '')[:60]
                reason = it.get('reason', '')[:60]
                print(f'\n  [{src} / {cat} / {lang}]')
                print(f'    title: {title}')
                print(f'    body:  {body}{"..." if len(it.get("summary",""))>60 else ""}')
                print(f'    reason: {reason}{"..." if len(it.get("reason",""))>60 else ""}')

        # 5. 截图
        page.goto(BASE + '/?_=v3shot&t=' + str(int(time.time())), wait_until='load', timeout=30000)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)
        page.click('.sb-item[data-view="all"]')
        page.wait_for_timeout(800)
        page.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v3_timeline.png', full_page=False)
        print('\nSaved v3_timeline.png')

        # 找一条有 body 的卡片截特写
        items_el = page.query_selector_all('#feedTimeline .tl-item')
        for idx, el in enumerate(items_el[:30]):
            has_body = el.query_selector('.tl-body')
            if has_body:
                page.evaluate(f"() => window.scrollTo(0, document.querySelectorAll('#feedTimeline .tl-item')[{idx}].offsetTop - 50)")
                page.wait_for_timeout(300)
                el.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v3_card.png')
                print(f'Saved v3_card.png (card #{idx})')
                break

        b.close()
        print('\nDone.')

if __name__ == '__main__':
    main()
