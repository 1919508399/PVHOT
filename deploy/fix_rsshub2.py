#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RSSHub 二次修复：装完整依赖 + build dist/"""
import os, sys, time, paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ssh_exec(ssh, cmd, timeout=300):
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

    # 1. 安装完整依赖（含 dev）
    log('Installing full dependencies (incl dev)...')
    ssh_exec(ssh, 'cd /opt/RSSHub && npm install --legacy-peer-deps 2>&1 | tail -10', timeout=300)

    # 2. Build
    log('Building dist/...')
    out, err = ssh_exec(ssh, 'cd /opt/RSSHub && npm run build 2>&1 | tail -20', timeout=300)
    
    # 检查 dist/ 是否生成
    out2, _ = ssh_exec(ssh, 'ls -la /opt/RSSHub/dist/index.mjs 2>/dev/null && echo BUILT || echo NOPE')
    if 'BUILT' in out2:
        log('dist/index.mjs exists!')
    else:
        log('ERROR: dist/ not built, trying alternative...')
        # 尝试直接用 tsx 跑
        ssh_exec(ssh, 'cd /opt/RSSHub && npx tsx lib/router.ts --port 1200 &', timeout=10)
        time.sleep(5)

    # 3. 重启 systemd
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
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
'''
    sftp = ssh.open_sftp()
    with sftp.file('/etc/systemd/system/rsshub.service', 'w') as f:
        f.write(service)
    sftp.chmod('/etc/systemd/system/rsshub.service', 0o644)
    sftp.close()

    ssh_exec(ssh, 'systemctl daemon-reload')
    ssh_exec(ssh, 'systemctl restart rsshub')
    time.sleep(8)

    out, _ = ssh_exec(ssh, 'systemctl is-active rsshub')
    if 'active' in out:
        log('RSSHub is ACTIVE!')
    else:
        log('Still not active, checking logs...')
        ssh_exec(ssh, 'journalctl -u rsshub --no-pager -n 20')

    # 4. 测试
    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/" 2>/dev/null')
    log('homepage: HTTP ' + out.strip())

    out, _ = ssh_exec(ssh, 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null')
    log('weibo search: HTTP ' + out.strip())

    out, _ = ssh_exec(ssh, 'curl -s "http://127.0.0.1:1200/weibo/search/keyword/%E5%85%89%E4%BC%8F" 2>/dev/null | grep -c "<item>"')
    log('weibo items: ' + out.strip())

    ssh.close()
    log('Done.')

if __name__ == '__main__':
    main()
