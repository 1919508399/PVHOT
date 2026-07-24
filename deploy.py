#!/usr/bin/env python3
"""统一部署脚本：上传文件 + 健康检查 + 服务重启

用法：
  python deploy.py [action] [options]

Actions:
  (无)         仅同步本地文件到服务器
  restart      同步文件 + 重启 pvhot-admin
  fetch        同步文件 + 运行 fetch_pv_news.js && merge.js
  status       查询服务状态（pvhot-admin / RSSHub / cron / 后台反馈数）

参数（环境变量或 --key value）：
  --files FILE:DEST    本地文件路径:服务器目标路径，可多次指定
  --no-restart         不重启服务（默认根据 action 自动决定）
  --dry-run            只打印操作，不实际执行

健康检查：每次操作后自动 GET https://pvhot.bbroot.com/api/ping 验证

示例：
  python deploy.py --files "fetch_pv_news.js:/var/www/pvhot/fetch_pv_news.js" fetch
  python deploy.py status
  python deploy.py restart
"""
import sys, os, time, re, argparse, paramiko

HOST = '47.250.92.231'
PORT = 22
USER = 'root'
PASS = '369287zjb@1998'
ROOT = '/var/www/pvhot'
DOMAIN = 'https://pvhot.bbroot.com'


def ssh_connect(timeout=25):
    s = paramiko.SSHClient()
    s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    s.connect(HOST, PORT, USER, PASS, timeout=timeout)
    return s


def run(ssh, cmd, timeout=60):
    print(f'[exec] {cmd}')
    si, so, se = ssh.exec_command(cmd, timeout=timeout)
    out = so.read().decode('utf-8', 'ignore')
    err = se.read().decode('utf-8', 'ignore')
    if out: print(f'[stdout] {out.rstrip()}')
    if err: print(f'[stderr] {err.rstrip()}')
    return out, err


def split_mapping(pair):
    """解析 SRC:DST，兼容 Windows 盘符冒号（C:\\file:/dst）。"""
    if not pair:
        return None, None
    m = re.match(r'^([A-Za-z]:)(.*)$', pair)
    if m:
        drive, rest = m.group(1), m.group(2)
        if ':' in rest:
            src, dst = rest.split(':', 1)
            return drive + src, dst
    if ':' in pair:
        return pair.split(':', 1)
    return None, None


def upload(ssh, pairs):
    if not pairs:
        print('[upload] no files to upload')
        return
    sftp = ssh.open_sftp()
    for pair in pairs:
        src, dst = split_mapping(pair)
        if src is None:
            print(f'[upload] BAD mapping: {pair}')
            continue
        if not os.path.exists(src):
            print(f'[upload] MISSING local: {src}')
            continue
        print(f'[upload] {src} -> {dst}')
        sftp.put(src, dst)
    sftp.close()


def health_check(verbose=True):
    """GET /api/ping 验证"""
    import urllib.request
    try:
        r = urllib.request.urlopen(DOMAIN + '/api/ping', timeout=8)
        body = r.read().decode('utf-8', 'ignore')[:120]
        ok = r.status == 200
        if verbose: print(f'[health] GET /api/ping HTTP {r.status} body={body}')
        return ok
    except Exception as e:
        if verbose: print(f'[health] GET /api/ping FAIL: {e!r}')
        return False


def do_upload(args):
    ssh = ssh_connect()
    try:
        upload(ssh, args.files or [])
        health_check()
    finally:
        ssh.close()


def do_restart(args):
    ssh = ssh_connect()
    try:
        upload(ssh, args.files or [])
        run(ssh, 'systemctl restart pvhot-admin', timeout=20)
        time.sleep(1)
        run(ssh, 'systemctl is-active pvhot-admin', timeout=5)
        health_check()
    finally:
        ssh.close()


def do_fetch(args):
    ssh = ssh_connect()
    try:
        upload(ssh, args.files or [])
        run(ssh, f'cd {ROOT} && /usr/bin/node fetch_pv_news.js >> {ROOT}/fetch.log 2>&1', timeout=300)
        run(ssh, f'cd {ROOT} && /usr/bin/node merge.js >> {ROOT}/merge.log 2>&1', timeout=60)
        # 验证 data.json
        out, _ = run(ssh, f'cd {ROOT} && python3 -c "import json;d=json.load(open(\\"data.json\\"));print(f\\"items={{len(d.get(\\\\\\"items\\\\\\", d))}}\\\\n\\")"', timeout=10)
    finally:
        ssh.close()


def do_status(args):
    ssh = ssh_connect()
    try:
        print('=== pvhot-admin ===')
        run(ssh, 'systemctl is-active pvhot-admin', timeout=5)
        print('\n=== RSSHub ===')
        run(ssh, 'systemctl is-active rsshub', timeout=5)
        print('\n=== cron ===')
        run(ssh, 'crontab -l 2>&1 | grep -v "^#" | grep .', timeout=5)
        print('\n=== feedback count ===')
        run(ssh, f'python3 -c "import json;d=json.load(open(\\"{ROOT}/feedback.json\\"));print(f\\"feedback={{len(d)}}, unread={{sum(1 for x in d if not x.get(\\\\\\"read\\\\\\"))}}\\\\n\\")"', timeout=10)
        print('\n=== data.json ===')
        run(ssh, f'ls -la {ROOT}/data.json {ROOT}/data_raw.json 2>&1', timeout=5)
        print('\n=== last fetch ===')
        run(ssh, f'tail -10 {ROOT}/fetch.log 2>&1', timeout=5)
        print('\n=== health ===')
        health_check()
    finally:
        ssh.close()


def main():
    # 手动解析：避免 argparse 对 --files 的贪婪吞掉 action
    args = argparse.Namespace(
        action='upload', files=None, dry_run=False
    )
    argv = sys.argv[1:]
    # 先收集所有 --files
    files = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--files':
            i += 1
            while i < len(argv) and not argv[i].startswith('-') and argv[i] not in ('upload','restart','fetch','status'):
                files.append(argv[i])
                i += 1
        elif a == '--dry-run':
            args.dry_run = True
            i += 1
        elif a in ('upload','restart','fetch','status'):
            args.action = a
            i += 1
        else:
            i += 1
    args.files = files

    if args.dry_run:
        print(f'[dry-run] action={args.action} files={args.files}')
        return

    fn = {
        'upload': do_upload,
        'restart': do_restart,
        'fetch': do_fetch,
        'status': do_status,
    }[args.action]
    fn(args)


if __name__ == '__main__':
    main()