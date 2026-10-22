# PVHOT 上线记录（已投产，2026-10-22）

域名不变：`https://pvhot.bbroot.com`。nginx 已从「发静态文件」改为「反代到引擎的 3000 端口」，旧静态站文件原地保留，可随时回滚。

## 生产环境现状

| 项 | 值 |
| --- | --- |
| 服务器 | 阿里云 47.250.92.231（Alibaba Cloud Linux 4，2 核 / 1.8G 内存 / 40G 盘） |
| 登录 | `ssh pvhot`（密钥登录，密码登录已禁用） |
| 代码目录 | `/opt/pvhot-app` |
| 运行方式 | Docker Compose，服务 `db` `setup` `api` `worker` `web` |
| 对外端口 | 仅 nginx 的 80 / 443；`web` 只监听 `127.0.0.1:3000` |
| 反向代理 | `/etc/nginx/conf.d/pvhot.conf` |
| 证书 | 已有 `pvhot.bbroot.com`，由 `pvhot-cert-renew.timer` 自动续期 |
| 数据库备份 | 每天 04:00 写入 `/opt/pvhot-app/backups`，保留 7 份 |


## 后台能改什么（不用改代码、不用重启）

「设置」页现在有两张新卡片：

- **模型服务**：接口地址、模型名、密钥。保存后约 15 秒对接口与采集器同时生效；密钥只以掩码形式回显，可随时清除。
- **更新日志**：直接发布新条目（日期、时间、类型、标题、正文按行分条），也可删除后台发布的条目。随站点发布的 26 条历史记录不在此列，保留不动。

- **采集通道**：四个入口的状态与密钥。公众号（极致了）、X 账号（SocialData）在这里填 key，两个付费通道可随时清除；网页列表不需要密钥，到「信源」页新建即可；外部推送在这里生成或重置口令，并给出推送地址。

四个通道的密钥都存数据库、随 15 秒轮询生效，公众号通道的定时对账任务已改成常驻注册，填完 key 不需要重启即会开始巡检。

其他仍在后台可改的：关于页二维码、通知目的地、付费请求上限、信源的新增/暂停/抓取间隔（「信源」页）。

改文案类页面（site/pages 下的隐私说明、使用规则）仍需重建镜像，见上文「更新代码」。

## 日常操作

```bash
ssh pvhot
sudo /opt/pvhot-app/ops.sh status          # 服务状态 + 今日入库量
sudo /opt/pvhot-app/ops.sh logs worker     # 看采集日志（api / web 同名）
sudo /opt/pvhot-app/ops.sh restart         # 重启 api / worker / web
sudo /opt/pvhot-app/ops.sh key sk-xxxx     # 写入大模型密钥并重启（之后流水线才跑）
sudo /opt/pvhot-app/ops.sh admin-password  # 查看后台密码；带参数则重设
sudo /opt/pvhot-app/ops.sh backup          # 手动备份一次
```

模型服务默认指向 DeepSeek（`https://api.deepseek.com/v1`，模型 `deepseek-chat`）。换别家时：

```bash
sudo /opt/pvhot-app/ops.sh key <key> https://dashscope.aliyuncs.com/compatible-mode/v1 qwen3.8-flash
```

## 更新代码

本机改完代码后：

```bash
tar czf /tmp/pvhot-src.tgz --exclude=node_modules --exclude=.git --exclude=.env .
cat /tmp/pvhot-src.tgz | ssh pvhot 'cat > /tmp/pvhot-src.tgz'
ssh pvhot 'tar xzf /tmp/pvhot-src.tgz -C /opt/pvhot-app && sudo /opt/pvhot-app/ops.sh update'
```

注意：上传包会覆盖服务器上的 `.env` 之外的同名文件，`docker-compose.yml` 以本机为准（已把手写端口绑定改成只监听 127.0.0.1）。

## 回滚到旧静态站

```bash
ssh pvhot
sudo cp /root/pvhot-nginx-backup-20261022-162854.conf /etc/nginx/conf.d/pvhot.conf
sudo nginx -t && sudo systemctl reload nginx
# 如需连容器一起停：cd /opt/pvhot-app && sudo docker compose down
```

旧站文件仍在 `/var/www/pvhot/current`，未做任何改动。

## 已知事项

- **未配模型密钥前，精选页与日报是空的**：采集照常入库，但文章停留在「待处理」，不会出现在公开列表。密钥写进 `.env` 后重启 api 与 worker 即自动补跑积压内容。
- 部分站点需要浏览器渲染才能取正文，走 Jina（按次付费，未配 `JINA_API_KEY` 时只有这类文章取不到正文，其余 RSS 与网页直连不受影响）。
- 服务器上已有一个公众号转 RSS 的服务（容器 `pvhot-werrs`，本机 8001 端口，对外未放行）。想免费接公众号，就用它生成的 RSS 地址在后台新建 `rss` 类型信源，不必买付费接口。
- 磁盘剩余约 6.9G，构建镜像时会临时占用，构建完执行 `sudo docker builder prune -af` 回收。

