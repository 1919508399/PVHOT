#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.4 部署：紧凑时间线 + 日期头 ▾ 合并/分开切换
- 上传 app.js / styles.css（纯前端改动，nginx conf 不变）
- 铁律：push 后 curl GET /api/ping 验证 200
"""
import os, sys, time, paramiko, urllib.request, urllib.error, urllib.parse

HOST  = '47.250.92.231'
PORT = 22
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT_REMOTE =
LOCAL_DIR = r'C:\Users\HUASUN\Desktop\新闻'

FILES = ['app.js', 'styles.css']

def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def main():
    log('===== v18.4 部署 =====')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    sftp = ssh.open_sftp()

    log('上传文件:')
    for f in FILES:
        local = os.path.join(LOCAL_DIR, f)
        remote = ROOT_REMOTE + '/' + f
        sftp.put(local, remote)
        log('  ✓ ' + f + '  (' + str(os.path.getsize(local)) + ' bytes)')

    sftp.close()

    # 铁律：GET /api/ping 验证 200（nginx /api/ 反代没丢）
    log('=== 铁律验证：GET /api/ping ===')
    try:, method='GET',
                                    headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=10) as r:
            log('  /api/ping → ' + str(r.status) + ' ' + r.read().decode('utf-8', 'ignore')[:80])
    except urllib.error.HTTPError as e:
        log('  ❌ /api/ping HTTP ' + str(e.code) + ' ' + e.read().decode('utf-8', 'ignore')[:120])
    except Exception as e:
        log('  ❌ /api/ping 异常: ' + str(e))

    ssh.close()
    log('===== 完成 =====')

if __name__ == '__main__':
    main()
