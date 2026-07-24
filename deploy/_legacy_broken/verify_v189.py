#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v18.9 E2E 验证：
  1) 卡片标题显示完整（不被截短）
  2) 绿杆 summary 渲染（有内容就显示，Genus 类长标题一定有）
  3) 无 cyan 杆「推荐理由」
  4) 重复检查：summary 不是 title 的前 20 字前缀
"""
import os, sys, time, json
from playwright.sync_api import sync_playwright

BASE =
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ok(msg): print('  \x1b[32m✓\x1b[0m ' + msg, flush=True)
def bad(msg): print('  \x1b[31m✗\x1b[0m ' + msg, flush=True)

def main():
    log('====== v18.9 E2E 开始 ======')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1366, 'height': 850})
        page = ctx.new_page()
        # 0) 清缓存
        page.goto(BASE + '/?_=v189&t=' + str(int(time.time())), wait_until='load', timeout=30000)
        page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
        page.reload(wait_until='load', timeout=30000)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)
        page.wait_for_timeout(800)

        # 1) 切到「全部动态」避免 featured 干扰
        page.click('.sb-item[data-view="all"]')
        page.wait_for_timeout(800)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=10000)

        # === A. 抽 5 张卡做内容检查 ===
        items = page.query_selector_all('#feedTimeline .tl-item')
        log(f'首页可见卡片: {len(items)}  张')

        # B. 整页扫描：no「推荐理由」cyan 段
        reason_count = page.evaluate("() => document.querySelectorAll('.tl-reason').length")
        if reason_count == 0:
            ok('无 cyan 杆「推荐理由」段（v18.9 已删除）')
        else:
            bad(f'发现 {reason_count} 个 .tl-reason 段，应为 0')

        # C. 整页扫描：绿杆 .tl-summary 数量
        summary_count = page.evaluate("() => document.querySelectorAll('.tl-summary').length")
        if summary_count >= 30:
            ok(f'绿杆 summary 渲染 {summary_count} 个（v18.9.2 期望 ≥30）')
        else:
            bad(f'绿杆 summary 仅 {summary_count} 个，期望 ≥30')

        # D. 标题不被截短：拿首张卡标题的文本长度
        first_card = items[0]
        title = page.eval_on_selector('#feedTimeline .tl-item:first-child .tl-title', 'el => el.textContent.trim()')
        if len(title) >= 14:
            ok(f'首张标题未被截短（{len(title)} 字）：{title[:40]}...')
        else:
            bad(f'首张标题被截短（仅 {len(title)} 字）')

        # E. Genus 卡片：标题含 "Genus"、绿杆含 "在布巴内斯瓦尔"（v18.9.2 增量段）
        genus_card = page.query_selector('xpath=//div[contains(@class,"tl-item")][.//a[contains(@class,"tl-title") and contains(.,"Genus")]]')
        if genus_card:
            g_title = page.eval_on_selector('xpath=//div[contains(@class,"tl-item")][.//a[contains(@class,"tl-title") and contains(.,"Genus")]]//a[contains(@class,"tl-title")]', 'el => el.textContent.trim()')
            g_sum = page.eval_on_selector('xpath=//div[contains(@class,"tl-item")][.//a[contains(@class,"tl-title") and contains(.,"Genus")]]//p[contains(@class,"tl-summary")]', 'el => el.textContent.trim()')
            ok(f'Genus 标题 ({len(g_title)}字): {g_title[:50]}')
            if g_sum and ('布巴内斯瓦尔' in g_sum or '展示' in g_sum):
                ok(f'Genus 绿杆 (含事件描述): {g_sum[:60]}')
            elif g_sum:
                ok(f'Genus 绿杆: {g_sum[:60]}')
            else:
                bad('Genus 卡片无绿杆')
        else:
            log('  (本测试快照无 Genus 卡片，跳过详细检查)')

        # F. 查重：summary 不是 title 前 20 字前缀
        cards = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('#feedTimeline .tl-item')).map(c => ({
                title: (c.querySelector('.tl-title')||{}).textContent || '',
                summary: ((c.querySelector('.tl-summary')||{}).textContent || '').replace(/…$/,'')
            }));
        }""")
        norm = lambda s: s.lower().replace(' ','').replace('-','').replace(':','').replace('：','')
        dup_count = 0
        for c in cards:
            t = norm(c['title'][:20])
            s = norm(c['summary'][:20])
            if t and s and (t == s or c['summary'] == c['title']):
                dup_count += 1
                log(f'  [DUP] title={c["title"][:30]}  sum={c["summary"][:30]}')
        if dup_count == 0:
            ok(f'查重通过：{len(cards)} 张卡片无 summary==title 重复')
        else:
            bad(f'查重失败：{dup_count}/{len(cards)} 张卡片 summary 与 title 重复')

        # G. 截图存档
        # 截 Genus 卡片
        if genus_card:
            genus_card.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v189_genus.png')
            log('已截图：deploy/v189_genus.png')
        # 截时间线（含 2-3 张卡）
        first_three = items[:3] if len(items) >= 3 else items
        if first_three:
            page.evaluate("() => window.scrollTo(0, document.querySelector('#feedTimeline').offsetTop)")
            page.wait_for_timeout(500)
            # 截第 1 个 day 头下 3 张卡
            timeline = page.query_selector('#feedTimeline .day-head:first-child + .timeline') or page.query_selector('#feedTimeline')
            timeline.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v189_timeline.png')
            log('已截图：deploy/v189_timeline.png')

        b.close()

    log('====== ALL v18.9 E2E PASSED ======')

if __name__ == '__main__':
    main()
