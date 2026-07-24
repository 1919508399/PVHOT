#!/usr/bin/env python3
"""
Comprehensive test of all WeChat routes with longer timeouts and error handling.
"""
import paramiko
import json
import time
import re
import sys
import urllib.parse

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)

def run(cmd, timeout=30):
    try:
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        stdout.channel.settimeout(timeout)
        return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')
    except Exception as e:
        return '', str(e)[:100]

def count_items(route):
    out, _ = run(f'curl -s --max-time 20 "http://127.0.0.1:1200{route}" 2>/dev/null | grep -c "<item>"', timeout=25)
    s = out.strip()
    return int(s) if s and s.isdigit() else 0

def get_feed_info(route):
    out, _ = run(f'curl -s --max-time 20 "http://127.0.0.1:1200{route}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2', timeout=25)
    titles = re.findall(r'<title>([^<]*)</title>', out)
    feed_title = titles[0].replace(' | 自由微信 | FreeWeChat', '').strip() if len(titles) > 0 else
    article_title = titles[1][:60] if len(titles) > 1 else
    return feed_title, article_title

# All candidate biz IDs
BIZ_CANDIDATES = {
    '光伏們': 'MzAxNjU2NjAyNA==',
    '索比光伏网': 'MjM5MzgyMjY2MQ==',
    'PV-Tech': 'MjM5MzI1NzEyMA==',
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
    '通威传媒': 'MzA3MTQ2MzQxMg==',
    '东吴光伏圈': 'MzkzMjY4MjE5Mg==',
    'ACMI硅基新材料': 'MzkwNzM4NDI2Mg==',
    '昱能科技': 'MjM5MzY2NDE2NA==',
    '21世纪经济报道': 'MjI3Njc0NTk4MQ==',
    '中国新闻社': 'MjM5NDI2MDc5NA==',
    '能源新媒': 'MjM5ODk4MzU2Mg==',
    '隆基绿能': 'MzkxNjYxMTI2Ng==',
    '隆基氢能': 'Mzg3ODY1NDgyMw==',
    '世纪新能源网': 'Mzg4NTU3Mzc3Mg==',
    '阳光电源': 'MzUwOTAxNDM0Nw==',
    '中国光伏资讯': 'MzA3NjM5MjIwOQ==',
}

SOGOU_KEYWORDS = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会',
    'SNEC光伏', '隆基LONGI', '晶科能源', 'TCL中环',
    '华晟新能源', '阳光电源', '通威股份', '天合光能',
    '协鑫集成', '正泰新能', '华为智能光伏',
]

print("=" * 70)
print("PHASE 1: Testing freewechat/profile routes")
print("=" * 70)
sys.stdout.flush()

working_freewechat = {}
for name, biz in BIZ_CANDIDATES.items():
    route = f'/freewechat/profile/{biz}'
    count = count_items(route)
    if count > 0:
        feed_title, article = get_feed_info(route)
        print(f"  [OK] {name}: {count} items | Feed: {feed_title} | Latest: {article}")
        sys.stdout.flush()
        working_freewechat[name] = {
            'type': 'freewechat',
            'biz': biz,
            'route': route,
            'items': count,
            'feed_title': feed_title
        }
    else:
        print(f"  [FAIL] {name}: 0 items")
        sys.stdout.flush()
    time.sleep(0.5)

print(f"\n  => {len(working_freewechat)} working freewechat feeds")

print("\n" + "=" * 70)
print("PHASE 2: Testing wechat/sogou/search routes")
print("=" * 70)
sys.stdout.flush()

working_sogou = {}
for kw in SOGOU_KEYWORDS:
    encoded = urllib.parse.quote(kw)
    route = f'/wechat/sogou/search/{encoded}'
    count = count_items(route)
    if count > 0:
        feed_title, article = get_feed_info(route)
        print(f"  [OK] '{kw}': {count} items | Latest: {article}")
        sys.stdout.flush()
        working_sogou[kw] = {
            'type': 'sogou',
            'route': route,
            'items': count,
            'feed_title': feed_title
        }
    else:
        print(f"  [FAIL] '{kw}': 0 items")
        sys.stdout.flush()
    time.sleep(0.5)

print(f"\n  => {len(working_sogou)} working sogou searches")

# Summary
print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)

all_working = {}
for name, info in working_freewechat.items():
    all_working[name] = info
for name, info in working_sogou.items():
    if name not in all_working:
        all_working[name] = info

print(f"Total: {len(all_working)} (freewechat: {len(working_freewechat)}, sogou: {len(working_sogou)})")

# Check user-requested accounts
user_accounts = [
    ('光伏們', '光伏們'),
    ('光伏头条', '光伏头条'),
    ('光伏技术', '光伏技术'),
    ('中国光伏行业协会CPIA', '中国光伏行业协会'),
    ('索比光伏网', '索比光伏网'),
    ('SNEC国际光伏与储能展会', 'SNEC光伏'),
    ('隆基LONGI Solar', '隆基'),
    ('晶科能源 JinkoSolar', '晶科能源'),
    ('TCL中环', 'TCL中环'),
    ('华晟新能源Huasun', '华晟新能源'),
]

print("\n--- User-requested accounts ---")
for full_name, search_key in user_accounts:
    matched = []
    for key in all_working:
        if search_key in key or key in search_key:
            matched.append(key)
    if matched:
        for m in matched:
            info = all_working[m]
            print(f"  {full_name} -> {m} ({info['type']}, {info['items']} items)")
    else:
        print(f"  {full_name} -> NOT FOUND")

# Generate config
print("\n--- Config for fetch_pv_news.js ---")
print("RSSHUB_WECHAT = [")
for name, info in sorted(all_working.items()):
    if info['type'] == 'freewechat':
        biz = info['biz']
        print(f'  {{ name: "{name}", route: "/freewechat/profile/{biz}" }},')
    else:
        print(f'  {{ name: "{name}", route: "/wechat/sogou/search/{name}" }},')
print("];")

# Save JSON
with open('wechat_routes_final.json', 'w', encoding='utf-8') as f:
    json.dump({
        'freewechat': working_freewechat,
        'sogou': working_sogou,
        'all': all_working
    }, f, ensure_ascii=False, indent=2)

ssh.close()
print("\n[Done]")
