"""Add pvhot.gpuia.com to nginx server_name and reload."""
import paramiko
import time

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
cmds = [
    "echo --- current server_name ---",
    "grep -n server_name /etc/nginx/conf.d/pvhot.conf",
    "echo --- add pvhot.gpuia.com ---",
    "sed -i 's|server_name pvhot.pp.ua pvhot.duckdns.org 47.250.92.231;|server_name pvhot.pp.ua pvhot.duckdns.org pvhot.gpuia.com 47.250.92.231;|' /etc/nginx/conf.d/pvhot.conf",
    "echo --- nginx -t ---",
    "nginx -t 2>&1",
    "echo --- reload ---",
    "systemctl reload nginx",
    "sleep 1",
    "systemctl is-active nginx",
    "echo --- verify via gpuia ---",
    "curl -sI -o /dev/null -w 'gpuia.com HTTP %{http_code}\\n' http://pvhot.gpuia.com/ 2>&1",
    "curl -sI -o /dev/null -w 'duckdns  HTTP %{http_code}\\n' http://pvhot.duckdns.org/ 2>&1",
    "curl -sI -o /dev/null -w 'IP       HTTP %{http_code}\\n' http://47.250.92.231/ 2>&1",
    "echo --- DNS resolution ---",
    "dig +short pvhot.gpuia.com @8.8.8.8 2>&1 || nslookup pvhot.gpuia.com 8.8.8.8 | grep -A1 'Name:' | head -4",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

for c in cmds:
    label = c[:50] if len(c) > 50 else c
    print(f"=== {label}")
    try:
        stdin, stdout, stderr = ssh.exec_command(c, timeout=15)
        out = stdout.read().decode(errors='replace').strip()
        err = stderr.read().decode(errors='replace').strip()
        if out:
            print(out)
        if err:
            print(f"  [ERR] {err}")
    except Exception as e:
        print(f"  [TIMEOUT/EXC] {e}")

ssh.close()
