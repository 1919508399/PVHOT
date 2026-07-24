#!/usr/bin/env python3
"""Last-mile cleanup: fix curl lines with leftover JSON in 4 files"""
import os

TARGETS = ['fix_nginx_md.py', 'fix_nginx_md2.py', 'fix_nginx_md3.py', 'push_skill.py']

for f in TARGETS:
    path = os.path.join(r'C:\Users\HUASUN\Desktop\新闻\deploy', f)
    with open(path, encoding='utf-8') as fp:
        s = fp.read()
    # 直接用字符串替换
    old_pat = "/api/ping"
    # 在 curl 行中，把 /api/ping 后面的任何残留（如 ':"...."}'）全部去掉
    lines = s.split('\n')
    new_lines = []
    for line in lines:
        if 'curl' in line and '/api/ping' in line:
            # 把 /api/ping 之后到行尾的所有内容替换成 /api/ping
            idx = line.find('/api/ping')
            # 找 /api/ping 结尾
            # 后面跟着：空格 + 其他字符 + '
            # 直接截断到 '/api/ping' 后第一个 ' 或 "
            end = len(line)
            for j in range(idx + len('/api/ping'), len(line)):
                c = line[j]
                if c in "'\"}":
                    end = j
                    break
            # 找 /api/ping 之前的单引号
            line = line[:idx] + '/api/ping' + "'"
        new_lines.append(line)
    s = '\n'.join(new_lines)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.write(s)
    print(f'fixed: {f}')