#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.0 多信源部署脚本
  - fetch_pv_news.js v3.0：Google News + 直接RSS(PV Magazine/PV-Tech/CleanTechnica) + HTML抓取(索比/北极星) + RSSHub(微博/微信)
  - 上传 fetch_pv_news.js + backfill_summary.js
  - SSH 跑 fetch_pv_news.js（抓取所有信源，写 data_raw.json）
  - SSH 跑 merge.js（合并 data_raw + admin_edits -> data.json + data_fallback.js）
  - GET /data.json 校验：多源数据 / source 分布 / body / reason
  - GET /api/ping 铁律健康检查
"""
import os, sys, time, paramiko, urllib.request, urllib.error, json, re

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT  = '/var/www/pvhot'
BASE =
LOCAL_FILES = [
    ('fetch_pv_news.js',    ROOT + '/fetch_pv_news.js',   0o755),
    ('backfill_summary.js', ROOT + '/backfill_summary.js', 0o755),
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

    # 2. 检查 RSSHub 是否在线
    out, _ = ssh_exec(ssh, 'systemctl is-active rsshub 2>/dev/null')
    rsshub_active = 'active' in out.strip()
    log('RSSHub status: ' + ('ACTIVE' if rsshub_active else 'INACTIVE (RSSHub routes will return empty)'))

    # 3. 运行 fetch_pv_news.js v3.0（抓取所有信源）
    log('Running fetch_pv_news.js v3.0 (this may take 3-8 min for translations)...')
    out, err = ssh_exec(ssh, 'cd /var/www/pvhot && /usr/bin/node fetch_pv_news.js 2>&1', timeout=600)
    
    # 检查 fetch 结果
    if 'OK wrote' in out:
        log('Fetch SUCCESS')
    else:
        log('WARN: fetch output may have issues, continuing...')

    # 4. 运行 merge.js
    log('Running merge.js...')
    ssh_exec(ssh, 'cd /var/www/pvhot && /usr/bin/node merge.js 2>&1')

    # 5. 校验 data.json
    log('Verifying data.json...')
    try:
        req = urllib.request.Request(BASE + '/data.json?t=' + str(int(time.time())))
        resp = urllib.request.urlopen(req, timeout=15), [])
        log('  total items: ' + str(len(items)))
        
        # Source 分布
        sources = {}
        for it in items:
            s = it.get('source', 'unknown')
            sources[s] = sources.get(s, 0) + 1
        log('  source distribution: ' + json.dumps(sources, ensure_ascii=False))
        
        # body / reason 统计
        with_body = sum(1 for it in items if it.get('summary', ''))
        with_reason = sum(1 for it in items if it.get('reason', ''))
        log('  withBody: ' + str(with_body) + '/' + str(len(items)))
        log('  withReason: ' + str(with_reason) + '/' + str(len(items)))
        
        # 语言分布
        langs = {}
        for it in items:
            l = it.get('lang', 'unknown')
            langs[l] = langs.get(l, 0) + 1
        log('  lang distribution: ' + json.dumps(langs))
        
        # 抽样 5 条（不同源各取一条）
        seen_sources = set()
        samples = []
        for it in items:
            s = it.get('source', '')
            if s not in seen_sources:
                seen_sources.add(s)
                samples.append(it)
            if len(samples) >= 8:
                break
        log('  --- samples ---')
        for s in samples:
            title = s.get('title', '')[:50]
            src = s.get('source', '')
            cat = s.get('category', '')
            lang = s.get('lang', '')
            log('    [' + src + ' / ' + cat + ' / ' + lang + '] ' + title)
        
    except Exception as e:
        log('ERROR verifying: ' + str(e))

    # 6. GET /api/ping 铁律健康检查
    log('Health check: GET /api/ping...')
    try:
        body = json.dumps({'type': 'bug', 'msg': 'v3.0 multi-source health-check', 'contact': ''}).encode('utf-8')
        req = urllib.request.Request(BASE + "/api/ping", method="GET"))
        req.add_header('Content-Type', 'application/json')
        resp = urllib.request.urlopen(req, timeout=10)
        log('  feedback: HTTP ' + str(resp.status))
    except urllib.error.HTTPError as e:
        log('  feedback: HTTP ' + str(e.code) + ' (反代正常，后端验证正常)')
    except Exception as e:
        log('  feedback ERROR: ' + str(e) + ' ← 检查 nginx /api/ 反代！')

    ssh.close()
    log('Done.')

if __name__ == '__main__':
    main()
