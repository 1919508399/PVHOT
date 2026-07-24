#!/usr/bin/env python3
"""Test Sogou routes with updated cookie - quick test"""
import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd, timeout=20):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# Test Sogou routes with updated cookie
print("=== Testing Sogou routes with updated cookie ===")
test_accounts = [
    '光伏們', '光伏头条', '光伏技术', '索比光伏网',
    '隆基', '晶科能源', 'TCL中环', '华晟新能源',
    '阳光电源', '通威股份', '天合光能', '晶澳科技',
    '阿特斯', '东方日升', '大全能源', '协鑫集成',
    '正泰新能', '华为智能光伏',
    '中国光伏行业协会CPIA', 'SNEC',
    '北极星太阳能光伏网', '光伏说', '全球光伏', '光伏资讯',
]

working_sogou = []
for acc in test_accounts:
    out, _ = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -c "<item>"')
    count = out.strip()
    if count and int(count) > 0:
        out2, _ = run(f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -1')
        title = out2.strip().replace('<title>', '').replace('</title>', '')[:60]
        print(f"  [OK] {acc}: {count} items - {title}")
        working_sogou.append(acc)
    else:
        print(f"  [EMPTY] {acc}: {count}")

print(f"\n=== Working Sogou accounts: {len(working_sogou)}/{len(test_accounts)} ===")

# Also test the existing keyword search
print("\n=== Testing existing keyword search ===")
out, _ = run('curl -s "http://127.0.0.1:1200/wechat/sogou/光伏" 2>/dev/null | grep -c "<item>"')
print(f"  光伏 keyword: {out.strip()} items")

out, _ = run('curl -s "http://127.0.0.1:1200/wechat/sogou/光伏" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -3')
print(f"  Titles: {out.strip()}")

ssh.close()
print("\n[Done]")
