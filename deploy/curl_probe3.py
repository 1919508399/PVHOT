import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

# 跟随重定向抓 solar + photovoltaic，数 item 和最近7天分布
cmd = r'''
for q in "solar" "photovoltaic" "solar%20panel" "polysilicon" "solar%20energy"; do
  curl -sL -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" "https://news.google.com/rss/search?q=$q&hl=en-US&gl=US&ceid=US:en" -o /tmp/g.xml --max-time 25
  total=$(grep -o "<item>" /tmp/g.xml | wc -l)
  # 提取 pubDate 并统计最近7天
  recent=0
  while IFS= read -r d; do
    t=$(date +%s 2>/dev/null)
    [ -z "$t" ] && continue
    now=$(date +%s)
    if [ $((now - t)) -lt 604800 ]; then recent=$((recent+1)); fi
  done < <(grep -o "<pubDate>[^<]*</pubDate>" /tmp/g.xml | sed 's/<[^>]*>//g')
  echo
done
'''
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode('utf-8', 'replace'))
err = stderr.read().decode('utf-8', 'replace')
if err.strip():
    print("STDERR:", err)
ssh.close()
