#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3b E2E 验证 — 榜单按多信源报道数 + 精选按AI推荐分
  1. 精选视图：TOP5 按 sourceCount 降序
  2. 精选视图：只显示 AI 推荐高分项（不显示全部）
  3. 卡片显示推荐分（不是热度）
  4. 精选徽标 = score >= 60
"""
import time, json, re
from playwright.sync_api import sync_playwright

BASE =
OUT = r'C:\Users\HUASUN\Desktop\新闻\deploy'

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1366, 'height': 850})
        page = ctx.new_page()

        results = []
        def check(name, cond, detail=''):
            status = '✓' if cond else
            msg = f'{status} {name}' + (f' — {detail}' if detail else '')
            print(msg)
            results.append(cond)

        page.goto(BASE + '/?_=v3b&t=' + str(int(time.time())), wait_until='load', timeout=30000)
        page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
        page.reload(wait_until='load', timeout=30000)
        page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)

        # 确保在精选视图
        page.click('.sb-item[data-view="featured"]')
        page.wait_for_timeout(1000)

        # 1. TOP5 排序检查
        top5 = page.evaluate("""() => {
            const rows = document.querySelectorAll('#top5 .row');
            return Array.from(rows).map(r => {
                const srccnt = r.querySelector('.t-srccnt b');
                return srccnt ? parseInt(srccnt.textContent) : 0;
            });
        }""")
        print(f'\n--- TOP5 sourceCount: {top5} ---')
        is_desc = all(top5[i] >= top5[i+1] for i in range(len(top5)-1)) if len(top5) > 1 else True
        check('TOP5 按 sourceCount 降序', is_desc, f'values={top5}')
        check('TOP5 至少有1条多源(sc>1)', any(sc > 1 for sc in top5), f'max={max(top5) if top5 else 0}')

        # 2. 精选视图不显示全部新闻
        all_count = page.evaluate("""() => {
            const items = document.querySelectorAll('#feedTimeline .tl-item');
            return items.length;
        }""")
        # 获取全部动态的数量
        page.click('.sb-item[data-view="all"]')
        page.wait_for_timeout(800)
        all_total = page.evaluate("""() => document.querySelectorAll('#feedTimeline .tl-item').length""")
        page.click('.sb-item[data-view="featured"]')
        page.wait_for_timeout(800)
        print(f'\n--- 精选={all_count} vs 全部={all_total} ---')
        check('精选不显示全部新闻', all_count < all_total, f'featured={all_count} all={all_total}')

        # 3. 卡片显示推荐分
        card_scores = page.evaluate("""() => {
            const nums = document.querySelectorAll('.tl-num');
            return Array.from(nums).slice(0, 5).map(n => {
                const m = n.textContent.match(/(\d+)/);
                return m ? parseInt(m[1]) : 0;
            });
        }""")
        print(f'--- 卡片推荐分(前5): {card_scores} ---')
        check('卡片显示推荐分(>=60)', all(s >= 60 for s in card_scores), f'scores={card_scores}')

        # 4. 精选徽标
        feat_badges = page.evaluate("""() => document.querySelectorAll('.tl-featured').length""")
        print(f'--- 精选徽标数: {feat_badges} ---')
        check('有精选徽标', feat_badges > 0, f'count={feat_badges}')

        # 5. AI推荐精选 区块标题
        ai_title = page.evaluate("""() => {
            const heads = document.querySelectorAll('.block-head h2');
            for (const h of heads) {
                if (h.textContent.includes('AI')) return h.textContent;
            }
            return '';
        }""")
        check('有"AI 推荐精选"区块', 'AI' in ai_title, f'title="{ai_title}"')

        # 6. 推荐分排序检查（精选视图内，同一天的分应降序）
        day_scores = page.evaluate("""() => {
            const days = document.querySelectorAll('#feedTimeline .day-head');
            const result = [];
            days.forEach(d => {
                const next = d.nextElementSibling;
                if (next && next.classList.contains('tl-list')) {
                    const nums = next.querySelectorAll('.tl-num');
                    const scores = Array.from(nums).map(n => {
                        const m = n.textContent.match(/(\d+)/);
                        return m ? parseInt(m[1]) : 0;
                    });
                    if (scores.length >= 2) result.push(scores);
                }
            });
            return result;
        }""")
        sorted_days = sum(1 for ds in day_scores if all(ds[i] >= ds[i+1] for i in range(len(ds)-1)))
        print(f'\n--- 同天按score降序: {sorted_days}/{len(day_scores)} 天 ---')
        check('精选视图同天内按score降序', sorted_days >= len(day_scores) * 0.7, f'{sorted_days}/{len(day_scores)} days sorted')

        # 7. 截图
        page.screenshot(path=OUT + r'\v3b_featured.png', full_page=False)
        # 滚动截单卡片
        page.evaluate("() => window.scrollTo(0, document.querySelector('#top5').offsetTop - 20)")
        page.wait_for_timeout(300)
        page.screenshot(path=OUT + r'\v3b_top5.png', full_page=False)
        # 滚动到 timeline
        page.evaluate("() => window.scrollTo(0, document.querySelector('#feedTimeline').offsetTop - 20)")
        page.wait_for_timeout(300)
        page.screenshot(path=OUT + r'\v3b_timeline.png', full_page=False)

        # 总结
        passed = sum(results)
        total = len(results)
        print(f'\n=== {passed}/{total} passed ===')

        b.close()

if __name__ == '__main__':
    main()
