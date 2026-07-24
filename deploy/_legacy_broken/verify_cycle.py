#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko

HOST, USER, PASS = '47.250.92.231', 'root',
def run(ssh, cmd, timeout=60):
    si, so, se = ssh.exec_command(cmd, timeout=timeout)
    o = so.read().decode('utf-8', 'ignore')
    e = se.read().decode('utf-8', 'ignore')
    if e.strip():
        print('[stderr]', e[:300])
    return o


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)

    run(ssh,
            "pass\":\"pvhot2026\"}' http://localhost/admin/api/login")
    before = run(ssh, "curl -s -b /tmp/ck.txt 'http://localhost/admin/api/items?pageSize=1' "
                   "| python3 -c \"import sys,json;print(json.load(sys.stdin)['total'])\"")
    print('before total:', before.strip())

    run(ssh,
          "title_cn\":\"【CURL测试】后端删除验证\",\"category\":\"组件\",\"featured\":false}' "
          "http://localhost/admin/api/items")
    aid = run(ssh, "curl -s -b /tmp/ck.txt
                + "%E6%B5%8B%E8%AF%95%E9%AA%8C&pageSize=3' "
                "| python3 -c \"import sys,json;d=json.load(sys.stdin);print(d['items'][0]['id'] if d['items'] else 'NONE')\"")
    aid = aid.strip()
    print('added id:', aid)

    d = run(ssh, "curl -s -b /tmp/ck.txt -X DELETE
              + aid + "'")
    print('delete resp:', d.strip()[:120])

    after = run(ssh, "curl -s -b /tmp/ck.txt 'http://localhost/admin/api/items?pageSize=1' "
                   "| python3 -c \"import sys,json;print(json.load(sys.stdin)['total'])\"")
    print('after delete total:', after.strip())

    run(ssh, "cd /var/www/pvhot && /usr/bin/node merge.js 2>&1 | tail -1")
    after2 = run(ssh, "curl -s -b /tmp/ck.txt 'http://localhost/admin/api/items?pageSize=1' "
                    "| python3 -c \"import sys,json;print(json.load(sys.stdin)['total'])\"")
    print('after merge total:', after2.strip())
    ssh.close()


if __name__ == '__main__':
    main()
