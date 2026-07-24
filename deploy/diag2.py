import paramiko

HOST='47.250.92.231'; USER='root'; PW='369287zjb@1998'
ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,username=USER,password=PW,timeout=30)

cmds = [
    "echo '=== DNS pvhot.pp.ua ===' && dig +short pvhot.pp.ua @8.8.8.8 || getent hosts pvhot.pp.ua",
    "echo '=== DNS pvhot.duckdns.org ===' && dig +short pvhot.duckdns.org @8.8.8.8",
    "echo '=== certbot 是否安装 ===' && (which certbot || rpm -q certbot || echo 'NO certbot')",
    "echo '=== 当前 nginx server_name ===' && grep -n server_name /etc/nginx/conf.d/pvhot.conf",
    "echo '=== 443 端口监听? ===' && (ss -ltnp | grep ':443' || echo '443 未监听')",
    "echo '=== 防火墙放行? ===' && (firewall-cmd --list-services 2>/dev/null; firewall-cmd --list-ports 2>/dev/null)",
    "echo '=== 用户最近访问日志(看是否还在连duckdns) ===' && tail -5 /var/log/nginx/access.log",
]
for c in cmds:
    print('\n----- '+c.split('&&')[-1].strip()[:50])
    stdin,stdout,stderr=ssh.exec_command(c,timeout=15)
    out=stdout.read().decode(errors='replace').strip()
    err=stderr.read().decode(errors='replace').strip()
    print(out)
    if err: print('  ERR:',err)
ssh.close()
