#!/usr/bin/env python3
"""Search freewechat.com from server for all accounts, extract biz IDs with names"""
import paramiko
import re
import json
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd, timeout=20):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

def search_freewechat(query):
    """Search freewechat.com and extract account names + biz IDs"""
    # Use python3 on server to fetch and parse
    script = f'''
import urllib.parse, urllib.request, re

q = urllib.parse.quote("{query}")
url = f"https://freewechat.com/search?q={{q}}"
req = urllib.request.Request(url, headers={{
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
}})
try:
    resp = urllib.request.urlopen(req, timeout=15)
    html = resp.read().decode("utf-8", errors="replace")
    
    # Find profile links: <a href="/profile/MzI...">AccountName</a>
    # Also look for text before profile links
    results = []
    
    # Pattern 1: profile links with text
    for m in re.finditer(r'href="/profile/(Mz[A-Za-z0-9+/=]+)"[^>]*>([^<]+)</a>', html):
        biz = m.group(1)
        name = m.group(2).strip()
        if name and len(name) > 1:
            results.append(f"{{name}}|{{biz}}")
    
    # Pattern 2: article links /a/MzI.../ - extract biz and try to find nearby account name
    article_biz = set()
    for m in re.finditer(r'/a/(Mz[A-Za-z0-9+/=]+)/', html):
        article_biz.add(m.group(1))
    
    # Pattern 3: Look for account name mentions in text near profile links
    # Sometimes the name is in a separate element
    
    if results:
        print("PROFILES:" + ";;".join(results))
    else:
        print("NO_PROFILES")
    
    if article_biz:
        print("ARTICLE_BIZ:" + ";;".join(list(article_biz)[:5]))
    else:
        print("NO_ARTICLE_BIZ")
        
except Exception as e:
    print("ERROR:" + str(e)[:200])
'''
    out, err = run(f'python3 -c \'{script}\'', timeout=25)
    return out.strip()

# Search for each account
accounts = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会',
    '索比光伏网', 'SNEC', '隆基', '晶科能源',
    'TCL中环', '华晟新能源', '阳光电源', '通威股份',
    '天合光能', '晶澳科技', '阿特斯', '东方日升',
    '大全能源', '协鑫集成', '正泰新能', '华为智能光伏',
    '北极星太阳能光伏网', '光伏资讯', '全球光伏', '光伏说',
    '光伏政策', '光伏见闻', '黑鹰光伏',
    'PV-Tech', '风芒能源', '储能与电力市场',
]

all_results = {}

for acc in accounts:
    print(f"\n--- {acc} ---")
    result = search_freewechat(acc)
    lines = result.split('\n')
    
    profiles = []
    article_biz = []
    
    for line in lines:
        if line.startswith('PROFILES:'):
            profiles = line[9:].split(';;')
        elif line.startswith('ARTICLE_BIZ:'):
            article_biz = line[13:].split(';;')
        elif line.startswith('ERROR:'):
            print(f"  ERROR: {line[6:]}")
        elif line.startswith('NO_'):
            pass
    
    if profiles:
        print(f"  Profiles found:")
        for p in profiles:
            parts = p.split('|')
            if len(parts) == 2:
                name, biz = parts
                print(f"    {name} -> {biz}")
                # Check if the name matches our search
                if acc in name or name in acc:
                    all_results[acc] = {'biz': biz, 'name': name, 'method': 'profile_exact'}
                    print(f"    *** EXACT MATCH for {acc}!")
    else:
        print(f"  No profile links found")
    
    if article_biz:
        print(f"  Article biz IDs: {article_biz[:3]}")
        # Store article biz for later testing
        if acc not in all_results:
            all_results[acc] = {'biz': article_biz[0], 'name': '', 'method': 'article_first'}
    
    time.sleep(1)  # Be gentle with freewechat

# Now test each found biz ID with RSSHub
print("\n\n=== Testing found biz IDs with RSSHub ===")
working = {}
for acc, info in all_results.items():
    biz = info['biz']
    out, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -c "<item>"', timeout=20)
    count = out.strip()
    if count and int(count) > 0:
        out2, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -1', timeout=20)
        title = out2.strip().replace('<title>', '').replace('</title>', '')[:60]
        print(f"  [OK] {acc}: biz={biz} -> {count} items - {title}")
        working[acc] = {'biz': biz, 'name': info['name'], 'items': int(count), 'title': title}
    else:
        print(f"  [FAIL] {acc}: biz={biz} -> 0 items")
    time.sleep(0.5)

print(f"\n=== FINAL: {len(working)} working accounts ===")
for acc, info in working.items():
    print(f"  {acc} -> biz={info['biz']} ({info['items']} items) [{info['name']}]")

# Save results
with open('wechat_accounts_final.json', 'w', encoding='utf-8') as f:
    json.dump(working, f, ensure_ascii=False, indent=2)

ssh.close()
print("\n[Done]")
