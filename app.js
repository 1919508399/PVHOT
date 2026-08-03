/* =========================================================================
 * 光伏 HOT · 渲染逻辑（v2 · aihot 功能模块版）
 * - 左侧栏：内容/接入/更多 三组导航 + 暗色模式
 * - 视图：精选 / 全部动态 / 日报 / 主题 / 收藏 / Agent 接入 / 关于 / 更新日志 / 反馈
 * - 当前热点：X 个信源同时报道 + HH:MM
 * - 时间线：HH:MM · 小圆点 · 用户头像 · X 条转播 · 同事件还有精选 · 推荐理由
 * - 数据驱动：fetch('data.json') → 失败回退到 data_fallback.js（file:// 双击）
 * ========================================================================= */
(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let DATA = null;
  let TEXTS = null;  // 关于 / Agent / 反馈 / 更新日志 4 段可编辑文本
  let state = { view: "featured", cat: "全部", tag: null, kw: "", dailyTab: "day", dailyDate: null, dailyWeek: null, dailyMonth: null };

  /* ---------- 时间线「合并/分开」状态（v18.4：按天持久化） ---------- */
  const MERGE_KEY = "pvhot-merge-days";
  function loadMergeSet() {
    try { return new Set(JSON.parse(localStorage.getItem(MERGE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveMergeSet(s) {
    try { localStorage.setItem(MERGE_KEY, JSON.stringify([...s])); } catch (e) {}
  }
  let mergeSet = loadMergeSet();
  function isMerged(dayKey) { return mergeSet.has(dayKey); }
  function toggleMerge(dayKey) {
    if (mergeSet.has(dayKey)) mergeSet.delete(dayKey); else mergeSet.add(dayKey);
    saveMergeSet(mergeSet);
  }

  /* ---------- 内置默认 texts（fetch 失败 / file:// 时用） ---------- */
  const DEFAULT_TEXTS = {
    about: {
      eyebrow: "关于这个站",
      title_html: "嗨，我是 <span class=\"abt-emerald\">清洁能源蛋黄派</span>",
      sub: "这个站是我做的，免费给大家用。",
      poem: [
        "每天抓 <b class=\"abt-emerald\">光伏圈</b> 的新动静。",
        "用 AI 帮我筛掉噪声。",
        "把真正值得看的几条留下来。"
      ],
      fineprint_html: "PV HOT 是聚合摘要和阅读索引，原文版权归各来源所有。<br/>如果你是来源方，希望更正、下架或调整展示方式，可以通过<a href=\"#\" data-goview=\"feedback\">反馈页</a>联系我。"
    },
    agent: {
      eyebrow: "AGENT 与开发者接入",
      title_html: "让 Agent 直接使用 <span class=\"abt-emerald\">PV HOT</span>",
      sub_html: "Agent Skill 负责理解问题和整理答案；RSS 与 REST API 负责稳定传递公开精选、最近 7 天动态和日报。<br/>匿名只读，无需 API Key。",
      note_html: "",
      verify_q: "今天光伏行业最重要的 5 件事是什么？"
    },
    feedback: {
      eyebrow: "反 馈",
      title_html: "<span class=\"abt-emerald\">说说</span>你的想法",
      sub_html: "发现 bug、想要的功能、看<span class=\"abt-emerald\">不顺眼</span>的地方——都可以告诉我。<br/>我都会看到。"
    },
    changelog: {
      items: [
        {
          ver: "v5.7", date: "2026-08-03", time: "11:28", type: "信源",
          title: "X 权威光伏信源与后台管理接入",
          text: "首批接入 12 个近期活跃的国际光伏媒体和机构 X 账号，用于发现突发动态与辅助判断网络热度。",
          bullets: [
            "X 只作发现信号，正文仍回到媒体官网提取标题、日期、摘要与主图",
            "按账号增量读取并保存上次位置，排除回复和纯转发，减少重复请求",
            "后台支持筛选、查看健康状态和添加指定 X 账号",
            "未配置官方 API 时如实显示被拦截，官网、RSS 和公众号抓取不受影响"
          ]
        },
        {
          ver: "v5.6", date: "2026-07-30", time: "09:25", type: "发布",
          title: "工程整改完成：CI、原子发布与安全运维上线",
          text: "PV HOT 的开发、合并和部署流程完成生产化整改；每个线上版本都能追溯到 Git 提交，并经过自动检查、健康验证和可恢复发布。",
          bullets: [
            "PR 自动执行代码规范、单元测试、首页冒烟测试、发布包白名单和完整历史凭据扫描",
            "主分支合并后自动构建锁定版本发布包，校验摘要后原子切换，并保留上一版本快速回滚",
            "抓取、价格、证书和后台服务改为最小权限账号与 systemd 管理，补齐日志轮转和失败状态检查",
            "线上数据重新抓取并验证今日新闻、AI 精选、移动端轻量首屏、UTF-8 编码和公开健康接口"
          ]
        },
        {
          ver: "v5.5", date: "2026-07-29", time: "15:50", type: "工程",
          title: "交付链路、安全与数据稳定性升级",
          text: "PV HOT 建立从代码检查到正式发布的可追溯工程链路，降低手工部署、版本混用和数据写入中断带来的风险。",
          bullets: [
            "新增快速 CI，自动检查语法、编码、关键数据逻辑、首页可用性与明文凭据",
            "正式版本按 Git 提交生成独立发布包，支持原子切换、健康检查和快速回滚",
            "新闻、微信、价格与后台数据统一改为原子写入，并增加跨进程任务锁",
            "服务器改用受限密钥账号，补齐运行状态、数据新鲜度和证书续期监控"
          ]
        },
        {
          ver: "v5.4", date: "2026-07-27", time: "14:24", type: "性能",
          title: "手机端首屏数据加速",
          text: "手机首次打开改为先加载轻量今日情报，再在后台补齐近 7 天完整数据，减少等待和主线程解析压力。",
          bullets: [
            "首屏数据从完整 280 条降为今日内容与最近动态轻量包",
            "手机端提前并行预加载数据，不再等待页面脚本执行后才发起请求",
            "完整数据后台静默补齐，切换全部动态和日报仍可直接使用",
            "生产 JSON 改为紧凑格式，并增加短时缓存与过期内容复用"
          ]
        },
        {
          ver: "v5.3", date: "2026-07-26", time: "21:25", type: "重构",
          title: "Agent 接入升级为可验证的开发者工作台",
          text: "Agent 接入从静态说明页升级为实时工作台，补齐公开 REST、RSS 与状态接口，并支持现场组合参数、复制和测试。",
          bullets: [
            "新增日期、赛道、关键词、AI 精选和返回数量组合生成器",
            "提供 Agent 提示词、REST API、RSS 三种即用型输出",
            "实时显示数据状态、今日动态、今日精选与覆盖信源",
            "Skill 文档升级到 v0.2，严格约束今天不混入旧闻"
          ]
        },
        {
          ver: "v5.2", date: "2026-07-26", time: "20:58", type: "更新",
          title: "更新日志与主题体验重做",
          text: "更新日志改为按日期分组的产品时间轴；侧栏底部恢复浅色、跟随系统与深色三段式切换，同时移除前台后台入口。",
          bullets: [
            "更新日志按日期、时间和更新类型展示，长内容更容易浏览",
            "深色模式重新覆盖首页、时间线、日报、信息页与移动端",
            "主题选择会保存在当前设备，并支持跟随系统自动变化"
          ]
        },
        {
          ver: "v5.1", date: "2026-07-26", time: "20:47", type: "重构",
          title: "管理后台 2.0：专业工作台整体升级",
          text: "后台升级为独立侧栏工作台，统一新闻审核、数据状态、站点内容与用户反馈。",
          bullets: [
            "新闻审核卡片增加原文图片、完整摘要、信源数与 AI 分数",
            "新增资讯总量、今日资讯、今日精选和活跃信源概览",
            "加入登录限频、抓取任务防重复与北京时间统计"
          ]
        },
        {
          ver: "v5.0", date: "2026-07-26", time: "20:28", type: "优化",
          title: "AI 精选、正文摘要与近 7 天新闻链路重构",
          text: "精选严格限定北京时间当天新闻，并从发布方原文提炼完整短总结与重要主图。",
          bullets: [
            "综合网络热度、跨信源报道、权威度、时效性和产业影响评分",
            "原文可访问时提炼 120–300 字摘要，受限时生成完整信源简报",
            "补齐近 7 天新闻，修复未来日期和旧闻混入精选的问题"
          ]
        },
        {
          ver: "v4.0", date: "2026-07-26", time: "18:40", type: "重构",
          title: "全站 UI 与信源体系升级",
          text: "建立暖白、深青与香槟金的 PV HOT 视觉体系，同时扩展国内外光伏行业信源。",
          bullets: [
            "重做品牌侧栏、情报头图、热点榜和时间线卡片",
            "扩展国际媒体、行业机构、国内网站与微信公众号监控",
            "优化静态数据加载、文章缓存与多信源聚合"
          ]
        },
        { ver: "v3.3", date: "2026-07-24", text: "新增「政策」「价格」分类导航；恢复关于页二维码；后台访问统计面板上线（PV/UV、7天趋势、热门页面）；全部动态取消精选标签。" },
        { ver: "v3.2", date: "2026-07-23", text: "多信源聚合上线（Google News + 索比光伏 + 北极星 + RSSHub 微博/微信公众号）；后台管理系统上线（编辑/精选/合并层）；榜单按信源数排行，精选按 AI 推荐分排序；HTTPS 启用。" },
        { ver: "v3.1", date: "2026-07-22", text: "反馈页改造：居中布局 + 输入提示 + 字数计数 + 邮箱选填，支持内嵌提交反馈（草稿存 localStorage）。" },
        { ver: "v3.0", date: "2026-07-22", text: "Agent 接入页 + 关于页：eyebrow + 大标题 + 三行诗 + 微信公众号二维码 + 6 平台安装命令。" },
        { ver: "v2.0", date: "2026-07-22", text: "左侧栏导航 + 时间线带头像/推荐理由 + 多视图（精选/全部/日报/收藏/Agent/关于/日志/反馈）+ 暗色模式 + 移动端侧栏。" },
        { ver: "v1.1", date: "2026-07-22", text: "接真实数据源（pv-magazine / pv-tech 等），英文自动翻译成中文。" },
        { ver: "v1.0", date: "2026-07-22", text: "光伏版新闻聚合门户上线：9 大分类，时间线 feed 形式。" }
      ]
    }
  };

  /* ---------- 工具 ---------- */
  const pad2 = n => String(n).padStart(2, "0");
  const fmtHHMM = iso => {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const fmtDay = iso => {
    const d = new Date(iso);
    const wd = ["周日","周一","周二","周三","周四","周五","周六"][d.getDay()];
    return { md: `${d.getMonth() + 1}月${d.getDate()}日`, wd, key: iso.slice(0, 10) };
  };
  /* 农历式中文大写日期（用于日报副标题） */
  const CN_NUM = ["〇","一","二","三","四","五","六","七","八","九"];
  const toCNYear = y => y.toString().split("").map(n => CN_NUM[+n]).join("");
  const toCNMonth = m => {
    const a = ["一","二","三","四","五","六","七","八","九","十","十一","十二"];
    return (m <= 10 ? a[m-1] : m === 11 ? "十一" : "十二") + "月";
  };
  const toCNDay = d => {
    if (d === 10) return "十日";
    if (d < 10)  return ["一","二","三","四","五","六","七","八","九"][d-1] + "日";
    if (d < 20)  return "十" + CN_NUM[d%10] + "日";
    if (d === 20) return "二十日";
    if (d < 30)  return "二十" + CN_NUM[d%10] + "日";
    if (d === 30) return "三十日";
    return "三十一";
  };
  const fmtDateCNFormal = key => `${toCNYear(+key.slice(0,4))}年${toCNMonth(+key.slice(5,7))}${toCNDay(+key.slice(8,10))}`;
  /* 简化版（无前导零）：7月23日 —— 与 day-head / featured 共用 */
  const fmtDateCN = key => {
    const [, m, d] = key.split("-").map(Number);
    return `${m}月${d}日`;
  };
  /* 完整中文：2026年7月23日（如果以后需要）*/
  const fmtDateFull = key => {
    const [y, m, d] = key.split("-").map(Number);
    return `${y}年${m}月${d}日`;
  };
  /* ISO 8601 周编号：2026-W29 */
  const getISOWeekKey = iso => {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${pad2(weekNo)}`;
  };
  /* ISO 周范围（周一 → 周日） */
  const getISOWeekRange = weekKey => {
    const [y, w] = weekKey.split("-W").map(Number);
    const jan4 = new Date(y, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const week1Mon = new Date(jan4);
    week1Mon.setDate(jan4.getDate() - (jan4Day - 1));
    const start = new Date(week1Mon);
    start.setDate(start.getDate() + (w - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end };
  };
  const fmtMD = d => `${d.getMonth() + 1}-${pad2(d.getDate())}`;
  /* 月份键：2026-07 */
  const getMonthKey = iso => (iso || "").slice(0, 7);
  /* 本周/本月主线程：取最热的 2 个分类 + 6 条头条，合成一段 */
  const composeThread = (items, periodLabel) => {
    if (!items.length) return { title: `${periodLabel}暂无数据`, body: "" };
    const byCat = {};
    items.forEach(it => (byCat[it.category] = byCat[it.category] || []).push(it));
    const cats = Object.entries(byCat)
      .map(([cat, arr]) => ({
        cat, count: arr.length,
        top: arr.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0))[0],
      }))
      .sort((a, b) => b.count - a.count);
    const main = cats[0], second = cats[1];
    let title;
    if (main && second)      title = `${main.cat}与${second.cat}共同主导${periodLabel}`;
    else if (main)            title = `${main.cat}主导${periodLabel}光伏动态`;
    else                       title = `${periodLabel}光伏主线`;
    const topItems = items.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0)).slice(0, 6);
    const mentions = topItems.map((it, i) => {
      const t = it.title;
      return i === 0 ? `其中《${t}》讨论度最高` : `另有《${t}》`;
    });
    const totalSources = items.reduce((s, it) => s + (it.sourceCount || 0), 0);
    const body = `${periodLabel}光伏行业共 ${items.length} 篇报道、覆盖 ${cats.length} 个分类、${totalSources} 个信源；${mentions.join("，")}。整体看，"${main ? main.cat : "光伏"}" 是这一${periodLabel.includes("周") ? "周" : "月"}的主旋律，其它各线并行推进。`;
    return { title, body };
  };
  /* 周/月底部 4 项数据：独立事件 / 条精选 / 顺日接续 / 读完本页 */
  const composeStats = items => {
    const days = new Set(items.map(it => (it.pubDate || "").slice(0, 10))).size;
    return {
      events:  items.length * 3 + (items.length ? 1 : 0),
      curated: items.length,
      days,
      readMin: estReadMin(items.length),
    };
  };
  /* 估算阅读时长：每篇 30 秒，最少 5 分钟 */
  const estReadMin = n => Math.max(5, Math.round(n * 0.5));
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const heatCls = h => h >= 80 ? "hi" : h >= 60 ? "mid" : "lo";
  const hl = (txt, kw) => {
    if (!kw) return esc(txt);
    const i = txt.toLowerCase().indexOf(kw.toLowerCase());
    if (i < 0) return esc(txt);
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + kw.length)) + "</mark>" + esc(txt.slice(i + kw.length));
  };
  /* ---------- 收藏（localStorage 持久化） ---------- */
  const FAV_KEY = "pvhot-favs";
  const getFavs = () => {
    try { const a = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  };
  const isFav = id => !!id && getFavs().includes(id);
  const toggleFav = id => {
    if (!id) return false;
    const s = getFavs();
    const i = s.indexOf(id);
    if (i >= 0) s.splice(i, 1); else s.push(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(s)); } catch (e) {}
    return i < 0; // 返回「现在是否收藏」
  };
  const favItems = () => DATA.items.filter(it => isFav(it.id));
  const updateFavBadge = () => {
    const el = document.querySelector("#sbFavBadge");
    if (el) {
      const n = getFavs().length;
      el.textContent = n ? String(n) : "";
      el.style.display = n ? "" : "none";
    }
    // 移动端底部抽屉里的收藏数也要同步
    const fc = document.querySelector("#mbSheetFavCount");
    if (fc) {
      const n = getFavs().length;
      fc.textContent = n ? String(n) + " 条" : "";
      fc.style.display = n ? "" : "none";
    }
  };
  /* 数据兜底：派生字段（pubTime / 真实信源 / related） */
  function ensureDerived(items) {
    const byCat = {};
    items.forEach((it, i) => (byCat[it.category] = byCat[it.category] || []).push({ ...it, _i: i }));
    items.forEach((it, i) => {
      if (!it.pubTime) it.pubTime = fmtHHMM(it.pubDate);
      const sourceName = (it.author || it.source || "行业信源").trim();
      const colorByCat = {
        "政策": "#805ad5", "硅料": "#0e7490", "硅片": "#2563eb",
        "电池片": "#0284c7", "组件": "#0f766e", "逆变器": "#2563eb",
        "储能": "#b7791f", "电站": "#2f855a", "价格": "#c2410c"
      };
      // 始终以真实来源覆盖旧版的虚拟编辑账号，避免用户误认为是原作者。
      it.user = {
        name: sourceName,
        handle: (it.sourceCount || 1) > 1 ? `${it.sourceCount} 个信源聚合` : "原文信源",
        color: colorByCat[it.category] || "#0f766e"
      };
      /* v3.5：来源标记 — 按源头类型分配标签和颜色 */
      if (!it.srcLabel) {
        const s = (it.source || '').toLowerCase();
        const srcs = ((it.sources || []).join(' ') || '').toLowerCase();
        if (s.includes('微信') || s.includes('wechat') || s.includes('公众号') || srcs.includes('公众号')) {
          it.srcLabel = '公众号'; it.srcColor = '#07c160';
        } else if (s.includes('微博') || s.includes('weibo') || srcs.includes('微博')) {
          it.srcLabel = '微博'; it.srcColor = '#e6162d';
        } else if (['solarbe', 'ne21', 'bjx', '索比', '北极星', '世纪新能源'].some(k => s.includes(k) || srcs.includes(k))) {
          it.srcLabel = '光伏媒体'; it.srcColor = '#ff6b35';
        } else if (['pv magazine', 'pv tech', 'pv-tech', 'cleantechnica', 'solar power world', 'reuters', 'bloomberg', 'pv-magazine', 'renewables now', 'taiyangnews', 'solarquarter', 'mercom', 'saur energy', 'energy-storage', 'solar power portal', 'businesskorea', 'financial times', 'wsj', 's&p global', 'bbc'].some(k => s.includes(k) || srcs.includes(k))) {
          it.srcLabel = '外媒'; it.srcColor = '#6c757d';
        } else {
          it.srcLabel = '资讯'; it.srcColor = '#3a7bd5';
        }
      }
      /* v3.5：微信文章使用真实公众号名称 + 头像 */
      if (it.source === '公众号' || it.source === '微信公众号' || it.source === 'wechat') {
        const acctName = it.author || '';
        if (acctName) {
          const avatarUrl = it.avatar || '';
          it.user = { name: acctName, handle: 'wechat_mp', color: '#07c160', avatar: avatarUrl };
        }
      }
      if (!it.related) {
        const sibs = (byCat[it.category] || []).filter(s => s._i !== i);
        sibs.sort((a, b) => (b.tags || []).filter(t => (it.tags || []).includes(t)).length
                            - (a.tags || []).filter(t => (it.tags || []).includes(t)).length);
        it.related = sibs.slice(0, 1).map(s => ({ title: s.title, link: s.link }));
      }
    });
    return items;
  }

  /* ---------- 渲染：顶栏 meta（顶栏已删除，保留空函数兼容） ---------- */
  function renderMeta() { /* noop: 顶栏已于 v13 移除 */ }

  /* ---------- 渲染：hero（视图头） ---------- */
  const VIEW_META = {
    featured:  { title: "精选",   sub: () => {
      const d = new Date(DATA.meta.date);
      const w = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][d.getDay()];
      return `${fmtDateFull(DATA.meta.date)} ${w} · 仅收录今日新闻 · 综合网络热度、信源权威度与产业影响筛选`;
    }},
    all:       { title: "全部动态", sub: () => `${DATA.meta?.totalItems || DATA.items.length} 条近 7 天光伏资讯，按时间倒序` },
    daily:     { title: "日报",   sub: () => `左侧日历/周/月选择期号 · 右侧每日（周/月）精选摘要 + 全量分类报道` },
    fav:       { title: "收藏",   sub: () => `你收藏的光伏资讯（共 ${getFavs().length} 条，本地保存）` },
    agent:     { title: "Agent 接入", sub: () => "通过 Agent Skill / RSS / REST API 把 PV HOT 接入你的工作流" },
    about:     { title: "关于",   sub: () => "PV HOT 是什么 · 为什么做" },
    changelog: { title: "更新日志", sub: () => "版本历史与本次变更" },
    feedback:  { title: "反馈",   sub: () => "提需求 / 报错 / 建议" },
  };
  function renderHero() {
    const m = VIEW_META[state.view] || VIEW_META.featured;
    $("#heroTitle").textContent = m.title;
    $("#heroSub").textContent   = m.sub();
    const kickerMap = {
      featured: "每日精选", all: "实时情报流", daily: "研究简报", fav: "个人资料夹",
      agent: "开发者接入", about: "关于本站", changelog: "产品更新", feedback: "联系与建议"
    };
    const kicker = $("#heroKicker");
    if (kicker) kicker.textContent = kickerMap[state.view] || "光伏情报";
    const uniqueSources = DATA.meta?.totalSources
      || new Set(DATA.items.map(it => it.source).filter(Boolean)).size;
    const latest = DATA.items.map(it => it.pubDate).filter(Boolean).sort().pop();
    const metricItems = $("#metricItems");
    const metricSources = $("#metricSources");
    const metricTopics = $("#metricTopics");
    const metricUpdated = $("#metricUpdated");
    if (metricItems) metricItems.textContent = DATA.meta?.totalItems || DATA.items.length;
    if (metricSources) metricSources.textContent = uniqueSources;
    if (metricTopics) metricTopics.textContent = Math.max(0, DATA.categories.length - 1);
    if (metricUpdated) metricUpdated.textContent = latest ? fmtHHMM(latest) : "—";
    const topbarDate = $("#topbarDate");
    if (topbarDate) topbarDate.textContent = fmtDateFull(DATA.meta.date);
    // 几个信息视图自带完整页头，隐藏全局 hero 与筛选工具条
    const noHero = state.view === "about" || state.view === "agent" || state.view === "feedback";
    const hero = document.querySelector(".hero");
    if (hero) hero.style.display = noHero ? "none" : "";
    const cat = document.querySelector(".content-bar");
    if (cat) cat.style.display = noHero ? "none" : "";
  }

  /* ---------- 渲染：分类导航（仅 feed 类视图显示） ---------- */
  const FEED_VIEWS = new Set(["featured", "all", "daily", "fav"]);
  function renderCatnav() {
    const box = $("#catnav");
    if (!FEED_VIEWS.has(state.view)) { box.innerHTML = ""; return; }
    box.innerHTML = DATA.categories.map(c =>
      `<button class="${c === state.cat ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`
    ).join("");
  }

  /* ---------- 现货价格面板（InfoLink 数据）---------- */
  function renderPricePanel() {
    const p = DATA.prices;
    if (!p || (!p.pv || !p.pv.length) && (!p.storage || !p.storage.length)) return '';
    let html = '<section class="price-panel">';
    html += '<div class="pp-head"><span class="pp-title">📊 产业链现货价格</span><span class="pp-src">数据来源：InfoLink Consulting</span></div>';
    // Tab buttons
    const hasPV = p.pv && p.pv.length > 0;
    const hasES = p.storage && p.storage.length > 0;
    if (hasPV && hasES) {
      html += '<div class="pp-tabs"><button class="pp-tab active" data-pt="pv">光伏</button><button class="pp-tab" data-pt="es">储能</button></div>';
    }
    // PV section
    if (hasPV) {
      html += `<div class="pp-pane ${hasES ? 'active' : ''}" data-pane="pv">`;
      if (p.pvDate) html += `<div class="pp-date">光伏价格更新：${esc(p.pvDate)}</div>`;
      html += p.pv.map(g => {
        let t = `<div class="pp-group"><div class="pp-group-head"><span class="pp-gname">${esc(g.group)}</span>${g.unit ? `<span class="pp-unit">${esc(g.unit)}</span>` : ''}</div>`;
        t += '<table class="pp-table"><thead><tr><th>项目</th><th>高点</th><th>低点</th><th>均价</th><th>涨跌幅</th></tr></thead><tbody>';
        g.items.forEach(it => {
          const chgClass = it.changePct && /-/.test(it.changePct) ? 'down' : (it.changePct && /[\d]/.test(it.changePct) ? 'up' : '');
          t += `<tr><td class="pp-name">${esc(it.name)}</td><td>${esc(it.high)}</td><td>${esc(it.low)}</td><td class="pp-avg">${esc(it.avg)}</td><td class="pp-chg ${chgClass}">${esc(it.changePct)}</td></tr>`;
        });
        t += '</tbody></table></div>';
        return t;
      }).join('');
      html += '</div>';
    }
    // Storage section
    if (hasES) {
      html += `<div class="pp-pane ${hasPV ? '' : 'active'}" data-pane="es">`;
      if (p.essDate) html += `<div class="pp-date">储能价格更新：${esc(p.essDate)}</div>`;
      html += p.storage.map(g => {
        let t = `<div class="pp-group"><div class="pp-group-head"><span class="pp-gname">${esc(g.group)}</span></div>`;
        t += '<table class="pp-table"><thead><tr><th>项目</th><th>价格区间</th><th>均价</th><th>涨跌</th></tr></thead><tbody>';
        g.items.forEach(it => {
          const chgClass = /下跌/.test(it.change) ? 'down' : (/上涨/.test(it.change) ? 'up' : '');
          t += `<tr><td class="pp-name">${esc(it.name)}</td><td>${esc(it.priceRange)}</td><td class="pp-avg">${esc(it.avg)}</td><td class="pp-chg ${chgClass}">${esc(it.change)}</td></tr>`;
        });
        t += '</tbody></table></div>';
        return t;
      }).join('');
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  /* ---------- 过滤 ---------- */
  function filtered() {
    const kw = state.kw.trim().toLowerCase();
    return DATA.items.filter(it => {
    if (state.cat !== "全部" && it.category !== state.cat) return false;
      if (state.tag && !(it.tags || []).includes(state.tag)) return false;
      if (kw) {
        const hay = (it.title + " " + (it.summary || "") + " " + (it.tags || []).join(" ") + " " + it.source).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function itemDateKey(it) {
    return it.dateKey || (it.pubDate || '').slice(0, 10);
  }

  /* ---------- 渲染：今日热点 TOP 5 ---------- */
  function renderTop5() {
    const todayKey = DATA.meta.date;
    const top = DATA.items
      .filter((it) => itemDateKey(it) === todayKey)
      .sort((a, b) =>
        (b.networkHeat || 0) - (a.networkHeat || 0)
        || (b.sourceCount || 1) - (a.sourceCount || 1)
        || (b.score || 0) - (a.score || 0)
      )
      .slice(0, 5);
    $("#top5").innerHTML = top.map((it, i) => `
      <a class="row" href="${esc(it.link)}" target="_blank" rel="noopener">
        <span class="rank">${i + 1}</span>
        <span class="t-title" title="${esc(it.orig_title || '')}">${hl(it.title, state.kw)}</span>
        <span class="t-time">${it.pubTime}</span>
        <span class="t-right">
          <span class="t-srccnt"><b>${it.networkHeat || it.score || 0}</b> 热度</span>
        </span>
      </a>`).join("");
  }

  /* ---------- 渲染：时间线 feed ---------- */
  async function renderFeed() {
    const list = filtered();
    const body = $("#viewBody");
    if (state.view === "featured") {
      const today = list.filter((it) => itemDateKey(it) === DATA.meta.date);
      const top = `<section class="block hot-block"><div class="block-head"><div><span class="block-eyebrow">TODAY'S SIGNAL</span><h2>今日热点</h2></div><span class="hint">网络热度 × 多源报道 × 信源权威度</span></div><div class="top5" id="top5"></div></section>`;
      const curated = today
        .filter((it) => it.featured === true)
        .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.networkHeat || 0) - (a.networkHeat || 0));
      const curatedSection = `<section class="block curated-block"><div class="block-head"><div><span class="block-eyebrow">AI EDITORIAL SELECTION</span><h2>今日 AI 精选</h2></div><span class="hint">只看今天 · ${curated.length}/${today.length} 条入选</span></div></section>`;
      body.innerHTML = top + curatedSection + `<div id="feedTimeline"></div>`;
      renderTop5();
      $("#feedTimeline").innerHTML = renderTimeline(curated);
    } else if (state.view === "all") {
      const pricePanel = (state.cat === "价格" && DATA.prices) ? renderPricePanel() : '';
      body.innerHTML = pricePanel + `<div id="feedTimeline">${renderTimeline(list)}</div>`;
    } else if (state.view === "daily") {
      renderDaily();
    } else if (state.view === "fav") {
      const items = favItems().filter(filtered);
      if (!items.length) {
        body.innerHTML = `<div class="empty">♡ 暂无收藏<br/><small style="color:var(--ink-3)">在条目上点 ♥ 即可加入收藏，刷新后仍在</small></div>`;
      } else {
        body.innerHTML = `<div id="feedTimeline">${renderTimeline(items)}</div>`;
      }
    } else {
      await renderInfoView(state.view);
    }
  }

  function renderTimeline(list) {
    if (!list.length) return `<div class="empty">没有匹配的光伏动态 🌿</div>`;
    const groups = {};
    list.forEach(it => (groups[fmtDay(it.pubDate).key] = groups[fmtDay(it.pubDate).key] || []).push(it));
    const keys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const isMobile = window.innerWidth <= 640;
    return keys.map(k => {
      const [y, m, d] = k.split("-");
      const wd = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][new Date(k + "T00:00:00").getDay()];
      const items = groups[k].sort((a, b) => {
        if (state.view === 'featured') return (b.score || b.heat || 0) - (a.score || a.heat || 0);
        return b.pubDate.localeCompare(a.pubDate);
      });
      // 移动端：日头用 "今天 / 昨天 / X 天前" 简化格式
      let dateLabel;
      if (isMobile) {
        const today = new Date(); today.setHours(0,0,0,0);
        const target = new Date(k + "T00:00:00");
        const diffDays = Math.round((today - target) / 86400000);
        if (diffDays === 0) dateLabel = "今天";
        else if (diffDays === 1) dateLabel = "昨天";
        else if (diffDays > 1 && diffDays < 7) dateLabel = `${diffDays} 天前`;
        else dateLabel = fmtDateCN(k);
      } else {
        dateLabel = fmtDateCN(k);
      }
      const merged = isMerged(k);
      const toggleCls = merged ? "dh-toggle merged" : "dh-toggle";
      const toggleTitle = merged ? "当前：合并 · 点击分开" : "当前：分开 · 点击合并当天新闻";
      return `
        <div class="day-head" data-day="${k}">
          <span class="dh-date">${dateLabel} <button class="${toggleCls}" data-toggle="${k}" title="${toggleTitle}" aria-label="合并/分开切换">▾</button> <span class="dh-wd">${wd}</span></span>
          <span class="dh-sep">·</span>
          <span class="dh-meta">${items.length} 条</span>
          <div class="day-picker"></div>
        </div>
        <div class="timeline">${merged ? renderMergeCard(k, items) : items.map(renderItem).join("")}</div>`;
    }).join("");
  }

  /* ---------- 渲染：合并卡（当日所有新闻合一张大卡，按时间倒序列表） ---------- */
  function renderMergeCard(dayKey, items) {
    const rows = items.map(it => {
      const userObj = it.user || { name: '媒体', handle: it.source || 'media', color: '#3a7bd5' };
      const srcName = esc(userObj.name);
      const pubTime = it.pubTime || (it.pubDate || '').slice(11, 16) || '--:--';
      const favOn = isFav(it.id);
      const tags = (it.tags || []).slice(0, 3).map(t => `<span># ${hl(t, state.kw)}</span>`).join(" ");
      return `
        <a class="tl-merge-row" href="${esc(it.link)}" target="_blank" rel="noopener">
          <span class="tm-time">${esc(pubTime)}</span>
          <span class="tm-body">
            <span class="tm-title">${hl(it.title, state.kw)}</span>
            <span class="tm-meta">
              <span class="tm-src">${srcName}</span>
              ${tags ? `<span class="tm-tags">${tags}</span>` : ''}
              <button class="tl-fav ${favOn ? "on" : ""}" data-fav="${esc(it.id)}" title="收藏" aria-label="收藏">${favOn ? "★" : "☆"}</button>
            </span>
          </span>
        </a>`;
    }).join("");
    return `
      <article class="tl-card merge">
        <div class="tl-merge-head">
          <span class="tm-h">${items.length} 条新闻</span>
          <span class="tm-cnt">合并视图</span>
          <span class="tm-mode">点击 ▾ 分开</span>
        </div>
        <div class="tl-merge-list">${rows}</div>
      </article>`;
  }

  /* ---------- 渲染：日报（aihot 风格 · 左日期选择器 + 右摘要/章节，含日报/周报/月报三档） ---------- */
  function renderDaily() {
    const body = $("#viewBody");
    const tab = state.dailyTab || "day";

    /* === 通用：按 pubDate 把全部数据聚成三个维度 === */
    const allByDay = {}, allByWeek = {}, allByMonth = {};
    DATA.items.forEach(it => {
      const dKey = (it.pubDate || "").slice(0, 10);
      if (!dKey) return;
      (allByDay[dKey] = allByDay[dKey] || { count: 0, topItem: null, byCat: {}, items: [] });
      allByDay[dKey].count++; allByDay[dKey].items.push(it);
      if (!allByDay[dKey].topItem || (it.heat || 0) > (allByDay[dKey].topItem.heat || 0)) allByDay[dKey].topItem = it;
      (allByDay[dKey].byCat[it.category] = allByDay[dKey].byCat[it.category] || []).push(it);

      const wKey = getISOWeekKey(dKey);
      (allByWeek[wKey] = allByWeek[wKey] || { count: 0, topItem: null, byCat: {}, items: [], days: new Set() });
      const w = allByWeek[wKey];
      w.count++; w.items.push(it); w.days.add(dKey);
      if (!w.topItem || (it.heat || 0) > (w.topItem.heat || 0)) w.topItem = it;
      (w.byCat[it.category] = w.byCat[it.category] || []).push(it);

      const mKey = dKey.slice(0, 7);
      (allByMonth[mKey] = allByMonth[mKey] || { count: 0, topItem: null, byCat: {}, items: [], days: new Set() });
      const m = allByMonth[mKey];
      m.count++; m.items.push(it); m.days.add(dKey);
      if (!m.topItem || (it.heat || 0) > (m.topItem.heat || 0)) m.topItem = it;
      (m.byCat[it.category] = m.byCat[it.category] || []).push(it);
    });
    Object.values(allByWeek).forEach(w => w.days = w.days.size);
    Object.values(allByMonth).forEach(m => m.days = m.days.size);

    const dayKeys = Object.keys(allByDay).sort((a, b) => b.localeCompare(a));
    if (!dayKeys.length) {
      body.innerHTML = `<div class="empty">暂无日报数据</div>`;
      return;
    }
    const weekKeys = Object.keys(allByWeek).sort((a, b) => b.localeCompare(a));
    const monthKeys = Object.keys(allByMonth).sort((a, b) => b.localeCompare(a));

    /* === 三档共用：Tabs === */
    const tabsHtml = `
      <div class="dp-tabs">
        <button class="${tab === 'day' ? 'active' : ''}" data-tab="day">日报</button>
        <button class="${tab === 'week' ? 'active' : ''}" data-tab="week">周报</button>
        <button class="${tab === 'month' ? 'active' : ''}" data-tab="month">月报</button>
      </div>`;

    /* === 分支 1: 日报 === */
    if (tab === "day") {
      if (!state.dailyDate || !allByDay[state.dailyDate]) state.dailyDate = dayKeys[0];
      const cur = state.dailyDate, curDay = allByDay[cur];
      const catStats = Object.entries(curDay.byCat)
        .map(([cat, items]) => ({ cat, count: items.length, top: items.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0))[0] }))
        .sort((a, b) => b.count - a.count || b.top.heat - a.top.heat)
        .slice(0, 5);
      const sections = Object.entries(curDay.byCat)
        .map(([cat, items]) => ({ cat, items: items.slice().sort((a, b) => b.pubDate.localeCompare(a.pubDate)) }))
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 5);
      body.innerHTML = `
        <div class="daily-wrap">
          <aside class="daily-picker">
            ${tabsHtml}
            <div class="dp-month"><span>${cur.slice(0, 4)} 年 ${+cur.slice(5, 7)} 月</span><span class="dp-cnt">${dayKeys.length}</span></div>
            <div class="dp-list">
              ${dayKeys.map(k => {
                const d = allByDay[k], [, m, dd] = k.split("-");
                const title = d.topItem ? d.topItem.title : "";
                return `<button class="dp-day ${k === cur ? 'active' : ''}" data-day="${k}">
                  <span class="dp-num">${+dd} 日</span>
                  <span class="dp-text">${hl(title, state.kw)}</span>
                </button>`;
              }).join("")}
            </div>
          </aside>
          <div class="daily-content">
            <header class="daily-head">
              <div class="dh-vol">VOL.${cur.replace(/-/g, ".")} · ${curDay.count} STORIES · PV HOT DAILY</div>
              <h1 class="dh-title">光伏 HOT 日报</h1>
              <div class="dh-sub">${fmtDateCNFormal(cur)}<b>·</b>${["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][new Date(cur + "T00:00:00").getDay()]}<b>·</b>DAILY<b>·</b>每早八时</div>
            </header>
            <section class="daily-highlights">
              <div class="dh-head"><b>今日看点</b><span class="dh-meta">${curDay.count} 篇报道 · 约 ${estReadMin(curDay.count)} 分钟</span></div>
              ${catStats.map((s, i) => `
                <div class="dh-row">
                  <span class="dh-n">0${i + 1}</span>
                  <div>
                    <a class="dh-cat" href="#" data-cat="${esc(s.cat)}">${esc(s.cat)}</a>
                    <div class="dh-sub">${hl(s.top.title, state.kw)}</div>
                  </div>
                  <span class="dh-cnt">${s.count}</span>
                </div>`).join("")}
            </section>
            ${sections.map((s, i) => `
              <section class="daily-section">
                <header class="ds-head">
                  <span class="ds-n">0${i + 1}</span>
                  <span class="ds-cat">${esc(s.cat)}</span>
                  <span class="ds-en">PV ${esc(s.cat)}</span>
                  <span class="ds-cnt">${s.items.length} 篇</span>
                </header>
                <div class="ds-list">
                  ${s.items.map(it => `
                    <a class="ds-item" href="${esc(it.link)}">
                      <span class="ds-time">${it.pubTime || fmtHHMM(it.pubDate)}</span>
                      <span class="ds-title">${hl(it.title, state.kw)}</span>
                      <span class="ds-heat">+${(it.heat || 50) - 25}</span>
                    </a>`).join("")}
                </div>
              </section>`).join("")}
          </div>
        </div>`;
    }
    /* === 分支 2: 周报 === */
    else if (tab === "week") {
      if (!state.dailyWeek || !allByWeek[state.dailyWeek]) state.dailyWeek = weekKeys[0];
      const cur = state.dailyWeek, curW = allByWeek[cur];
      const { start, end } = getISOWeekRange(cur);
      const rangeStr = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())} ~ ${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
      const wkNo = +cur.split("-W")[1];
      const thread = composeThread(curW.items, "本周");
      const stats = composeStats(curW.items);
      const catStats = Object.entries(curW.byCat)
        .map(([cat, items]) => ({ cat, count: items.length, top: items.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0))[0] }))
        .sort((a, b) => b.count - a.count || b.top.heat - a.top.heat)
        .slice(0, 5);
      const sections = Object.entries(curW.byCat)
        .map(([cat, items]) => ({ cat, items: items.slice().sort((a, b) => b.pubDate.localeCompare(a.pubDate)) }))
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 5);
      body.innerHTML = `
        <div class="daily-wrap">
          <aside class="daily-picker">
            ${tabsHtml}
            <div class="dp-month"><span>${cur.split("-W")[0]} 年</span><span class="dp-cnt">${weekKeys.length}</span></div>
            <div class="dp-list">
              ${weekKeys.map(k => {
                const d = allByWeek[k], wk = +k.split("-W")[1];
                const title = d.topItem ? d.topItem.title : "";
                return `<button class="dp-day ${k === cur ? 'active' : ''}" data-week="${k}">
                  <span class="dp-num">第 ${wk} 周</span>
                  <span class="dp-text">${hl(title, state.kw)}</span>
                </button>`;
              }).join("")}
            </div>
          </aside>
          <div class="daily-content">
            <header class="daily-head">
              <div class="dh-vol">VOL.${cur} · ${curW.count} STORIES · PV HOT WEEKLY</div>
              <h1 class="dh-title">光伏 HOT 周报</h1>
              <div class="dh-sub">${rangeStr}<b>·</b>WEEKLY<b>·</b>编辑系统自动整合</div>
            </header>

            <div class="wp-line"></div>

            <section class="wp-mainline">
              <div class="wp-eyebrow">本周主线 · THE THREAD</div>
              <h2 class="wp-mt">${esc(thread.title)}</h2>
              <p class="wp-mb">${esc(thread.body)}</p>
            </section>

            <div class="wp-line"></div>

            <div class="wp-stats">
              <div class="stat"><div class="stat-n">${stats.events}</div><div class="stat-l">独立事件</div></div>
              <div class="stat"><div class="stat-n">${stats.curated}</div><div class="stat-l">条精选</div></div>
              <div class="stat"><div class="stat-n">${stats.days}</div><div class="stat-l">顺日接续</div></div>
              <div class="stat"><div class="stat-n">≈${stats.readMin} min</div><div class="stat-l">读完本页</div></div>
            </div>

            <section class="daily-highlights" style="margin-top:32px">
              <div class="dh-head"><b>本周看点</b><span class="dh-meta">${curW.count} 篇报道 · 约 ${estReadMin(curW.count)} 分钟</span></div>
              ${catStats.map((s, i) => `
                <div class="dh-row">
                  <span class="dh-n">0${i + 1}</span>
                  <div>
                    <a class="dh-cat" href="#" data-cat="${esc(s.cat)}">${esc(s.cat)}</a>
                    <div class="dh-sub">${hl(s.top.title, state.kw)}</div>
                  </div>
                  <span class="dh-cnt">${s.count}</span>
                </div>`).join("")}
            </section>

            ${sections.map((s, i) => `
              <section class="daily-section">
                <header class="ds-head">
                  <span class="ds-n">0${i + 1}</span>
                  <span class="ds-cat">${esc(s.cat)}</span>
                  <span class="ds-en">PV ${esc(s.cat)}</span>
                  <span class="ds-cnt">${s.items.length} 篇</span>
                </header>
                <div class="ds-list">
                  ${s.items.map(it => `
                    <a class="ds-item" href="${esc(it.link)}">
                      <span class="ds-time">${it.pubTime || fmtHHMM(it.pubDate)}</span>
                      <span class="ds-title">${hl(it.title, state.kw)}</span>
                      <span class="ds-heat">+${(it.heat || 50) - 25}</span>
                    </a>`).join("")}
                </div>
              </section>`).join("")}
          </div>
        </div>`;
    }
    /* === 分支 3: 月报 === */
    else {
      if (!state.dailyMonth || !allByMonth[state.dailyMonth]) state.dailyMonth = monthKeys[0];
      const cur = state.dailyMonth, curM = allByMonth[cur];
      const [yy, mm] = cur.split("-");
      const thread = composeThread(curM.items, "本月");
      const stats = composeStats(curM.items);
      const catStats = Object.entries(curM.byCat)
        .map(([cat, items]) => ({ cat, count: items.length, top: items.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0))[0] }))
        .sort((a, b) => b.count - a.count || b.top.heat - a.top.heat)
        .slice(0, 5);
      const sections = Object.entries(curM.byCat)
        .map(([cat, items]) => ({ cat, items: items.slice().sort((a, b) => b.pubDate.localeCompare(a.pubDate)) }))
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 5);
      body.innerHTML = `
        <div class="daily-wrap">
          <aside class="daily-picker">
            ${tabsHtml}
            <div class="dp-month"><span>${yy} 年</span><span class="dp-cnt">${monthKeys.length}</span></div>
            <div class="dp-list">
              ${monthKeys.map(k => {
                const d = allByMonth[k], m = +k.split("-")[1];
                const title = d.topItem ? d.topItem.title : "";
                return `<button class="dp-day ${k === cur ? 'active' : ''}" data-month="${k}">
                  <span class="dp-num">${m} 月</span>
                  <span class="dp-text">${hl(title, state.kw)}</span>
                </button>`;
              }).join("")}
            </div>
          </aside>
          <div class="daily-content">
            <header class="daily-head">
              <div class="dh-vol">VOL.${cur} · ${curM.count} STORIES · PV HOT MONTHLY</div>
              <h1 class="dh-title">光伏 HOT 月报</h1>
              <div class="dh-sub">${yy} 年 ${+mm} 月<b>·</b>MONTHLY<b>·</b>编辑系统自动整合</div>
            </header>

            <div class="wp-line"></div>

            <section class="wp-mainline">
              <div class="wp-eyebrow">本月主线 · THE THREAD</div>
              <h2 class="wp-mt">${esc(thread.title)}</h2>
              <p class="wp-mb">${esc(thread.body)}</p>
            </section>

            <div class="wp-line"></div>

            <div class="wp-stats">
              <div class="stat"><div class="stat-n">${stats.events}</div><div class="stat-l">独立事件</div></div>
              <div class="stat"><div class="stat-n">${stats.curated}</div><div class="stat-l">条精选</div></div>
              <div class="stat"><div class="stat-n">${stats.days}</div><div class="stat-l">${tab === "month" ? "日接续" : "顺日接续"}</div></div>
              <div class="stat"><div class="stat-n">≈${stats.readMin} min</div><div class="stat-l">读完本页</div></div>
            </div>

            <section class="daily-highlights" style="margin-top:32px">
              <div class="dh-head"><b>本月看点</b><span class="dh-meta">${curM.count} 篇报道 · 约 ${estReadMin(curM.count)} 分钟</span></div>
              ${catStats.map((s, i) => `
                <div class="dh-row">
                  <span class="dh-n">0${i + 1}</span>
                  <div>
                    <a class="dh-cat" href="#" data-cat="${esc(s.cat)}">${esc(s.cat)}</a>
                    <div class="dh-sub">${hl(s.top.title, state.kw)}</div>
                  </div>
                  <span class="dh-cnt">${s.count}</span>
                </div>`).join("")}
            </section>

            ${sections.map((s, i) => `
              <section class="daily-section">
                <header class="ds-head">
                  <span class="ds-n">0${i + 1}</span>
                  <span class="ds-cat">${esc(s.cat)}</span>
                  <span class="ds-en">PV ${esc(s.cat)}</span>
                  <span class="ds-cnt">${s.items.length} 篇</span>
                </header>
                <div class="ds-list">
                  ${s.items.map(it => `
                    <a class="ds-item" href="${esc(it.link)}">
                      <span class="ds-time">${it.pubTime || fmtHHMM(it.pubDate)}</span>
                      <span class="ds-title">${hl(it.title, state.kw)}</span>
                      <span class="ds-heat">+${(it.heat || 50) - 25}</span>
                    </a>`).join("")}
                </div>
              </section>`).join("")}
          </div>
        </div>`;
    }

    /* === 交互：tab 切换 + 日期/周/月选择 === */
    $$(".dp-tabs button", body).forEach(btn => {
      btn.addEventListener("click", () => {
        state.dailyTab = btn.dataset.tab;
        renderDaily();
      });
    });
    $$(".dp-day", body).forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.day)   state.dailyDate = btn.dataset.day;
        if (btn.dataset.week)  state.dailyWeek = btn.dataset.week;
        if (btn.dataset.month) state.dailyMonth = btn.dataset.month;
        renderDaily();
      });
    });
    $$(".dh-cat", body).forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const c = a.dataset.cat;
        /* 跳到「全部」并按分类筛选（侧栏已无「主题」入口） */
        state.view = "all"; state.cat = c; state.kw = ""; state.tag = null;
        $$(".sb-item").forEach(b => b.classList.toggle("active", b.dataset.view === "all"));
        renderHero(); renderCatnav(); renderFeed();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  /* 正文级短总结：后端优先提取原文，前端只做完整句安全截断。 */
  function bodyHTML(it) {
    let raw = (it.summary || '').replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '');
    let sum = raw.replace(/\s+/g, ' ').trim();
    if (!sum || sum.length < 8) return '';
    if (sum.length > 320) {
      const sub = sum.slice(0, 320);
      const end = Math.max(sub.lastIndexOf('。'), sub.lastIndexOf('！'), sub.lastIndexOf('？'));
      sum = end >= 100 ? sub.slice(0, end + 1) : sub.replace(/[…，,；;、\s]+$/, '') + '。';
    }
    const norm = s => s.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '');
    const t = norm(it.title || '');
    const m = norm(sum.replace(/…$/, ''));
    if (t && m && (t.startsWith(m.slice(0, 20)) || m.startsWith(t.slice(0, 20)))) return '';
    return `<p class="tl-body">${hl(sum, state.kw)}</p>`;
  }

  function mediaHTML(it) {
    const image = String(it.image || '').trim();
    if (!/^https?:\/\//i.test(image)) return '';
    return `<a class="tl-media" href="${esc(it.link)}" target="_blank" rel="noopener" aria-label="查看原文图片">
      <img src="${esc(image)}" alt="${esc(it.title || '新闻配图')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"
        onerror="this.closest('.tl-media').remove()" />
      <span>原文配图</span>
    </a>`;
  }
  /* v18.10：推荐理由段（淡色独立段，"推荐理由"前缀，与 aihot 风格一致） */
  function reasonHTML(it) {
    const r = (it.reason || '').replace(/\s+/g, ' ').trim();
    if (!r || r.length < 8) return '';
    return `<div class="tl-reason"><b>推荐理由</b>${hl(r, state.kw)}</div>`;
  }

  function renderItem(it) {
    const userObj = it.user || { name: '媒体', handle: it.source || 'media', color: '#3a7bd5' };
    const srcName = esc(userObj.name);
    const srcType = esc(userObj.handle || '');
    const avatarName = userObj.name || '媒体';
    const avatarChar = /^[a-z]/i.test(avatarName) ? avatarName.slice(0, 1).toUpperCase() : avatarName.slice(0, 1);
    const avatarBg = esc(userObj.color || '#3a7bd5');
    /* v3.5：头像 — 有真实头像用 img，否则用文字圆 */
    const avatarHTML = userObj.avatar
      ? `<img class="tl-avatar-img" src="${esc(userObj.avatar)}" alt="${srcName}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()" /><span class="tl-avatar" style="background:${avatarBg}">${esc(avatarChar)}</span>`
      : `<span class="tl-avatar" style="background:${avatarBg}">${esc(avatarChar)}</span>`;
    /* v3.5：来源标记标签 */
    const srcLabel = it.srcLabel || '资讯';
    const srcColor = it.srcColor || '#3a7bd5';
    /* v3b：精选徽标 = AI 推荐分 >= 60 */
    const score = it.score || it.heat || 50;
    const featured = (it.featured === true) ? true
      : (it.featured === false) ? false
      : (score >= 60);
    const featHTML = (featured && state.view === "featured") ? `<span class="tl-featured">精选</span>` : '';
    const xSignalHTML = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/i.test(it.xPostUrl || '')
      ? `<a class="tl-x-signal" href="${esc(it.xPostUrl)}" target="_blank" rel="noopener" title="查看发现这篇文章的 X 原帖">X 线索</a>`
      : '';
    const numStr = String(Math.max(1, score));
    const pubTime = it.pubTime || (it.pubDate || '').slice(11, 16) || '--:--';
    const relatedHTML = (it.related && it.related.length)
      ? `<div class="tl-related"><b>同事件还有精选：</b>${it.related.map(r => `<a href="${esc(r.link)}">《${hl(r.title, state.kw)}》</a>`).join(" ")}</div>`
      : "";
    return `
      <div class="tl-item">
        <div class="tl-time" title="${esc(it.pubDate || '')}">${esc(pubTime)}</div>
        <article class="tl-card">
          <header class="tl-head">
            <div class="tl-head-l">
              ${avatarHTML}
              <span class="tl-srcname">${srcName}</span>
              ${srcType ? `<span class="tl-srctype">${srcType}</span>` : ''}
              <span class="tl-src-badge" style="background:${srcColor};color:#fff">${esc(srcLabel)}</span>
              ${xSignalHTML}
              ${featHTML}
            </div>
            <div class="tl-head-r">
              <span class="tl-num" title="AI 推荐分">AI ${numStr}</span>
              <button class="tl-fav ${isFav(it.id) ? "on" : ""}" data-fav="${esc(it.id)}" title="收藏" aria-label="收藏">${isFav(it.id) ? "★" : "☆"}</button>
            </div>
          </header>
          <a class="tl-title" href="${esc(it.link)}" title="${esc(it.orig_title || '')}" target="_blank" rel="noopener">${hl(it.title, state.kw)}</a>
          ${mediaHTML(it)}
          ${bodyHTML(it)}
          <div class="tl-tags">${(it.tags || []).map(t => `<span class="tl-tag" data-tag="${esc(t)}"># ${hl(t, state.kw)}</span>`).join("")}</div>
          ${reasonHTML(it) ? `<div class="tl-divider"></div>${reasonHTML(it)}` : ''}
          ${relatedHTML}
        </article>
      </div>`;
  }

  /* ---------- 信息卡视图（关于 / Agent 接入 / 更新日志 / 反馈） ----------
   * 关于 与 Agent 接入 两页完全照 aihot.virxact.com 的版式复刻。
   * ------------------------------------------------------------------ */

  // aihot 风格的复制按钮
  function copyBtn(dataSel, label = "复制") {
    return `<button class="copy-btn" data-copy="${dataSel}" title="复制到剪贴板">${label}</button>`;
  }
  function bindCopy() {
    document.addEventListener("click", e => {
      const b = e.target.closest(".copy-btn");
      if (!b) return;
      e.preventDefault();
      const sel = b.dataset.copy;
      const node = document.querySelector(sel);
      if (!node) return;
      const text = node.innerText || node.textContent || "";
      const done = (ok) => {
        const old = b.dataset.label || b.textContent;
        b.dataset.label = old;
        b.textContent = ok ? "✓ 已复制" : "复制失败";
        b.classList.add(ok ? "ok" : "err");
        setTimeout(() => { b.textContent = old; b.classList.remove("ok", "err"); }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => done(true)).catch(() => fallback());
      } else { fallback(); }
      function fallback() {
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          done(ok);
        } catch (e) { done(false); }
      }
    });
  }

  /* aihot 风格：信息卡里的"去某视图"链接（data-goview="feedback" 等） */
  function bindGoView() {
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-goview]");
      if (!a) return;
      e.preventDefault();
      const v = a.dataset.goview;
      const target = $$(".sb-item").find(x => x.dataset.view === v);
      if (target) target.click();
    });
  }

  /* ---------- 移动端底部 Tab Bar + 更多抽屉 ---------- */
  function bindAgentConsole(origin) {
    const scope = $("#agtScope");
    const category = $("#agtCategory");
    const limit = $("#agtLimit");
    const keyword = $("#agtKeyword");
    const featured = $("#agtFeatured");
    const generated = $("#agtGenerated");
    const openLink = $("#agtOpenApi");
    const testBtn = $("#agtTestApi");
    const testState = $("#agtTestState");
    const preview = $("#agtPreview");
    const tabs = $$("[data-agent-output]");
    if (!scope || !category || !generated) return;

    let outputType = "prompt";

    const buildUrl = (kind = "rest") => {
      const endpoint = kind === "rss" ? "/api/v1/rss.xml" : "/api/v1/news";
      const url = new URL(endpoint, origin);
      if (scope.value !== "all") url.searchParams.set("date", scope.value);
      if (category.value) url.searchParams.set("category", category.value);
      if (featured.checked) url.searchParams.set("featured", "true");
      if (keyword.value.trim()) url.searchParams.set("q", keyword.value.trim());
      url.searchParams.set("limit", limit.value);
      return url.toString();
    };

    const renderOutput = () => {
      const restUrl = buildUrl("rest");
      const rssUrl = buildUrl("rss");
      const scopeText = scope.options[scope.selectedIndex]?.text || "所选时间";
      const categoryText = category.value || "全产业链";
      const focusText = keyword.value.trim() ? `，重点关注“${keyword.value.trim()}”` : "";
      const featuredText = featured.checked ? "，仅保留 AI 精选事件" : "";
      const prompt = `请使用 PV HOT 查询${scopeText}的${categoryText}光伏情报${focusText}${featuredText}：
${restUrl}

请按重要性整理，合并同一事件的重复报道；每条给出中文标题、简短摘要、时间和原文链接。涉及数字、政策或原话时，提醒我回到原文核验。`;

      if (outputType === "rest") generated.textContent = `curl -fsSL "${restUrl}"`;
      else if (outputType === "rss") generated.textContent = rssUrl;
      else generated.textContent = prompt;
      openLink.href = outputType === "rss" ? rssUrl : restUrl;
      testState.textContent = "参数已更新，等待测试";
      testState.className = "agt-test-state";
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        outputType = tab.dataset.agentOutput;
        tabs.forEach((item) => item.classList.toggle("active", item === tab));
        renderOutput();
      });
    });
    [scope, category, limit, featured].forEach((el) => el.addEventListener("change", renderOutput));
    keyword.addEventListener("input", renderOutput);

    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testState.textContent = "正在请求实时数据…";
      testState.className = "agt-test-state is-loading";
      preview.hidden = true;
      try {
        const response = await fetch(buildUrl("rest"), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items.slice(0, 3) : [];
        testState.textContent = `连接成功 · 返回 ${data.count || 0} 条`;
        testState.className = "agt-test-state is-ok";
        preview.innerHTML = items.length
          ? `<div class="agt-preview-head"><b>实时返回预览</b><span>展示前 ${items.length} 条</span></div>
             ${items.map((item, index) => `<a class="agt-preview-item" href="${esc(item.link || "#")}" target="_blank" rel="noopener">
               <i>${index + 1}</i>
               <span><b>${esc(item.title || "未命名动态")}</b><small>${esc(item.source || "PV HOT")} · ${esc(item.dateKey || "")}</small></span>
               <em>↗</em>
             </a>`).join("")}`
          : `<div class="agt-preview-empty">当前条件没有匹配动态，尝试扩大时间范围或取消“仅 AI 精选”。</div>`;
        preview.hidden = false;
      } catch (error) {
        testState.textContent = `连接失败 · ${error.message || "请稍后再试"}`;
        testState.className = "agt-test-state is-error";
      } finally {
        testBtn.disabled = false;
      }
    });

    fetch(new URL("/api/v1/status", origin), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((status) => {
        const dot = $("#agtLiveDot");
        const title = $("#agtLiveTitle");
        if (dot) dot.classList.add("is-ok");
        if (title) title.textContent = `数据服务正常 · API ${status.apiVersion || "v1"}`;
        const updated = $("#agtLiveUpdated");
        if (updated) {
          const stamp = status.updated ? new Date(status.updated) : null;
          updated.textContent = stamp && !Number.isNaN(stamp.getTime())
            ? `最近更新 ${stamp.toLocaleString("zh-CN", { hour12: false })}`
            : "实时状态已确认";
        }
        const values = {
          agtLiveToday: status.today,
          agtLiveFeatured: status.featuredToday,
          agtLiveSources: status.sources,
          agtLiveTotal: status.items,
        };
        Object.entries(values).forEach(([id, value]) => {
          const node = document.getElementById(id);
          if (node) node.textContent = Number.isFinite(Number(value)) ? String(value) : "—";
        });
        (status.categories || []).forEach((name) => {
          if (!name || Array.from(category.options).some((option) => option.value === name)) return;
          category.add(new Option(name, name));
        });
      })
      .catch(() => {
        const title = $("#agtLiveTitle");
        const updated = $("#agtLiveUpdated");
        if (title) title.textContent = "数据服务暂时不可达";
        if (updated) updated.textContent = "可稍后重试，安装文档仍可使用";
      });

    renderOutput();
  }

  function bindMbTab() {
    const mbTab = $("#mbTab");
    const sheet = $("#mbSheet");
    const mask = $("#mbSheetMask");
    if (!mbTab) return;

    const closeSheet = () => {
      if (sheet) sheet.hidden = true;
      if (mask) mask.hidden = true;
    };
    const openSheet = () => {
      const fc = $("#mbSheetFavCount");
      const n = getFavs().length;
      if (fc) { fc.textContent = n ? String(n) + " 条" : ""; fc.style.display = n ? "" : "none"; }
      if (sheet) sheet.hidden = false;
      if (mask) mask.hidden = false;
    };

    // 给每个底部 tab 项独立绑 click（不依赖 closest / 委托）
    $$(".mb-tab-item").forEach(it => {
      it.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        if (it.id === "mbTabMore") { openSheet(); return; }
        const v = it.dataset.mbview;
        if (!v) return;
        $$(".mb-tab-item").forEach(x => x.classList.remove("active"));
        it.classList.add("active");
        goToView(v);
        closeSheet();
      });
    });

    // 抽屉里的项：直接走 goToView（不依赖 closest 委托）
    $$("[data-mbview]").forEach(a => {
      if (a.closest("#mbTab")) return;
      a.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const v = a.dataset.mbview;
        if (!v) return;
        $$(".mb-tab-item").forEach(x => {
          if (x.id === "mbTabMore") return;
          x.classList.toggle("active", x.dataset.mbview === v);
        });
        goToView(v);
        closeSheet();
      });
    });

    if (mask) mask.addEventListener("click", closeSheet);
  }

  async function renderInfoView(view) {
    const body = $("#viewBody");
    const t = TEXTS || DEFAULT_TEXTS;

    /* ============ 关于页（aihot 版式，可编辑字段由 TEXTS 注入） ============ */
    if (view === "about") {
      const a = t.about || DEFAULT_TEXTS.about;
      const poem = (a.poem || []).map(line => `<p>${line}</p>`).join("");
      body.innerHTML = `
        <div class="abt-page">
          <div class="abt-eyebrow">${esc(a.eyebrow || "")}</div>
          <h1 class="abt-h1">${a.title_html || ""}</h1>
          <p class="abt-sub">${esc(a.sub || "")}</p>

          <div class="abt-popoem">${poem}</div>

          <p class="abt-fine">${a.fineprint_html || ""}</p>

          <div class="abt-divider"></div>

          <div class="abt-qrhead">如果觉得有应用，欢迎加入</div>
          <div class="abt-qrcards abt-qrcards-single" id="abtQrBlock" style="display:none">
            <div class="abt-qrcard">
              <div class="abt-qrlabel"><span class="abt-dot"></span>微信公众号</div>
              <div class="abt-qrframe">
                <img id="abtQrImg" src="" alt="清洁能源蛋黄派 微信公众号" />
              </div>
              <div class="abt-qrfoot">清洁能源蛋黄派</div>
            </div>
          </div>
        </div>`;
      // 动态取后台二维码（HEAD 探针 → 200 则挂载）
      try {
        const r = await fetch('/admin/api/qrcode', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j && j.exists) {
            const img = document.getElementById('abtQrImg');
            const blk = document.getElementById('abtQrBlock');
            if (img && blk){
              img.src = '/uploads/qrcode.png?v=' + (j.mtime || Date.now());
              blk.style.display = '';
            }
          }
        }
      } catch (e) { /* 静默：file:// 或后端不可达时直接不显示 */ }
      return;
    }

    /* ============ Agent 接入（aihot 版式，可编辑字段由 TEXTS 注入） ============ */
    if (view === "agent") {
      const ag = t.agent || DEFAULT_TEXTS.agent;
      const origin = /^https?:/.test(location.origin) ? location.origin : "https://pvhot.bbroot.com";
      const installCmd = `bash <(curl -fsSL ${origin}/pvhot-skill/install.sh) --target claude`;
      const verifyQ = ag.verify_q || "今天光伏行业最重要的 5 件事是什么？";
      const noteBlock = ag.note_html
        ? `<div class="agt-note">${ag.note_html}</div>`
        : "";
      body.innerHTML = `
        <div class="agt-page">
          <div class="abt-eyebrow">${esc(ag.eyebrow || "")}</div>
          <h1 class="abt-h1">${ag.title_html || ""}</h1>
          <p class="abt-sub">${ag.sub_html || ""}</p>

          ${noteBlock}

          <div class="agt-pills">
            <span class="agt-pill">匿名只读</span>
            <span class="agt-pill">无需 API Key</span>
            <span class="agt-pill">API v1.1.0</span>
            <span class="agt-pill">Skill v0.2.0</span>
          </div>

          <div class="agt-cards">
            <div class="agt-card">
              <div class="agt-card-h">Agent Skill</div>
              <div class="agt-card-d">让 Agent 自动理解问题、查询并整理结果</div>
            </div>
            <div class="agt-card">
              <div class="agt-card-h">RSS</div>
              <div class="agt-card-d">给阅读器和低代码工具订阅更新</div>
            </div>
            <div class="agt-card">
              <div class="agt-card-h">REST API</div>
              <div class="agt-card-d">给程序、工作流和自定义 Agent 使用</div>
            </div>
          </div>

          <section class="agt-live" id="agtLive" aria-live="polite">
            <div class="agt-live-copy">
              <span class="agt-live-kicker"><i id="agtLiveDot"></i> 实时连接</span>
              <strong id="agtLiveTitle">正在连接 PV HOT 数据服务…</strong>
              <span id="agtLiveUpdated">读取数据更新时间</span>
            </div>
            <div class="agt-live-metrics">
              <div><b id="agtLiveToday">—</b><span>今日动态</span></div>
              <div><b id="agtLiveFeatured">—</b><span>今日精选</span></div>
              <div><b id="agtLiveSources">—</b><span>覆盖信源</span></div>
              <div><b id="agtLiveTotal">—</b><span>可查询动态</span></div>
            </div>
          </section>

          <section class="agt-block agt-builder">
            <div class="agt-builder-head">
              <div>
                <div class="abt-eyebrow">PLAYGROUND · 无需 API KEY</div>
                <h2 class="agt-h2">生成你的专属接入</h2>
                <p class="agt-desc">选择时间、赛道和数量，立即得到 Agent 提示词、REST 地址或 RSS 订阅，并可现场验证返回结果。</p>
              </div>
              <span class="agt-builder-badge">只读接口</span>
            </div>

            <div class="agt-formgrid">
              <label class="agt-field">
                <span>时间范围</span>
                <select id="agtScope">
                  <option value="today">今天</option>
                  <option value="7d">最近 7 天</option>
                  <option value="all">全部可用数据</option>
                </select>
              </label>
              <label class="agt-field">
                <span>产业赛道</span>
                <select id="agtCategory">
                  <option value="">全部赛道</option>
                  <option value="硅料">硅料</option>
                  <option value="硅片">硅片</option>
                  <option value="电池片">电池片</option>
                  <option value="组件">组件</option>
                  <option value="逆变器">逆变器</option>
                  <option value="支架BOS">支架 BOS</option>
                  <option value="储能">储能</option>
                  <option value="电站">电站</option>
                  <option value="行情">行情</option>
                </select>
              </label>
              <label class="agt-field">
                <span>返回数量</span>
                <select id="agtLimit">
                  <option value="5">5 条</option>
                  <option value="10" selected>10 条</option>
                  <option value="20">20 条</option>
                  <option value="50">50 条</option>
                </select>
              </label>
              <label class="agt-field agt-field-wide">
                <span>关键词（可选）</span>
                <input id="agtKeyword" type="search" maxlength="60" placeholder="例如：TOPCon、组件价格、美国关税">
              </label>
              <label class="agt-check">
                <input id="agtFeatured" type="checkbox">
                <span><b>仅 AI 精选</b><small>只返回当天高价值事件</small></span>
              </label>
            </div>

            <div class="agt-output-tabs" role="tablist" aria-label="接入格式">
              <button class="active" type="button" data-agent-output="prompt">Agent 提示词</button>
              <button type="button" data-agent-output="rest">REST API</button>
              <button type="button" data-agent-output="rss">RSS 订阅</button>
            </div>
            <div class="agt-codebox agt-generated-box">
              <pre id="agtGenerated"></pre>
              ${copyBtn("#agtGenerated")}
            </div>
            <div class="agt-builder-actions">
              <button class="agt-linkbtn agt-test-btn" id="agtTestApi" type="button">测试当前接口</button>
              <a class="agt-linkbtn" id="agtOpenApi" href="#" target="_blank" rel="noopener">在新窗口打开</a>
              <span class="agt-test-state" id="agtTestState">等待测试</span>
            </div>
            <div class="agt-preview" id="agtPreview" hidden></div>
          </section>

          <div class="agt-block">
            <div class="abt-eyebrow">推荐路径 · AGENT-FIRST</div>
            <h2 class="agt-h2">把这一段发给你的 Agent</h2>
            <p class="agt-desc">
              这段提示会要求 Agent 先审阅来源和写入位置，再安装到当前平台目录；不会默认使用 sudo，也不会把 Codex 的更新写进 Claude 目录。
            </p>
            <div class="agt-codebox">
              <pre id="agtInstall">请先检查并安装 PV HOT Skill：${origin}/pvhot-skill/

要求：
1. 先读取并检查 SKILL.md、README.md，确认只访问 PV HOT 的公开只读接口；
2. 告诉我你准备写入的目录和文件，不要使用 sudo，不要覆盖其它 Skill；
3. 安装到你当前 Agent 官方支持的用户级 skills 目录；
4. 安装完成后告诉我是否需要重启或开启新会话，并给出一个验证问题。</pre>
              ${copyBtn("#agtInstall")}
            </div>
            <div class="agt-linkbtns">
              <a class="agt-linkbtn" href="${origin}/pvhot-skill/SKILL.md" target="_blank" rel="noopener">查看 SKILL.md</a>
              <a class="agt-linkbtn" href="${origin}/pvhot-skill/SKILL.md" download rel="noopener">⬇ 下载 SKILL.md</a>
              <a class="agt-linkbtn" href="${origin}/pvhot-skill/install.sh" target="_blank" rel="noopener">查看安装脚本</a>
              <a class="agt-linkbtn" href="${origin}/pvhot-skill/install.sh" download rel="noopener">⬇ 下载 install.sh</a>
              <a class="agt-linkbtn" href="https://github.com/1919508399/PVHOT" target="_blank" rel="noopener">GitHub 来源</a>
            </div>
          </div>

          <div class="agt-block">
            <div class="agt-blockh">Agent Skill · 自动理解意图</div>
            <h2 class="agt-h2">安装、验证、再开始使用</h2>
            <div class="agt-meta">v0.2.0</div>
            <div class="agt-steps">
              <div class="agt-step">
                <div class="agt-stepno">1</div>
                <div class="agt-stepb">
                  <b>审阅并安装</b>
                  <p>让 Agent 先说明来源、目标目录和写入文件，再执行安装。</p>
                </div>
              </div>
              <div class="agt-step">
                <div class="agt-stepno">2</div>
                <div class="agt-stepb">
                  <b>重启或开启新会话</b>
                  <p>大多数 Agent 只在会话开始时扫描 Skill；当前对话不一定立刻看到新文件。</p>
                </div>
              </div>
              <div class="agt-step">
                <div class="agt-stepno">3</div>
                <div class="agt-stepb">
                  <b>发送验证问题</b>
                  <p>看到明确时间窗、中文摘要和 PV HOT 站内链接，即表示接入成功。</p>
                </div>
              </div>
            </div>

            <div class="agt-blockh" style="margin-top:18px">验证问题</div>
            <div class="agt-codebox">
              <pre id="agtVerify">${verifyQ}</pre>
              ${copyBtn("#agtVerify")}
            </div>
            <div class="agt-success">
              <b>成功标志</b> 回答严格限定“今天”，给出 5 条以内中文摘要和原文链接；当天没有匹配事件时，不使用旧闻填充。
            </div>
          </div>

          <div class="agt-block">
            <div class="agt-blockh">人类手动安装：选择当前平台</div>
            <p class="agt-desc">先打开并审阅 <a href="${origin}/pvhot-skill/install.sh" target="_blank" rel="noopener" class="agt-inline">install.sh</a>。下面每条命令都显式声明目标平台，不再猜目录。</p>

            <div class="agt-platforms">
              <div class="agt-platform">
                <div class="agt-platform-h">Claude Code <code>~/.claude/skills/pvhot</code></div>
                <div class="agt-codebox">
                  <pre id="agtClaude">${installCmd}</pre>
                  ${copyBtn("#agtClaude")}
                </div>
              </div>
              <div class="agt-platform">
                <div class="agt-platform-h">Codex <code>$CODEX_HOME/skills/pvhot（默认 ~/.codex）</code></div>
                <div class="agt-codebox">
                  <pre id="agtCodex">bash &lt;(curl -fsSL ${origin}/pvhot-skill/install.sh) --target codex</pre>
                  ${copyBtn("#agtCodex")}
                </div>
              </div>
              <div class="agt-platform">
                <div class="agt-platform-h">Gemini CLI <code>~/.gemini/skills/pvhot</code></div>
                <div class="agt-codebox">
                  <pre id="agtGemini">bash &lt;(curl -fsSL ${origin}/pvhot-skill/install.sh) --target gemini</pre>
                  ${copyBtn("#agtGemini")}
                </div>
              </div>
              <div class="agt-platform">
                <div class="agt-platform-h">GitHub Copilot <code>~/.copilot/skills/pvhot</code></div>
                <div class="agt-codebox">
                  <pre id="agtCopilot">bash &lt;(curl -fsSL ${origin}/pvhot-skill/install.sh) --target copilot</pre>
                  ${copyBtn("#agtCopilot")}
                </div>
              </div>
              <div class="agt-platform">
                <div class="agt-platform-h">OpenCode <code>~/.config/opencode/skills/pvhot</code></div>
                <div class="agt-codebox">
                  <pre id="agtOpencode">bash &lt;(curl -fsSL ${origin}/pvhot-skill/install.sh) --target opencode</pre>
                  ${copyBtn("#agtOpencode")}
                </div>
              </div>
              <div class="agt-platform">
                <div class="agt-platform-h">通用 Agent Skills <code>~/.agents/skills/pvhot</code></div>
                <div class="agt-codebox">
                  <pre id="agtAgents">bash &lt;(curl -fsSL ${origin}/pvhot-skill/install.sh) --target agents</pre>
                  ${copyBtn("#agtAgents")}
                </div>
              </div>
            </div>
          </div>

          <div class="agt-block">
            <div class="agt-blockh">更新已有 Skill</div>
            <p class="agt-desc">让当前 Agent 覆盖它正在使用的同一目录。不要复制默认命令去猜另一个平台的目录。</p>
            <p class="agt-desc">老版本可能仍沿用浏览器或无头浏览器 UA。看到 <code class="agt-tagcode">blocked / 567</code> 不等于 IP 被封；先更新 Skill，再新开会话验证。</p>
            <div class="agt-codebox">
              <pre id="agtUpdate">请更新当前已安装的 PV HOT Skill：${origin}/pvhot-skill/

先找到当前会话实际加载的 pvhot/SKILL.md 路径，告诉我旧版本和目标路径；确认后覆盖同一目录。不要把更新写到其它 Agent 的目录。
更新后用可识别的非浏览器 User-Agent 发起一次验证请求；如果此前出现 blocked / 567，不要继续沿用 Mozilla、Chrome 或 HeadlessChrome UA。</pre>
              ${copyBtn("#agtUpdate")}
            </div>
          </div>

          <div class="agt-block">
            <div class="agt-blockh">没有触发？按这个顺序排查</div>
            <ol class="agt-ordered">
              <li>确认文件名严格为 <code class="agt-tagcode">SKILL.md</code>，且位于当前 Agent 支持的 skills 目录。</li>
              <li>关闭旧会话并新开一个会话，再问上面的验证问题。</li>
              <li>让 Agent 列出它发现的 skills，确认其中有 <code class="agt-tagcode">pvhot</code>。</li>
              <li>仍失败时，把平台、版本和实际安装路径提交到<a href="#" data-goview="feedback" class="agt-inline">反馈页</a>；不要发送 token 或本地隐私文件。</li>
            </ol>
            <p class="agt-desc">Agent Skills 是开放格式，但不同产品的目录、权限和启用方式不同。上面只承诺这些明确列出的路径；其它工具请以其官方文档为准。</p>
          </div>

          <h2 class="agt-h2 agt-h2-soft">使用边界</h2>
          <p class="agt-desc agt-h2-soft-sub">公开可读，不等于可以忽略来源</p>

          <div class="agt-callouts">
            <div class="agt-callout">
              <b>重要事实回原文核对</b>
              <p>摘要和翻译由 AI 生成。引用数字、政策或原话前，请使用 API 返回的原文 URL 复核。</p>
            </div>
            <div class="agt-callout">
              <b>保留来源和 canonical</b>
              <p>对外发布 API 结果时请保留返回的 attribution/canonical；第三方原文版权归原作者。</p>
            </div>
            <div class="agt-callout">
              <b>按频率合同调用</b>
              <p>正常会话、RSS 阅读器和分钟级轮询均可使用；收到 429 后退避，不要并发抓取。</p>
            </div>
            <div class="agt-callout">
              <b>测试版，不提供 SLA</b>
              <p>兼容性变化和版本更新会写入 changelog；生产关键链路请自行设置缓存、重试和降级。</p>
            </div>
          </div>
        </div>`;
      bindAgentConsole(origin);
      return;
    }

    if (view === "changelog") {
      const cl = (t.changelog || DEFAULT_TEXTS.changelog);
      const dayNames = ["周日","周一","周二","周三","周四","周五","周六"];
      const formatDate = key => {
        const d = new Date(`${key}T12:00:00`);
        if (Number.isNaN(d.getTime())) return { label:key, weekday:"" };
        return {
          label:`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`,
          weekday:dayNames[d.getDay()]
        };
      };
      const sorted = (cl.items || []).slice().sort((a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")) ||
        String(b.time || "").localeCompare(String(a.time || ""))
      );
      const groups = [];
      sorted.forEach(it => {
        const key = it.date || "未标注日期";
        let group = groups.find(g => g.key === key);
        if (!group) { group = { key, items:[] }; groups.push(group); }
        group.items.push(it);
      });
      const days = groups.map(group => {
        const d = formatDate(group.key);
        const entries = group.items.map(it => {
          const raw = String(it.text || "");
          const legacyLead = raw.split(/[；。]/)[0].slice(0, 34);
          const title = it.title || `${it.ver || "更新"}：${legacyLead}`;
          const bullets = Array.isArray(it.bullets) && it.bullets.length
            ? `<ul>${it.bullets.map(line => `<li>${esc(line)}</li>`).join("")}</ul>`
            : "";
          return `<article class="change-entry">
            <div class="change-meta">
              <time>${esc(it.time || "—")}</time>
              <span><i></i>${esc(it.type || "更新")}</span>
            </div>
            <div class="change-content">
              <h3>${esc(title)}${it.ver ? `<small>${esc(it.ver)}</small>` : ""}</h3>
              <p>${esc(raw)}</p>
              ${bullets}
            </div>
          </article>`;
        }).join("");
        return `<section class="change-day">
          <header class="change-date"><h2>${esc(d.label)}</h2><span>${esc(d.weekday)}</span></header>
          <div class="change-entries">${entries}</div>
        </section>`;
      }).join("");
      body.innerHTML = `
        <div class="changelog-page">
          <header class="change-hero">
            <span>CHANGELOG</span>
            <h1>${esc(cl.title || "更新日志")}</h1>
            <p>${esc(cl.sub || "最近发生了什么——新功能、调整、优化，都写在这里。")}</p>
          </header>
          <div class="change-list">${days}</div>
        </div>`;
      return;
    }

    if (view === "feedback") {
      const fb = t.feedback || DEFAULT_TEXTS.feedback;
      body.innerHTML = `
        <div class="abt-page fb-page">
          <div class="abt-eyebrow">${esc(fb.eyebrow || "")}</div>
          <h1 class="abt-h1">${fb.title_html || ""}</h1>
          <p class="abt-sub">${fb.sub_html || ""}</p>

          <form class="fb-form" id="fbForm" autocomplete="off">
            <div class="fb-row">
              <label class="fb-label" for="fbMsg">想说点什么？</label>
              <div class="fb-textwrap">
                <textarea id="fbMsg" name="msg" class="fb-textarea" rows="9" maxlength="2000" placeholder="比如" required></textarea>
                <span class="fb-count"><b id="fbCount">0</b> / 2000</span>
              </div>
            </div>

            <div class="fb-row">
              <label class="fb-label" for="fbEmail">邮箱 <span class="fb-opt">（选填）</span></label>
              <input id="fbEmail" name="email" type="email" class="fb-input" placeholder="留下邮箱，我可以回信联系你" />
            </div>

            <div class="fb-actions">
              <button type="submit" class="fb-submit" id="fbSubmit">发送反馈</button>
              <span class="fb-hint" id="fbHint">提交后会真正发到站长后台，刷新页面再发一条也会保留。</span>
            </div>

            <div class="fb-sent" id="fbSent" hidden>
              <span class="fb-sentic">✓</span>
              <div>
                <b id="fbSentTitle">收到啦</b>
                <p id="fbSentBody">已发送到站长后台，我会在后台看到这条反馈。</p>
              </div>
            </div>
          </form>
        </div>`;
      bindFeedback();
      return;
    }
  }

  /* ---------- 反馈页：字数计数 / 草稿 / 提交 ---------- */
  function bindFeedback() {
    const ta = document.getElementById("fbMsg");
    const ct = document.getElementById("fbCount");
    const form = document.getElementById("fbForm");
    const sent = document.getElementById("fbSent");
    const hint = document.getElementById("fbHint");
    if (!form) return;

    // 草稿恢复
    try {
      const draft = JSON.parse(localStorage.getItem("pvhot-feedback-draft") || "null");
      if (draft && draft.msg) ta.value = draft.msg;
      if (draft && draft.email) document.getElementById("fbEmail").value = draft.email;
    } catch (e) {}

    const update = () => { ct.textContent = (ta.value || "").length; };
    ta.addEventListener("input", update);
    update();

    let t;
    const saveDraft = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          localStorage.setItem("pvhot-feedback-draft", JSON.stringify({
            msg: ta.value, email: document.getElementById("fbEmail").value, t: Date.now(),
          }));
        } catch (e) {}
      }, 200);
    };
    ta.addEventListener("input", saveDraft);
    document.getElementById("fbEmail").addEventListener("input", saveDraft);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = (ta.value || "").trim();
      if (!msg) { ta.focus(); return; }
      const email = (document.getElementById("fbEmail").value || "").trim();
      const submitBtn = document.getElementById("fbSubmit");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "发送中…"; }
      if (hint) hint.textContent = "正在发送…";

      const payload = {
        msg, email,
        page: location.pathname + (location.hash || ""),
        ua: navigator.userAgent.slice(0, 120),
      };
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(r => r.json().then(j => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (!ok) throw new Error(j && j.error || ("HTTP " + (j && j.status || "")));
          sent.hidden = false;
          if (hint) hint.textContent = "已发送到站长后台。";
          ta.value = ""; update();
          document.getElementById("fbEmail").value = "";
          try { localStorage.removeItem("pvhot-feedback-draft"); } catch (e) {}
          setTimeout(() => { sent.hidden = true; }, 5000);
        })
        .catch(err => {
          if (hint) hint.textContent = "发送失败：" + err.message + "（已存为本地草稿，下次再发）";
        })
        .finally(() => {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "发送反馈"; }
        });
    });
  }

  /* ---------- 侧栏点击 → 切换视图 ---------- */
  /* ---------- 切换视图（侧栏 + 底部 tab 共用） ---------- */
  function goToView(view) {
    if (!view) return;
    // 顶部状态
    state.view = view;
    state.cat = "全部"; state.tag = null; state.kw = "";
    const search = $("#search"); if (search) search.value = "";
    // 同步侧栏高亮
    $$(".sb-item").forEach(x => x.classList.toggle("active", x.dataset.view === view));
    // 同步底部 tab 高亮（仅同步有 data-mbview 对应的）
    $$(".mb-tab-item").forEach(x => {
      if (x.id === "mbTabMore") return;
      x.classList.toggle("active", x.dataset.mbview === view);
    });
    // 重新渲染
    renderHero(); renderCatnav(); renderFeed();
    // 移动端：收起侧栏
    if (window.innerWidth <= 900) {
      const sb = $("#sidebar"); if (sb) sb.classList.remove("open");
      const ov = $("#sbOverlay"); if (ov) ov.classList.remove("show");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bindSidebar() {
    $$(".sb-item").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        goToView(a.dataset.view);
      });
    });
    /* 移动端：汉堡 + 遮罩（HTML 可能已移除这些元素，做 null check） */
    const sbToggle = $("#sbToggle");
    if (sbToggle) sbToggle.addEventListener("click", () => {
      const sb = $("#sidebar"); if (sb) sb.classList.add("open");
      const ov = $("#sbOverlay"); if (ov) ov.classList.add("show");
    });
    const sbOverlay = $("#sbOverlay");
    if (sbOverlay) sbOverlay.addEventListener("click", () => {
      const sb = $("#sidebar"); if (sb) sb.classList.remove("open");
      const ov = $("#sbOverlay"); if (ov) ov.classList.remove("show");
    });
  }

  /* ---------- 分类 / 标签 / 搜索 ---------- */
  function bindCatnav() {
    $("#catnav").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      state.cat = b.dataset.cat; state.tag = null;
      renderCatnav(); renderFeed();
    });
  }
  /* ---------- 价格面板 tab 切换 ---------- */
  function bindPriceTabs() {
    document.addEventListener("click", e => {
      const t = e.target.closest(".pp-tab");
      if (!t) return;
      const pane = t.closest(".price-panel");
      if (!pane) return;
      pane.querySelectorAll(".pp-tab").forEach(b => b.classList.remove("active"));
      pane.querySelectorAll(".pp-pane").forEach(p => p.classList.remove("active"));
      t.classList.add("active");
      const target = pane.querySelector(`.pp-pane[data-pane="${t.dataset.pt}"]`);
      if (target) target.classList.add("active");
    });
  }
  function bindFeedTags() {
    document.addEventListener("click", e => {
      const t = e.target.closest(".tl-tag");
      if (!t) return;
      e.preventDefault();
      state.tag = t.dataset.tag;
      state.cat = "全部"; $("#search").value = ""; state.kw = "";
      renderCatnav(); renderFeed();
      window.scrollTo({ top: $(".content-bar").offsetTop - 70, behavior: "smooth" });
    });
  }
  function bindSearch() {
    const run = () => {
      state.kw = $("#search").value.trim();
      renderCatnav(); renderFeed();
    };
    $("#search").addEventListener("input", run);
    $("#search").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
    $("#searchBtn").addEventListener("click", run);
  }

  /* ---------- 收藏按钮（事件委托） ---------- */
  function bindFav() {
    document.addEventListener("click", e => {
      const b = e.target.closest(".tl-fav");
      if (!b) return;
      e.preventDefault();
      const id = b.dataset.fav;
      if (!id) return;
      const nowOn = toggleFav(id);
      // 更新当前按钮视觉（用 ★/☆ 与 renderItem 渲染时保持一致）
      b.classList.toggle("on", nowOn);
      b.textContent = nowOn ? "★" : "☆";
      b.title = nowOn ? "取消收藏" : "收藏";
      // 刷新侧栏收藏计数 + 移动端抽屉计数
      updateFavBadge();
      // 若在收藏页点了取消，立即从列表移除
      if (state.view === "fav" && !nowOn) renderFeed();
    });
  }

  /* ---------- 时间线 合并/分开 切换（v18.4：按天） ---------- */
  function bindMergeToggle() {
    document.addEventListener("click", e => {
      const b = e.target.closest(".dh-toggle");
      if (!b) return;
      e.preventDefault();
      const k = b.dataset.toggle;
      if (!k) return;
      toggleMerge(k);
      // 仅重渲染 feed 区域（不动侧栏/分类），避免整页闪烁
      const list = (state.view === "fav") ? favItems().filter(filtered) : filtered();
      const feed = $("#feedTimeline");
      if (feed) feed.innerHTML = renderTimeline(list);
      else renderFeed();
    });
  }

  /* ---------- 浅色 / 跟随系统 / 深色主题 ---------- */
  function bindDark() {
    const KEY = "pvhot-theme";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let mode = "system";
    try {
      const saved = localStorage.getItem(KEY);
      if (["light","system","dark"].includes(saved)) mode = saved;
      else if (localStorage.getItem("pvhot-dark") === "1") mode = "dark";
    } catch (e) {}

    const apply = next => {
      mode = ["light","system","dark"].includes(next) ? next : "system";
      const dark = mode === "dark" || (mode === "system" && media.matches);
      document.body.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = mode;
      $$(".theme-option").forEach(btn => {
        const active = btn.dataset.theme === mode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.setAttribute("content", dark ? "#0d1517" : "#f8f7f3");
      try {
        localStorage.setItem(KEY, mode);
        localStorage.removeItem("pvhot-dark");
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("pvhot-darkchange", { detail:{ mode, dark } }));
    };

    $$(".theme-option").forEach(btn => btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      apply(btn.dataset.theme);
    }));
    const onSystemChange = () => { if (mode === "system") apply("system"); };
    if (media.addEventListener) media.addEventListener("change", onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
    apply(mode);
  }

  /* ---------- 回到顶部 ---------- */
  function bindToTop() {
    const b = $("#toTop");
    window.addEventListener("scroll", () => {
      b.classList.toggle("show", window.scrollY > 480);
      const n = $(".topbar"); if (n) n.style.boxShadow = window.scrollY > 8 ? "0 6px 18px -12px rgba(28,39,51,.18)" : "none";
    });
    b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function renderAll() { renderHero(); renderCatnav(); renderFeed(); }

  /* ---------- URL hash 同步（#about / #agent 等） ---------- */
  function applyHash() {
    const v = (location.hash || "").replace(/^#/, "");
    if (!v) return;
    const target = $$(".sb-item").find(x => x.dataset.view === v);
    if (target) target.click();
  }

  /* ---------- 启动：照搬 aihot「拉取数据 → 渲染」 ----------
   * 优先 fetch('data.json')（http 路径，数据最新）；
   * 失败时回退到 data_fallback.js 内嵌数据（file:// 双击也能直接看）。
   */
  /* 预处理：自动识别语言，英文译文(title_cn)替换进 title，并标记 translated */
  function preprocessData(data) {
    (data.items || []).forEach(it => {
      if (it.title_short) {
        /* v18.7 数据：卡片显示短标题，tooltip 挂完整中文标题；summary 已由后端算好（真实描述/增量段），不再覆盖 */
        it.orig_title = it.title_cn || it.title;
        it.title = it.title_short;
      } else {
        if (it.title_cn) { it.orig_title = it.title; it.title = it.title_cn; }
        if (it.summary_cn) { it.orig_summary = it.summary; it.summary = it.summary_cn; }
      }
      it.translated = !!(it.title_cn);
      it.lang = it.lang || (it.title_cn ? 'en' : 'zh');
    });
  }
  const useData = (json, fromFallback) => {
    DATA = json;
    preprocessData(DATA);
    ensureDerived(DATA.items);
    renderMeta();
    renderAll();
    bindSidebar();
    bindCatnav();
    bindFeedTags();
    bindSearch();
    bindPriceTabs();
    bindDark();
    bindFav();
    bindMergeToggle();
    bindToTop();
    bindCopy();
    bindGoView();
    bindMbTab();
    updateFavBadge();
    applyHash();
    window.addEventListener("hashchange", applyHash);
    loadTexts();
    if (fromFallback) {
      // 注意：不再追加“当前使用内嵌数据”底部提示条
      // 偶尔的网络抖动不应让用户误以为网站坏了；fallback 数据本身就是近期缓存
      console.warn("[PV-HOT] 已回退到内嵌数据（fetch 失败）");
    }
  };

  const upgradeToFullData = (json) => {
    DATA = json;
    preprocessData(DATA);
    ensureDerived(DATA.items);
    document.documentElement.dataset.fullData = "ready";
    renderMeta();
    renderHero();
    // 精选首屏已经包含完整当天数据，不重复重绘，避免用户阅读时页面跳动。
    // 其它数据型视图若已被打开，则就地补齐近 7 天数据。
    if (["all", "daily", "fav"].includes(state.view)) {
      renderCatnav();
      renderFeed();
    }
  };

  function loadFallbackData() {
    if (window.__PV_FALLBACK_DATA) return Promise.resolve(window.__PV_FALLBACK_DATA);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data_fallback.js";
      script.onload = () => window.__PV_FALLBACK_DATA ? resolve(window.__PV_FALLBACK_DATA) : reject(new Error("兜底数据无效"));
      script.onerror = () => reject(new Error("兜底数据加载失败"));
      document.head.appendChild(script);
    });
  }

  const DATA_CACHE_TAG = "20260727-v55";
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const slowConnection = Boolean(
    connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || ""))
  );
  const preferBootstrap = window.matchMedia("(max-width: 900px)").matches || slowConnection;
  const bootstrapUrl = `data_bootstrap.json?v=${DATA_CACHE_TAG}`;

  const fetchJson = (url, priority = "auto") => fetch(url, {
    cache: "default",
    credentials: "same-origin",
    priority,
  }).then(r => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });

  const liveData = location.protocol === "file:"
    ? Promise.reject(new Error("file 协议使用兜底数据"))
    : (preferBootstrap
      ? fetchJson(bootstrapUrl, "high")
          .then(json => ({ json, bootstrap: true }))
          .catch(() => fetchJson("data.json", "high").then(json => ({ json, bootstrap: false })))
      : fetchJson("data.json", "high").then(json => ({ json, bootstrap: false })));

  liveData
    .then(({ json, bootstrap }) => {
      useData(json, false);
      if (!bootstrap) {
        document.documentElement.dataset.fullData = "ready";
        return;
      }
      // 首屏完成后在后台拉取完整近 7 天数据，切换“全部/日报”时无需再次等待。
      setTimeout(() => {
        fetchJson("data.json", "low")
          .then(upgradeToFullData)
          .catch(err => console.warn("[PV-HOT] 完整数据后台加载失败：", err.message));
      }, 0);
    })
    .catch(err => loadFallbackData()
      .then(json => {
        console.warn("[PV-HOT] 实时数据不可用，已加载兜底数据：", err.message);
        useData(json, true);
      })
      .catch(fallbackErr => {
        $("#viewBody").innerHTML = `<div class="empty">数据加载失败：${esc(fallbackErr.message)}<br/>请稍后刷新重试。</div>`;
      }));

  /* ---------- 加载可编辑 texts（关于/Agent/反馈/更新日志） ---------- */
  function loadTexts() {
    const apply = (t) => {
      TEXTS = t || DEFAULT_TEXTS;
      // 当前如果停在某个 info 视图，重渲一次让最新内容生效
      if (state.view === "about" || state.view === "agent" || state.view === "feedback" || state.view === "changelog") {
        renderInfoView(state.view);
      }
    };
    if (window.__PV_FALLBACK_TEXTS) { apply(window.__PV_FALLBACK_TEXTS); return; }
    fetch(`site_texts.json?v=${DATA_CACHE_TAG}`, { cache:"default" })
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(t => apply(t))
      .catch(() => apply(DEFAULT_TEXTS));
  }

  /* ---------- 访问统计上报（PV/UV） ---------- */
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: location.pathname + location.search,
        ref: document.referrer || "",
      }),
      credentials: "omit",
    }).catch(() => {});
  } catch (e) {}
})();
