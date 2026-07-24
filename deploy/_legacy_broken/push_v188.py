#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""push_v188.py — 修复精选页日期头：去掉 2026年、月份前导 0，改成「7月23日 星期四」"""
import os, sys, time, paramiko, urllib.request, urllib.parse, urllib.error
HOST='47.250.92.231'; PORT=22; USER='root'; PWD='369287zjb@1998'
ROOT='/var/www/pvhot'; DOMAIN='https://pvhot.bbroot.com'
HERE=os.path.dirname(__file__)
FILES=[(os.path.join(HERE,'..','app.js'), ROOT+'/app.js')]
def run(ssh, cmd, label):
    i,o,e=ssh.exec_command(cmd); out=o.read().decode('utf-8','ignore'); err=e.read().decode('utf-8','ignore')
    code=o.channel.recv_exit_status()
    print(f'  [{label}] exit={code}')
    if out.strip(): print('   ', out.strip().replace('\n','\n    '))
    if err.strip(): print('   ! ', err.strip()[:300])
    return code
def feedback_check():,'content':'v18.8 push '+time.strftime('%H:%M:%S')}).encode()
    req=urllib.request.Request(DOMAIN+'/api/ping', headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req,timeout=8) as r: print(f'  ✓ /api/ping HTTP {r.status}'); return r.status==200
    except urllib.error.HTTPError as e: print(f'  ~ /api/ping HTTP {e.code}（到达后端，反代 OK）'); return e.code in (400,422)
    except Exception as e: print(f'  ✗ /api/ping ERR {e!r}'); return False
def main():
    print('=== push_v188 ===')
    ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST,PORT,USER,PWD,timeout=10)
    sftp=ssh.open_sftp()
    for lp,rp in FILES: sftp.put(lp,rp); print(f'  ↑ {rp} ({sftp.stat(rp).st_size} bytes)')
    sftp.close()
    time.sleep(1)
    ok=feedback_check(); ssh.close()
    if not ok: print('!!! 健康检查失败'); sys.exit(2)
    print('=== push_v188 DONE ===')
if __name__=='__main__': main()
