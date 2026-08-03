# PVHOT 生产发布与运维

这套配置把代码发布和业务数据分开：

```text
/var/www/pvhot/
├── current -> releases/<git-sha>       # Nginx 和 systemd 只读取这个入口
├── previous -> releases/<git-sha>      # 一步回滚目标
├── releases/
│   └── <git-sha>/                      # 代码与该版本依赖，不原地修改
├── shared/
│   ├── data/                           # 新闻、价格、后台编辑、缓存
│   ├── content/                        # 后台可编辑的 PVHOT Skill
│   ├── config/                         # 可选的密码摘要文件
│   ├── uploads/
│   ├── log/
│   ├── run/locks/                      # 所有 release 共用的进程锁
│   ├── runtime/npm-cache/              # 加快 npm ci，不共享 node_modules
│   └── acme/                           # Let's Encrypt HTTP-01
└── incoming/                           # CI 临时上传发布包
```

发布包以完整 Git SHA 命名。`deploy.sh` 在独立 staging 目录解压、检查路径、校验 JavaScript/JSON、按 lockfile 安装生产依赖、连接 shared 数据并完成预检。所有步骤成功后，才原子替换 `current`。

切换后会重启后台服务并从公网检查首页、`data.json`、`/api/healthz` 和 `release.json`。任何一步失败都会恢复旧 symlink 并重启旧服务。默认保留最近 5 个 release。

## 文件职责

- `deploy.sh`：正式发布入口；CI 会上传并校验当前提交中的脚本后执行，服务器安装版保留给首次迁移和人工应急。
- `rollback.sh`：回到 `previous`，或指定一个仍保留的完整 Git SHA。
- `nginx/pvhot.conf`：唯一 PVHOT Nginx 配置。
- `systemd/pvhot-admin.service`：后台和公开 API。
- `systemd/pvhot-fetch.{service,timer}`：每小时新闻/微信抓取。
- `systemd/pvhot-prices.{service,timer}`：每天 07:00 更新价格。
- `systemd/pvhot-baidu-push.{service,timer}`：每天 06:00 使用服务器环境变量向百度推送 URL。
- `systemd/pvhot-cert-renew.{service,timer}`：每天两次检查证书并在续期后 reload Nginx。
- `logrotate/pvhot`：保留 14 天抓取日志。
- `config/*.example`：不含真实秘密的环境变量模板。
- `sudoers/pvhot-deploy`：发布账号唯一可执行的提权操作。

## 一次性服务器准备

以下准备操作由服务器管理员执行。日常发布账号不需要 root 权限。

### 1. 建立专用账号和目录

使用两个低权限账号分离发布和运行职责：

- `pvhot-deploy`：CI 专用 SSH 发布账号，拥有 release、incoming 和 shared 文件；只允许通过 sudo 重启/检查 `pvhot-admin.service`。
- `pvhot`：无交互 shell 的 systemd 运行账号，只通过 `pvhot` 组读取 release、读写 shared。

两者都禁用密码登录。只有 `pvhot-deploy` 放置 CI 专用公钥，不再使用 root 密码发布。

```bash
sudo groupadd --system pvhot
sudo useradd --system --create-home --home-dir /var/lib/pvhot --shell /usr/sbin/nologin --gid pvhot pvhot
sudo useradd --create-home --shell /bin/bash pvhot-deploy
sudo usermod -aG pvhot pvhot-deploy
sudo passwd --lock pvhot
sudo passwd --lock pvhot-deploy
sudo install -d -o pvhot-deploy -g pvhot -m 2750 /var/www/pvhot
sudo install -d -o pvhot-deploy -g pvhot -m 2750 /var/www/pvhot/incoming
```

如果用户、组或目录已经存在，跳过对应创建命令，并确认 `id pvhot-deploy` 包含附加组 `pvhot`。不要删除现有网站文件：首次发布会优先把顶层的现有生产数据复制到 `shared`，成功验证后再单独归档旧文件。

