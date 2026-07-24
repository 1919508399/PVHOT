#!/usr/bin/env python3
"""
Comprehensive test of all WeChat routes:
1. freewechat/profile/{biz} for all known biz IDs
2. wechat/sogou/search/{keyword} for specific account keywords
3. Output a JSON config for fetch_pv_news.js
"""
import paramiko
import json
import time
import re

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd, timeout=20):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

def count_items(route):
    """Count <item> tags in RSS feed"""
    out, _ = run(f'curl -s "http://127.0.0.1:1200{route}" 2>/dev/null | grep -c "<item>"', timeout=15)
    s = out.strip()
    return int(s) if s and s.isdigit() else 0

def get_feed_info(route):
    """Get feed title and first article title"""
    out, _ = run(f'curl -s "http://127.0.0.1:1200{route}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2', timeout=15)
    titles = re.findall(r'<title>([^<]*)</title>', out)
    feed_title = titles[0].replace(' | 自由微信 | FreeWeChat', '').strip() if len(titles) > 0 else
    article_title = titles[1][:60] if len(titles) > 1 else
    return feed_title, article_title

# All candidate biz IDs (from freewechat searches)
BIZ_CANDIDATES = {
    # User-requested accounts
    '光伏們': 'MzAxNjU2NjAyNA==',
    '索比光伏网': 'MjM5MzgyMjY2MQ==',
    'PV-Tech': 'MjM5MzI1NzEyMA==',
    
    # Other光伏 accounts found during search
    '光伏资讯': 'MzA3NjQxMjkxOA==',
    '风芒能源': 'MzU1NDY3OTAyNw==',
    '储能与电力市场': 'Mzg2Mjc2MzQ4Mg==',
    '北极星分布式光伏': 'MzA5MDMwMDc1MQ==',
    '光伏见闻': 'MzAwNTM2NzYxNA==',
    '天合跟踪': 'Mzg4NTY5MjUxMg==',
    '天合光能系统解决方案': 'Mzg2NTg0MzAxMg==',
    '中关村储能产业技术联盟': 'MjM5MzUwNzk2Mg==',
    '上海证券报': 'MjM5MDIwNDEyMg==',
    '赶碳号科技': 'Mzg3NDc3MzIyMw==',
    '电能革新': 'MzAwMTc0MzcxOQ==',
    '天合光能产品中心': 'Mzg3MjU2MzA4Ng==',
    
    # From article links (biz IDs appearing in article URLs)
    '通威传媒(华晟关联)': 'MzA3MTQ2MzQxMg==',
    '东吴光伏圈': 'MzkzMjY4MjE5Mg==',
    'ACMI硅基新材料': 'MzkwNzM4NDI2Mg==',
    '昱能科技': 'MjM5MzY2NDE2NA==',
    '21世纪经济报道': 'MjI3Njc0NTk4MQ==',
    '中国新闻社': 'MjM5NDI2MDc5NA==',
    '能源新媒': 'MjM5ODk4MzU2Mg==',
    '环球零碳': 'Mzg3OTcxNTY5Nw==',
    '光伏政策': 'MzIyNzE4MjM3Nw==',
    '光伏发电': 'MzI4MzkzMzkwNw==',
    '隆基绿能(候选)': 'MzkxNjYxMTI2Ng==',
    '隆基氢能(候选)': 'Mzg3ODY1NDgyMw==',
    '世纪新能源网(候选)': 'Mzg4NTU3Mzc3Mg==',
    '中国光伏资讯(候选)': 'MzA3NjM5MjIwOQ==',
    '阳光电源(候选)': 'MzUwOTAxNDM0Nw==',
}

# Sogou keyword searches for accounts we couldn't find biz IDs
SOGOU_KEYWORDS = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会CPIA',
    'SNEC', '隆基', '晶科能源', 'TCL中环', '华晟新能源',
    '阳光电源', '通威股份', '天合光能', '晶澳科技',
    '协鑫集成', '正泰新能', '华为智能光伏',
]

print("=" * 70)
print("PHASE 1: Testing freewechat/profile routes")
print("=" * 70)

working_freewechat = {}
for name, biz in BIZ_CANDIDATES.items():
    route = f'/freewechat/profile/{biz}'
    count = count_items(route)
    if count > 0:
        feed_title, article = get_feed_info(route)
        print(f"  [OK] {name}: {count} items | Feed: {feed_title} | Latest: {article}")
        working_freewechat[name] = {
            'type': 'freewechat',
            'biz': biz,
            'route': route,
            'items': count,
            'feed_title': feed_title
        }
    else:
        print(f"  [FAIL] {name}: 0 items")
    time.sleep(0.3)

print(f"\n  Phase 1 result: {len(working_freewechat)} working freewechat feeds")

print("\n" + "=" * 70)
print("PHASE 2: Testing wechat/sogou/search routes")
print("=" * 70)

working_sogou = {}
for kw in SOGOU_KEYWORDS:
    # URL-encode the keyword
    import urllib.parse
    encoded = urllib.parse.quote(kw)
    route = f'/wechat/sogou/search/{encoded}'
    count = count_items(route)
    if count > 0:
        feed_title, article = get_feed_info(route)
        print(f"  [OK] '{kw}': {count} items | Feed: {feed_title} | Latest: {article}")
        working_sogou[kw] = {
            'type': 'sogou',
            'route': route,
            'items': count,
            'feed_title': feed_title
        }
    else:
        print(f"  [FAIL] '{kw}': 0 items")
    time.sleep(0.5)

print(f"\n  Phase 2 result: {len(working_sogou)} working sogou searches")

# Final summary
print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)

all_working = {}
for name, info in working_freewechat.items():
    all_working[name] = info
for name, info in working_sogou.items():
    if name not in all_working:  # Don't override freewechat if we have it
        all_working[name] = info

print(f"\nTotal working routes: {len(all_working)}")
print(f"  - freewechat/profile: {len(working_freewechat)}")
print(f"  - wechat/sogou/search: {len(working_sogou)}")

# Map to user's requested accounts
user_accounts = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会CPIA',
    '索比光伏网', 'SNEC国际光伏与储能展会', '隆基LONGI Solar',
    '晶科能源 JinkoSolar', 'TCL中环', '华晟新能源Huasun',
]

print("\n--- User-requested accounts status ---")
for acc in user_accounts:
    # Check if we have a match
    matched = False
    for key in all_working:
        if acc.split()[0] in key or key in acc:
            info = all_working[key]
            print(f"  {acc} -> {key} ({info['type']}, {info['items']} items)")
            matched = True
            break
    if not matched:
        print(f"  {acc} -> NOT FOUND")

# Save results
with open('wechat_routes_final.json', 'w', encoding='utf-8') as f:
    json.dump({
        'freewechat': working_freewechat,
        'sogou': working_sogou,
        'all': all_working
    }, f, ensure_ascii=False, indent=2)

# Generate RSSHUB_WECHAT config for fetch_pv_news.js
print("\n--- Generated RSSHUB_WECHAT config ---")
print("const RSSHUB_WECHAT = [")
for name, info in sorted(all_working.items()):
    if info['type'] == 'freewechat':
        biz = info['biz']
        print(f"  {{ name: '{name}', route: '/freewechat/profile/{biz}' }},")
    else:
        print(f"  {{ name: '{name}', route: '/wechat/sogou/search/{name}' }},")
print("];")

ssh.close()
print("\n[Done]")
