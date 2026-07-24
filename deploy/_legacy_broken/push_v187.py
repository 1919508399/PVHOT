#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_v187.py —— v18.7 修复"短标题 / 总结重复"
- 上传 app.js / fetch_pv_news.js / backfill_summary.js
- ssh 跑 backfill_summary.js（回填 title_short + 去尾源 summary）+ merge.js
- 校验：data.json 每条有 title_short；随机抽样 title_short != summary（不重复）
- 铁律：curl GET /api/ping 验反代健康
"""
import os, sys, time, paramiko, urllib.request, urllib.parse, urllib.error

HOST='47.250.92.231'; PORT=22; USER='root'; PWD='369287zjb@1998'
ROOT='/var/www/pvhot'; DOMAIN='https://pvhot.bbroot.com'
HERE=os.path.dirname(__file__)

FILES=[
    (os.path.join(HERE,'..','app.js'),               ROOT+'/app.js'),
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

def feedback_check():,'content':'v18.7 push '+time.strftime('%H:%M:%S')}).encode()
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
    print('=== push_v187 ===')
    ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST,PORT,USER,PWD,timeout=10)
    sftp=ssh.open_sftp()
    for lp,rp in FILES:
        sftp.put(lp,rp); print(f'  ↑ {rp} ({sftp.stat(rp).st_size} bytes)')
    sftp.close()

    # 回填：重算 title_short + 去尾源 summary
    run(ssh,'cd %s && node backfill_summary.js'%ROOT,'backfill')
    # 重新合并生成 data.json + fallback
    code,_=run(ssh,'cd %s && node merge.js'%ROOT,'merge')
    if code!=0:
        print('!!! merge 失败'); ssh.close(); sys.exit(2)

    # 校验 data.json：title_short 覆盖率 + 抽样"短标题≠总结"
    chk=(r"const d=JSON.parse(require('fs').readFileSync('data.json','utf8'));"
         r"const n=d.items.length;"
         r"const ts=d.items.filter(x=>x.title_short&&x.title_short.length>=2).length;"
         r"const norm=s=>(s||'').toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]+/g,'');"
         r"let dup=0;d.items.forEach(x=>{const a=norm(x.title_short||x.title_cn||x.title);"
         r"const b=norm((x.summary||'').replace(/…$/,''));"
         r"if(a&&b&&(a.startsWith(b.slice(0,20))||b.startsWith(a.slice(0,20))))dup++;});"
         r"console.log('items='+n+' with title_short='+ts+' summary_dup_with_title='+dup);"
         r"const sam=d.items.slice(0,3).map(x=>({t:x.title_short,s:x.summary}));"
         r"console.log(JSON.stringify(sam,null,1));")
    run(ssh, 'cd %s && node -e "%s"'%(ROOT, chk.replace('"','\\"')), 'verify')

    time.sleep(1)
    try:
        with urllib.request.urlopen(DOMAIN+'/data.json?v='+str(int(time.time())),timeout=8) as r:
            print(f'  ✓ GET /data.json HTTP {r.status}')
    except Exception as e:
        print(f'  ✗ GET /data.json ERR {e!r}')

    ok=feedback_check()
    ssh.close()
    if not ok: print('!!! 健康检查失败'); sys.exit(2)
    print('=== push_v187 DONE ===')

if __name__=='__main__':
    main()
