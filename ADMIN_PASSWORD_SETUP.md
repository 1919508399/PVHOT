# 后台密码配置

后台不再使用内置默认密码。部署前请配置以下任一方式：

1. 将管理员密码的 SHA-256 十六进制摘要写入 `/var/www/pvhot/admin_pass.txt`；或
2. 设置环境变量 `PVHOT_ADMIN_PASSWORD_HASH` 为同一摘要。

可用 Node.js 生成摘要：

```sh
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "请替换为高强度密码"
```

本地调试可通过 `PVHOT_ROOT`、`PVHOT_ADMIN_PORT`、`PVHOT_ADMIN_HOST` 和 `PVHOT_NODE` 覆盖后台的默认目录、端口、监听地址与 Node.js 路径。
