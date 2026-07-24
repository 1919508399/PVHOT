# -*- coding: utf-8 -*-
import paramiko, time

SCRIPT = r'''#!/bin/bash
LOG=/root/https_finish.log
CONF=/etc/nginx/conf.d/pvhot.conf
DOMAIN=pvhot.bbroot.com
WEBROOT=/var/www/pvhot
echo "=== retry loop start $(date -u) ===" >> $LOG
for i in $(seq 1 24); do
  echo "--- attempt $i $(date -u) ---" >> $LOG
  if certbot certonly --webroot -w $WEBROOT -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --no-eff-email >> $LOG 2>&1; then
    echo "CERT_OK $(date -u)" >> $LOG
    cat > $CONF <<'NGXEOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.bbroot.com 47.250.92.231;
    location ^~ /.well-known/acme-challenge/ { root /var/www/pvhot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name pvhot.bbroot.com 47.250.92.231;

    ssl_certificate /etc/letsencrypt/live/pvhot.bbroot.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pvhot.bbroot.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location = /admin { return 301 /admin/; }
    location /admin/ {
        proxy_pass http://127.0.0.1:8777;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

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
NGXEOF
    if nginx -t >> $LOG 2>&1; then
      nginx -s reload >> $LOG 2>&1
      echo "DONE $(date -u)" >> $LOG
      exit 0
    else
      echo "NGINX_TEST_FAIL $(date -u)" >> $LOG
      exit 2
    fi
  fi
  sleep 600
done
echo "GAVE_UP $(date -u)" >> $LOG
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
sftp = c.open_sftp()
with sftp.open("/root/finish_https.sh", "w") as f:
    f.write(SCRIPT.encode("utf-8"))
sftp.close()
c.exec_command("chmod +x /root/finish_https.sh")
c.exec_command("nohup bash /root/finish_https.sh >/dev/null 2>&1 &")
time.sleep(4)
stdin, stdout, stderr = c.exec_command("ps aux | grep finish_https | grep -v grep; echo '--- log tail ---'; tail -n 8 /root/https_finish.log")
print(stdout.read().decode(errors="replace"))
err = stderr.read().decode(errors="replace")
if err.strip():
    print("ERR:", err)
c.close()
