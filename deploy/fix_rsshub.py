#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 RSSHub 入口：查 package.json 找正确入口，修 systemd service，重启"""
import os, sys, time, paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ssh_exec(ssh, cmd, timeout=60):
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
    log('Connecting...')
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)

    # 1. 查 package.json 找入口
    out, _ = ssh_exec(ssh, 'cd /opt/RSSHub && node -e "const p=require("./package.json"); console.log(JSON.stringify({main:p.main,scripts:p.scripts,start:p.scripts&&p.scripts.start}))"')
    log('package.json: ' + out.strip())

    # 2. 查实际文件
    out, _ = ssh_exec(ssh, 'ls /opt/RSSHub/lib/*.js 2>/dev/null; ls /opt/RSSHub/lib/pkg/ 2>/dev/null; ls /opt/RSSHub/*.js 2>/dev/null')
    log('files: ' + out.strip())

    # 3. 试用 npm start
    out, _ = ssh_exec(ssh, 'cd /opt/RSSHub && timeout 5 npm start 2>&1 | head -20', timeout=15)

    # 4. 修 systemd service
    service = '''[Unit]
Description=RSSHub (social media feeds for pvhot)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/RSSHub
ExecStart=/usr/bin/npm start
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
    log('Writing fixed systemd service...')
    sftp = ssh.open_sftp()
    with sftp.file('/etc/systemd/system/rsshub.service', 'w') as f:
        f.write(service)
    sftp.chmod('/etc/systemd/system/rsshub.service', 0o644)
    sftp.close()

    ssh_exec(ssh, 'systemctl daemon-reload')
    ssh_exec(ssh, 'systemctl restart rsshub')
    time.sleep(5)

    out, _ = ssh_exec(ssh, 'systemctl is-active rsshub')
    if 'active' in out:
        log('RSSHub is ACTIVE')
    else:
        log('ERROR: still not active, checking logs...')
        ssh_exec(ssh, 'journalctl -u rsshub --no-pager -n 40')

    # 5. 测试路由
    log('Testing routes...')
    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/" 2>/dev/null')
    log('  homepage: HTTP ' + out.strip())

    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null')
    log('  weibo search: HTTP ' + out.strip())

    out, _ = ssh_exec(ssh, 'curl -s "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null | head -100')
    if '<item>' in out or '<title>' in out:
        log('  weibo search: HAS CONTENT')
    else:
        log('  weibo search: no content')
        log('  response: ' + out[:200])

    ssh.close()
    log('Done.')

if __name__ == '__main__':
    main()
