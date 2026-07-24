# PV HOT Skill

让 Agent（Claude Code / Codex / Gemini CLI / GitHub Copilot / OpenCode / 通用 Agent Skills）通过 PV HOT 的公开只读接口，获取光伏产业链最新新闻与日报、按分类检索、并向站长提交反馈。

- 站点：https://pvhot.bbroot.com
- 数据源：`GET /data.json`（匿名、无需 API Key）
- 反馈：`POST /api/feedback`（匿名、限频）

## 一键安装（推荐）

把下面这条发给你的 Agent，它会先审阅 `SKILL.md` 与 `install.sh`，确认写入目录后再安装：

```
请先检查并安装 PV HOT Skill：https://pvhot.bbroot.com/pvhot-skill/

要求：
1. 先读取并检查 SKILL.md、README.md，确认只访问 PV HOT 的公开只读接口；
2. 告诉我你准备写入的目录和文件，不要使用 sudo，不要覆盖其它 Skill；
3. 安装到你当前 Agent 官方支持的用户级 skills 目录；
4. 安装完成后告诉我是否需要重启或开启新会话，并给出一个验证问题。
```

或直接用安装脚本（显式声明目标平台，**不会猜目录、不会默认用 sudo**）：

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

## 验证

安装后**关闭旧会话、新开一个会话**，再问：

> 过去 24 小时光伏行业最重要的 5 件事是什么？

成功标志：回答注明"过去 24 小时"、给出 5 条以内中文摘要、并把标题链接到 PV HOT 阅读页。

## 更新已有 Skill

让当前 Agent 覆盖它正在使用的同一目录，不要把更新写到其它 Agent 的目录。更新后用**非浏览器 UA** 发起一次验证请求。

## 没有触发？按这个顺序排查

1. 确认文件名严格为 `SKILL.md`，且位于当前 Agent 支持的 skills 目录。
2. 关闭旧会话并新开一个会话，再问上面的验证问题。
3. 让 Agent 列出它发现的 skills，确认其中有 `pvhot`。
4. 仍失败时，把平台、版本、实际安装路径提交到 https://pvhot.bbroot.com/#feedback；不要发送 token 或本地隐私文件。

## 使用边界

公开可读，不等于可以忽略来源。摘要和翻译由 AI 生成，引用前请复核原文；对外发布请保留来源；收到 429 退避；这是测试版，不提供 SLA。
