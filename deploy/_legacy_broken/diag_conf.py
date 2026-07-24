"""诊断 pvhot.conf 当前的 443 重复来源，并确认 80 是否仍正常"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
CMD = r"""
echo
ls -la /etc/nginx/conf.d/
echo
grep -rn "listen 443" /etc/nginx/ 2>/dev/null
echo
cat -n /etc/nginx/conf.d/pvhot.conf
echo
systemctl is-active nginx 2>/dev/null
echo
curl -s -m 5 -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1/ || echo
echo
ls -l /etc/letsencrypt/live/ 2>/dev/null || echo
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=40)
    print(stdout.read().decode("utf-8", "ignore"))
    err = stderr.read().decode("utf-8", "ignore")
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
