---
name: pvhot
description: Use this skill when the user asks about recent photovoltaic (PV) / solar industry news, daily briefings, market moves, policy, or company updates across the PV value chain (polysilicon, wafers, cells, modules, inverters, BOS, storage, plants, market quotes). Fetches aggregated, AI-translated Chinese news from PV HOT (https://pvhot.bbroot.com).
---

# PV HOT — 光伏行业新闻接入

PV HOT（https://pvhot.bbroot.com）是一个光伏产业链新闻聚合站：每天从 Google News RSS 抓取 **硅料 / 硅片 / 电池片 / 组件 / 逆变器 / 支架BOS / 储能 / 电站 / 行情** 9 大类动态，AI 翻译成中文并附推荐理由。

本 skill 让 Agent 通过**公开只读、无需 API Key** 的接口获取这些数据，并提供一个**匿名反馈通道**给站长。

## 接口

### 1. 拉取新闻（GET，匿名）
```
GET https://pvhot.bbroot.com/data.json
```
返回 JSON：
```json
{
  "meta":   { "siteName", "siteSub", "date", "weekday", "updated", "generator" },
  "categories": ["全部","硅料","硅片","电池片","组件","逆变器","支架BOS","储能","电站","行情"],
  "items": [ { ... } ]
}
```
`items[]` 字段说明：
- `id`：稳定 id（由 link 派生，不会因抓取重排而变）
- `title_cn`：中文标题（**优先使用**）
- `title`：原文标题（多为英文）
- `summary_cn` / `summary`：中文 / 原文摘要（可能为空）
- `category`：分类（见上面的 categories）
- `link`：原文链接（经 Google News 中转，需点开看原文）
- `pubDate`：ISO 时间，如 `"2026-07-23T14:01:00"`
- `dateKey`：日期 `"2026-07-23"`
- `source` / `sources[]`：来源名
- `heat`：热度 0–100
- `reason`：AI 生成的推荐理由（中文）

调用示例（Python，标准库即可）：
```python
import urllib.request, json
with urllib.request.urlopen("https://pvhot.bbroot.com/data.json", timeout=15) as r:
    data = json.load(r)
items = data["items"]
# 按分类筛选
storage = [x for x in items if x["category"] == "储能"]
# 取最近 5 条
recent = sorted(items, key=lambda x: x.get("pubDate", ""), reverse=True)[:5]
for it in recent:
    print(it["pubDate"], it["title_cn"], it["link"])
```

### 2. 提交反馈（POST，匿名，限频）
```
POST https://pvhot.bbroot.com/api/feedback
Content-Type: application/json
```
```json
{ "msg": "反馈内容", "email": "可选", "page": "当前页", "ua": "调用方 UA" }
```
成功返回 `{ "ok": true, "id": "..." }`。同一 IP **1 分钟内最多 5 条**。

## 使用约定（务必遵守）
- 引用**数字、政策或原话**前，用 `link` 指向的原文复核，不要只信摘要。
- 对外发布时**保留来源 attribution**；第三方原文版权归原作者。
- 收到 HTTP **429** 时退避，不要并发抓取。正常会话 / RSS / 分钟级轮询均可。
- 这是**测试版，不提供 SLA**；生产链路请自行加缓存、重试与降级。

## 何时使用本 skill
- 用户问"今天 / 最近光伏有什么大事"
- 用户关心某细分领域（储能、逆变器、硅料价格…）
- 用户要光伏日报、周报，或某家公司动态
- 用户想给 PV HOT 提反馈、报错或要某个功能
