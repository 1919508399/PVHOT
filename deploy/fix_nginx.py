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

# ---- 1) 恢复有效 80-only 配置（移除引用缺失证书的 443 块，避免重启失败）----
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
run('systemctl is-active nginx')
run("curl -sI --max-time 8 http://47.250.92.231/ -o /dev/null -w 'IP HTTP %{http_code}\\n'")

# ---- 2) pip 安装 certbot（ALinux4 官方源无此包）----
run('python3 --version; python3 -m pip --version 2>/dev/null || echo NOPIP')
run('python3 -m pip install --quiet --upgrade pip', t=120)
run('python3 -m pip install --quiet certbot 2>&1 | tail -8', t=300)
_,e=run('which certbot || ls /usr/local/bin/certbot 2>/dev/null || echo NOCERTBOT')
# certbot 可能在 /usr/local/bin
run('/usr/local/bin/certbot --version 2>/dev/null || python3 -m certbot --version 2>/dev/null || echo VERSION_UNKNOWN')

sftp.close(); ssh.close()
print('\n===== RUN1 DONE =====')
