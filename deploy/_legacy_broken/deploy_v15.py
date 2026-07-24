#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""v15: 3 处界面改造
1) 改 fetch_pv_news.js: reason 字段从模板字 → 基于 summary_cn/标题/分类生成有意义描述
2) 改 app.js: renderItem 加作者头像 + 时间线, renderTimeline 改"星期X"格式 + day-head 加"·"分隔
3) 改 styles.css: .tl-item grid 两列(56px时间+1fr卡片), 加 .tl-avatar, .tl-reason 改蓝条
"""
import paramiko, os, sys, time

HOST  = '47.250.92.231'
USER  = 'root'
PWD  =
WEB  =
LOCAL = r'C:\Users\HUASUN\Desktop\新闻'

def main():
    print('connecting...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=20)
    sftp = ssh.open_sftp()

    files = [
        ('fetch_pv_news.js', f'{LOCAL}\\fetch_pv_news.js', f'{WEB}/fetch_pv_news.js', 0o755),
        ('app.js',          f'{LOCAL}\\app.js',          f'{WEB}/app.js',          0o644),
        ('styles.css',      f'{LOCAL}\\styles.css',      f'{WEB}/styles.css',      0o644),
    ]
    for name, local, remote, mode in files:
        if not os.path.exists(local):
            print(f'  [SKIP] {name} not found'); continue
        sz = os.path.getsize(local)
        print(f'  [UP]  {name} ({sz:,} bytes)')
        sftp.put(local, remote)
        sftp.chmod(remote, mode)

    sftp.close()

    print('running fetch_pv_news.js to refresh reason field...')
    si, so, se = ssh.exec_command(f'cd {WEB} && /usr/bin/node fetch_pv_news.js 2>&1 | tail -20')
    out = so.read().decode('utf-8', errors='ignore')
    err = se.read().decode('utf-8', errors='ignore')
    print(out)
    if err.strip(): print('STDERR:', err[:500])

    # verify HTTP
    si, so, se = ssh.exec_command(f'curl -sI -o /dev/null -w "HTTP %{http_code} | size=%{{size_download}}\\n" {WEB}/index.html')
    print('index.html:', so.read().decode().strip())
    si, so, se = ssh.exec_command(f'curl -s {WEB}/data.json | head -c 600')
    print('data.json sample:', so.read().decode('utf-8', errors='ignore')[:600])
    ssh.close()
    print('=== v15 deploy done ===')

if __name__ == '__main__':
    main()
