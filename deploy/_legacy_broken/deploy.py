#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键部署光伏 HOT 静态站到阿里云服务器（47.250.92.231）。

用法：
    python deploy.py <root密码>

行为：
  1. SSH 登录 root@47.250.92.231
  2. 创建 /var/www/pvhot 目录
  3. SFTP 上传前端静态文件（index.html / app.js / styles.css / data.json /
     data_fallback.js / qrcode_wechat.jpg / fetch_pv_news.js / enrich_data.js）
  4. 安装 nginx + 写入 /etc/nginx/conf.d/pvhot.conf（server_name 含 pvhot.pp.ua 与 IP）
  5. 关默认站点、测配置、启动 nginx、放行 80 端口

注意：密码仅用于本次 SSH，不会落盘；部署后请上服务器改 root 密码或改 key 登录。
"""
import sys
import os
import paramiko

HOST  = '47.250.92.231'
PORT = 22
USER  = 'root'
REMOTE_DIR =
LOCAL_DIR = r"C:\Users\HUASUN\Desktop\新闻"

# 需要上传的文件（前端必需 + 抓取脚本可选）
FILES = [
    "index.html",
    "app.js",
    "styles.css",
    "data.json",
    "data_fallback.js",
    "qrcode_wechat.jpg",
    "fetch_pv_news.js",
    "enrich_data.js",
]

NGINX_CONF = r"""server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name pvhot.pp.ua 47.250.92.231;

    root /var/www/pvhot;
    index index.html;

    location ~ /\. {
        deny all;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|json|jpg|jpeg|png|gif|svg|ico|woff2?)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    location = /data.json {
        add_header Cache-Control "no-cache";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
"""


def main():
    if len(sys.argv) < 2:
        print("用法: python deploy.py <root密码>")
        sys.exit(1)
    password = sys.argv[1]

    print(f"[1/5] 连接 {USER}@{HOST}:{PORT} ...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, port=PORT, username=USER, password=password, timeout=30)
    except Exception as e:
        print(f"  ✗ SSH 连接失败：{e}")
        sys.exit(1)
    print("  ✓ 已登录")

    sftp = ssh.open_sftp()
    ssh.exec_command(f"mkdir -p {REMOTE_DIR}")

    print(f"[2/5] 上传 {len(FILES)} 个文件到 {REMOTE_DIR} ...")
    for f in FILES:
        local = os.path.join(LOCAL_DIR, f)
        if not os.path.exists(local):
            print(f"  ! 跳过（本地缺失）：{f}")
            continue
        remote = f"{REMOTE_DIR}/{f}"
        sftp.put(local, remote)
        print(f"  ✓ {f}")
    sftp.close()

    print("[3/5] 安装 nginx + 写入配置 ...")
    install = (
        "cat > /etc/nginx/conf.d/pvhot.conf <<'NGINX'\n"
        f"{NGINX_CONF}"
    )
    stdin, stdout, stderr = ssh.exec_command(install)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    print(out)
    if err.strip():
        print("[stderr]", err)

    print("[4/5] 校验 nginx 状态 ...")
    _, out2, _ = ssh.exec_command("systemctl is-active nginx && echo NGINX_ACTIVE")
    status = out2.read().decode().strip()
    print("  nginx:", status)

    print("[5/5] 收尾 ...")
    ssh.close()

    ok = "PVHOT_DEPLOY_DONE" in out and "PVHOT_DEPLOY_DONE" in out
    if "PVHOT_DEPLOY_DONE" in out and "NGINX_ACTIVE" in status:
        print("\n✅ 部署完成！")
        print("   访问：http://47.250.92.231  （若已注册 pp.ua：http://pvhot.pp.ua）")
        print("   数据更新：服务器上 `node /var/www/pvhot/fetch_pv_news.js` 重新生成 data.json")
    else:
        print("\n⚠️ 部署脚本执行完毕，但状态校验未完全通过，请登录服务器检查 nginx。")


if __name__ == "__main__":
    main()
