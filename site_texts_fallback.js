// 由 admin_server.js 同步自 site_texts.json
window.SITE_TEXTS = {
  "about": {
    "eyebrow": "关于这个站",
    "title_html": "嗨，我是 <span class=\"abt-emerald\">清洁能源蛋黄派</span>",
    "sub": "这个站是我做的，免费给大家用。",
    "poem": [
      "每天抓 <b class=\"abt-emerald\">光伏圈</b> 的新动静。",
      "用 AI 帮我筛掉噪声。",
      "把真正值得看的几条留下来。"
    ],
    "fineprint_html": "PV HOT 是聚合摘要和阅读索引，原文版权归各来源所有。<br/>如果你是来源方，希望更正、下架或调整展示方式，可以通过<a href=\"#\" data-goview=\"feedback\">反馈页</a>联系我。"
  },
  "agent": {
    "eyebrow": "AGENT 与开发者接入",
    "title_html": "让 Agent 直接使用 <span class=\"abt-emerald\">PV HOT</span>",
    "sub_html": "Agent Skill 负责理解问题和整理答案；RSS 与 REST API 负责稳定传递公开精选、最近 7 天动态和日报。<br/>匿名只读，无需 API Key。",
    "note_html": "",
    "verify_q": "过去 24 小时光伏行业最重要的 5 件事是什么？",
    "skill_md": "---\nname: pvhot\ndescription: Use this skill when the user asks about recent photovoltaic (PV) / solar industry news, daily briefings, market moves, policy, or company updates across the PV value chain (polysilicon, wafers, cells, modules, inverters, BOS, storage, plants, market quotes). Fetches aggregated, AI-translated Chinese news from PV HOT (https://pvhot.bbroot.com).\n---\n\n# PV HOT — 光伏行业新闻接入\n\nPV HOT（https://pvhot.bbroot.com）是一个光伏产业链新闻聚合站：每天从 Google News RSS 抓取 **硅料 / 硅片 / 电池片 / 组件 / 逆变器 / 支架BOS / 储能 / 电站 / 行情** 9 大类动态，AI 翻译成中文并附推荐理由。\n\n本 skill 让 Agent 通过**公开只读、无需 API Key** 的接口获取这些数据，并提供一个**匿名反馈通道**给站长。\n\n## 接口\n\n### 1. 拉取新闻（GET，匿名）\n```\nGET https://pvhot.bbroot.com/data.json\n```\n返回 JSON：\n```json\n{\n  \"meta\":   { \"siteName\", \"siteSub\", \"date\", \"weekday\", \"updated\", \"generator\" },\n  \"categories\": [\"全部\",\"硅料\",\"硅片\",\"电池片\",\"组件\",\"逆变器\",\"支架BOS\",\"储能\",\"电站\",\"行情\"],\n  \"items\": [ { ... } ]\n}\n```\n`items[]` 字段说明：\n- `id`：稳定 id（由 link 派生，不会因抓取重排而变）\n- `title_cn`：中文标题（**优先使用**）\n- `title`：原文标题（多为英文）\n- `summary_cn` / `summary`：中文 / 原文摘要（可能为空）\n- `category`：分类（见上面的 categories）\n- `link`：原文链接（经 Google News 中转，需点开看原文）\n- `pubDate`：ISO 时间，如 `\"2026-07-23T14:01:00\"`\n- `dateKey`：日期 `\"2026-07-23\"`\n- `source` / `sources[]`：来源名\n- `heat`：热度 0–100\n- `reason`：AI 生成的推荐理由（中文）\n\n调用示例（Python，标准库即可）：\n```python\nimport urllib.request, json\nwith urllib.request.urlopen(\"https://pvhot.bbroot.com/data.json\", timeout=15) as r:\n    data = json.load(r)\nitems = data[\"items\"]\n# 按分类筛选\nstorage = [x for x in items if x[\"category\"] == \"储能\"]\n# 取最近 5 条\nrecent = sorted(items, key=lambda x: x.get(\"pubDate\", \"\"), reverse=True)[:5]\nfor it in recent:\n    print(it[\"pubDate\"], it[\"title_cn\"], it[\"link\"])\n```\n\n### 2. 提交反馈（POST，匿名，限频）\n```\nPOST https://pvhot.bbroot.com/api/feedback\nContent-Type: application/json\n```\n```json\n{ \"msg\": \"反馈内容\", \"email\": \"可选\", \"page\": \"当前页\", \"ua\": \"调用方 UA\" }\n```\n成功返回 `{ \"ok\": true, \"id\": \"...\" }`。同一 IP **1 分钟内最多 5 条**。\n\n## 使用约定（务必遵守）\n- 引用**数字、政策或原话**前，用 `link` 指向的原文复核，不要只信摘要。\n- 对外发布时**保留来源 attribution**；第三方原文版权归原作者。\n- 收到 HTTP **429** 时退避，不要并发抓取。正常会话 / RSS / 分钟级轮询均可。\n- 这是**测试版，不提供 SLA**；生产链路请自行加缓存、重试与降级。\n\n## 何时使用本 skill\n- 用户问\"今天 / 最近光伏有什么大事\"\n- 用户关心某细分领域（储能、逆变器、硅料价格…）\n- 用户要光伏日报、周报，或某家公司动态\n- 用户想给 PV HOT 提反馈、报错或要某个功能\n"
  },
  "feedback": {
    "eyebrow": "反 馈",
    "title_html": "<span class=\"abt-emerald\">说说</span>你的想法",
    "sub_html": "发现 bug、想要的功能、看<span class=\"abt-emerald\">不顺眼</span>的地方——都可以告诉我。<br/>我都会看到。"
  },
  "changelog": {
    "items": [
      {
        "ver": "v3.1",
        "date": "2026-07-22",
        "text": "反馈页改造：居中布局 + 输入提示 + 字数计数 + 邮箱选填，支持内嵌提交反馈（草稿存 localStorage）。"
      },
      {
        "ver": "v3.0",
        "date": "2026-07-22",
        "text": "Agent 接入页：eyebrow + 大标题 + 接入方式卡 + 推荐路径代码块 + 6 个平台安装命令 + 4 条使用边界 callout；关于页：eyebrow + 大标题 + 三行诗 + 微信公众号二维码。"
      },
      {
        "ver": "v2.0",
        "date": "2026-07-22",
        "text": "左侧栏导航 + 当前热点按信源数显示 + 时间线带用户头像 / 转播数 / 同事件关联 / 推荐理由 + 日期下拉 + 多视图（精选 / 全部 / 日报 / 收藏 / Agent / 关于 / 日志 / 反馈）+ 暗色模式 + 移动端侧栏。"
      },
      {
        "ver": "v1.1",
        "date": "2026-07-22",
        "text": "接真实数据源：pv-magazine / pv-tech / energy-storage / solarquarter / pvbuzz（MyMemory 翻译成中文）。file:// 双击 file:// 兜底。"
      },
      {
        "ver": "v1.0",
        "date": "2026-07-22",
        "text": "光伏版新闻聚合门户：硅料 / 硅片 / 电池片 / 组件 / 逆变器 / 支架 / 储能 / 电站 / 行情 9 大类，时间线 feed 形式。"
      }
    ]
  }
};
