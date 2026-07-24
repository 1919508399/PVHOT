import paramiko, time

HOST='47.250.92.231'; USER='root'; PW='369287zjb@1998'
ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,username=USER,password=PW,timeout=30)
sftp=ssh.open_sftp()

def run(c, t=120):
    print('\n===== '+c[:70])
    stdin,stdout,stderr=ssh.exec_command(c,timeout=t)
    out=stdout.read().decode(errors='replace').strip()
    err=stderr.read().decode(errors='replace').strip()
    if out: print(out)
    if err: print('  [ERR]',err)
    return out,err

# ---- Step 1: 安装 certbot（先禁掉失效的 docker 仓库；必要时开 EPEL）----
run('dnf install -y certbot --disablerepo=docker-ce-stable', t=240)
# 若 certbot 仍未装，尝试开 epel
_,e=run('which certbot || true')
if 'no certbot' in e or run('rpm -q certbot || echo MISSING')[0]=='MISSING':
    run('dnf install -y epel-release --disablerepo=docker-ce-stable', t=180)
    run('dnf install -y certbot --disablerepo=docker-ce-stable', t=240)
run('which certbot && certbot --version')

# ---- Step 2: 80 配置加 /.well-known 例外（certbot webroot 需要）----
conf80 = '''server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.pp.ua pvhot.duckdns.org 47.250.92.231;

    # Let's Encrypt 验证目录（必须在 deny 之前）
    location ^~ /.well-known/ { }

    root /var/www/pvhot;
    index index.html;

    location ~ /\\. {
        deny all;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location = /data.json {
        add_header Cache-Control "no-cache";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
'''
with sftp.open('/etc/nginx/conf.d/pvhot.conf','w') as f:
    f.write(conf80)
run('nginx -t')
run('systemctl reload nginx')

# ---- Step 3: 签发 Let's Encrypt 证书（duckdns 现在能解析，LE 服务端能访问）----
run('certbot certonly --webroot -w /var/www/pvhot -d pvhot.duckdns.org '
    '--rsa-key-size 2048', t=120)
run('ls -la /etc/letsencrypt/live/pvhot.duckdns.org/ 2>/dev/null || echo NOCERT')

# ---- Step 4: 写最终 80+443 双开配置 ----
conf_full = conf80 + '''
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name pvhot.pp.ua pvhot.duckdns.org 47.250.92.231;

    ssl_certificate     /etc/letsencrypt/live/pvhot.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pvhot.duckdns.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;

    root /var/www/pvhot;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location = /data.json {
        add_header Cache-Control "no-cache";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
'''
with sftp.open('/etc/nginx/conf.d/pvhot.conf','w') as f:
    f.write(conf_full)
run('nginx -t')
run('systemctl reload nginx')

# ---- Step 5: 验证 ----
run("echo '--- 443 本地 ---'; curl -sI --max-time 10 https://127.0.0.1/ -o /dev/null -w 'localhost HTTPS %{http_code}\\n' -k")
run("echo '--- 443 外部(经域名) ---'; curl -sI --max-time 15 https://pvhot.duckdns.org/ -o /dev/null -w 'duckdns HTTPS %{http_code}\\n' -k")
run("echo '--- 80 仍可用 ---'; curl -sI --max-time 10 http://47.250.92.231/ -o /dev/null -w 'IP HTTP %{http_code}\\n'")
run("echo '--- 自动续期测试(模拟) ---'; certbot renew --dry-run 2>&1 | tail -4")

sftp.close(); ssh.close()
print('\n===== DONE =====')
