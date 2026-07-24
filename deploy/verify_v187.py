#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.7 E2E：卡片"上面短标题、下面总结"不再重复
- 每条 tl-item 都有 tl-title
- 对有 tl-summary 的卡片：标题与总结不是前缀重合（不重复）
- title_cn 尾源已清（抽样不含 "- Eco" / "– ODISHA RAY" 等）
- 截图存档
"""
import sys, re
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

    page.goto(BASE+'/?_=v187', wait_until='load')
    page.evaluate("() => localStorage.removeItem('pvhot-day-merge')")
    page.goto(BASE+'/?_=v187b', wait_until='load')
    page.click('.sb-item[data-view="all"]')
    page.wait_for_selector('#feedTimeline .tl-item', timeout=15000)
    page.wait_for_timeout(600)

    # 1. 全量抓取：每条的标题文本 + 总结文本，检测前缀重合
    rows=page.evaluate("""() => {
        const norm=s=>(s||'').toLowerCase().replace(/[^0-9a-z\\u4e00-\\u9fff]+/g,'');
        const items=[...document.querySelectorAll('#feedTimeline .tl-item')];
        let total=0, withSum=0, dup=0, dupSamples=[];
        items.forEach(it=>{
            const tEl=it.querySelector('.tl-title'); if(!tEl) return;
            total++;
            const t=norm(tEl.textContent);
            const sEl=it.querySelector('.tl-summary');
            if(!sEl) return;
            withSum++;
            const s=norm((sEl.textContent||'').replace(/…$/,''));
            if(t&&s&&(t.startsWith(s.slice(0,20))||s.startsWith(t.slice(0,20)))){
                dup++; if(dupSamples.length<3) dupSamples.push({t:tEl.textContent.slice(0,30),s:sEl.textContent.slice(0,30)});
            }
        });
        return { total, withSum, dup, dupSamples };
    }""")
    print('[debug] rows=', rows)
    if rows['total']>0:
        ok('时间线渲染 '+str(rows['total'])+' 条卡片')
    else:
        bad('未渲染任何卡片')
    if rows['dup']==0:
        ok('没有任何卡片"短标题=总结"重复（withSummary='+str(rows['withSum'])+'）')
    else:
        bad(str(rows['dup'])+' 条仍重复，样例='+str(rows['dupSamples']))

    # 2. 每条都有短标题
    noTitle=page.evaluate("""() => [...document.querySelectorAll('#feedTimeline .tl-item')].filter(it=>!it.querySelector('.tl-title')).length""")
    if noTitle==0: ok('每条卡片都有短标题')
    else: bad(str(noTitle)+' 条无标题')

    # 3. 尾源清洗：抽样标题不含 "- Eco/- WBAL/– ODISHA RAY" 类残留
    tails=page.evaluate("""() => {
        const bads=[]; const re=/[-–—]\\s*(ODISHA RAY|Eco|WBAL|Reuters|Bloomberg|EE Times)\\b/i;
        [...document.querySelectorAll('#feedTimeline .tl-title')].forEach(a=>{
            if(re.test(a.textContent)) bads.push(a.textContent.slice(0,40));
        });
        return bads.slice(0,5);
    }""")
    if not tails: ok('标题无英文尾源残留')
    else: bad('标题仍带尾源：'+str(tails))

    # 4. summary 渲染的都带 emerald 左杆
    hasBar=page.evaluate("""() => {
        const s=document.querySelector('#feedTimeline .tl-summary');
        if(!s) return 'none';
        const cs=getComputedStyle(s);
        return cs.borderLeftWidth;
    }""")
    if hasBar=='none':
        ok('（当前视图首屏无 summary 卡，跳过左杆检查）')
    elif hasBar.replace('px','').strip() in ('3','3.0'):
        ok('总结带 emerald 左杆（border-left '+hasBar+'）')
    else:
        bad('左杆宽度异常 '+hasBar)

    # 5. 截图：截前 6 条
    page.locator('#feedTimeline').screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/summary_v187.png')
    ok('已截图：deploy/summary_v187.png')
    # 找一条有 summary 的卡单独截
    idx=page.evaluate("""() => {
        const items=[...document.querySelectorAll('#feedTimeline .tl-item')];
        return items.findIndex(it=>it.querySelector('.tl-summary'));
    }""")
    if idx>=0:
        page.locator('#feedTimeline .tl-item').nth(idx).screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/summary_v187_item.png')
        ok('已截图有总结卡：deploy/summary_v187_item.png（第'+str(idx+1)+'条）')

    b.close()

print()
print('===== v18.7 E2E 结果 =====')
for s in PASS: print(s)
if FAILED:
    print('>>> 有失败项'); sys.exit(1)
print('>>> ALL v18.7 E2E PASSED')
