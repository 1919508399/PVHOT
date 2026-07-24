#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_v185.py —— v18.5 图2 风格时间线部署
- 仅前端：sftp 上传 styles.css（app.js 未改）
- 铁律：改 conf/nginx 后必 curl GET /api/ping 200（这里仅前端，但跑一次确认站点仍健康）
"""
import os, sys, time, paramiko, urllib.request, urllib.parse, urllib.error, json

HOST  = '47.250.92.231'
PORT = 22
USER  = 'root'
PWD  =
ROOT  = '/var/www/pvhot'
DOMAIN =
LOCAL_FILES = [
    (os.path.join(os.path.dirname(__file__), '..', 'styles.css'),
     ROOT + '/styles.css'),
]

def sftp_upload(sftp, local, remote):
    sftp.put(local, remote)
    sz = sftp.stat(remote).st_size
    print(f'  ↑ {remote}  ({sz} bytes)')

def post_feedback_check():
    """铁律：改 conf/前端后必跑一次 /api/ping 验站点还活着""",
        'content': 'v18.5 push ' + time.strftime('%Y-%m-%d %H:%M:%S'),
    }).encode()
    req = urllib.request.Request(DOMAIN + '/api/ping',
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read().decode('utf-8', 'ignore')[:200]
            print(f'  ✓ /api/ping HTTP {r.status}  body[:200]={body!r}')
            return r.status == 200
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')[:200]
        print(f'  ! /api/ping HTTP {e.code}  body[:200]={body!r}')
        # 400/422 表示到达后端只是字段问题，反代 OK
        return e.code in (400, 422)
    except Exception as e:
        print(f'  ✗ /api/ping ERR {e!r}')
        return False

def main():
    print('=== push_v185 ===')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PWD, timeout=10)
    sftp = ssh.open_sftp()

    for lp, rp in LOCAL_FILES:
        sftp_upload(sftp, lp, rp)
    sftp.close()

    # 强刷缓存（force-reload）
    ssh.exec_command('rm -f /var/www/pvhot/styles.css.bak')
    print('  ✓ 上传完成')

    # 等 1s 再 GET 一次确认 200
    time.sleep(1)
    try:
        with urllib.request.urlopen(DOMAIN + '/styles.css?v=' + str(int(time.time())), timeout=8) as r:
            n = int(r.headers.get('Content-Length') or 0)
            print(f'  ✓ GET /styles.css HTTP {r.status}  {n} bytes')
    except Exception as e:
        print(f'  ✗ GET /styles.css ERR {e!r}')

    ok = post_feedback_check()
    ssh.close()
    if not ok:
        print('!!! 站点健康检查失败，请人工介入')
        sys.exit(2)
    print('=== push_v185 DONE ===')

if __name__ == '__main__':
    main()
