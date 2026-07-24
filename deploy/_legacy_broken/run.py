#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""在服务器上执行传入的 shell 命令（逐条），实时打印输出。
用法： python run.py "cmd1" "cmd2" ...
"""
import sys, paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PWD  =
def main():
    cmds = sys.argv[1:]
    if not cmds:
        print("no cmd"); return
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    for c in cmds:
        print("\n===== CMD:", c[:80].replace("\n", " "), "=====", flush=True)
        stdin, stdout, stderr = ssh.exec_command(c, timeout=180)
        out = stdout.read().decode(errors="replace").rstrip()
        err = stderr.read().decode(errors="replace").rstrip()
        if out: print(out, flush=True)
        if err: print("[stderr]", err, flush=True)
    ssh.close()

if __name__ == "__main__":
    main()
