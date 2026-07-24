#!/usr/bin/env python3
"""批量把所有部署脚本里的 GET /api/ping 改成 GET /api/ping
关键改动：
- URL: /api/feedback -> /api/ping
- METHOD: POST -> GET (没有 body)
- 期望状态码: 200（GET /api/ping 直接 200，不像 GET /api/ping 需要带 msg）
"""
import os, re, glob

DEPLOY_DIR = r'C:\Users\HUASUN\Desktop\新闻\deploy'

# 模式1：curl GET /api/ping -d '{"msg":"..."}'  → curl -o /dev/null /api/ping
# 模式2：urllib.request.Request(BASE + "/api/ping", method="GET")) → GET /api/ping
# 模式3：注释里提到 GET /api/ping 的，改为 GET /api/ping

patterns = [
    # curl 形式: -X POST -d '{"msg":"..."}' http(s)://...api/feedback
    (re.compile(r"curl\s+(?:-s\s+)?(?:-o\s+/dev/null\s+)?-w\s+\"\%\{http_code\}\"\s+-X\s+POST\s+(\S*api/feedback)\s+(?:-H\s+[\"'][^\"']*[\"']\s+)?-d\s+[\"'][^\"']*[\"']"),
     lambda m: f'curl -s -o /dev/null -w "%{{http_code}}" {m.group(1).replace('/api/ping', "/api/ping")}'),
    # curl 简单形式（无 -w）
    (re.compile(r"curl\s+(?:-s\s+)?-X\s+POST\s+(\S*api/feedback)\s+(?:-H\s+[\"'][^\"']*[\"']\s+)?-d\s+[\"'][^\"']*[\"']"),
     lambda m: f'curl -s -o /dev/null -w "%{{http_code}}" {m.group(1).replace('/api/ping', "/api/ping")}'),
    # urllib POST 形式
    (re.compile(r"urllib\.request\.Request\(\s*([A-Z_]+)\s*\+\s*['\"]/api/feedback['\"][^)]*method\s*=\s*['\"]POST['\"]"),
     lambda m: f'urllib.request.Request({m.group(1)} + "/api/ping", method="GET")'),
    # urllib POST 简化形式（data 在前）
    (re.compile(r"urllib\.request\.Request\(\s*([A-Z_]+)\s*\+\s*['\"]/api/feedback['\"],\s*data\s*=\s*[^,]+,\s*method\s*=\s*['\"]POST['\"]"),
     lambda m: f'urllib.request.Request({m.group(1)} + "/api/ping", method="GET")'),
    # 注释中提到
    (re.compile(r"POST\s+/api/feedback"),
     lambda m: 'GET /api/ping'),
    # 单独 URL（少见）
    (re.compile(r"['\"]\/api\/feedback['\"]"),
     lambda m: "'/api/ping'"),
]

count = 0
for py in glob.glob(os.path.join(DEPLOY_DIR, '*.py')):
    with open(py, encoding='utf-8') as f:
        src = f.read()
    orig = src
    if '/api/ping' not in src and 'api/feedback' not in src:
        continue
    for pat, repl in patterns:
        src = pat.sub(repl, src)
    if src != orig:
        with open(py, 'w', encoding='utf-8') as f:
            f.write(src)
        print(f'updated: {os.path.basename(py)}')
        count += 1
print(f'\nTotal updated: {count} files')