---

# 分析方式：模型模式与免费模式（2026-10-22 加）

后台「设置 → 分析方式」一个开关，决定每篇文章要不要花钱。采集永远免费，只有甄别、评分、
摘要、事件归组、日报会调用模型。

## 两个模式

| | 模型模式 | 免费模式 |
|---|---|---|
| 甄别 / 分类 / 标签 | 提示词 | 关键词词表 |
| 精选评分 | 模型打两次分取均值 | 信源分级 + 关键词 + 数字密度 + 时效，规则加权 |
| 标题 | 翻译并改写 | 保留信源原文 |
| 摘要 | 内容理解后重写 | 正文开头（会先洗掉必应 RSS 的页面模板） |
| 事件归组 / 日报 | 有 | 跳过；日报退化为各篇标题并列 |
| 费用 | 按 token 计费 | 0 |

精选门槛不共用。模型门槛在 `industry/selection.ts`（T1 58 / T1_5 64 / T2 74），规则门槛在
`rules.ts` 的 `RULE_THRESHOLDS`（T1 58 / T1_5 62 / T2 70）。原因是关键词打分的分布比模型窄，
直接套模型的数字会把几乎所有文章推到同一侧。这组数字是在 125 篇回填上标定的，实测精选率
约 25%（T1 45%、T1_5 41%、T2 5%）。换行业或改词表后要重新标定一次。

## 切换

后台保存后写 `settings` 表，15 秒轮询到 api 与 worker，不用重启：

```sql
-- 当前值
SELECT value FROM settings WHERE key = 'analysis_mode';   -- {"mode":"rules"}
```

已经判过的文章保持原判，排队的按新方式处理。想用新规则重判一遍：

```sql
UPDATE articles SET processing_state='new', processing_attempts=0,
       processing_retry_at=NULL, processing_queued_at=NULL
WHERE id IN (SELECT article_id FROM analyses WHERE model='rules');
```

`analyses.model = 'rules'` 就是规则判出来的，和模型判的在本表里可区分。

## 代码位置

- `packages/backend/src/editorial/rules.ts`：规则管线（甄别、分类、标签、评分、文案），
  产出与模型管线同构的 `AnalysisRun`，下游发布、分组、精选、日报不用改
- `packages/backend/src/editorial/analyze.ts`：`runAnalysis` 开头的模式分支
- `packages/backend/src/events/group.ts`、`digest.ts`：免费模式下的跳过与标题并列
- `packages/backend/src/runtime-overrides.ts`：`getAnalysisMode()`，由 `site/model-service.ts`
  的轮询写入（settings 表 `analysis_mode`）

## 什么时候用哪个

- 模型账户没钱、或不想再花钱：切免费模式，采集和页面照常
- 想看清「同一件事有几家在报」「今天哪几条最要紧」：切回模型模式跑一段时间再切回来，
  已经跑过的不重复计费（`receipts` 按 logical_key 复用）
- 只是缺翻译：模型模式跑完再切免费，不影响已生成的文案

# 这次花了多少钱，钱花在哪

2 小时（17:25–19:06）内 897 次模型调用：一次性回填 245 篇历史文章，每篇要走
prefilter → structure → score（两次）→ understand/summarize，四到五个环节。

| 环节 | 次数 | 平均输入 token | 平均输出 token |
|---|---|---|---|
| score_article | 311 | 4161 | 1077 |
| prefilter_article | 239 | 2085 | 180 |
| structure_article | 180 | 4820 | 1245 |
| summarize_article | 80 | 4622 | 1657 |
| story_digest | 56 | 917 | 547 |
| understand_article | 27 | 6702 | 1274 |
| group_article | 3 | 3439 | 763 |
| group_review | 1 | 1242 | 455 |
| **合计** | **897** | **310 万** | **78 万** |

按 DeepSeek 公开价（输入 ¥2/百万、输出 ¥3/百万，未命中缓存）约 **8–9 元**。

两件事让这次特别贵：

1. 一次性把 245 篇存量全跑了一遍，平时每天新增只有 100–150 篇
2. `deepseek-flash` 是推理模型，思考过程也按输出 token 计价；`.env` 里的
   `LLM_REASONING_TOKENS=4000` 让每次调用最多思考 4000 token

平时按模型模式跑，每天新增 100–150 篇大约 3–5 元。免费模式是 0。
