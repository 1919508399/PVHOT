#!/usr/bin/env python3
"""Search freewechat.com for WeChat account biz IDs"""
import paramiko
import re
import json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

accounts = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会CPIA',
    '索比光伏网', 'SNEC', '隆基', '晶科能源',
    'TCL中环', '华晟新能源', '阳光电源', '通威股份',
    '天合光能', '晶澳科技', '阿特斯', '东方日升',
    '大全能源', '协鑫集成', '正泰新能', '华为智能光伏',
    '北极星太阳能光伏网', '光伏说', '全球光伏', '光伏资讯',
]

found = {}

for acc in accounts:
    # Search on freewechat.com
    out, err = run(f'curl -s -L "https://freewechat.com/search?q={acc}" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" 2>/dev/null | head -200')
    if not out:
        print(f"  [FAIL] {acc}: no response")
        continue

    # Look for biz IDs in the search results (base64 pattern like MzI...==)
    biz_matches = re.findall(r'(Mz[A-Za-z0-9+/=]{10,30})', out)
    # Also look for account names in links
    # Pattern: /profile/{biz}
    profile_matches = re.findall(r'/profile/(Mz[A-Za-z0-9+/=]+)', out)

    all_biz = list(set(biz_matches + profile_matches))

    if all_biz:
        # Try to find the account name near the biz ID
        for biz in all_biz[:3]:  # Test first 3
            # Test the route
            out2, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -c "<item>"')
            count = out2.strip()
            if count and int(count) > 0:
                # Get first title
                out3, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2')
                print(f"  [OK] {acc}: biz={biz} -> {count} items - {out3.strip()[:80]}")
                found[acc] = biz
                break
        else:
            print(f"  [BIZ] {acc}: found biz IDs {all_biz[:2]} but no items returned")
    else:
        print(f"  [NONE] {acc}: no biz IDs found in search results")

print(f"\n=== Found {len(found)} accounts with working freewechat routes ===")
for acc, biz in found.items():
    print(f"  {acc} -> {biz}")

# Save results
with open('wechat_biz_ids.json', 'w', encoding='utf-8') as f:
    json.dump(found, f, ensure_ascii=False, indent=2)

ssh.close()
print("\n[Done]")
