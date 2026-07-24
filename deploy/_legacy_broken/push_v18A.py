#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v18.10 部署脚本：参考 aihot 卡片重构
  - fetch_pv_news.js：buildCleanSummary → buildBody(详细正文200字) + 新增 buildReason
  - backfill_summary.js v5：同步 buildBody + buildReason
  - app.js：summaryHTML → bodyHTML(多行) + 新增 reasonHTML + renderItem 加分隔线
  - styles.css：.tl-summary → .tl-body + 新增 .tl-divider
  - 推送 4 文件 + ssh 跑 backfill + merge
  - GET /data.json 校验：withBody / withReason / reason 无重复数字(如 15%15)
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
    ('styles.css',          ROOT + '/styles.css',         0o644),
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
    log('====== v18.10 部署开始 ======')
    t0 = time.time()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASS, timeout=15)
    sftp = ssh.open_sftp()

    # 1) sftp 推送 4 个文件
    for local, remote, mode in LOCAL_FILES:
        local_path = os.path.join('..', local)
        sftp.put(local_path, remote)
        sftp.chmod(remote, mode)
        size = os.path.getsize(local_path)
        log(f'↑ {local} → {remote} ({size}B)')

    sftp.close()

    # 2) 跑 backfill_summary v5（buildBody + buildReason）
    ssh_exec(ssh, 'cd ' + ROOT + ' && /usr/bin/node backfill_summary.js', timeout=30)

    # 3) 跑 merge.js 生成 data.json + data_fallback.js
    ssh_exec(ssh, 'cd ' + ROOT + ' && /usr/bin/node merge.js', timeout=30)

    # 4) 数据校验
    log('---- 数据校验 ----')
    out, _ = ssh_exec(ssh, "node -e \""
        "const d=JSON.parse(require('fs').readFileSync('" + ROOT + "/data.json','utf8'));"
        "console.log('total='+its.length);"
        "console.log('withBody='+its.filter(x=>x.summary&&x.summary.length>5).length);"
        "console.log('withReason='+its.filter(x=>x.reason&&x.reason.length>5).length);"
        "console.log('reasonDupNum='+dupNum);"
        "samples.forEach((x,i)=>console.log('  sample'+(i+1)+': ['+x.category+']
        "\"", timeout=20)

    # 5) HTTP /data.json 校验
    log('---- HTTP /data.json 校验 ----')
    try:
        with urllib.request.urlopen(BASE + '/data.json', timeout=20) as r:
            d = json.loads(r.read().decode('utf-8', errors='replace'))
        items = d.get('items', [])
        log(f'total via HTTP = {len(items)}')
        log(f'withBody        = {sum(1 for x in items if x.get("summary"))}')
        log(f'withReason      = {sum(1 for x in items if x.get("reason"))}')
        # 检查重复数字
        dup = 0
        for x in items:
            r_text = x.get('reason', '')
            nums = re.findall(r'\d+(?:\.\d+)?\s*(?:%|MW|GW|kWh|亿|万)', r_text)
            seen = set()
            for n in nums:
                if n in seen:
                    dup += 1
                    log(f'  DUP NUM in reason: {n} | {r_text[:60]}')
                seen.add(n)
        log(f'reasonDupNum    = {dup} (应为 0)')
    except Exception as ex:
        log(f'WARN HTTP /data.json 失败: {ex}')

    # 6) GET /api/ping 铁律健康检查
    log('---- GET /api/ping 健康检查 ----')
    try:
        body = json.dumps({'msg': 'v18.10 health-check', 'page': '/', 'ua': 'push-script'}).encode('utf-8')
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
