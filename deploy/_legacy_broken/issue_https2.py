"""尝试安装 certbot nginx 插件；装不上则降级用 webroot 模式签发 + 手动写 443 块"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
SSL_CONF = r"""
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name pvhot.bbroot.com 47.250.92.231;

    ssl_certificate     /etc/letsencrypt/live/pvhot.bbroot.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pvhot.bbroot.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

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
echo
dnf install -y python3-certbot-nginx 2>&1 | tail -6 || true
if python3 -c "import certbot_nginx" 2>/dev/null; then
  echo
  echo
  certbot --nginx -d pvhot.bbroot.com --non-interactive --agree-tos --email webmaster@pvhot.bbroot.com --redirect --keep-until-expiring 2>&1 | tail -25
else
  echo
  echo
  certbot certonly --webroot -w /var/www/pvhot -d pvhot.bbroot.com --non-interactive --agree-tos --email webmaster@pvhot.bbroot.com --keep-until-expiring 2>&1 | tail -25
  echo
  cat >> /etc/nginx/conf.d/pvhot.conf <<'SSLEOF'{SSL_CONF}SSLEOF
  echo
  python3 - <<'PY'
import re
p="/etc/nginx/conf.d/pvhot.conf"
s=open(p).read()
# ensure 80 block redirects to https
if "return 301 https" not in s:
    s=s.replace("    location / {{ try_files $uri $uri/ /index.html; }}",
                "    location / { return 301 https://$host$request_uri; }")
    open(p,"w").write(s)
    print("REDIRECT_ADDED")
else:
    print("REDIRECT_EXISTS")
PY
fi
echo
nginx -t
systemctl daemon-reload
systemctl reload nginx
echo
curl -sI https://pvhot.bbroot.com/ | head -5
echo
curl -sI http://pvhot.bbroot.com/ | head -3
echo
ls -l /etc/letsencrypt/live/pvhot.bbroot.com/ 2>/dev/null || echo
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=240)
    print(stdout.read().decode("utf-8", "ignore"))
    err = stderr.read().decode("utf-8", "ignore")
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
