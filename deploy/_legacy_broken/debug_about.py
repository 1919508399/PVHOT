#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断 about 视图"""
import time
from playwright.sync_api import sync_playwright

BASE =
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    # 抓 console
    page.on('console', lambda msg: print('[console]', msg.type, msg.text))
    page.on('pageerror', lambda exc: print('[pageerror]', exc))

    print('打开首页')
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(2000)

    # 看 viewBody
    body = page.evaluate("document.getElementById('viewBody').innerHTML.slice(0, 200)")
    print('viewBody 前 200 字符:', body)

    # 找 about 项
    has_about = page.query_selector('[data-view="about"]')
    print('has about link:', bool(has_about))
    if has_about:
        # 看 dataset.view
        view = has_about.get_attribute('data-view')
        print('data-view:', view)

    # 点击 about
    page.click('[data-view="about"]')
    page.wait_for_timeout(2000)
    body = page.evaluate("document.getElementById('viewBody').innerHTML.slice(0, 500)")
    print('点击 about 后 viewBody 前 500 字符:', body)

    has_block = page.query_selector('#abtQrBlock')
    print('has abtQrBlock:', bool(has_block))

    # 强制 renderInfoView
    out = page.evaluate("""
      (async () => {
        try {
          if (typeof renderInfoView !== 'function') return 'renderInfoView NOT defined';
          await renderInfoView('about');
          const blk = document.getElementById('abtQrBlock');
          return 'after call, hasBlk=' + !!blk + ' display=' + (blk && blk.style.display);
        } catch(e){ return 'error: ' + e.message; }
      })()
    """)
    print('手动调用 renderInfoView:', out)

    browser.close()
