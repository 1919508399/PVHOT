#!/usr/bin/env python3
"""Test specific WeChat account names via RSSHub Sogou route + try freewechat"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Test accounts via Sogou route
accounts = [
    '光伏們', '光伏头条', '光伏技术', '中国光伏行业协会CPIA',
    '索比光伏网', 'SNEC国际光伏与储能展会',
    '隆基LONGI Solar', '晶科能源 JinkoSolar',
    'TCL中环', '华晟新能源Huasun',
    # Additional recommended accounts
    '光伏們PV', '光伏说', '太阳能光伏网', '光伏智库',
    '全球光伏', '光伏资讯', '阳光电源', '通威股份',
    '天合光能', '晶澳科技', '阿特斯', '东方日升',
    '大全能源', '协鑫集成', '正泰新能', '华为智能光伏',
    'Mysolarz光伏网', '北极星太阳能光伏网',
]

print("=== Testing Sogou route with account names ===")
working = []
for acc in accounts:
    # URL encode the account name for curl
    out, err = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -c "<item>"')
    count = out.strip()
    status = "OK" if count and int(count) > 0 else
    if status == "OK":
        working.append(acc)
        # Get first title
        out2, _ = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -1')
        title = out2.strip()[:80]
        print(f"  [{status}] {acc}: {count} items - {title}")
    else:
        print(f"  [{status}] {acc}: {count} items")

print(f"\n=== Working accounts: {len(working)} ===")
for w in working:
    print(f"  - {w}")

# Also test freewechat with a known biz ID
# Try to search freewechat for 光伏們
print("\n=== Testing freewechat search ===")
out, err = run('curl -s "https://freewechat.com/search?query=光伏們" 2>/dev/null | head -50')
print(f"Freewechat search: {out[:300]}")

# Test if freewechat profile route works
out, err = run('curl -s "http://127.0.0.1:1200/freewechat/profile/MzI5NTUxNzk3OA==" 2>/dev/null | grep -c "<item>"')
print(f"Freewechat test item count: {out.strip()}")

ssh.close()
print("\n[Done]")
