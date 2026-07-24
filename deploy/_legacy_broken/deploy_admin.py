#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 部署光伏 HOT 后台系统：上传文件 + 初始化 + nginx 反代 + systemd + cron + 冒烟测试
import paramiko, hashlib, time, sys

HOST, PORT, USER, PASS = '47.250.92.231', 22, 'root',
LOCAL = r'C:\Users\HUASUN\Desktop\新闻'
REMOTE_DIR =
# ---- 默认后台密码（sha256 预置，登录用：pvhot2026）----
ADMIN_PASS =
ADMIN_HASH = hashlib.sha256(ADMIN_PASS.encode('utf-8')).hexdigest()

# ---- nginx 配置（新增 /admin 反代，proxy_pass 不带末尾斜杠，保留完整 /admin 前缀给 node 路由）----
NGINX_CONF = r'''
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.bbroot.com 47.250.92.231;

    location = /admin { return 301 /admin/; }
    location /admin/ {
        proxy_pass http://127.0.0.1:8777;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /.well-known/ { }

    root /var/www/pvhot;
    index index.html;

    location ~ /\. { deny all; }

    location / { try_files $uri $uri/ /index.html; }

    location ~* \.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h; add_header Cache-Control "public, max-age=3600";
    }
    location = /data.json { add_header Cache-Control "no-cache"; }
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
'''

# ---- systemd 服务 ----
SYSTEMD_UNIT = r'''
[Unit]
Description=PVHOT Admin Backend
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /var/www/pvhot/admin_server.js
WorkingDirectory=/var/www/pvhot
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
'''

CRON_LINE =
def run_ssh(ssh, cmd, timeout=120):
    print('\n=== $', cmd[:70])
    si, so, se = ssh.exec_command(cmd, timeout=timeout)
    out = so.read().decode('utf-8', errors='ignore')
    err = se.read().decode('utf-8', errors='ignore')
    if out.strip():
        print(out)
    if err.strip():
        print('[stderr]', err[:800])
    return out, err


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
    sftp = ssh.open_sftp()

    # 1) 上传文件
    files = ['fetch_pv_news.js', 'merge.js', 'admin_server.js', 'admin.html', 'app.js']
    for f in files:
        lpath = f'{LOCAL}\\{f}'
        rpath = f'{REMOTE_DIR}/{f}'
        with open(lpath, 'rb') as fh:
            sftp.putfo(fh, rpath)
        print(f'uploaded {rpath}')

    # 2) 初始化空壳
    with sftp.open(f'{REMOTE_DIR}/admin_edits.json', 'w') as fh:
        fh.write('{"deleted":[],"overrides":{},"added":[]}')
    print('wrote admin_edits.json (empty)')
    with sftp.open(f'{REMOTE_DIR}/admin_pass.txt', 'w') as fh:
        fh.write(ADMIN_HASH)
    print(f'wrote admin_pass.txt (default pass = {ADMIN_PASS})')

    # 3) 写 nginx conf + systemd unit
    with sftp.open('/etc/nginx/conf.d/pvhot.conf', 'w') as fh:
        fh.write(NGINX_CONF)
    print('wrote /etc/nginx/conf.d/pvhot.conf')
    with sftp.open('/etc/systemd/system/pvhot-admin.service', 'w') as fh:
        fh.write(SYSTEMD_UNIT)
    print('wrote /etc/systemd/system/pvhot-admin.service')

    sftp.close()

    # 4) 跑抓取 + 合并（生成 data_raw.json -> data.json + data_fallback.js）
    run_ssh(ssh, f'cd {REMOTE_DIR} && /usr/bin/node fetch_pv_news.js 2>&1 | tail -6', timeout=180)
    run_ssh(ssh, f'cd {REMOTE_DIR} && /usr/bin/node merge.js 2>&1 | tail -3', timeout=60)

    # 5) 校验 data.json 条数 + id 是否已稳定哈希
    run_ssh(ssh, "cd %s && python3 -c \"import json; d=json.load(open('data.json')); print('data.json items:', len(d['items'])); print('sample id:', d['items'][0]['id']); print('has featuredfield:', 'featured' in d['items'][0])\"" % REMOTE_DIR)

    # 6) nginx 语法检查 + reload
    run_ssh(ssh, 'nginx -t')
    run_ssh(ssh, 'systemctl daemon-reload')
    run_ssh(ssh, 'systemctl enable --now pvhot-admin')
    run_ssh(ssh, 'systemctl is-active pvhot-admin')
    run_ssh(ssh, 'nginx -s reload')

    # 7) 更新 cron
    run_ssh(ssh, f"echo '{CRON_LINE}' | crontab -")
    run_ssh(ssh, "crontab -l | grep -v '^#'")

    # 8) 冒烟测试
    run_ssh(ssh, "curl -s -o /dev/null -w 'GET /admin/ -> HTTP %{http_code}\\n' http://localhost/admin/")
    # 登录拿 cookie
    ssh.exec_command("curl -s -c /tmp/ck.txt pass\":\"%s\"}' http://localhost/admin/api/login > /tmp/login.json" % ADMIN_PASS)
    run_ssh(ssh, "cat /tmp/login.json")
    # 带 cookie 拉列表
    run_ssh(ssh, "curl -s -b /tmp/ck.txt 'http://localhost/admin/api/items?pageSize=2' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('list total:', d['total']); [print('  -', (i.get('title_cn') or i.get('title'))[:40]) for i in d['items']]\"")
    # 未登录应被拒
    run_ssh(ssh, "curl -s -o /dev/null -w 'no-auth items -> HTTP %{http_code}\\n' http://localhost/admin/api/items")

    ssh.close()
    print('\n=== DONE ===')


if __name__ == '__main__':
    main()
