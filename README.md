# PVHOT 光伏 HOT

光伏产业链的热点站：自动盯住信源、两轮独立评分精选、把同一件事的报道归到一起，每天 08:00 出一份日报。
基于 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT)（MIT）重构，站名与品牌归 PVHOT 所有。

线上地址：<https://pvhot.bbroot.com/>

## 产业链分类

硅料 · 硅片 · 电池片 · 组件 · 辅材设备 · 储能 · 电站 · 政策 · 企业 · 行业 · 观点

精选标准在 `industry/prompts/`（预筛、评分、写作、事件归组），门槛在 `industry/selection.ts`，
信源在 `industry/sources.json`（首次启动自动导入），主题页在 `industry/topics.json`。
行业怎么改、改哪里，见 [docs/customize.md](docs/customize.md)。

## 本地跑通（不用 Docker）

依赖：Node.js 24+、PostgreSQL 17（本机任意方式装好即可）。

```bash
npm install
# 配置 .env（参考 .env.example）：至少填 SITE_URL、ADMIN_PASSWORD、SESSION_SECRET、
# IMG_PROXY_SIGN_SECRET、DATABASE_URL、COLLECT_ENABLED=true，以及 LLM_API_KEY
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts     # 导入示范信源
node --env-file=.env apps/api/src/main.ts        # API（默认 127.0.0.1:3001）
node --env-file=.env apps/worker/src/main.ts     # 采集与处理
node --env-file=.env apps/web/server.ts          # 网站（默认 127.0.0.1:3000，需先 npm run build -w @aihot/web）
```

打开 <http://localhost:3000>，后台在 `/admin`（密码是 `.env` 里的 `ADMIN_PASSWORD`）。
没有模型 key 时采集照常入库，精选与写作不运行；填好 `LLM_API_KEY`（任何 OpenAI 兼容接口）后流水线自动开始。

## 生产部署（Docker，推荐）

```bash
node scripts/init-env.ts --llm-key <你的模型APIKey>
docker compose up -d --build
```

域名与 HTTPS 见 [docs/deploy.md](docs/deploy.md)。`SITE_URL` 设为 `https://pvhot.bbroot.com`。

## 信源

已接入的与待接入的（公众号、X、企业官网）清单见 [docs/sources-pvhot.md](docs/sources-pvhot.md)。
公众号需要极致了（Dajiala）的 key，X 需要 SocialData 的 key，都是付费服务，在后台“设置”里有预算熔断。

## 检查

```bash
npm run typecheck
DATABASE_URL=postgres://…/pvhot_test npm test   # 库名必须以 _test 结尾
node scripts/smoke.ts --base http://localhost:3000
```

## 安全规则

- `.env` 不入库；密钥泄露先轮换再清理历史。
- 生产部署使用专用低权限账号，不要共享 root。
- 第三方 GitHub Action 固定到完整 40 位提交 SHA。
