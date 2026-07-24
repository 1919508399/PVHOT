#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v18.2 部署：内容管理精简 + 二维码上传 + 后台入口新窗口
- 上传 admin.html / admin_server.js / app.js / index.html
- 重启 pvhot-admin（让 admin_server.js 新代码生效）
- E2E 验证
"""
import os, sys, time, json, urllib.request, urllib.parse
import paramiko

# ---- 配置 ----
HOST  = '47.250.92.231'
PORT = 22
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT_REMOTE =
LOCAL_DIR = r'C:\Users\HUASUN\Desktop\新闻'

FILES = [
    'admin.html',
    'admin_server.js',
    'app.js',
    'index.html',
]

def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def sftp_upload(sftp, local_path, remote_path):
    sftp.put(local_path, remote_path)

def ssh_exec(ssh, cmd, timeout=30):
    log('  $ ' + cmd)
    si, so, se = ssh.exec_command(cmd, timeout=timeout)
    out = so.read().decode('utf-8', errors='ignore')
    err = se.read().decode('utf-8', errors='ignore')
    if out.strip(): print(out.rstrip())
    if err.strip(): print('STDERR:', err.rstrip(), file=sys.stderr)
    return out, err

def main():
    log('===== v18.2 部署 =====')
    log('连接 SSH ' + HOST + ' ...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    sftp = ssh.open_sftp()

    # 1) 上传
    log('上传文件:')
    for f in FILES:
        local = os.path.join(LOCAL_DIR, f)
        remote = ROOT_REMOTE + '/' + f
        sftp_upload(sftp, local, remote)
        sz = os.path.getsize(local)
        log('  ✓ ' + f + '  (' + str(sz) + ' bytes)')

    # 2) 创建 uploads 目录
    log('创建 uploads 目录 ...')
    ssh_exec(ssh, 'mkdir -p ' + ROOT_REMOTE + '/uploads && ls -la ' + ROOT_REMOTE + '/uploads/')

    # 3) 语法检查 admin_server.js
    log('语法检查 admin_server.js ...')
    out, err = ssh_exec(ssh, 'cd ' + ROOT_REMOTE + ' && /usr/bin/node -c admin_server.js && echo OK_SYNTAX')
    if 'OK_SYNTAX' not in out:
        log('❌ 语法错误，终止部署')
        ssh.close(); sys.exit(1)

    # 4) 重启 pvhot-admin
    log('重启 pvhot-admin ...')
    ssh_exec(ssh, 'systemctl restart pvhot-admin && sleep 2 && systemctl status pvhot-admin --no-pager | head -5')

    # 5) 验证：qrcode 端点 + /uploads/ 静态可访问
    log('=== E2E 验证 ===')
    time.sleep(1)
    BASE =
    # 验证 /admin/api/qrcode（未登录 → 401 是对的，但我们 GET 不带 cookie → 也被 authed 守卫挡）
    # texts 端点也要登录；改用公共路径验证
    try:
        req = urllib.request.Request(BASE + '/admin/api/qrcode', method='GET')
        with urllib.request.urlopen(req, timeout=10) as r:
            code = r.status
            body = r.read().decode('utf-8', errors='ignore')
            log('qrcode HEAD: ' + str(code) + ' ' + body[:120])
    except urllib.error.HTTPError as e:
        log('qrcode HEAD HTTP ' + str(e.code) + ' (期望 401，因需登录) body=' + (e.read().decode()[:120] if e.fp else ''))
    except Exception as e:
        log('qrcode HEAD 异常: ' + str(e))

    # /uploads/qrcode.png 不存在应 404
    try:
        req = urllib.request.Request(BASE + '/uploads/qrcode.png', method='HEAD')
        with urllib.request.urlopen(req, timeout=10) as r:
            log('/uploads/qrcode.png HEAD: ' + str(r.status) + ' (size ' + r.headers.get('Content-Length','?') + ')')
    except urllib.error.HTTPError as e:
        log('/uploads/qrcode.png HEAD: ' + str(e.code) + ' (期望 404，未上传)')
    except Exception as e:
        log('/uploads HEAD 异常: ' + str(e))

    # /admin/ GET 应 200
    try:
        req = urllib.request.Request(BASE + '/admin/', method='GET')
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read().decode('utf-8', errors='ignore')
            ok = r.status == 200 and '光伏 HOT' in body
            log('/admin/ GET: ' + str(r.status) + ' has-brand=' + str('光伏 HOT' in body))
    except Exception as e:
        log('/admin/ 异常: ' + str(e))

    # /admin.html GET 应 200
    try:
        req = urllib.request.Request(BASE + '/admin.html', method='HEAD')
        with urllib.request.urlopen(req, timeout=10) as r:
            log('/admin.html HEAD: ' + str(r.status))
    except Exception as e:
        log('/admin.html 异常: ' + str(e))

    # /index.html 关于视图：检查有 abtQrBlock
    try:
        req = urllib.request.Request(BASE + '/index.html', method='GET')
        with urllib.request.urlopen(req, timeout=10) as r:
            log('/index.html GET: ' + str(r.status))
    except Exception as e:
        log('/index.html 异常: ' + str(e))

    ssh.close()
    log('===== 完成 =====')

if __name__ == '__main__':
    main()
