# PVHOT

PVHOT 是面向光伏行业的中文信息聚合站。仓库包含前端页面、新闻与价格抓取、数据合并、管理后台和服务器运维配置。

## 本地开始

要求：

- Node.js 22 LTS（仓库通过 `.nvmrc` 固定主版本，与生产环境一致）
- npm 10 或更高版本

首次运行：

```bash
npm ci
npm run dev
```

然后访问 <http://127.0.0.1:4173>。本地预览只提供静态站点，不会启动抓取任务、连接生产服务器或修改线上数据。

## 统一命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 在 `127.0.0.1:4173` 启动安全的静态预览 |
| `npm run check` | 检查 JavaScript 语法、JSON、UTF-8、HTML 基础结构和工作流版本固定 |
| `npm test` | 运行 Node.js 与 Python 离线单元测试，不访问网络 |
| `npm run smoke` | 启动临时站点并验证首页、静态资源和数据接口 |
| `npm run security` | 扫描当前工作区中的常见明文凭据 |
| `npm run security:history` | 扫描所有可达 Git 历史；凭据轮换和历史清理时使用 |
| `npm run ci` | 本地串行执行合并前的四项必需检查 |

这些命令不依赖全局安装包，也不会写入业务数据。

`puppeteer` 固定为生产环境正在使用的 25.3.0。普通页面开发与 CI 不启动浏览器；需要本地运行微信抓取时，请确保 Puppeteer 所需的 Chromium 已正确安装。

可选环境变量：

```text
PVHOT_DEV_HOST=127.0.0.1
PVHOT_DEV_PORT=4173
```

## 开发与 PR 流程

1. 从最新 `main` 创建短生命周期分支。
2. 完成一个小而完整的改动，先运行 `npm run ci`。
3. 推送分支并创建 PR，等待 `validate`、`unit`、`smoke`、`security` 全部通过。
4. 使用 Squash Merge 合入 `main`，合并后删除分支。
5. 正式环境只部署合并提交生成的发布包，不从本地脏工作区直接上传文件。

PR 推送新提交时，GitHub 会取消同一 PR 上过时的 CI。四个检查并行运行，目标是在五分钟内反馈。

## 目录说明

```text
.github/       PR 模板和自动化工作流
scripts/       本地开发、质量检查、冒烟和安全扫描
tests/         快速、离线、可重复的单元测试
pvhot-skill/   Agent 接入文档与安装入口
ops/           原子发布、回滚、Nginx、systemd 与证书续期配置
```

站点的主要入口为 `index.html`、`styles.css` 和 `app.js`。新闻数据处理的主要入口为 `fetch_pv_news.js`、`fetch_wechat.js`、`fetch_prices.js` 与 `merge.js`。

## 安全规则

- 不得在代码、文档、测试、日志或命令示例中写入真实密码、Token、Cookie、私钥或服务器凭据。
- 使用环境变量或 CI 的受保护 Secret；示例文件只写变量名和占位符。
- 泄露的凭据必须先轮换，再清理当前代码与 Git 历史。
- 正式部署使用专用低权限账号，不使用共享 root 密码。
- 第三方 GitHub Action 必须固定到完整的 40 位提交 SHA。

生产环境由 `main` 分支在所有 CI 检查通过后自动发布。部署账号只能上传发布包、执行受控发布脚本并重启 PVHOT 服务；应用进程使用独立的 `pvhot` 运行账号。详细迁移、回滚和故障处理见 `ops/README.md`。

## 常见问题

如果 `npm run check` 报编码错误，请确认编辑器以 UTF-8 保存文件，不要用系统默认编码覆盖中文源码。

如果冒烟测试失败，先运行 `npm run dev`，确认首页、`app.js`、`styles.css` 和 `data.json` 能在本地打开。冒烟测试不会访问线上网站，因此结果不受外部网络波动影响。
