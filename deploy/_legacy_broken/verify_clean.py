#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko, json, re

HOST, USER, PASS = '47.250.92.231', 'root',
def run(ssh, cmd, timeout=60):
    si, so, se = ssh.exec_command(cmd, timeout=timeout)
    o = so.read().decode('utf-8', 'ignore')
    e = se.read().decode('utf-8', 'ignore')
    if e.strip():
        print('[stderr]', e[:300])
    return o


def total(ssh, ck):
    c = ("curl -s -b %s 'http://localhost/admin/api/items?pageSize=1' "
           "| python3 -c \"import sys,json;print(json.load(sys.stdin)['total'])\"" % ck)
    return run(ssh, c).strip()


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)

    # 0) 彻底重置 admin_edits.json + merge -> 应为 120
    run(ssh,
            "pass\":\"pvhot2026\"}' http://localhost/admin/api/login >/dev/null")
    ck =
    run(ssh, "cd /var/www/pvhot && printf '%s' '{\"deleted\":[],\"overrides\":{},"
        "\"added\":[]}' > admin_edits.json && /usr/bin/node merge.js >/dev/null 2>&1")
    print('reset -> total:', total(ssh, ck))

    # 1) 添加（从响应直接拿 id）
    add_out = run(ssh,
                     "title_cn\":\"【干净测试】某某光伏企业发布新一代组件\",\"category\":\"组件\"}' "
                     "http://localhost/admin/api/items" % ck)
    print('add resp:', add_out.strip()[:160])
    try:
        aid = json.loads(add_out)['item']['id']
    except Exception as ex:
        print('parse add id failed:', ex); ssh.close(); return
    print('added id:', aid)
    print('after add total:', total(ssh, ck), '(应 121)')

    # 2) 删除该 id
    d = run(ssh, "curl -s -b %s -X DELETE 'http://localhost/admin/api/items/%s'" % (ck, aid))
    print('delete resp:', d.strip()[:80])
    print('after delete total:', total(ssh, ck), '(应 120)')

    # 3) 跨 merge 持久（删除应保留）
    run(ssh, "cd /var/www/pvhot && /usr/bin/node merge.js >/dev/null 2>&1")
    print('after merge total:', total(ssh, ck), '(应仍 120)')

    # 4) 再次完整抓取+合并，确认删除不被覆盖
    run(ssh,
              "/usr/bin/node merge.js >/dev/null 2>&1")
    print('after full fetch+merge total:', total(ssh, ck), '(应仍 120)')

    ssh.close()
    print('=== DONE ===')


if __name__ == '__main__':
    main()
