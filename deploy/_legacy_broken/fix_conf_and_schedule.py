"""1) 修复 pvhot.conf 为纯 80(HTTP) 防挂；2) 部署服务器本地后台脚本，10:16 UTC+8 后自动补签证书+加443+跳转"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
PV_CONF = r"""
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

SSL_BLOCK = r"""
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

FINISH_SH = r"""#!/bin/bash
# 等待 Let's Encrypt 对 bbroot.com 的周限额(02:11 UTC)过后，留 5 分钟缓冲
NOW=$(date +%s)
TARGET=$(date -u +%s)
SLEEP=$((TARGET - NOW))
if [ "$SLEEP" -gt 0 ]; then sleep $SLEEP; fi
echo "=== start certbot $(date -u) ===" >> /root/https_finish.log
certbot certonly --webroot -w /var/www/pvhot -d pvhot.bbroot.com --non-interactive --agree-tos --email webmaster@pvhot.bbroot.com --keep-until-expiring >> /root/https_finish.log 2>&1
if [ -f /etc/letsencrypt/live/pvhot.bbroot.com/fullchain.pem ]; then
  # 先改 80 块为 301 跳转（此时 443 尚未追加，只命中 80 块）
  python3 - <<'PY'
p="/etc/nginx/conf.d/pvhot.conf"
s=open(p).read()
if "return 301 https" not in s:
    s=s.replace("    location / { try_files $uri $uri/ /index.html; }",
                "    location / { return 301 https://$host$request_uri; }",1)
    open(p,"w").write(s)
PY
  # 追加 443 块
  cat /root/ssl_block.txt >> /etc/nginx/conf.d/pvhot.conf
  nginx -t >> /root/https_finish.log 2>&1 && systemctl reload nginx >> /root/https_finish.log 2>&1
  echo "HTTPS_DONE $(date -u)" >> /root/https_finish.log
else
  echo "CERT_FAIL $(date -u)" >> /root/https_finish.log
fi
"""

CMD = r"""
set -e
# 1) 修复 pvhot.conf 为纯 80
cat > /etc/nginx/conf.d/pvhot.conf <<'PVEOF'
__PV_CONF__
PVEOF

# 2) 写 443 块模板
cat > /root/ssl_block.txt <<'SSLEOF'
__SSL_BLOCK__
SSLEOF

# 3) 写后台补签脚本
cat > /root/finish_https.sh <<'RMT'
__FINISH_SH__
RMT
chmod +x /root/finish_https.sh

# 4) 立即 reload 保证 HTTP 正常
nginx -t
systemctl reload nginx
curl -s -o /dev/null -w "HTTP_AFTER_FIX:%{http_code}\n" http://127.0.0.1/

# 5) 启动后台补签（服务器本地，不依赖本地连接）
nohup bash /root/finish_https.sh >/dev/null 2>&1 &
echo
echo
wc -l /etc/nginx/conf.d/pvhot.conf
"""

CMD = CMD.replace("__PV_CONF__", PV_CONF).replace("__SSL_BLOCK__", SSL_BLOCK).replace("__FINISH_SH__", FINISH_SH)

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=60)
    print(stdout.read().decode("utf-8", "ignore"))
    err = stderr.read().decode("utf-8", "ignore")
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
