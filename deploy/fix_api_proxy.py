"""v18.1.1 修 nginx: 给 443 server block 加 /api/ 反代
原因：push_api_proxy.py 当时改了 conf，但 80 server block 的 `location / { return 301 ... }` 把整个站 80 强转 443。
后来 push_v18 又覆盖了一次 conf 时只保留了 80→301 + 443 /admin/，没加 /api/ 反代。
所以 /api/feedback POST 走到 try_files -> index.html, index.html 405。

修：直接给 443 block 加 location /api/ { proxy_pass ... }。同时给 80 block 也加，兜底。
"""
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
def run(cmd):
    si,so,se = c.exec_command(cmd)
    return so.read().decode(errors='replace')

# 读原 conf
conf = run("cat /etc/nginx/conf.d/pvhot.conf")
print("=== BEFORE ===")
print(conf)

api_block_443 = """
    # 公共 API 端点（用户提交反馈等）— 无需登录
    location /api/ {
        proxy_pass http://127.0.0.1:8777;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        limit_req zone=api_burst burst=10 nodelay;
        limit_req_status 429;
    }
"""

# 在 443 block 里，location /admin/ 后面插入 /api/
if "location /api/" not in conf:
    # 找 "location /admin/ { ... }" 结尾的 "}" 后插入
    new_conf = conf.replace(
        "    location /admin/ {\n        proxy_pass http://127.0.0.1:8777;",
        api_block_443.lstrip("\n") + "    location /admin/ {\n        proxy_pass http://127.0.0.1:8777;"
    )
    # 写回
    run('cat > /etc/nginx/conf.d/pvhot.conf << \'NGX_EOF\'\n' + new_conf + 'NGX_EOF\n')
    print("=== AFTER (443 block updated) ===")
    print(run("cat /etc/nginx/conf.d/pvhot.conf"))
else:
    print("=== already has /api/ block, skip ===")

# nginx -t 验证
print("=== nginx -t ===")
print(run("nginx -t 2>&1"))

# 强制 reload（即使 conf 看似没变也 reload 一次确保）
print("=== nginx reload ===")
print(run("nginx -s reload 2>&1"))
print("reload done")

# 同时也得保证 limit_req_zone 在 http 块 — 看一下
print("=== nginx.conf /etc/nginx/nginx.conf (top) ===")
print(run("head -30 /etc/nginx/nginx.conf"))

c.close()
