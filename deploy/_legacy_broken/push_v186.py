#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_v186.py —— v18.6 卡片标题下方"简短总结"（红杆）
- 上传 app.js / styles.css / fetch_pv_news.js / backfill_summary.js
- ssh 跑 backfill_summary.js（回填存量 summary）+ merge.js（重生成 data.json + fallback）
- 铁律：curl GET /api/ping 验反代健康
"""
import os, sys, time, paramiko, urllib.request, urllib.parse, urllib.error

HOST='47.250.92.231'; PORT=22; USER='root'; PWD='369287zjb@1998'
ROOT='/var/www/pvhot'; DOMAIN='https://pvhot.bbroot.com'
HERE=os.path.dirname(__file__)

FILES=[
    (os.path.join(HERE,'..','app.js'),               ROOT+'/app.js'),
    (os.path.join(HERE,'..','styles.css'),           ROOT+'/styles.css'),
    (os.path.join(HERE,'..','fetch_pv_news.js'),     ROOT+'/fetch_pv_news.js'),
    (os.path.join(HERE,'..','backfill_summary.js'),  ROOT+'/backfill_summary.js'),
]

def run(ssh, cmd, label):
    i,o,e=ssh.exec_command(cmd)
    out=o.read().decode('utf-8','ignore'); err=e.read().decode('utf-8','ignore')
    code=o.channel.recv_exit_status()
    print(f'  [{label}] exit={code}')
    if out.strip(): print('   ', out.strip().replace('\n','\n    '))
    if err.strip(): print('   ! ', err.strip()[:300])
    return code, out

def feedback_check():,'content':'v18.6 push '+time.strftime('%H:%M:%S')}).encode()
    req=urllib.request.Request(DOMAIN+'/api/ping',
        headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req,timeout=8) as r:
            print(f'  ✓ /api/ping HTTP {r.status}'); return r.status==200
    except urllib.error.HTTPError as e:
        print(f'  ~ /api/ping HTTP {e.code}（到达后端，反代 OK）'); return e.code in (400,422)
    except Exception as e:
        print(f'  ✗ /api/ping ERR {e!r}'); return False

def main():
    print('=== push_v186 ===')
    ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST,PORT,USER,PWD,timeout=10)
    sftp=ssh.open_sftp()
    for lp,rp in FILES:
        sftp.put(lp,rp); print(f'  ↑ {rp} ({sftp.stat(rp).st_size} bytes)')
    sftp.close()

    # 回填存量 summary
    run(ssh,'cd %s && node backfill_summary.js'%ROOT,'backfill')
    # 重新合并生成 data.json + fallback
    code,_=run(ssh,'cd %s && node merge.js'%ROOT,'merge')
    if code!=0:
        print('!!! merge 失败'); ssh.close(); sys.exit(2)

    # 校验 data.json summary 覆盖率
    run(ssh, 'cd %s && node -e "const d=JSON.parse(require(\'fs\').readFileSync(\'data.json\',\'utf8\'));const w=d.items.filter(x=>x.summary&&x.summary.length>=5).length;console.log(\'data.json items=\'+d.items.length+\' with summary=\'+w)"'%ROOT, 'verify-coverage')

    time.sleep(1)
    try:
        with urllib.request.urlopen(DOMAIN+'/data.json?v='+str(int(time.time())),timeout=8) as r:
            print(f'  ✓ GET /data.json HTTP {r.status}')
    except Exception as e:
        print(f'  ✗ GET /data.json ERR {e!r}')

    ok=feedback_check()
    ssh.close()
    if not ok: print('!!! 健康检查失败'); sys.exit(2)
    print('=== push_v186 DONE ===')

if __name__=='__main__':
    main()
