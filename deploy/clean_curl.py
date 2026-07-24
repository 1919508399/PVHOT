#!/usr/bin/env python3
"""Clean up curl -X POST /api/ping -d ...  ->  curl GET /api/ping"""
import os, re

DEPLOY_DIR = r'C:\Users\HUASUN\Desktop\新闻\deploy'
EXCLUDE = {'inspect_feedback.py', 'fix_api_proxy.py', 'update_health_check.py',
           'force_replace.py', 'clean_curl.py'}

for f in sorted(os.listdir(DEPLOY_DIR)):
    if not f.endswith('.py'): continue
    if f in EXCLUDE: continue
    path = os.path.join(DEPLOY_DIR, f)
    with open(path, encoding='utf-8') as fp:
        s = fp.read()
    orig = s

    # Remove -X POST
    s = re.sub(r'-X POST\s+', '', s)
    # Remove -H 'Content-Type: ...'
    s = re.sub(r"""-H\s+['"]Content-Type:\s*application/json['"]\s+""", '', s)
    s = re.sub(r"""-H\s+['"]Content-Type:\s*application/x-www-form-urlencoded['"]\s+""", '', s)
    # Remove -d 'json'
    s = re.sub(r"""-d\s+['"][^'"]*['"]\s*""", '', s)
    # urllib: remove data=body, and method='POST' -> method='GET'
    s = re.sub(r',?\s*data\s*=\s*[^,]+(?=,)', '', s)
    s = re.sub(r"method\s*=\s*['\"]POST['\"]", "method='GET'", s)

    if s != orig:
        with open(path, 'w', encoding='utf-8') as fp:
            fp.write(s)
        print(f'cleaned: {f}')