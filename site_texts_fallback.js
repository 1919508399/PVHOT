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
    "verify_q": "今天光伏行业最重要的 5 件事是什么？",
    "skill_md": "---\nname: pvhot\ndescription: Use this skill when the user asks about recent photovoltaic (PV) / solar industry news, daily briefings, market moves, policy, or company updates across the PV value chain (polysilicon, wafers, cells, modules, inverters, BOS, storage, plants, market quotes). Fetches aggregated, AI-translated Chinese news from PV HOT (https://pvhot.bbroot.com).\n---\n\n# PV HOT — 光伏行业新闻接入\n\nPV HOT（https://pvhot.bbroot.com）是一个光伏产业链新闻聚合站：每天从 Google News RSS 抓取 **硅料 / 硅片 / 电池片 / 组件 / 逆变器 / 支架BOS / 储能 / 电站 / 行情** 9 大类动态，AI 翻译成中文并附推荐理由。\n\n本 skill 让 Agent 通过**公开只读、无需 API Key** 的接口获取这些数据，并提供一个**匿名反馈通道**给站长。\n\n## 接口\n\n### 1. 拉取新闻（GET，匿名）\n```\nGET https://pvhot.bbroot.com/data.json\n```\n返回 JSON：\n```json\n{\n  \"meta\":   { \"siteName\", \"siteSub\", \"date\", \"weekday\", \"updated\", \"generator\" },\n  \"categories\": [\"全部\",\"硅料\",\"硅片\",\"电池片\",\"组件\",\"逆变器\",\"支架BOS\",\"储能\",\"电站\",\"行情\"],\n  \"items\": [ { ... } ]\n}\n```\n`items[]` 字段说明：\n- `id`：稳定 id（由 link 派生，不会因抓取重排而变）\n- `title_cn`：中文标题（**优先使用**）\n- `title`：原文标题（多为英文）\n- `summary_cn` / `summary`：中文 / 原文摘要（可能为空）\n- `category`：分类（见上面的 categories）\n- `link`：原文链接（经 Google News 中转，需点开看原文）\n- `pubDate`：ISO 时间，如 `\"2026-07-23T14:01:00\"`\n- `dateKey`：日期 `\"2026-07-23\"`\n- `source` / `sources[]`：来源名\n- `heat`：热度 0–100\n- `reason`：AI 生成的推荐理由（中文）\n\n调用示例（Python，标准库即可）：\n```python\nimport urllib.request, json\nwith urllib.request.urlopen(\"https://pvhot.bbroot.com/data.json\", timeout=15) as r:\n    data = json.load(r)\nitems = data[\"items\"]\n# 按分类筛选\nstorage = [x for x in items if x[\"category\"] == \"储能\"]\n# 取最近 5 条\nrecent = sorted(items, key=lambda x: x.get(\"pubDate\", \"\"), reverse=True)[:5]\nfor it in recent:\n    print(it[\"pubDate\"], it[\"title_cn\"], it[\"link\"])\n```\n\n### 2. 提交反馈（POST，匿名，限频）\n```\nPOST https://pvhot.bbroot.com/api/feedback\nContent-Type: application/json\n```\n```json\n{ \"msg\": \"反馈内容\", \"email\": \"可选\", \"page\": \"当前页\", \"ua\": \"调用方 UA\" }\n```\n成功返回 `{ \"ok\": true, \"id\": \"...\" }`。同一 IP **1 分钟内最多 5 条**。\n\n## 使用约定（务必遵守）\n- 引用**数字、政策或原话**前，用 `link` 指向的原文复核，不要只信摘要。\n- 对外发布时**保留来源 attribution**；第三方原文版权归原作者。\n- 收到 HTTP **429** 时退避，不要并发抓取。正常会话 / RSS / 分钟级轮询均可。\n- 这是**测试版，不提供 SLA**；生产链路请自行加缓存、重试与降级。\n\n## 何时使用本 skill\n- 用户问\"今天 / 最近光伏有什么大事\"\n- 用户关心某细分领域（储能、逆变器、硅料价格…）\n- 用户要光伏日报、周报，或某家公司动态\n- 用户想给 PV HOT 提反馈、报错或要某个功能\n"
  },
  "feedback": {
    "eyebrow": "反 馈",
    "title_html": "<span class=\"abt-emerald\">说说</span>你的想法",
    "sub_html": "发现 bug、想要的功能、看<span class=\"abt-emerald\">不顺眼</span>的地方——都可以告诉我。<br/>我都会看到。"
  },
  "changelog": {
    "title": "更新日志",
    "sub": "最近发生了什么——新功能、调整、优化，都写在这里。",
    "items": [
      {
        "ver": "v5.6",
        "date": "2026-07-30",
        "time": "09:25",
        "type": "发布",
        "title": "工程整改完成：CI、原子发布与安全运维上线",
        "text": "PV HOT 的开发、合并和部署流程完成生产化整改；每个线上版本都能追溯到 Git 提交，并经过自动检查、健康验证和可恢复发布。",
        "bullets": [
          "PR 自动执行代码规范、单元测试、首页冒烟测试、发布包白名单和完整历史凭据扫描",
          "主分支合并后自动构建锁定版本发布包，校验摘要后原子切换，并保留上一版本快速回滚",
          "抓取、价格、证书和后台服务改为最小权限账号与 systemd 管理，补齐日志轮转和失败状态检查",
          "线上数据重新抓取并验证今日新闻、AI 精选、移动端轻量首屏、UTF-8 编码和公开健康接口"
        ]
      },
      {
        "ver": "v5.5",
        "date": "2026-07-29",
        "time": "15:50",
        "type": "工程",
        "title": "交付链路、安全与数据稳定性升级",
        "text": "PV HOT 建立从代码检查到正式发布的可追溯工程链路，降低手工部署、版本混用和数据写入中断带来的风险。",
        "bullets": [
          "新增快速 CI，自动检查语法、编码、关键数据逻辑、首页可用性与明文凭据",
          "正式版本按 Git 提交生成独立发布包，支持原子切换、健康检查和快速回滚",
          "新闻、微信、价格与后台数据统一改为原子写入，并增加跨进程任务锁",
          "服务器改用受限密钥账号，补齐运行状态、数据新鲜度和证书续期监控"
        ]
      },
      {
        "ver": "v5.4",
        "date": "2026-07-27",
        "time": "14:24",
        "type": "性能",
        "title": "手机端首屏数据加速",
        "text": "手机首次打开改为先加载轻量今日情报，再在后台补齐近 7 天完整数据，减少等待和主线程解析压力。",
        "bullets": [
          "首屏数据从完整 280 条降为今日内容与最近动态轻量包",
          "手机端提前并行预加载数据，不再等待页面脚本执行后才发起请求",
          "完整数据后台静默补齐，切换全部动态和日报仍可直接使用",
          "生产 JSON 改为紧凑格式，并增加短时缓存与过期内容复用"
        ]
      },
      {
        "ver": "v5.3",
        "date": "2026-07-26",
        "time": "21:25",
        "type": "重构",
        "title": "Agent 接入升级为可验证的开发者工作台",
        "text": "Agent 接入从静态说明页升级为实时工作台，补齐公开 REST、RSS 与状态接口，并支持现场组合参数、复制和测试。",
        "bullets": [
          "新增日期、赛道、关键词、AI 精选和返回数量组合生成器",
          "提供 Agent 提示词、REST API、RSS 三种即用型输出",
          "实时显示数据状态、今日动态、今日精选与覆盖信源",
          "Skill 文档升级到 v0.2，严格约束今天不混入旧闻"
        ]
      },
      {
        "ver": "v5.2",
        "date": "2026-07-26",
        "time": "20:58",
        "type": "更新",
        "title": "更新日志与主题体验重做",
        "text": "更新日志改为按日期分组的产品时间轴；侧栏底部恢复浅色、跟随系统与深色三段式切换，同时移除前台后台入口。",
        "bullets": [
          "更新日志按日期、时间和更新类型展示，长内容更容易浏览",
          "深色模式重新覆盖首页、时间线、日报、信息页与移动端",
          "主题选择会保存在当前设备，并支持跟随系统自动变化"
        ]
      },
      {
        "ver": "v5.1",
        "date": "2026-07-26",
        "time": "20:47",
        "type": "重构",
        "title": "管理后台 2.0：专业工作台整体升级",
        "text": "后台升级为独立侧栏工作台，统一新闻审核、数据状态、站点内容与用户反馈。",
        "bullets": [
          "新闻审核卡片增加原文图片、完整摘要、信源数与 AI 分数",
          "新增资讯总量、今日资讯、今日精选和活跃信源概览",
          "加入登录限频、抓取任务防重复与北京时间统计"
        ]
      },
      {
        "ver": "v5.0",
        "date": "2026-07-26",
        "time": "20:28",
        "type": "优化",
        "title": "AI 精选、正文摘要与近 7 天新闻链路重构",
        "text": "精选严格限定北京时间当天新闻，并从发布方原文提炼完整短总结与重要主图。",
        "bullets": [
          "综合网络热度、跨信源报道、权威度、时效性和产业影响评分",
          "原文可访问时提炼 120–300 字摘要，受限时生成完整信源简报",
          "补齐近 7 天新闻，修复未来日期和旧闻混入精选的问题"
        ]
      },
      {
        "ver": "v4.0",
        "date": "2026-07-26",
        "time": "18:40",
        "type": "重构",
        "title": "全站 UI 与信源体系升级",
        "text": "建立暖白、深青与香槟金的 PV HOT 视觉体系，同时扩展国内外光伏行业信源。",
        "bullets": [
          "重做品牌侧栏、情报头图、热点榜和时间线卡片",
          "扩展国际媒体、行业机构、国内网站与微信公众号监控",
          "优化静态数据加载、文章缓存与多信源聚合"
        ]
      },
      {
        "ver": "v3.3",
        "date": "2026-07-24",
        "time": "10:30",
        "type": "更新",
        "title": "分类导航与访问统计上线",
        "text": "新增政策、价格分类导航；恢复关于页二维码；后台访问统计面板上线，并调整全部动态标签展示。"
      },
      {
        "ver": "v3.2",
        "date": "2026-07-23",
        "time": "18:20",
        "type": "更新",
        "title": "多信源聚合与后台管理上线",
        "text": "接入 Google News、索比光伏、北极星与 RSSHub 等来源；支持后台编辑、精选和合并，启用 HTTPS。"
      },
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
