# -*- coding: utf-8 -*-
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)

def run(cmd):
    stdin, stdout, stderr = c.exec_command(cmd)
    return stdout.read().decode(errors="replace"), stderr.read().decode(errors="replace")

for cmd in [
    "echo '=== finish log ==='; cat /root/https_finish.log 2>/dev/null || echo NO_LOG",
    "echo '=== finish proc ==='; ps aux | grep -i finish_https | grep -v grep || echo NO_PROC",
    "echo '=== cert dir ==='; ls -la /etc/letsencrypt/live/ 2>/dev/null || echo NO_LE",
    "echo '=== 443 listen ==='; ss -tlnp | grep ':443' || echo NO_443",
    "echo '=== nginx conf ==='; cat /etc/nginx/conf.d/pvhot.conf",
]:
    o, e = run(cmd)
    print(o)
    if e.strip():
        print("ERR:", e)
c.close()
