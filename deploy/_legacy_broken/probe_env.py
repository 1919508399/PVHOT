"""探测服务器环境：certbot / node / Google News RSS 可达性 / 当前 nginx 80"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
CMD = r"""
echo "=== os ==="; cat /etc/os-release | head -3
echo "=== certbot ==="; which certbot 2>/dev/null || echo
echo "=== python3 ==="; which python3 2>/dev/null || echo
echo "=== node ==="; which node 2>/dev/null || echo
echo "=== nginx 80 self ==="; curl -s -m 5 -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1/
echo
curl -s -m 20 -o /tmp/gn_us.xml -w "HTTP:%{http_code} SIZE:%{size_download}\n" "https://news.google.com/rss/search?q=photovoltaic+OR+solar+OR+silicon&hl=en-US&gl=US&ceid=US:en" || echo
echo
curl -s -m 20 -o /tmp/gn_cn.xml -w "HTTP:%{http_code} SIZE:%{size_download}\n" "https://news.google.com/rss/search?q=%E5%85%89%E4%BC%8F+OR+%E7%BB%84%E4%BB%B6&hl=zh-CN&gl=CN&ceid=CN:zh-Hans" || echo
echo "=== gn_us head ==="; head -c 300 /tmp/gn_us.xml 2>/dev/null
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=60)
    print(stdout.read().decode("utf-8", "ignore"))
    err = stderr.read().decode("utf-8", "ignore")
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
