import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

cmd = (
    'echo "=== curl solar ===" && '
    'curl -s -A "Mozilla/5.0" "https://news.google.com/rss/search?q=solar&hl=en&gl=US&ceid=US:en" -o /tmp/gn1.xml -w "HTTP:%{http_code} SIZE:%{size_download}\\n" --max-time 20; '
    'echo "--- item count ---"; grep -c "<item>" /tmp/gn1.xml; '
    'echo "--- first pubDate ---"; grep -o "<pubDate>[^<]*</pubDate>" /tmp/gn1.xml | head -3; '
    'echo "=== curl chinese ==="; '
    'curl -s -A "Mozilla/5.0" "https://news.google.com/rss/search?q=%E5%85%89%E4%BC%8F&hl=zh-CN&gl=CN&ceid=CN:zh-CN" -o /tmp/gn2.xml -w "HTTP:%{http_code} SIZE:%{size_download}\\n" --max-time 20; '
    'echo "--- item count ---"; grep -c "<item>" /tmp/gn2.xml; '
    'echo "--- first pubDate ---"; grep -o "<pubDate>[^<]*</pubDate>" /tmp/gn2.xml | head -3'
)
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode('utf-8', 'replace'))
err = stderr.read().decode('utf-8', 'replace')
if err.strip():
    print("STDERR:", err)
ssh.close()
