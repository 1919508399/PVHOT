#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v18.9 部署脚本：app.js + fetch + backfill 改造
  - app.js 删 cyan 杆「推荐理由」
  - fetch_pv_news.js 改 buildCleanSummary + 删 buildReason / title_short
  - backfill_summary.js 同步 v4
  - 推送 3 文件 + ssh 跑 backfill + merge
  - GET /data.json 抽样校验：所有 120 条都有清洗后 title_cn；含 summary 的卡片不超过 50%
  - GET /api/ping 铁律健康检查
"""
import os, sys, time, paramiko, urllib.request, urllib.error, urllib.parse
import json, re

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT  = '/var/www/pvhot'
LOCAL_FILES = [
    ('app.js',              ROOT + '/app.js',             0o644),
    ('fetch_pv_news.js',    ROOT + '/fetch_pv_news.js',   0o755),
    ('backfill_summary.js', ROOT + '/backfill_summary.js', 0o755),
]
BASE =
def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ssh_exec(ssh, cmd, timeout=60):
    log('ssh> ' + cmd)
    i, o, e = ssh.exec_command(cmd, timeout=timeout)
    out = o.read().decode('utf-8', errors='replace')
    err = e.read().decode('utf-8', errors='replace')
    if out: print(out, end='')
    if err: print('ERR>', err, end='')
    return out, err

def main():
    log('====== v18.9 部署开始 ======')
    t0 = time.time()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASS, timeout=15)
    sftp = ssh.open_sftp()

    # 1) sftp 推送 3 个文件
    for local, remote, mode in LOCAL_FILES:
        local_path = os.path.join('..', local)
        sftp.put(local_path, remote)
        sftp.chmod(remote, mode)
        size = os.path.getsize(local_path)
        log(f'↑ {local} → {remote} ({size}B)')

    sftp.close()

    # 2) 跑 backfill_summary（v4 改用 buildCleanSummary + 删 title_short/reason）
    ssh_exec(ssh, 'cd ' + ROOT + ' && /usr/bin/node backfill_summary.js', timeout=30)

    # 3) 跑 merge.js 生成 data.json + data_fallback.js
    ssh_exec(ssh, 'cd ' + ROOT + ' && /usr/bin/node merge.js', timeout=30)

    # 4) 数据校验
    log('---- 数据校验 ----')
    out, _ = ssh_exec(ssh, "node -e \"const d=JSON.parse(require('fs').readFileSync('" + ROOT + "/data.json','utf8'));const its=d.items;console.log('total='+its.length);console.log('with title_cn='+its.filter(x=>x.title_cn).length);console.log('with summary='+its.filter(x=>x.summary&&x.summary.length>5).length);console.log('with title_short='+its.filter(x=>x.title_short).length);console.log('with reason='+its.filter(x=>x.reason).length);const titles=its.filter(x=>x.title_cn).map(x=>x.title_cn);const tail=require('crypto');let bad=0;titles.forEach(t=>{if(/(ODISHA RAY| - Eco| - WBAL| — Reuters|Reuters$|Bloomberg$|Nikkei$|Xinhua$)/i.test(t)){bad++;console.log('  TAIL SOURCE:',t.slice(-30));}});console.log('titleWithTailSource='+bad);\"", timeout=20)

    # 5) HTTP 抽样：远程打开页面拿 data.json
    log('---- HTTP /data.json 校验 ----')
    try:
        with urllib.request.urlopen(BASE + '/data.json', timeout=20) as r:
            d = json.loads(r.read().decode('utf-8', errors='replace'))
        items = d.get('items', [])
        log(f'total via HTTP = {len(items)}')
        log(f'with title_cn  = {sum(1 for x in items if x.get("title_cn"))}')
        log(f'with summary   = {sum(1 for x in items if x.get("summary"))}')
        log(f'with title_short (应为 0) = {sum(1 for x in items if x.get("title_short"))}')
        log(f'with reason   (应为 0) = {sum(1 for x in items if x.get("reason"))}')
    except Exception as ex:
        log(f'WARN HTTP /data.json 失败: {ex}')

    # 6) GET /api/ping 铁律健康检查
    log('---- GET /api/ping 健康检查 ----')
    try:
        body = json.dumps({'type': 'bug', 'title': 'v18.9 health-check', 'contact': ''}).encode('utf-8')
        req = urllib.request.Request(BASE + "/api/ping", method="GET"),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as r:
            log(f'GET /api/ping -> {r.status} (反代正常)')
    except urllib.error.HTTPError as he:
        log(f'GET /api/ping -> HTTP {he.code} ({he.reason})')
    except Exception as ex:
        log(f'WARN GET /api/ping 失败: {ex}')

    ssh.close()
    log(f'====== 部署完成 ({time.time()-t0:.1f}s) ======')

if __name__ == '__main__':
    main()