`releases` 使用 `2750`，运行账号和 Nginx 只能按组读取；`shared` 目录使用 setgid `2770`，可变文件使用 `0660`，确保 `pvhot-deploy` 与 `pvhot` 通过同一组协作。兼容密码摘要文件单独使用 `0640`。

Nginx 工作进程需要加入 `pvhot` 组才能读取 `0640` 的发布文件。阿里云镜像通常使用 `nginx`，Debian/Ubuntu 通常使用 `www-data`；先通过 `nginx -T` 的 `user` 指令确认，再执行其中一个：

```bash
sudo usermod -aG pvhot nginx
# 或
sudo usermod -aG pvhot www-data
```

变更附加组后需要重启 Nginx 一次。

### 2. 安装运行环境

- Node.js 22 和配套 npm。
- Nginx、curl、tar、flock、realpath。
- 服务器共享的 Chrome for Testing；不要在每个 release 重复下载浏览器。
- Certbot 及 Nginx 或 webroot 支持。

发布脚本严格检查 Node 主版本为 22，并执行：

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --ignore-scripts --no-audit --no-fund
```

每个 release 都从锁文件得到独立依赖；仅 npm 下载缓存跨版本复用。

服务器目前没有系统 Chromium，可把现有 Chrome for Testing 复制到固定路径。下面的源目录按服务器现有版本调整：

```bash
sudo install -d -o root -g pvhot -m 0750 /opt/pvhot/chrome
sudo cp -a /home/admin/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/. /opt/pvhot/chrome/
sudo chown -R root:pvhot /opt/pvhot/chrome
sudo chmod -R g+rX,o-rwx /opt/pvhot/chrome

sudo -u pvhot /opt/pvhot/chrome/chrome --version
sudo -u pvhot timeout 15 /opt/pvhot/chrome/chrome \
  --headless=new --no-sandbox --disable-gpu --dump-dom about:blank
```

两项验证都成功后，保持 `/etc/pvhot/pvhot-fetch.env` 中：

```text
PUPPETEER_EXECUTABLE_PATH=/opt/pvhot/chrome/chrome
```

### 3. 安装运行配置与服务器秘密

在仓库根目录执行：

```bash
sudo install -o root -g root -m 0755 ops/deploy.sh /usr/local/bin/pvhot-deploy
sudo install -o root -g root -m 0755 ops/rollback.sh /usr/local/bin/pvhot-rollback

