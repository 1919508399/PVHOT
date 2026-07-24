#!/usr/bin/env python3
"""暴力替换：把所有 deploy 脚本里的 /api/ping 换成 /api/ping
排除 inspect_feedback.py（那个是真实测试 feedback 端点的）
排除本脚本自身
"""
import os, glob

DEPLOY_DIR = r'C:\Users\HUASUN\Desktop\新闻\deploy'
EXCLUDE = {'inspect_feedback.py', 'update_health_check.py', 'fix_api_proxy.py'}

count = 0
for py in glob.glob(os.path.join(DEPLOY_DIR, '*.py')):
    name = os.path.basename(py)
    if name in EXCLUDE:
        print(f'skip: {name}')
        continue
    with open(py, encoding='utf-8') as f:
        src = f.read()
    if '/api/ping' not in src and 'api/feedback' not in src:
        continue
    new_src = src.replace('/api/ping', '/api/ping')
    with open(py, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print(f'updated: {name}')
    count += 1

print(f'\nTotal: {count}')