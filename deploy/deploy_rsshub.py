#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RSSHub 部署脚本：在服务器上部署 RSSHub 用于微博/微信公众号/X 等社交媒体信源
  1. git clone RSSHub 到 /opt/RSSHub
  2. npm install --production
  3. 创建 systemd service (port 1200, 127.0.0.1 only)
  4. 启动 + 测试
"""
import os, sys, time, paramiko, urllib.request, urllib.error

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ssh_exec(ssh, cmd, timeout=120):
    log('ssh> ' + cmd)
    i, o, e = ssh.exec_command(cmd, timeout=timeout)
    out = o.read().decode('utf-8', errors='replace')
    err = e.read().decode('utf-8', errors='replace')
    if out: print(out, end='')
    if err: print('STDERR>', err, end='')
    return out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log('Connecting to ' + HOST + '...')
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)

    # 1. 检查是否已安装
    out, _ = ssh_exec(ssh, 'test -d /opt/RSSHub && echo EXISTS || echo NOTFOUND')
    if 'EXISTS' in out:
        log('RSSHub already exists, pulling latest...')
        ssh_exec(ssh, 'cd /opt/RSSHub && git pull', timeout=60)
    else:
        log('Cloning RSSHub...')
        ssh_exec(ssh, 'cd /opt && git clone https://github.com/DIYgod/RSSHub.git', timeout=120)

    # 2. npm install
    log('Installing dependencies...')
    out, err = ssh_exec(ssh, 'cd /opt/RSSHub && npm install --production 2>&1 | tail -5', timeout=300)
    if 'npm error' in (out + err).lower():
        log('WARN: npm install had errors, trying pnpm...')
        ssh_exec(ssh, 'cd /opt/RSSHub && npm install --production --legacy-peer-deps 2>&1 | tail -5', timeout=300)

    # 3. 创建 systemd service
    service = '''[Unit]
Description=RSSHub (social media feeds for pvhot)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/RSSHub
ExecStart=/usr/bin/node lib/pkg.js
Restart=always
RestartSec=10
Environment=PORT=1200
Environment=HOST=127.0.0.1
Environment=CACHE_TYPE=memory
Environment=CACHE_EXPIRE=600
Environment=REQUEST_TIMEOUT=30000

[Install]
WantedBy=multi-user.target
'''
    log('Writing systemd service...')
    sftp = ssh.open_sftp()
    with sftp.file('/etc/systemd/system/rsshub.service', 'w') as f:
        f.write(service)
    sftp.chmod('/etc/systemd/system/rsshub.service', 0o644)
    sftp.close()

    # 4. 启动
    ssh_exec(ssh, 'systemctl daemon-reload')
    ssh_exec(ssh, 'systemctl enable rsshub')
    ssh_exec(ssh, 'systemctl restart rsshub')
    time.sleep(3)

    # 5. 检查状态
    out, _ = ssh_exec(ssh, 'systemctl is-active rsshub')
    if 'active' in out:
        log('RSSHub is ACTIVE')
    else:
        log('ERROR: RSSHub not active, checking logs...')
        ssh_exec(ssh, 'journalctl -u rsshub --no-pager -n 30')

    # 6. 测试微博搜索路由
    log('Testing RSSHub routes...')
    # 微博搜索
    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null')
    log('  weibo search: HTTP ' + out.strip())

    # 微信搜索 (sogou)
    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/wechat/sogou/%E5%85%89%E4%BC%8F" 2>/dev/null')
    log('  wechat sogou: HTTP ' + out.strip())

    # 7. 检查 RSSHub 实际返回内容（微博搜索）
    out, _ = ssh_exec(ssh, 'curl -s "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null | head -50')
    if '<item>' in out or '<title>' in out:
        log('  weibo search: has content')
    else:
        log('  weibo search: no content (may need cookies)')

    ssh.close()
    log('Done.')

if __name__ == '__main__':
    main()
