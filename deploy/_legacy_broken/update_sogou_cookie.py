#!/usr/bin/env python3
"""Get complete Sogou cookie + test article extraction + parse freewechat"""
import paramiko
import re

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Get complete cookie by visiting search page
print("=== Getting complete Sogou cookie ===")
out, err = run('''curl -s -D - -o /dev/null "https://weixin.sogou.com/weixin?type=2&query=%E5%85%89%E4%BC%8F&ie=utf8" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" 2>/dev/null | grep -i "set-cookie"''')
print(f"Search page cookies:\n{out}")

# Extract all cookie name=value pairs
cookie_parts = []
for line in out.split('\n'):
    if 'set-cookie' in line.lower():
        val = line.split(':', 1)[1].strip().split(';')[0].strip()
        if val:
            cookie_parts.append(val)

complete_cookie = '; '.join(cookie_parts)
print(f"\nComplete cookie: {complete_cookie}")

# 2. Test article extraction with complete cookie
print("\n=== Testing article extraction ===")
test_accounts = ['光伏們', '隆基Longi', '晶科能源', '华晟新能源', '阳光电源']
for acc in test_accounts:
    # Check if we get article links (not just account profiles)
    cmd = f'''curl -s "https://weixin.sogou.com/weixin?type=2&query={acc}&ie=utf8" -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" -H "Cookie: {complete_cookie}" 2>/dev/null | grep -o 'href="[^"]*"' | head -5'''
    out2, _ = run(cmd)
    print(f"  {acc}: links found = {out2.strip()[:200]}")

# 3. Now update the RSSHub sogou.ts with the new cookie
print("\n=== Updating RSSHub sogou.ts ===")
old_cookie =
new_cookie = complete_cookie

# Read the file, replace the cookie, write back
cmd = f'''sed -i "s|{old_cookie}|{new_cookie}|g" /opt/RSSHub/lib/routes/wechat/sogou.ts && echo "Cookie updated" '''
out, err = run(cmd)
print(f"Update result: {out}")
if err:
    print(f"Update error: {err}")

# Verify the update
out, _ = run('grep "hardcodedCookie" /opt/RSSHub/lib/routes/wechat/sogou.ts')
print(f"New cookie line: {out.strip()[:200]}")

# 4. Rebuild RSSHub
print("\n=== Rebuilding RSSHub ===")
out, err = run('cd /opt/RSSHub && npm run build 2>&1 | tail -5')
print(f"Build result: {out.strip()}")
if err:
    print(f"Build stderr: {err[:300]}")

# 5. Restart RSSHub
print("\n=== Restarting RSSHub ===")
out, err = run('systemctl restart rsshub && sleep 3 && systemctl is-active rsshub')
print(f"RSSHub status: {out.strip()}")

# 6. Test with updated cookie via RSSHub route
print("\n=== Testing RSSHub routes with new cookie ===")
test_via_rsshub = ['光伏們', '隆基Longi', '晶科能源', '华晟新能源', '阳光电源', '索比光伏网', 'TCL中环']
for acc in test_via_rsshub:
    # URL encode for curl
    cmd = f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -c "<item>"'
    out2, _ = run(cmd)
    count = out2.strip()
    if count and int(count) > 0:
        cmd2 = f'curl -s "http://127.0.0.1:1200/wechat/sogou/{acc}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -2'
        out3, _ = run(cmd2)
        print(f"  [OK] {acc}: {count} items - {out3.strip()[:100]}")
    else:
        print(f"  [EMPTY] {acc}: {count} items")

ssh.close()
print("\n[Done]")
