import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

cmd = (
    'echo "=== 302 Location ==="; '
    'curl -s -A "Mozilla/5.0" -D - "https://news.google.com/rss/search?q=solar&hl=en&gl=US&ceid=US:en" -o /dev/null --max-time 20 | grep -i "location"; '
    'echo "=== follow redirect (-L) ==="; '
    'curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" "https://news.google.com/rss/search?q=solar&hl=en&gl=US&ceid=US:en" -o /tmp/gn1.xml -w "HTTP:%{http_code} SIZE:%{size_download}\\n" --max-time 25; '
    'echo "--- item count ---"; grep -c "<item>" /tmp/gn1.xml; '
    'echo "--- first 3 pubDate ---"; grep -o "<pubDate>[^<]*</pubDate>" /tmp/gn1.xml | head -3; '
    'echo "--- head of xml ---"; head -c 300 /tmp/gn1.xml'
)
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode('utf-8', 'replace'))
err = stderr.read().decode('utf-8', 'replace')
if err.strip():
    print("STDERR:", err)
ssh.close()
