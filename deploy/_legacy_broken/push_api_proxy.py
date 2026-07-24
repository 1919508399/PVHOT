"""加 /api/ 反代到 127.0.0.1:8777（与 /admin/ 同级），reload nginx"""
import paramiko, re
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
def run(cmd):
    si, so, se = c.exec_command(cmd)
    return so.read().decode(errors='replace'), se.read().decode(errors='replace')
CONF  = '/etc/nginx/conf.d/pvhot.conf'
out, _ = run('cat ' + CONF)
if '/api/' in out and 'proxy_pass http://127.0.0.1:8777' in out and re.search(r'location\s+/api/\s*\{[^}]*proxy_pass\s+http://127\.0\.0\.1:8777', out, re.S):
    print('already has /api/ block, skip')
else:
    # 在 /admin/ 块前插入 /api/ 块
    new_block =
    # 把 /api/ 块插在第一个 location 之前
    if 'location /admin/' in out:
        out2 = out.replace('  location /admin/', new_block + '  location /admin/', 1)
    else:
        # 兜底：插在 server { 后面
        out2 = out.replace('server {', 'server {' + new_block, 1)
    # 同时确保 limit_req_zone 存在（http 段）
    check_zone, _ = run("grep -c 'limit_req_zone' /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf 2>/dev/null || echo 0")
    print('limit_req_zone present:', check_zone.strip())
    # 写
    si, so, se = c.exec_command('cat > ' + CONF + ' << "NGINX_EOF"\n' + out2 + '\nNGINX_EOF')
    so.read(); se_read = se.read().decode(errors='replace')
    if se_read: print('WRITE ERR:', se_read)
    # 加 limit_req_zone（如果还没）
    out3, _ = run('cat /etc/nginx/nginx.conf')
    if 'limit_req_zone' not in out3:
        out3 = out3.replace('http {', 'http {\n  limit_req_zone $binary_remote_addr zone=api_burst:10m rate=30r/m;\n', 1)
        si, so, se = c.exec_command('cat > /etc/nginx/nginx.conf << "NGINX_EOF"\n' + out3 + '\nNGINX_EOF')
        so.read()
    # test + reload
    t, te = run('nginx -t 2>&1')
    print('nginx -t:', t, te)
    if 'successful' in t:
        run('systemctl reload nginx')
        print('reloaded')
    else:
        print('NGINX TEST FAILED, not reloading')
# 验证
for p in ['/api/ping', '/admin/', '/']:
    code = run('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1' + p)[0]
    print(p, '->', code)
c.close()
