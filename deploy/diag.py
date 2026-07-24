import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=30)

cmds = [
    ("nginx access tail", "tail -30 /var/log/nginx/access.log"),
    ("5x sequential", """for i in 1 2 3 4 5; do curl -sI -o /dev/null -w "try%{time_total}s code%{http_code} " http://pvhot.duckdns.org/; echo; done"""),
    ("data.json size", "curl -s -o /dev/null -w 'data.json HTTP %{http_code} size=%{size_download} time=%{time_total}s\\n' http://pvhot.duckdns.org/data.json"),
    ("app.js head", "curl -sI http://pvhot.duckdns.org/app.js | head -8"),
    ("10x concurrent", "for i in $(seq 1 10); do curl -s -o /dev/null -w '%{http_code} ' http://pvhot.duckdns.org/ & done; wait; echo"),
    ("system resources", "uptime; echo '---'; free -h | head -2; echo '---'; ss -s | head -3"),
    ("nginx error log", "tail -10 /var/log/nginx/error.log 2>/dev/null || echo 'no error log'"),
    ("open file limit", "ulimit -n; cat /proc/sys/net/core/somaxconn"),
]
for label, c in cmds:
    print(f"\n=== {label} ===")
    stdin, stdout, stderr = ssh.exec_command(c, timeout=20)
    try:
        out = stdout.read().decode(errors='replace').strip()
        err = stderr.read().decode(errors='replace').strip()
        print(out)
        if err: print("[stderr]", err)
    except Exception as e:
        print("ERR:", e)
ssh.close()
