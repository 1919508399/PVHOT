# 后台密码配置

后台不再使用内置默认密码。生产环境应使用 systemd 环境文件配置：

1. 将 `ops/config/pvhot-admin.env.example` 复制到 `/etc/pvhot/pvhot-admin.env`；
2. 将 `PVHOT_ADMIN_PASSWORD_HASH` 设置为管理员密码的 SHA-256 十六进制摘要；
3. 将文件所有者设为 `root:root`、权限设为 `0600`，然后重启 `pvhot-admin.service`。

`/var/www/pvhot/shared/config/admin_pass.txt` 仅用于兼容旧部署，正式环境优先使用 `/etc/pvhot/pvhot-admin.env`。不要把明文密码或摘要提交到 Git。

可用 Node.js 生成摘要：

```sh
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "请替换为高强度密码"
```

本地调试可通过 `PVHOT_ROOT`、`PVHOT_ADMIN_PORT`、`PVHOT_ADMIN_HOST` 和 `PVHOT_NODE` 覆盖后台的默认目录、端口、监听地址与 Node.js 路径。
