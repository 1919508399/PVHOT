#!/usr/bin/env python3
"""Test RSSHub WeChat routes on server"""
import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# 1. Check RSSHub status
out, err = run('systemctl is-active rsshub')
print(f"[1] RSSHub active: {out.strip()}")

out, err = run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1200/')
print(f"[2] RSSHub HTTP status: {out.strip()}")

# 3. Test existing wechat search route
out, err = run('curl -s "http://127.0.0.1:1200/wechat/sogou/search/光伏" 2>/dev/null | head -50')
print(f"[3] WeChat search '光伏' (first 500 chars):")
print(out[:500] if out else "(empty)")

# 4. Test wechat account route - try with account name
out, err = run('curl -s "http://127.0.0.1:1200/wechat/sogou/account/光伏們" 2>/dev/null | head -20')
print(f"\n[4] WeChat account route with name '光伏們':")
print(out[:300] if out else "(empty)")

# 5. Check RSSHub version and available wechat routes
out, err = run('cd /opt/RSSHub && cat package.json 2>/dev/null | grep version | head -1; echo "---"; ls -la lib/routes/wechat/sogou/ 2>/dev/null || echo "no wechat/sogou dir"; echo "---"; find lib/routes/wechat -name "*.ts" -o -name "*.js" 2>/dev/null | head -20')
print(f"\n[5] RSSHub version and wechat routes:")
print(out[:800] if out else "(empty)")

# 6. Check if there's a wechat2 or other wechat routes
out, err = run('find /opt/RSSHub/lib/routes -path "*wechat*" -name "*.ts" 2>/dev/null | head -30; echo "==="; find /opt/RSSHub/lib/routes -path "*wechat*" -name "*.js" 2>/dev/null | head -30')
print(f"\n[6] All wechat route files:")
print(out[:1000] if out else "(empty)")

# 7. Check the namespace and paths for wechat
out, err = run('grep -r "namespace" /opt/RSSHub/lib/routes/wechat/ 2>/dev/null | head -10; echo "==="; grep -r "path:" /opt/RSHub/lib/routes/wechat/ 2>/dev/null | head -20; echo "==="; grep -rn "path:" /opt/RSSHub/lib/routes/wechat/ 2>/dev/null | head -20')
print(f"\n[7] Wechat route definitions:")
print(out[:1000] if out else "(empty)")

ssh.close()
print("\n[Done]")
