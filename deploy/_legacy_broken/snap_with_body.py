import time, json
from playwright.sync_api import sync_playwright
BASE =
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 850})
    page = ctx.new_page()
    page.goto(BASE + '/?_=v18A&t=' + str(int(time.time())), wait_until='load', timeout=30000)
    page.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
    page.reload(wait_until='load', timeout=30000)
    page.wait_for_selector('#feedTimeline .tl-item', timeout=20000)
    page.click('.sb-item[data-view="all"]')
    page.wait_for_timeout(800)
    items = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#feedTimeline .tl-item')).map((c, i) => ({
            i, hasBody: !!c.querySelector('.tl-body'),
            title: (c.querySelector('.tl-title')||{}).textContent ||
        }));
    }""")
    body_idx = next((x['i'] for x in items if x['hasBody']), None)
    print(f'cards={len(items)} bodyIdx={body_idx}')
    if body_idx is not None:
        page.evaluate("() => window.scrollTo(0, document.querySelectorAll('#feedTimeline .tl-item')[" + str(body_idx) + "].offsetTop - 50)")
        page.wait_for_timeout(500)
        items_el = page.query_selector_all('#feedTimeline .tl-item')
        items_el[body_idx].screenshot(path='C:/Users/HUASUN/Desktop/新闻/deploy/v18A_card_with_body.png')
        print('saved v18A_card_with_body.png')
    b.close()