#!/usr/bin/env python3
"""Final cleanup: remove leftover json strings after curl /api/ping"""
import os, re

DEPLOY_DIR = r'C:\Users\HUASUN\Desktop\新闻\deploy'
EXCLUDE = {'inspect_feedback.py', 'fix_api_proxy.py', 'update_health_check.py',
           'force_replace.py', 'clean_curl.py', 'final_cleanup.py'}

for f in sorted(os.listdir(DEPLOY_DIR)):
    if not f.endswith('.py'): continue
    if f in EXCLUDE: continue
    path = os.path.join(DEPLOY_DIR, f)
    with open(path, encoding='utf-8') as fp:
        s = fp.read()
    orig = s
    # Remove leftover json literals after curl
    s = re.sub(r"""\s*msg[^'"]*['"][^'"]*['"]\}?'""", '', s)
    s = re.sub(r'''\s+['"][^'"]*['"]\s*$''', '', s, flags=re.MULTILINE)
    if s != orig:
        with open(path, 'w', encoding='utf-8') as fp:
            fp.write(s)
        print(f'final-clean: {f}')