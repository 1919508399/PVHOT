#!/usr/bin/env python3
"""Final fix: complete the broken curl commands in 4 files"""
import os

TARGETS = ['fix_nginx_md.py', 'fix_nginx_md2.py', 'fix_nginx_md3.py', 'push_skill.py']

for f in TARGETS:
    path = os.path.join(r'C:\Users\HUASUN\Desktop\新闻\deploy', f)
    with open(path, encoding='utf-8') as fp:
        lines = fp.readlines()
    new_lines = []
    for line in lines:
        # 匹配：si,so,se = ssh.exec_command("...curl.../api/ping'  (截断的行)
        if 'ssh.exec_command(' in line and '/api/ping' in line and line.rstrip().endswith("/api/ping'"):
            # 修复：把结尾的 ' 改成 ", timeout=15)
            line = line.rstrip() + '"' + ", timeout=15)\n"
        new_lines.append(line)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.writelines(new_lines)
    print(f'fixed: {f}')