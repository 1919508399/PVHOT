"""Deep check: DNS state, NS records, file content."""
import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
cmds = [
    "echo === file content ===",
    "cat /etc/nginx/conf.d/pvhot.conf | head -30",
    "echo === DNS dig + trace ===",
    "dig pvhot.gpuia.com @8.8.8.8 2>&1 | head -20",
    "echo === try cloudns ns directly ===",
    "dig pvhot.gpuia.com @ns71.cloudns.net +short 2>&1",
    "dig pvhot.gpuia.com @ns72.cloudns.net +short 2>&1",
    "echo === nslookup fallback ===",
    "nslookup pvhot.gpuia.com 8.8.8.8 2>&1 | head -10",
    "echo === check cloudns NS exist ===",
    "dig gpuia.com NS +short @8.8.8.8 2>&1",
    "echo === curl with Host header ===",
    "curl -sI -o /dev/null -w 'http %{http_code}\\n' -H 'Host: pvhot.gpuia.com' http://47.250.92.231/",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

for c in cmds:
    print(f"\n>>> {c[:60]}")
    try:
        stdin, stdout, stderr = ssh.exec_command(c, timeout=15)
        out = stdout.read().decode(errors='replace').strip()
        err = stderr.read().decode(errors='replace').strip()
        if out:
            print(out)
        if err:
            print(f"  [ERR] {err}")
    except Exception as e:
        print(f"  [EXC] {e}")

ssh.close()
