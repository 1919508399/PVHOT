# PVHOT HTTPS 补签检查报告

- 检查时间：2026-07-23 10:25 (GMT+8)
- 目标：https://pvhot.bbroot.com / 服务器 47.250.92.231

## 结论：❌ 证书补签失败，HTTPS 未生效

### 1) /root/https_finish.log 关键内容
```
=== start certbot Thu Jul 23 02:16:00 UTC 2026 ===
Requesting a certificate for pvhot.bbroot.com
An unexpected error occurred:
too many certificates (50) already issued for "bbroot.com" in the last 168h0m0s,
retry after 2026-07-23 05:36:49 UTC
CERT_FAIL Thu Jul 23 02:16:01 UTC 2026
```
- 日志状态：**CERT_FAIL**（非 HTTPS_DONE），后台补签任务已退出。
- 失败原因：Let's Encrypt 对 `bbroot.com` 注册域的 168 小时新证书签发已达上限（50 张/周），触发公共二级域共享受限。

### 2) curl -sI https://pvhot.bbroot.com/
- 返回：空（无响应）。说明服务器当前仍只有 80(HTTP) 配置，443 块未追加，HTTPS 不可访问。

## 下一步建议
1. **等待限频窗口重置**：需在 **2026-07-23 05:36:49 UTC（北京时间 13:36:49）之后** 再签发。
   - 即约 **北京时间今天 13:36 之后**（当前约还有 3 小时）。
2. **届时在服务器手动完成补签 + 启用 HTTPS**（已具备脚本与模板）：
   ```bash
   # 1) 重新签发证书（webroot 模式）
   certbot certonly --webroot -w /var/www/pvhot -d pvhot.bbroot.com \
     --non-interactive --agree-tos --email webmaster@pvhot.bbroot.com --keep-until-expiring

   # 2) 追加 443 块
   cat /root/ssl_block.txt >> /etc/nginx/conf.d/pvhot.conf

   # 3) 将 80 块改为 301 跳转（若尚未改）
   #    location / { try_files $uri $uri/ /index.html; }
   #    -> location / { return 301 https://$host$request_uri; }

   # 4) 校验并重载
   nginx -t && systemctl reload nginx
   ```
3. 验证：`curl -sI https://pvhot.bbroot.com/` 应返回 `HTTP/2 200`。

## 备注
- 当前 HTTP(80) 仍正常，门户可通过 http://pvhot.bbroot.com 访问。
- 根因是 bbroot.com 为公共免费二级域，多人共用 Let's Encrypt 周限额；如需彻底规避，建议换用独立域名或等待窗口后重试。
