"""清理旧 443 块 + certbot 签发 pvhot.bbroot.com + 强制 HTTPS 跳转"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
# 先只保留干净的 80 块（去掉引用旧 duckdns 证书的 443 块），再让 certbot 重建 443
CONF = r"""
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.bbroot.com 47.250.92.231;

    location ^~ /.well-known/ { }

    root /var/www/pvhot;
    index index.html;

    location ~ /\. { deny all; }

    location / { try_files $uri $uri/ /index.html; }

    location ~* \.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h; add_header Cache-Control "public, max-age=3600";
    }
    location = /data.json { add_header Cache-Control "no-cache"; }
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
"""

CMD = f"""
set -e
cp /etc/nginx/conf.d/pvhot.conf /etc/nginx/conf.d/pvhot.conf.bak.$(date +%s)
cat > /etc/nginx/conf.d/pvhot.conf <<'PVEOF'{CONF}PVEOF
nginx -t
systemctl reload nginx
echo
curl -sI http://127.0.0.1/ | head -1
echo
certbot --nginx -d pvhot.bbroot.com --non-interactive --agree-tos --email webmaster@pvhot.bbroot.com --redirect --keep-until-expiring 2>&1 | tail -30
echo
nginx -t
systemctl reload nginx
echo
curl -sI https://pvhot.bbroot.com/ | head -5
echo
curl -sI http://pvhot.bbroot.com/ | head -3
echo
systemctl list-timers certbot* 2>/dev/null || true
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=180)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    print(out)
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