sudo install -d -o root -g root -m 0755 /etc/pvhot
sudo install -o root -g root -m 0644 ops/config/pvhot-common.env.example /etc/pvhot/pvhot-common.env
sudo install -o root -g root -m 0600 ops/config/pvhot-fetch.env.example /etc/pvhot/pvhot-fetch.env
sudo install -o root -g root -m 0600 ops/config/pvhot-admin.env.example /etc/pvhot/pvhot-admin.env
sudo install -o root -g root -m 0600 ops/config/pvhot-baidu.env.example /etc/pvhot/pvhot-baidu.env
```

检查 Chromium 的真实路径并修改 `/etc/pvhot/pvhot-fetch.env`。这个文件同时预留了可选的 X API 凭据，因此必须保持 `root:root`、权限 `0600`，不能再按普通 `0644` 配置安装。在服务器上生成新的后台密码摘要，填入 `/etc/pvhot/pvhot-admin.env`；把轮换后的百度推送 token 只填入 `/etc/pvhot/pvhot-baidu.env`。这些文件和任何真实凭据都不得提交 Git。

先校验再安装受限 sudo 规则：

```bash
sudo visudo -cf ops/sudoers/pvhot-deploy
sudo install -o root -g root -m 0440 ops/sudoers/pvhot-deploy /etc/sudoers.d/pvhot-deploy
```

这个规则只允许 `pvhot-deploy` 重启和读取 `pvhot-admin.service` 状态。运行账号 `pvhot` 没有 sudo 权限。代码切换本身不使用 sudo，Nginx 也不需要在日常发布时 reload。

### 可选启用 X 官方 API

X 监控不是 PVHOT 基础抓取的必需条件。没有配置时，官网、RSS、微信公众号和其他信源仍会正常更新；后台信源健康面板会把 X 显示为“被拦截”，原因是 `X_API_NOT_CONFIGURED`。这是可预期的降级状态，不代表整站故障。

启用前，站点所有者需要自行完成以下准备：

1. 在 X Developer 平台开通可读取用户与帖子数据的官方 API 套餐，并确认当前接口和读取额度满足监控频率。
2. 核对最新价格和限额。X API 可能收费，套餐与计价方式也可能调整；先设置月度预算、用量告警或硬性限额，避免意外费用。
3. 只在生产服务器保存 Bearer Token，不经聊天、工单、Git、CI 制品或普通配置文件传递。

当前 unit 已让后台服务和定时抓取共同读取 `/etc/pvhot/pvhot-fetch.env`。以服务器管理员身份编辑该文件：

```bash
sudoedit /etc/pvhot/pvhot-fetch.env
sudo chown root:root /etc/pvhot/pvhot-fetch.env
sudo chmod 0600 /etc/pvhot/pvhot-fetch.env
```

在服务器文件中给唯一变量 `PVHOT_X_BEARER_TOKEN` 填入真实值；仓库里的 `ops/config/pvhot-fetch.env.example` 必须一直保持空值。不要把 Token 直接写进 `ops/systemd/*.service` 的 `Environment=` 行，因为 unit 通常是 `0644`，也会进入 Git 和部署制品。

如果运维平台统一采用 systemd credential，也应让秘密只存在于 root-only 凭据存储，并在进程启动时以同一个变量名 `PVHOT_X_BEARER_TOKEN` 提供给 PVHOT。当前仓库开箱即用的方式是上面的 root-only `EnvironmentFile`；不要在没有完成凭据文件读取适配时仅添加 `LoadCredential=`，否则应用不会自动取得 Token。

保存后重启后台，并立即手动执行一轮抓取：

```bash
sudo systemctl restart pvhot-admin.service
sudo systemctl start pvhot-fetch.service
```

验证时不要打印环境变量或 Token 本身。下面的检查只确认文件权限、变量非空、服务结果和 X 抓取状态：

```bash
sudo test "$(stat -c '%U:%G %a' /etc/pvhot/pvhot-fetch.env)" = "root:root 600"
sudo grep -q '^PVHOT_X_BEARER_TOKEN=..*$' /etc/pvhot/pvhot-fetch.env && echo 'X token is configured'
systemctl is-active pvhot-admin.service
systemctl show pvhot-fetch.service -p Result --value
journalctl -u pvhot-fetch.service --since '15 minutes ago' --no-pager
```

最后登录后台“信源健康”页面确认：顶部应显示“X 官方 API 已配置”，X 账号不再因为 `X_API_NOT_CONFIGURED` 统一处于“被拦截”。若仍出现 `401`、`403` 或 `429`，分别检查 Token 权限、套餐接口权限与额度/预算；不要把完整 Authorization 请求头贴入日志或反馈内容。

如需停用，只需在服务器的 root-only 文件中清空 `PVHOT_X_BEARER_TOKEN`，再重启后台和下一轮抓取。停用后 X 恢复为“被拦截 / 未配置”，其他信源继续工作。

### 4. 安装 systemd 和日志轮转

```bash
sudo install -o root -g root -m 0644 ops/systemd/pvhot-admin.service /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-fetch.service /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-fetch.timer /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-prices.service /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-prices.timer /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-baidu-push.service /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-baidu-push.timer /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-cert-renew.service /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/systemd/pvhot-cert-renew.timer /etc/systemd/system/
sudo install -o root -g root -m 0644 ops/logrotate/pvhot /etc/logrotate.d/pvhot

sudo systemd-analyze verify /etc/systemd/system/pvhot-*.service /etc/systemd/system/pvhot-*.timer
sudo logrotate --debug /etc/logrotate.d/pvhot
sudo systemctl daemon-reload
sudo systemctl enable pvhot-admin.service
```

先不要启用 timers；等首次 release 成功并移除旧 cron 后再启用，避免同一抓取任务同时执行两次。

新闻与价格任务统一使用 `/var/www/pvhot/shared/run/locks`。systemd 还用单独的 `.pipeline.lock` 串行化整条新闻与价格流水线，避免二者在 07:00 左右交叉执行。微信抓取失败不会阻断其他新闻源，但新闻主流程或合并失败会让本次任务明确失败。

### 5. 安装唯一 Nginx 配置

先备份现有配置，并确保 `/etc/nginx/conf.d/` 或 `sites-enabled` 中没有第二份 PVHOT `server_name`。

首次迁移为避免 `current` 尚未建立造成公网 smoke 循环，应先准备并上传下一节描述的 release 包，再由 `pvhot-deploy` 执行一次仅 bootstrap 可用的发布：

```bash
PVHOT_SKIP_EXTERNAL_SMOKE=1 /usr/local/bin/pvhot-deploy \
  "/var/www/pvhot/incoming/pvhot-${SHA}.tar.gz" \
  "${SHA}"
```

该开关只有在完全不存在 `current` 时才会生效；一旦已有 active release，脚本会拒绝它。bootstrap 仍会完成本地预检、原子切换和后台重启，只跳过公网 smoke。

建立 `current` 后安装 Nginx 配置：

```bash
sudo install -o root -g root -m 0644 ops/nginx/pvhot.conf /etc/nginx/conf.d/pvhot.conf
sudo nginx -t
sudo systemctl reload nginx
```

配置只公开前端资源、明确允许的数据和 `/uploads/qrcode.png`，阻止访问其余 uploads、后台脚本、抓取缓存、反馈、统计、密码摘要、`ops/`、`lib/` 和历史部署工具。

reload 后立即以相同 tar 和 SHA 正常执行一次 `pvhot-deploy`。第二次是幂等验证，会执行完整公网 smoke。GitHub Actions 和任何后续发布严禁设置 `PVHOT_SKIP_EXTERNAL_SMOKE`。

## 创建和部署一个 release

只从干净、已合并并通过 CI 的提交生成制品。运行时发布包采用白名单，不包含 Git 元数据、测试、旧部署脚本或开发工具：

```bash
SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"

git archive \
  --format=tar.gz \
  --output="pvhot-${SHA}.tar.gz" \
  "${SHA}" -- \
  index.html \
  styles.css \
  app.js \
  admin.html \
  admin_server.js \
  bd_push.py \
  fetch_pv_news.js \
  fetch_prices.js \
  fetch_wechat.js \
  merge.js \
  source_registry.js \
  lib \
  package.json \
  package-lock.json \
  data.json \
  data_fallback.js \
  site_texts.json \
  site_texts_fallback.js \
  pvhot-skill \
  robots.txt \
  sitemap.xml \
  og-image-v4.jpg \
  qrcode_wechat.jpg \
  baidu_verify_codeva-vHjUI6fnHC.html \
  c953027fa91a245e4a273f09c69bd57b.txt
```

CI 将制品和当前提交中的 `ops/deploy.sh` 一同上传到 `/var/www/pvhot/incoming/`，分别核对校验和后，以 `pvhot-deploy` 用户执行这份版本化脚本。这样代码与发布规则始终属于同一个 Git 提交，不会因服务器残留旧脚本而失败。

首次迁移或人工应急时，仍可使用服务器安装版：

```bash
/usr/local/bin/pvhot-deploy \
  "/var/www/pvhot/incoming/pvhot-${SHA}.tar.gz" \
  "${SHA}"
```

同一个 SHA 和同一个制品重复运行是幂等的。若同一个 Git SHA 对应的 tar 校验和发生变化，脚本会拒绝覆盖已有 release，防止“同版本不同内容”。

部署成功后可检查：

```bash
readlink -f /var/www/pvhot/current
curl --fail --silent https://pvhot.bbroot.com/release.json
curl --fail --silent https://pvhot.bbroot.com/api/healthz
sudo systemctl status pvhot-admin.service
```

## 首次切换后的任务迁移

确认网页、后台 API 和数据均正常后：

1. 从 root 的原 crontab 中只删除 PVHOT 新闻、微信、价格、merge 和 06:00 百度推送项，保留所有无关任务。确认新 `/etc/pvhot/pvhot-baidu.env` 已配置后再移除旧任务，旧脚本中的 token 不得继续保留。
2. 启用新 timers：

```bash
sudo systemctl enable --now pvhot-fetch.timer pvhot-prices.timer pvhot-baidu-push.timer
systemctl list-timers 'pvhot-*'
```

3. 手动运行一次并检查日志：

```bash
sudo systemctl start pvhot-fetch.service
sudo systemctl start pvhot-prices.service
sudo systemctl start pvhot-baidu-push.service
journalctl -u pvhot-fetch.service -u pvhot-prices.service -u pvhot-baidu-push.service --since today
```

不要在任务运行中部署。`deploy.sh` 和 timers 都有锁，但发布前暂停长时间抓取仍能让切换更容易观察。

## 回滚

回到最近一次发布：

```bash
/usr/local/bin/pvhot-rollback
```

回到一个仍被保留的指定版本：

```bash
/usr/local/bin/pvhot-rollback <完整 Git SHA>
```

回滚也会原子切换、重启后台并执行公网 smoke。如果目标版本不健康，脚本会自动恢复回滚前的版本。

## HTTPS 自动续期

HTTP-01 challenge 使用稳定目录 `/var/www/pvhot/shared/acme`，不随代码发布切换。

检查当前证书，停用发行版的通用 Certbot timer，启用 PVHOT 专用 timer，避免重复执行：

```bash
sudo certbot certificates
sudo systemctl disable --now certbot.timer
sudo systemctl enable --now pvhot-cert-renew.timer
systemctl list-timers pvhot-cert-renew.timer
```

专用 service 已持久配置 webroot 和“续期成功后 reload Nginx”的 deploy hook。启用前先执行演练：

```bash
sudo certbot renew \
  --dry-run \
  --webroot \
  --webroot-path /var/www/pvhot/shared/acme \
  --deploy-hook "/usr/bin/systemctl reload nginx"
```

每周从外部监控证书剩余天数，在少于 21 天时告警；不要只依赖服务器本机的 timer 状态。

## 日常诊断

```bash
systemctl is-active pvhot-admin.service
systemctl list-timers 'pvhot-*'
journalctl -u pvhot-admin.service --since '30 minutes ago'
journalctl -u pvhot-fetch.service --since today
journalctl -u pvhot-prices.service --since today
curl --fail --silent https://pvhot.bbroot.com/release.json
curl --fail --silent https://pvhot.bbroot.com/api/healthz
```

外部监控至少应告警：

- 首页或 `/api/healthz` 连续两次失败。
- `data.json` 无法解析。
- 数据更新时间超过 90 分钟。
- 证书剩余时间少于 21 天。
- systemd timer 最近一次结果失败。

## 安全边界

- 仓库、tar、systemd unit、Nginx 配置和日志中不保存真实密码或私钥。
- X API 统一使用 `PVHOT_X_BEARER_TOKEN`；真实值只放在服务器 root-only 环境文件或等效的 systemd credential 中，示例文件保持空值。
- SSH 使用 CI 专用密钥；私钥只存在 GitHub `production` Environment。
- `pvhot-deploy` 只可重启和检查 PVHOT 后台服务；运行账号 `pvhot` 没有 sudo 权限，两者都不能 reload Nginx 或管理其他服务。
- 第三方 GitHub Actions 固定完整 commit SHA。
- release 目录由完整 Git SHA 唯一标识；生产版本通过公开的 `release.json` 可追溯。
- `shared/config/admin_pass.txt` 是兼容旧配置的可选路径，权限固定为 `0640`；优先使用只由后台服务读取的 `/etc/pvhot/pvhot-admin.env`。
