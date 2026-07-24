#!/usr/bin/env python3
"""Remove broken old=/nw= block lines from 3 files"""
import os

TARGETS = ['fix_nginx_md2.py', 'fix_nginx_md3.py', 'push_skill.py']

for f in TARGETS:
    path = os.path.join(r'C:\Users\HUASUN\Desktop\新闻\deploy', f)
    with open(path, encoding='utf-8') as fp:
        lines = fp.readlines()
    new_lines = []
    skip_next = 0
    for i, line in enumerate(lines):
        # 跳过 'old =' / 'nw  =' / 'assert old in conf,' 这种破坏的行
        if line.startswith('old =') or line.startswith('nw  =') or line.startswith('nw =') or line.startswith('assert old in conf,'):
            continue
        # push_skill.py L13: fb = '...' + json.dumps(st, ensure_ascii=False, indent=2) +
        # 后面缺 open(...) 调用，简化为单行赋值
        if f == 'push_skill.py' and 'fb = ' in line and line.rstrip().endswith('+'):
            line = line.rstrip().rstrip('+') + "open(os.path.join(LOCAL,'site_texts_fallback.js'),'w',encoding='utf-8').write(fb)\n"
            skip_next = 1  # 下一行是 open(...).write(fb)，跳过
            new_lines.append(line)
            continue
        if skip_next and 'open(' in line and 'write(fb)' in line:
            skip_next = 0
            continue
        new_lines.append(line)
    with open(path, 'w', encoding='utf-8') as fp:
        fp.writelines(new_lines)
    print(f'fixed: {f}')