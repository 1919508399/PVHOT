#!/usr/bin/env python3
"""Fix Sogou cookie + search freewechat for biz IDs + rebuild RSSHub"""
import paramiko
import re
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Read the sogou.ts file, replace cookie, write back using Python
print("=== Updating Sogou cookie via Python ===")
new_cookie =
# Use sed with # delimiter to avoid | conflict
old_cookie_escaped =
cmd = f"""python3 -c "
import re
with open('/opt/RSSHub/lib/routes/wechat/sogou.ts', 'r') as f:
    content = f.read()
old =
new =
content = content.replace(old, new)
with open('/opt/RSSHub/lib/routes/wechat/sogou.ts', 'w') as f:
    f.write(content)
print('Cookie updated successfully')
" """
out, err = run(cmd)
print(f"Update: {out.strip()}")
if err:
    print(f"Error: {err[:200]}")

# Verify
out, _ = run('grep "hardcodedCookie" /opt/RSSHub/lib/routes/wechat/sogou.ts | head -1')
print(f"New line: {out.strip()[:150]}")

# 2. Rebuild RSSHub (with longer timeout)
print("\n=== Rebuilding RSSHub (may take 1-2 min) ===")
out, err = run('cd /opt/RSSHub && npm run build 2>&1 | tail -10', timeout=180)
print(f"Build output: {out.strip()[-300:]}")
if err:
    print(f"Build stderr: {err[:300]}")

# 3. Restart RSSHub
print("\n=== Restarting RSSHub ===")
out, err = run('systemctl restart rsshub')
time.sleep(3)
out, err = run('systemctl is-active rsshub')
print(f"RSSHub status: {out.strip()}")

# 4. Search freewechat.com for biz IDs
print("\n=== Searching freewechat.com for biz IDs ===")
accounts_to_search = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会CPIA',
    '索比光伏网', 'SNEC', '隆基', '晶科能源',
    'TCL中环', '华晟新能源', '阳光电源', '通威股份',
    '天合光能', '晶澳科技', '阿特斯', '东方日升',
    '大全能源', '协鑫集成', '正泰新能', '华为智能光伏',
    '北极星太阳能光伏网', '光伏说', '全球光伏', '光伏资讯',
]

found_biz = {}

for acc in accounts_to_search:
    # Use Python3 on server to URL encode and fetch
    cmd = f"""python3 -c "
import urllib.parse, urllib.request
q = urllib.parse.quote('{acc}')
url = f'https://freewechat.com/search?q={{q}}'
req = urllib.request.Request(url, headers={{'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}})
try:
    resp = urllib.request.urlopen(req, timeout=10)
    html = resp.read().decode('utf-8', errors='replace')
    import re
    # Find biz IDs in profile links: /profile/MzI...
    biz = re.findall(r'/profile/(Mz[A-Za-z0-9+/=]+)', html)
    # Also find biz in data attributes
    biz2 = re.findall(r'(MzIw[A-Za-z0-9+/=]{{10,30}})', html)
    all_biz = list(set(biz + biz2))[:3]
    if all_biz:
        print('|'.join(all_biz))
    else:
        print('NONE')
except Exception as e:
    print('ERROR:' + str(e)[:100])
" """
    out2, _ = run(cmd, timeout=15)
    result = out2.strip()
    if result and result != 'NONE' and not result.startswith('ERROR'):
        biz_list = result.split('|')
        # Test each biz ID with RSSHub
        for biz in biz_list:
            out3, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -c "<item>"', timeout=15)
            count = out3.strip()
            if count and int(count) > 0:
                out4, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2', timeout=15)
                print(f"  [OK] {acc}: biz={biz[:20]}... -> {count} items - {out4.strip()[:80]}")
                found_biz[acc] = biz
                break
        else:
            print(f"  [BIZ-NO-ITEMS] {acc}: found {biz_list} but 0 items")
    elif result.startswith('ERROR'):
        print(f"  [ERR] {acc}: {result[:80]}")
    else:
        print(f"  [NONE] {acc}")

print(f"\n=== Found {len(found_biz)} accounts via freewechat ===")
for acc, biz in found_biz.items():
    print(f"  {acc} -> {biz}")

# 5. Test Sogou routes with new cookie
print("\n=== Testing Sogou routes with updated cookie ===")
test_sogou = ['光伏們', '隆基', '晶科能源', '华晟新能源']
for acc in test_sogou:
    out, _ = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -c "<item>"', timeout=15)
    count = out.strip()
    if count and int(count) > 0:
        out2, _ = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2', timeout=15)
        print(f"  [OK] {acc}: {count} items - {out2.strip()[:80]}")
    else:
        print(f"  [EMPTY] {acc}: {count}")

ssh.close()
print("\n[Done]")
