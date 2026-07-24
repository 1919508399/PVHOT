import paramiko

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

# 0) 确认 certbot 可用
run('/usr/bin/certbot --version')

# 1) 签发证书（LE 服务端能访问 duckdns，webroot 已放行 /.well-known）
run('/usr/bin/certbot certonly --webroot -w /var/www/pvhot -d pvhot.duckdns.org '
    '--rsa-key-size 2048 --key-type rsa', t=120)
run('ls -la /etc/letsencrypt/live/pvhot.duckdns.org/ 2>/dev/null || echo NOCERT')

# 2) 写 80+443 双开配置（不强制跳转，保留 80 给 VPN/续期用户）
conf = '''server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.pp.ua pvhot.duckdns.org 47.250.92.231;

    location ^~ /.well-known/ { }

    root /var/www/pvhot;
    index index.html;

    location ~ /\\. { deny all; }

    location / { try_files $uri $uri/ /index.html; }

    location ~* \\.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h; add_header Cache-Control "public, max-age=3600";
    }
    location = /data.json { add_header Cache-Control "no-cache"; }
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}

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

    location / { try_files $uri $uri/ /index.html; }

    location ~* \\.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h; add_header Cache-Control "public, max-age=3600";
    }
    location = /data.json { add_header Cache-Control "no-cache"; }
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
'''
with sftp.open('/etc/nginx/conf.d/pvhot.conf','w') as f:
    f.write(conf)
run('nginx -t')
run('systemctl reload nginx')

# 3) 验证
run("curl -sI --max-time 10 https://127.0.0.1/ -o /dev/null -w 'localhost HTTPS %{http_code}\\n' -k")
run("curl -sI --max-time 15 https://pvhot.duckdns.org/ -o /dev/null -w 'duckdns HTTPS %{http_code}\\n' -k")
run("curl -sI --max-time 10 http://47.250.92.231/ -o /dev/null -w 'IP HTTP80 %{http_code}\\n'")
run("echo '--- 续期模拟 ---'; /usr/bin/certbot renew --dry-run 2>&1 | tail -3")
# 4) 设自动续期（certbot 自带 systemd timer，确认启用）
run('systemctl enable certbot-renew.timer 2>/dev/null; systemctl list-timers 2>/dev/null | grep -i certbot || echo "timer检查跳过"')

sftp.close(); ssh.close()
print('\n===== RUN2 DONE =====')
