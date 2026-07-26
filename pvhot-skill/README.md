# PV HOT Skill

让 Claude Code、Codex、Gemini CLI、GitHub Copilot、OpenCode 与通用 Agent Skills 直接查询 PV HOT 的光伏行业情报。

- 站点：https://pvhot.bbroot.com
- 新闻：`GET /api/v1/news`
- RSS：`GET /api/v1/rss.xml`
- 状态：`GET /api/v1/status`
- 全量兼容数据：`GET /data.json`
- 反馈：`POST /api/feedback`
- 匿名只读，无需 API Key

## 快速体验

```bash
curl -fsSL "https://pvhot.bbroot.com/api/v1/news?date=today&featured=true&limit=5"
```

支持按日期、产业赛道、关键词、AI 精选和数量筛选。完整参数见 [SKILL.md](./SKILL.md)。

## 一键安装

把下面这段发给你的 Agent：

```text
请先检查并安装 PV HOT Skill：https://pvhot.bbroot.com/pvhot-skill/

要求：
1. 先读取并检查 SKILL.md、README.md，确认只访问 PV HOT 的公开只读接口；
2. 告诉我准备写入的目录和文件，不要使用 sudo，不要覆盖其他 Skill；
3. 安装到当前 Agent 官方支持的用户级 skills 目录；
4. 安装完成后说明是否需要重启或开启新会话，并给出一个验证问题。
```

也可以显式选择平台：

```bash
# Claude Code
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target claude

# Codex
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target codex

# Gemini CLI
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target gemini

# GitHub Copilot
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target copilot

# OpenCode
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target opencode

# 通用 Agent Skills
bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target agents
```

脚本不会猜目录、不会默认使用 sudo，也不会覆盖其他 Skill。

## 验证

安装后关闭旧会话并新开一个会话，再问：

> 今天光伏行业最重要的 5 件事是什么？

成功标志：回答严格限定今天，给出 5 条以内中文摘要，并保留来源与原文链接；当天没有匹配事件时不使用旧闻填充。

## 排查

1. 确认文件名严格为 `SKILL.md`，且位于当前 Agent 支持的 skills 目录。
2. 关闭旧会话并新开会话。
3. 让 Agent 列出已发现的 skills，确认其中有 `pvhot`。
4. 用 `/api/v1/status` 检查服务状态。
5. 仍失败时在 PV HOT 反馈页提交平台、版本和实际安装路径；不要提交 token 或本地隐私文件。

## 使用边界

摘要和翻译由 AI 生成。引用数字、政策、价格或原话前请回到原文核验；对外发布保留来源；收到 429 后退避。当前为公开测试服务，不提供 SLA。
