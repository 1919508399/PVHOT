---
name: pvhot
description: Use this skill when the user asks about recent photovoltaic (PV) or solar industry news, daily briefings, market moves, policy, company updates, or a specific segment such as polysilicon, wafers, cells, modules, inverters, BOS, storage, plants, and market quotes. Fetches aggregated, deduplicated and AI-summarized Chinese intelligence from PV HOT.
---

# PV HOT — 光伏行业情报

PV HOT（https://pvhot.bbroot.com）聚合国内外光伏产业信源，按事件去重，并提供中文标题、简短摘要、热度、来源和原文链接。

本 Skill 使用 PV HOT 的公开只读接口，匿名访问，无需 API Key。

## 查询流程

1. 从用户问题中识别时间范围、产业赛道、关键词和数量。
2. 优先请求筛选接口 `GET /api/v1/news`，不要先下载全量数据。
3. 按事件重要性整理；同一事件的多个来源合并呈现，不重复罗列。
4. 回答中标明时间范围，给出中文标题、简短摘要、发布时间、来源和原文链接。
5. 涉及数字、政策、价格或原话时，明确提示用户回到 `link` 指向的原文核验。

## 公开接口

### 1. 新闻查询

```text
GET https://pvhot.bbroot.com/api/v1/news
```

可选参数：

- `date=today`：仅今天（北京时间）
- `date=7d`：最近 7 天
- `date=YYYY-MM-DD`：指定日期
- `category=储能`：产业赛道，可用值包括硅料、硅片、电池片、组件、逆变器、支架BOS、储能、电站、行情
- `featured=true`：仅 AI 精选
- `q=TOPCon`：匹配标题、摘要、来源与标签
- `limit=10`：返回数量，1–100，默认 20

示例：

```text
https://pvhot.bbroot.com/api/v1/news?date=today&category=储能&featured=true&limit=5
```

返回结构：

```json
{
  "apiVersion": "1.1.0",
  "generatedAt": "2026-07-26T12:00:00.000Z",
  "updated": "2026-07-26T11:58:00.000Z",
  "total": 8,
  "count": 5,
  "filters": {
    "date": "today",
    "category": "储能",
    "featured": true,
    "q": ""
  },
  "items": []
}
```

`items[]` 主要字段：

- `id`：稳定事件 ID
- `title` / `title_original`：中文标题 / 原始标题
- `summary`：AI 提炼的中文摘要
- `category`：产业赛道
- `featured`：是否进入 AI 精选
- `source` / `sources` / `sourceCount`：主来源、来源列表、交叉信源数
- `networkHeat` / `score`：网络热度、综合推荐分
- `pubDate` / `dateKey`：发布时间、北京时间日期
- `link`：原文链接
- `image`：代表图片，可能为空
- `reason`：精选理由
- `tags`：主题标签
- `attribution`：对外引用说明

### 2. RSS

```text
GET https://pvhot.bbroot.com/api/v1/rss.xml
```

RSS 支持与新闻查询相同的 `date`、`category`、`featured`、`q`、`limit` 参数；最大返回 50 条。

### 3. 服务状态

```text
GET https://pvhot.bbroot.com/api/v1/status
```

返回 API 版本、数据更新时间、今日动态数、今日精选数、信源数与可用分类。查询失败时可先用此接口判断服务状态。

### 4. 全量兼容数据

```text
GET https://pvhot.bbroot.com/data.json
```

仅在需要本地分析全量数据或兼容旧流程时使用。日常问答优先使用 `/api/v1/news`。

### 5. 提交反馈

```text
POST https://pvhot.bbroot.com/api/feedback
Content-Type: application/json
```

```json
{ "msg": "反馈内容", "email": "可选", "page": "当前页", "ua": "调用方 UA" }
```

同一 IP 1 分钟内最多 5 条。

## 回答规范

- 时间问题必须使用接口返回的 `pubDate` / `dateKey`，不要用抓取顺序代替日期。
- 用户问“今天”时必须设置 `date=today`；没有返回时如实说明，不用旧闻填充。
- 优先呈现 `featured=true`、多信源交叉验证或 `networkHeat` 较高的事件，但不能只看热度。
- 摘要和翻译由 AI 生成，不把它们冒充原文引述。
- 对外发布保留来源与原文链接；第三方原文版权归原作者。
- 收到 HTTP 429 时退避，不并发抓取。生产链路自行加入缓存、重试与降级。

## 触发示例

- “今天光伏行业最重要的 5 件事是什么？”
- “整理最近一周储能和逆变器动态”
- “查一下 TOPCon、组件价格或美国关税的新消息”
- “生成一份带来源的光伏日报”
