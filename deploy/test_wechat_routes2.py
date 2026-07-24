#!/usr/bin/env python3
"""Deep inspect RSSHub WeChat routes"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. Read sogou.ts route definition
out, err = run('cat /opt/RSSHub/lib/routes/wechat/sogou.ts')
print("=== sogou.ts (first 2000 chars) ===")
print(out[:2000])

# 2. Read newrank wechat route
out, err = run('cat /opt/RSSHub/lib/routes/newrank/wechat.ts 2>/dev/null | head -80')
print("\n=== newrank/wechat.ts ===")
print(out[:1500])

# 3. Read wechat2rss route
out, err = run('cat /opt/RSSHub/lib/routes/wechat/wechat2rss.ts')
print("\n=== wechat2rss.ts ===")
print(out[:800])

# 4. Read ce route
out, err = run('cat /opt/RSSHub/lib/routes/wechat/ce.ts')
print("\n=== ce.ts ===")
print(out[:800])

# 5. Read ershicimi route
out, err = run('cat /opt/RSSHub/lib/routes/wechat/ershcimi.ts')
print("\n=== ershcimi.ts ===")
print(out[:800])

# 6. Read feeddd route
out, err = run('cat /opt/RSSHub/lib/routes/wechat/feeddd.ts')
print("\n=== feeddd.ts ===")
print(out[:800])

# 7. Read namespace.ts for all route paths
out, err = run('cat /opt/RSSHub/lib/routes/wechat/namespace.ts')
print("\n=== namespace.ts ===")
print(out[:500])

# 8. Check freewechat routes
out, err = run('cat /opt/RSSHub/lib/routes/freewechat/profile.ts 2>/dev/null | head -40')
print("\n=== freewechat/profile.ts ===")
print(out[:800])

# 9. Check if sogou search actually returns items (not welcome page)
out, err = run('curl -s "http://127.0.0.1:1200/wechat/sogou/光伏" 2>/dev/null | grep -c "<item>"')
print(f"\n[9] Items in sogou/光伏 response: {out.strip()}")

# 10. Check newrank route
out, err = run('curl -s "http://127.0.0.1:1200/newrank/wechat/光伏" 2>/dev/null | head -5')
print(f"\n[10] newrank/wechat/光伏: {out[:200]}")

ssh.close()
print("\n[Done]")
