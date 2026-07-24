#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.6 E2E：卡片标题下方"简短总结"红杆
- 每条 tl-item 都有 .tl-summary
- .tl-summary 有 emerald 左红杆（border-left 3px）+ 淡底
- 内容非空
"""
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

    page.goto(BASE+'/?_=v186', wait_until='networkidle')
    page.evaluate("() => localStorage.removeItem('pvhot-day-merge')")
    page.goto(BASE+'/?_=v186b', wait_until='networkidle')
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .tl-item', timeout=10000)
    page.wait_for_timeout(500)

    # 1. tl-item 数 vs tl-summary 数
    stat=page.evaluate("""() => {
        const items=[...document.querySelectorAll('#feedTimeline .tl-item')];
        let withSum=0, empty=0;
        items.forEach(it=>{
            const s=it.querySelector('.tl-summary');
            if(s){ withSum++; if(!(s.textContent||'').trim()) empty++; }
        });
        return { total: items.length, withSum, empty };
    }""")
    print('[debug] items=',stat)
    if stat['total']>0 and stat['withSum']==stat['total']:
        ok('每条新闻都有简短总结（'+str(stat['withSum'])+'/'+str(stat['total'])+'）')
    else:
        bad('简短总结覆盖不全：'+str(stat['withSum'])+'/'+str(stat['total']))
    if stat['empty']==0:
        ok('无空白总结')
    else:
        bad(str(stat['empty'])+' 条总结为空')

    # 2. 红杆样式：border-left 3px emerald + 淡底
    style=page.eval_on_selector('#feedTimeline .tl-summary', """el => {
        const cs=getComputedStyle(el);
        return { bl: cs.borderLeftWidth, blc: cs.borderLeftColor, bg: cs.backgroundColor, pad: cs.paddingLeft };
    }""")
    print('[debug] tl-summary style=',style)
    if style['bl'].replace('px','').strip() in ('3','3.0'):
        ok('简短总结带左杆（border-left 3px）')
    else:
        bad('左杆宽度异常 '+style['bl'])
    # emerald ≈ rgb(47,125,92)
    if 'rgb' in style['blc'] and style['blc']!='rgba(0, 0, 0, 0)':
        ok('左杆颜色非透明（'+style['blc']+'）')
    else:
        bad('左杆颜色异常 '+style['blc'])
    if style['bg']!='rgba(0, 0, 0, 0)':
        ok('简短总结有淡色底（'+style['bg']+'）')
    else:
        bad('无淡色底')

    # 3. 总结与推荐理由是两个不同元素
    both=page.evaluate("""() => {
        const it=document.querySelector('#feedTimeline .tl-item');
        const s=it.querySelector('.tl-summary');
        const r=it.querySelector('.tl-reason');
        return { hasSum: !!s, hasReason: !!r,
                 sumText: s?(s.textContent||'').trim().slice(0,40):'',
                 reasonText: r?(r.textContent||'').trim().slice(0,40):'' };
    }""")
    print('[debug] first item:', both)
    if both['hasSum'] and both['hasReason']:
        ok('简短总结与推荐理由并存（两层信息）')
    else:
        bad('总结/理由缺失 '+str(both))

    # 4. 截图
    page.locator('#feedTimeline .tl-item').first.screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/summary_v186_item.png')
    ok('已截图：deploy/summary_v186_item.png')
    page.locator('#feedTimeline').screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/summary_v186.png')
    ok('已截图：deploy/summary_v186.png')

    b.close()

print()
print('===== v18.6 E2E 结果 =====')
for s in PASS: print(s)
if FAILED:
    print('>>> 有失败项'); sys.exit(1)
print('>>> ALL v18.6 E2E PASSED')
