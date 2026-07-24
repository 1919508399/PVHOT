#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3b 部署脚本 — 榜单按多信源报道数 + 精选按AI推荐分
  - fetch_pv_news.js v3b：加 aggregateMultiSource() + computeScore()
  - backfill_summary.js v6：加 computeScore() 同步
  - app.js：renderTop5 按 sourceCount 排序 + 精选视图按 score 筛选排序
  - SSH 跑 fetch + merge
  - 校验：sourceCount 分布 / score 分布 / 多源聚类数
  - GET /api/ping 铁律健康检查
"""
import os, sys, time, paramiko, urllib.request, urllib.error, json

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT  = '/var/www/pvhot'
BASE =
LOCAL_FILES = [
    ('fetch_pv_news.js',    ROOT + '/fetch_pv_news.js',    0o755),
    ('backfill_summary.js', ROOT + '/backfill_summary.js', 0o755),
    ('app.js',              ROOT + '/app.js',               0o644),
]

def log(msg):
    print('[' + time.strftime('%H:%M:%S') + '] ' + msg, flush=True)

def ssh_exec(ssh, cmd, timeout=600):
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
    log('Connecting to ' + HOST + '...')
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)

    # 1. 上传文件
    log('Uploading files...')
    sftp = ssh.open_sftp()
    for local_name, remote_path, mode in LOCAL_FILES:
        local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', local_name)
        if not os.path.exists(local_path):
            local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), local_name)
        if not os.path.exists(local_path):
            log('ERROR: ' + local_name + ' not found at ' + local_path)
            sys.exit(1)
        log('  ' + local_name + ' -> ' + remote_path)
        sftp.put(local_path, remote_path)
        sftp.chmod(remote_path, mode)
    sftp.close()
    log('Upload done.')

    # 2. 运行 fetch_pv_news.js v3b
    log('Running fetch_pv_news.js v3b (this may take 3-8 min)...')
    out, err = ssh_exec(ssh, 'cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1', timeout=600)

    if 'OK wrote' in out:
        log('Fetch SUCCESS')
    else:
        log('WARN: fetch output may have issues, continuing...')

    # 3. 运行 merge.js
    log('Running merge.js...')
    ssh_exec(ssh, 'cd /var/www/pvhot && /usr/bin/node merge.js 2>&1')

    # 4. 校验 data.json
    log('Verifying data.json...')
    try:
        req = urllib.request.Request(BASE + '/data.json?t=' + str(int(time.time())))
        resp = urllib.request.urlopen(req, timeout=15), [])
        log('  total items: ' + str(len(items)))

        # sourceCount 分布
        sc_dist = {}
        multi_count = 0
        for it in items:
            sc = it.get('sourceCount', 1)
            sc_dist[sc] = sc_dist.get(sc, 0) + 1
            if sc > 1:
                multi_count += 1
        log('  sourceCount distribution: ' + json.dumps(sc_dist, sort_keys=True))
        log('  multi-source clusters: ' + str(multi_count))

        # score 分布
        scores = [it.get('score', 0) for it in items]
        if scores:
            log('  score: min=' + str(min(scores)) + ' max=' + str(max(scores)) + ' avg=' + str(round(sum(scores)/len(scores), 1)))
            high_score = sum(1 for s in scores if s >= 60)
            log('  score >= 60 (AI recommended): ' + str(high_score) + '/' + str(len(items)))

        # body / reason 统计
        with_body = sum(1 for it in items if it.get('summary', ''))
        with_reason = sum(1 for it in items if it.get('reason', ''))
        log('  withBody: ' + str(with_body) + '/' + str(len(items)))
        log('  withReason: ' + str(with_reason) + '/' + str(len(items)))

        # 抽样：TOP5 按 sourceCount
        top5_sc = sorted(items, key=lambda x: x.get('sourceCount', 1), reverse=True)[:5]
        log('  --- TOP5 by sourceCount ---')
        for i, it in enumerate(top5_sc):
            log('    #' + str(i+1) + ' sc=' + str(it.get('sourceCount', 1)) + ' score=' + str(it.get('score', 0)) + ' [' + it.get('source', '') + '] ' + it.get('title', '')[:50])

        # 抽样：TOP5 按 score
        top5_score = sorted(items, key=lambda x: x.get('score', 0), reverse=True)[:5]
        log('  --- TOP5 by score ---')
        for i, it in enumerate(top5_score):
            log('    #' + str(i+1) + ' score=' + str(it.get('score', 0)) + ' sc=' + str(it.get('sourceCount', 1)) + ' [' + it.get('source', '') + '] ' + it.get('title', '')[:50])

    except Exception as e:
        log('ERROR verifying: ' + str(e))

    # 5. GET /api/ping 铁律健康检查
    log('Health check: GET /api/ping...')
    try:
        body = json.dumps({'type': 'bug', 'msg': 'v3b ranking+featured health-check', 'contact': ''}).encode('utf-8')
        req = urllib.request.Request(BASE + "/api/ping", method="GET"))
        req.add_header('Content-Type', 'application/json')
        resp = urllib.request.urlopen(req, timeout=10)
        log('  feedback: HTTP ' + str(resp.status))
    except urllib.error.HTTPError as e:
        log('  feedback: HTTP ' + str(e.code) + ' (反代正常)')
    except Exception as e:
        log('  feedback ERROR: ' + str(e) + ' ← 检查 nginx /api/ 反代！')

    ssh.close()
    log('Done.')

if __name__ == '__main__':
    main()
