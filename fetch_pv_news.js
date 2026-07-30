#!/usr/bin/env node
'use strict';
// 光伏 HOT 自动抓取 v3.0：多信源聚合
// 信源类型：Google News RSS + 直接RSS + HTML抓取 + RSSHub(社交媒体)
// 自动识别语言：中文源直接采用；英文源经 Google 翻译 gtx 接口译为中文（MyMemory 兜底 + 缓存）
// 零依赖（仅 node 内置 http/https / fs / path / crypto）
//
// v3.0 新增（2026-07-23）：
//   1) 直接 RSS：PV Magazine / PV-Tech / CleanTechnica（已验证可用）
//   2) HTML 抓取：索比光伏网 / 北极星太阳能光伏网（中文原生态，无需翻译）
//   3) RSSHub：微博搜索 / 微信公众号搜索（需服务器部署 RSSHub，端口 1200）
//   4) 跨源去重（link 去重）
//   5) MAX_ITEMS 提到 150

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJsonSync, atomicWriteUtf8Sync } = require('./lib/safe_io');
const { withProcessLock, withProcessLockSync } = require('./lib/process_lock');
const {
  REGISTRY_VERSION,
  TOPIC_QUERIES,
  CURATED_SEARCH_QUERIES,
  RSS_FEEDS,
  SCRAPE_SOURCES,
  RSSHUB_ROUTES: REGISTERED_RSSHUB_ROUTES,
  WECHAT_ACCOUNTS,
  TRUSTED_SOURCE_TOKENS,
} = require('./source_registry');

const ROOT = process.env.PVHOT_ROOT || '/var/www/pvhot';
const OUT = path.join(ROOT, 'data_raw.json');
const LOG = path.join(ROOT, 'fetch.log');
const CACHE_FILE = path.join(ROOT, 'translate_cache.json');
const ARTICLE_CACHE_FILE = path.join(ROOT, 'article_cache.json');
const SOURCE_HEALTH_FILE = path.join(ROOT, 'source_health.json');
const RSSHUB_BASE = 'http://127.0.0.1:1200';
const NEWS_LOCK_OPTIONS = {
  root: ROOT,
  name: 'pvhot-news-fetch',
  timeoutMs: Number(process.env.PVHOT_NEWS_LOCK_TIMEOUT_MS || 30_000),
  staleMs: Number(process.env.PVHOT_NEWS_LOCK_STALE_MS || 45 * 60_000),
};
const DATA_LOCK_OPTIONS = {
  root: ROOT,
  name: 'pvhot-data-write',
  timeoutMs: Number(process.env.PVHOT_DATA_LOCK_TIMEOUT_MS || 60_000),
  staleMs: Number(process.env.PVHOT_DATA_LOCK_STALE_MS || 15 * 60_000),
};

// 分类 -> 关键词（中英文，命中即归此类）
// 顺序敏感：优先匹配「政策」「价格」等跨产业链维度，再匹配具体环节。
const CATS = [
  { cat: '政策',   keys: ['policy', 'policies', 'subsidy', 'subsidies', 'tariff', 'tariffs', 'trade war', 'anti-dumping', 'anti-circumvention', 'forced labor', 'uflpa', 'ad/cvd', 'inflation reduction act', 'ira', 'feed-in tariff', 'fit', 'renewable energy target', 'carbon border', 'cbam', 'renewable portfolio standard', 'rps', 'net metering', '气候法案', '能源法案', '清洁能源法案', '通胀削减法案', '政策', '补贴', '关税', '反倾销', '反规避', '强制劳动', '法案', '标准', '法规', '监管', '制裁', '豁免', '配额', '双反', '上网电价', '可再生能源目标', '碳边境', '净计量', '绿证', '碳中和', '减排目标'] },
  { cat: '价格',   keys: ['price', 'prices', 'pricing', 'spot price', 'price trend', 'cost', 'polysilicon price', 'wafer price', 'cell price', 'module price', 'inverter price', 'storage price', 'lithium price', 'price index', 'price war', '价格', '价格趋势', '价格走势', '现货价格', '硅料价格', '硅片价格', '电池片价格', '组件价格', '逆变器价格', '储能价格', '锂价', '价格指数', '降价', '涨价', '报价', '单价', '触底', '反弹'] },
  { cat: '硅料',   keys: ['polysilicon', 'poly silicon', 'multicrystalline', '多晶硅', '硅料', '硅烷'] },
  { cat: '硅片',   keys: ['wafer', 'ingot', '硅片', '硅锭', '铸锭', '单晶'] },
  { cat: '电池片', keys: ['solar cell', 'perovskite', 'hjt', 'topcon', 'bc cell', '钙钛矿', '电池片', '电池', '异质结'] },
  { cat: '组件',   keys: ['solar module', 'solar panel', 'pv module', '组件', '光伏组件', '太阳能板'] },
  { cat: '逆变器', keys: ['solar inverter', 'pv inverter', 'inverter', '逆变器', '逆变', '组串'] },
  { cat: '支架BOS', keys: ['solar tracker', 'solar mount', 'bos', '支架', '跟踪支架'] },
  { cat: '储能',   keys: ['battery storage', 'solar storage', 'solar battery', 'bess', '储能', '电池储能', '光储'] },
  { cat: '电站',   keys: ['solar plant', 'solar project', 'solar farm', 'epc', '电站', '光伏项目', '光伏电站', '渔光互补', '分布式光伏'] },
  { cat: '行情',   keys: ['solar capacity', 'solar stock', '股价', '产能', '招标', '行情', '装机', '度电成本', '装机量', '出货量', '市场份额'] },
];

// 所有信源统一由 source_registry.js 管理。
const QUERIES = [...TOPIC_QUERIES, ...CURATED_SEARCH_QUERIES];
// freewechat 经常失效，默认关闭；开启时只使用注册表中有 profileId 的明确账号。
const RSSHUB_ROUTES = process.env.PVHOT_ENABLE_FREEWECHAT === '1' ? REGISTERED_RSSHUB_ROUTES : [];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_AGE_DAYS = Math.max(1, Math.min(30, Number(process.env.PVHOT_MAX_AGE_DAYS || 7)));
const MAX_ITEMS = Math.max(10, Math.min(500, Number(process.env.PVHOT_MAX_ITEMS || 280)));
const ENRICH_LIMIT = Math.max(0, Math.min(120, Number(process.env.PVHOT_ENRICH_LIMIT || 84)));
const GOOGLE_DECODE_LIMIT = Math.max(0, Math.min(80, Number(process.env.PVHOT_GOOGLE_DECODE_LIMIT || 48)));

// 信源质量控制：保留光伏/储能强相关内容，拦截财经软文与泛能源噪声。
const RELEVANCE_RE = /光伏|太阳能|多晶硅|硅料|硅片|电池片|光伏组件|逆变器|跟踪支架|屋顶发电|分布式|钙钛矿|异质结|\b(?:solar|photovoltaic|polysilicon|pv module|solar cell|solar panel|solar inverter|solar tracker|perovskite|topcon|hjt)\b/i;
const STORAGE_RE = /储能|光储|电化学储能|锂电池|钠离子电池|液流电池|虚拟电厂|\b(?:bess|battery storage|energy storage)\b/i;
const PRIMARY_PV_RE = /光伏|太阳能|多晶硅|硅料|硅片|电池片|光伏组件|逆变器|跟踪支架|钙钛矿|异质结|\b(?:solar|photovoltaic|polysilicon|pv module|solar cell|solar panel|solar inverter|solar tracker|perovskite|topcon|hjt)\b/i;
const HARD_NOISE_RE = /A股|个股|牛股|涨停|选股|炒股|算力|存储芯片|先进封装|半导体|GPU|英伟达|风电|风力发电|波浪能|煤炭|原油|石油|核电|绿色甲醇|白银|银价|美联储|\b(?:stock picks?|semiconductor|chipmaker|gpu|nvidia|wind farm|wind turbine|wave energy|crude oil|nuclear power|silver|fed|hawkish|federal reserve)\b/i;
const LOW_QUALITY_SOURCE_RE = /marketbeat|yahoo[!\s-]*finance|motley fool|seeking alpha|tradingview|barchart|marketscreener|simplywall|stock titan|gurufocus|streetinsider|moomoo|quartr|24\/7 wall|finance\.biggo|富途牛牛|investing\.com|tipranks|scanx\.trade|stockhouse|morningstar|hdfc sky|kavout|dalal street|trade brains|东方财富|新浪财经|openpr|pr newswire/i;
const GENERIC_SOCIAL_SOURCE_RE = /微博搜索|微信搜索光伏/i;
const TRUSTED_SOURCE_RE = /pv[\s-]?(?:tech|magazine)|solarbe|bjx|北极星|ne21|reuters|clean ?technica|solar power world|taiyangnews|mercom|energy-storage\.news|ess news|公众号/i;
function isTrustedSource(source) {
  const normalized = cleanText(source || '').toLowerCase();
  return TRUSTED_SOURCE_RE.test(normalized)
    || TRUSTED_SOURCE_TOKENS.some((token) => normalized.includes(token.toLowerCase()));
}

function isRelevantItem(it) {
  const title = cleanText((it && (it.title_cn || it.title)) || '');
  const body = title + ' ' + cleanText((it && (it.summary_cn || it.summary)) || '');
  const source = cleanText((it && it.source) || '');
  if (LOW_QUALITY_SOURCE_RE.test(source)) return false;
  if (!RELEVANCE_RE.test(body) && !STORAGE_RE.test(body)) return false;
  // 通用社交搜索最容易夹带热股/泛能源内容，标题必须直接命中行业词。
  if (GENERIC_SOCIAL_SOURCE_RE.test(source) && !RELEVANCE_RE.test(title) && !STORAGE_RE.test(title)) return false;
  // 泛能源/财经标题仅允许专业行业媒体保留，普通聚合源直接剔除。
  if (HARD_NOISE_RE.test(title) && (!PRIMARY_PV_RE.test(title) || !isTrustedSource(source))) return false;
  return true;
}

function sourceCap(source) {
  if (isTrustedSource(source)) return 18;
  if (/the cool down/i.test(source || '')) return 5;
  return 3;
}

function balanceSources(items) {
  const counts = new Map();
  const capped = items.filter((it) => {
    const source = cleanText(it.source || 'google-news').toLowerCase();
    const day = (toBJ(it.pubDate) || {}).dateKey || 'unknown';
    const capKey = `${day}|${source}`;
    const count = counts.get(capKey) || 0;
    if (count >= sourceCap(source)) return false;
    counts.set(capKey, count + 1);
    return true;
  });

  // 分日配额：当天优先，但最近 7 天每天都保留足够样本，避免小时刷新把历史日期挤出资料库。
  const dateKeys = recentBeijingDateKeys(MAX_AGE_DAYS);
  const target = Math.min(capped.length, MAX_ITEMS + 60);
  const groups = new Map(dateKeys.map((key) => [key, []]));
  capped.forEach((it) => {
    const key = (toBJ(it.pubDate) || {}).dateKey;
    if (groups.has(key)) groups.get(key).push(it);
  });
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const trustDiff = Number(isTrustedSource(b.source)) - Number(isTrustedSource(a.source));
      if (trustDiff) return trustDiff;
      return (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0);
    });
  }

  const selected = [];
  const selectedLinks = new Set();
  const todayQuota = Math.min(90, Math.max(40, Math.ceil(target * 0.32)));
  const historyQuota = Math.max(18, Math.floor((target - todayQuota) / Math.max(1, dateKeys.length - 1)));
  dateKeys.forEach((key, index) => {
    const quota = index === 0 ? todayQuota : historyQuota;
    for (const it of groups.get(key).slice(0, quota)) {
      const id = cleanText(it.link || it.title);
      if (!selectedLinks.has(id)) {
        selectedLinks.add(id);
        selected.push(it);
      }
    }
  });

  // 某天信源不足时，用其余最近新闻补足总量。
  if (selected.length < target) {
    for (const it of capped) {
      const id = cleanText(it.link || it.title);
      if (selectedLinks.has(id)) continue;
      selectedLinks.add(id);
      selected.push(it);
      if (selected.length >= target) break;
    }
  }

  return selected.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
}

function selectAcrossDays(items, limit) {
  const dateKeys = recentBeijingDateKeys(MAX_AGE_DAYS);
  const groups = new Map(dateKeys.map((key) => [key, []]));
  items.forEach((it) => {
    const key = (toBJ(it._pubDate || it.pubDate) || {}).dateKey;
    if (groups.has(key)) groups.get(key).push(it);
  });
  for (const arr of groups.values()) {
    arr.sort((a, b) => (new Date(b._pubDate || b.pubDate).getTime() || 0) - (new Date(a._pubDate || a.pubDate).getTime() || 0));
  }
  const selected = [];
  const seen = new Set();
  const todayQuota = Math.min(72, Math.max(36, Math.ceil(limit * .28)));
  const historyQuota = Math.max(12, Math.floor((limit - todayQuota) / Math.max(1, dateKeys.length - 1)));
  dateKeys.forEach((key, index) => {
    const quota = index === 0 ? todayQuota : historyQuota;
    for (const it of groups.get(key).slice(0, quota)) {
      const id = cleanText(it.link || it.title);
      if (!seen.has(id)) {
        seen.add(id);
        selected.push(it);
      }
    }
  });
  if (selected.length < limit) {
    for (const it of items) {
      const id = cleanText(it.link || it.title);
      if (seen.has(id)) continue;
      seen.add(id);
      selected.push(it);
      if (selected.length >= limit) break;
    }
  }
  return selected
    .slice(0, limit)
    .sort((a, b) => (new Date(b._pubDate || b.pubDate).getTime() || 0) - (new Date(a._pubDate || a.pubDate).getTime() || 0));
}

function classify(text) {
  const t = (text || '').toLowerCase();
  // 排除：Silicon Valley / 硅谷 / 半导体芯片等非光伏 silicon 误命中
  const EXCLUDE = ['silicon valley', 'silicon photonics', 'silicon quantum', 'silicon-carbon battery',
    'silicon anode', 'silicon metal', 'silicon wafer (semiconductor)', 'chip', 'semiconductor',
    'gpu', 'nvidia', 'ai model', '硅谷'];
  for (const ex of EXCLUDE) {
    if (t.includes(ex)) return '行情'; // 非光伏 silicon → 归行情（通用）
  }
  for (const c of CATS) {
    for (const k of c.keys) {
      if (t.indexOf(k.toLowerCase()) !== -1) return c.cat;
    }
  }
  return '行情';
}

function pickUser(cat) {
  const map = {
    '政策':   { name: '政策观察', handle: 'policy_watch',  color: '#8a4a8e' },
    '价格':   { name: '价格追踪', handle: 'price_tracker', color: '#c2570f' },
    '硅料':   { name: '硅业分会', handle: 'silicon_assoc', color: '#1d6f8b' },
    '硅片':   { name: '硅基研究', handle: 'silicom_lab',   color: '#3a7bd5' },
    '电池片': { name: 'PV-Sense', handle: 'pv_sense',     color: '#a23b3b' },
    '组件':   { name: '北辰能源', handle: 'polaris_neo',  color: '#c2570f' },
    '逆变器': { name: '逆变观察', handle: 'inv_watch',     color: '#2f9e6b' },
    '支架BOS': { name: '支架前线', handle: 'track_front',  color: '#7a5cc0' },
    '储能':   { name: '度电思考', handle: 'kwh_thinker', color: '#8a4a8e' },
    '电站':   { name: '光子前线', handle: 'photon_front', color: '#b3402a' },
    '行情':   { name: '绿能周报', handle: 'green_weekly', color: '#0e6e7c' },
  };
  return map[cat] || map['行情'];
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function beijingDateKey(date = new Date()) {
  const bj = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
}

function beijingWeekday(date = new Date()) {
  const bj = new Date(date.getTime() + 8 * 3600 * 1000);
  return ['周日','周一','周二','周三','周四','周五','周六'][bj.getUTCDay()];
}

function recentBeijingDateKeys(days = MAX_AGE_DAYS) {
  const keys = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    keys.push(beijingDateKey(new Date(now.getTime() - i * 86400000)));
  }
  return keys;
}

// 把 RFC822 pubDate 转北京时间（明确无 Z，前端按本地时区解析即北京）
function toBJ(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const bj = new Date(d.getTime() + 8 * 3600 * 1000); // UTC+8
  const y = bj.getUTCFullYear();
  const m = pad(bj.getUTCMonth() + 1);
  const day = pad(bj.getUTCDate());
  const hh = pad(bj.getUTCHours());
  const mm = pad(bj.getUTCMinutes());
  return {
    dateKey: `${y}-${m}-${day}`,                       // 北京日期，前端分组用
    iso: `${y}-${m}-${day}T${hh}:${mm}:00`,            // 北京时间 ISO（无 Z）
    pubTime: `${hh}:${mm}`,
  };
}

function unescapeXml(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extract(re, xml) {
  const m = xml.match(re);
  return m ? unescapeXml((m[1] || m[2] || '').trim()) : '';
}

/* ---------- Google News RSS 专用解析（含尾源清理、跟踪链接清理）---------- */
function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    let title = extract(/<title>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/title>/, block);
    const link = extract(/<link>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/link>/, block);
    const pubDate = extract(/<pubDate>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/pubDate>/, block);
    const source = extract(/<source[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/source>/, block);
    let desc = extract(/<description>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/description>/, block);

    if (!link || !title) continue;
    title = title.replace(/\s*-\s*[^-\n]{1,60}\s*$/, '').trim();
    if (!title) continue;

    let summary = stripHtml(desc);
    summary = summary.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const dm = summary.match(/^[^-–—]{1,40}\s*[-–—]\s*([\s\S]+)$/);
    if (dm) summary = dm[1];
    summary = summary.trim().slice(0, 220);
    if (summary.length < 25) summary = '';
    if (summary && title) {
      const tNorm = title.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, ' ').trim();
      const sNorm = summary.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, ' ').trim();
      if (sNorm && (sNorm.startsWith(tNorm.slice(0, 30)) || tNorm.startsWith(sNorm.slice(0, 30)))) {
        summary = '';
      }
    }

    items.push({ title, link, pubDate, source, summary });
  }
  return items;
}

/* ---------- 通用 RSS 解析（直接 RSS + RSSHub，不做 Google News 专用清理）---------- */
function parseGenericRSS(xml, sourceName) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    let title = extract(/<title>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/title>/, block);
    const link = extract(/<link>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/link>/, block);
    // pubDate 或 dc:date（RSSHub 常用 Dublin Core）
    const pubDate = extract(/<pubDate>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/pubDate>/, block) ||
                    extract(/<dc:date>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/dc:date>/, block);
    let desc = extract(/<description>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/description>/, block);

    if (!link || !title) continue;
    title = title.trim();
    if (!title) continue;

    let summary = stripHtml(desc);
    summary = summary.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
    if (summary.length < 15) summary = '';

    items.push({ title, link, pubDate, source: sourceName, summary });
  }
  // 同时兼容 Atom，方便机构和研究站点接入。
  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const title = stripHtml(extract(/<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/title>/i, block));
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    const link = linkMatch ? unescapeXml(linkMatch[1]) : '';
    const pubDate = extract(/<(?:published|updated)>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/(?:published|updated)>/i, block);
    const rawSummary = extract(/<(?:summary|content)[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/(?:summary|content)>/i, block);
    const summary = stripHtml(rawSummary).slice(0, 500);
    if (title && link) items.push({ title, link, pubDate, source: sourceName, summary });
  }
  return items;
}

/* ---------- 去 HTML 标签 + 解码实体 ---------- */
function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- 自动识别语言 ---------- */
function detectLang(s) {
  const txt = s || '';
  const cjk = (txt.match(/[一-鿿㐀-䶿]/g) || []).length;
  const letters = (txt.match(/[A-Za-z]/g) || []).length;
  return cjk >= letters ? 'zh' : 'en';
}

/* ---------- 翻译缓存（按原文，跨次运行复用，省配额） ---------- */
let CACHE = loadCache();
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveCache() {
  try {
    atomicWriteJsonSync(CACHE_FILE, CACHE, {
      validate: (value) => value && typeof value === 'object' && !Array.isArray(value),
    });
  } catch (e) {}
}

/* ---------- 翻译：Google gtx（无限额）+ MyMemory 兜底 ---------- */
function translate(text) {
  return new Promise((resolve) => {
    if (!text) return resolve('');
    const key = 'en|zh-CN::' + text;
    if (CACHE[key]) return resolve(CACHE[key]);
    const q = text.slice(0, 1000);
    const tryMyMemory = () => {
      const murl = 'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(q.slice(0, 480)) + '&langpair=en|zh-CN';
      const req = https.get(murl, { headers: { 'User-Agent': UA } }, (res) => {
        let buf = ''; res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            if (j && j.responseStatus === 200 && j.responseData && j.responseData.translatedText) {
              const t = j.responseData.translatedText;
              if (/MYMEMORY|WARNING|QUOTA/i.test(t)) return resolve('');
              CACHE[key] = t; saveCache(); resolve(t);
            } else resolve('');
          } catch (e) { resolve(''); }
        });
      });
      req.on('error', () => resolve(''));
      req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} resolve(''); });
    };
    const gurl = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' +
      encodeURIComponent(q);
    const req = https.get(gurl, { headers: { 'User-Agent': UA } }, (res) => {
      let buf = ''; res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          const t = (j && j[0] || []).map(x => x[0]).join('');
          if (t && t !== q) { CACHE[key] = t; saveCache(); resolve(t); }
          else tryMyMemory();
        } catch (e) { tryMyMemory(); }
      });
    });
    req.on('error', () => tryMyMemory());
    req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} tryMyMemory(); });
  });
}

function isMojibake(value) {
  const text = String(value || '');
  if (!text) return false;
  const replacements = (text.match(/\uFFFD/g) || []).length;
  if (replacements >= 2 || replacements / text.length > 0.015) return true;
  if (/(?:锟斤拷|烫烫烫|屯屯屯|Ã.|Â.|â€|ï¿½){2,}/.test(text)) return true;
  return false;
}

function decodeResponseBuffer(buffer, headers) {
  if (!buffer || !buffer.length) return '';
  const contentType = String(headers?.['content-type'] || '');
  const headAscii = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('ascii');
  const charsetMatch = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)
    || headAscii.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)
    || headAscii.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i);
  const declared = String(charsetMatch?.[1] || '').toLowerCase();
  const isChineseLegacy = /^(?:gbk|gb2312|gb18030|cp936)$/.test(declared);
  const encoding = isChineseLegacy ? 'gb18030' : (declared || 'utf-8');
  try {
    const decoded = new TextDecoder(encoding).decode(buffer);
    if (!isMojibake(decoded) || isChineseLegacy) return decoded;
  } catch (e) {}
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!isMojibake(utf8)) return utf8;
  try {
    const gb = new TextDecoder('gb18030').decode(buffer);
    return (gb.match(/[\u4e00-\u9fff]/g) || []).length > (utf8.match(/[\u4e00-\u9fff]/g) || []).length
      ? gb
      : utf8;
  } catch (e) {
    return utf8;
  }
}

/* ---------- 通用 URL 抓取（跟随 30x 重定向，按声明字符集解码）---------- */
function fetchURL(url, useHTTP, timeout) {
  const reqTimeout = timeout || 15000;
  function tryGet(u, redirects) {
    return new Promise((resolve) => {
      if (redirects > 5) return resolve('');
      // v3.0.1: 按实际 URL 协议选模块（修复 HTTPS→HTTP 跨协议重定向静默失败）
      const mod = u.startsWith('https://') ? https : http;
      const req = mod.get(u, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/rss+xml,application/xml,text/xml,*/*',
          'Accept-Encoding': 'identity',
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return resolve(tryGet(next, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(''); }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve(decodeResponseBuffer(Buffer.concat(chunks), res.headers)));
      });
      req.on('error', (e) => { console.error('fetchURL error: ' + u.slice(0,60) + ' -> ' + (e.message||e)); resolve(''); });
      req.setTimeout(reqTimeout, () => { req.destroy(); resolve(''); });
    });
  }
  return tryGet(url, 0);
}

/* ---------- 原文 URL、正文摘要与主图提取 ---------- */
let ARTICLE_CACHE = (() => {
  try { return JSON.parse(fs.readFileSync(ARTICLE_CACHE_FILE, 'utf8')); } catch (e) { return {}; }
})();

function saveArticleCache() {
  try {
    atomicWriteJsonSync(ARTICLE_CACHE_FILE, ARTICLE_CACHE, {
      validate: (value) => value && typeof value === 'object' && !Array.isArray(value),
    });
  } catch (e) {}
}

function decodeHtmlText(value) {
  return unescapeXml(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = html.match(pattern);
      if (m) return decodeHtmlText(m[1]);
    }
  }
  return '';
}

function normalizeArticleImage(value, baseUrl) {
  if (!value) return '';
  let url = Array.isArray(value) ? value[0] : value;
  if (url && typeof url === 'object') url = url.url || url.contentUrl || '';
  if (typeof url !== 'string') return '';
  try { url = new URL(decodeHtmlText(url), baseUrl).href; } catch (e) { return ''; }
  if (!/^https?:\/\//i.test(url)) return '';
  if (/logo|avatar|icon|sprite|favicon|qrcode|wechat/i.test(url)) return '';
  return url;
}

function collectJsonLd(html, baseUrl) {
  const result = { body: '', description: '', image: '' };
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].replace(/[\u0000-\u001f]+/g, ' '));
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        const type = String(node['@type'] || '').toLowerCase();
        if (/article|newsarticle|report|blogposting/.test(type)) {
          if (!result.body && node.articleBody) result.body = decodeHtmlText(node.articleBody);
          if (!result.description && node.description) result.description = decodeHtmlText(node.description);
          if (!result.image && node.image) result.image = normalizeArticleImage(node.image, baseUrl);
        }
      }
    } catch (e) {}
  }
  return result;
}

function extractParagraphText(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  const article = (cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || [])[1]
    || (cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1]
    || cleaned;
  const paragraphs = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(article)) !== null) {
    const text = decodeHtmlText(stripHtml(m[1]));
    if (text.length < 28 || text.length > 900) continue;
    if (/cookie|privacy policy|subscribe|newsletter|all rights reserved|责任编辑|免责声明|扫码|点击关注|广告/i.test(text)) continue;
    paragraphs.push(text);
    if (paragraphs.join(' ').length >= 5000) break;
  }
  return paragraphs.join(' ');
}

function completeSentence(text) {
  const out = cleanText(text).replace(/[…,.，、；;:：\-—]+$/, '').trim();
  if (!out) return '';
  return /[。！？!?]$/.test(out) ? out : out + '。';
}

function summarizeArticleText(body, fallback, title, maxChars = 320) {
  const raw = cleanText(body || fallback || '')
    .replace(/data-(?:image|large-file|medium-file|caption)[^>]{0,220}>/gi, ' ')
    .replace(/\]\]\s*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const titleNorm = cleanText(title).toLowerCase();
  const pieces = raw
    .split(/(?<=[。！？!?])\s*|(?<=[.!?])\s+(?=[A-Z0-9\u4e00-\u9fff])/)
    .map(completeSentence)
    .filter((sentence) => sentence.length >= 22 && sentence.length <= 420)
    .filter((sentence) => !/^(?:this|the)\s+(?:image|photo|illustration)|representative image|image source|photo credit|the post .+ appeared first|^post\s+/i.test(sentence))
    .filter((sentence) => {
      const normalized = sentence.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '');
      const normalizedTitle = titleNorm.replace(/[^\w\u4e00-\u9fff]+/g, '');
      return !normalizedTitle || !normalized.startsWith(normalizedTitle.slice(0, 28));
    });
  if (!pieces.length) return completeSentence(raw.slice(0, maxChars));

  const titleTokens = new Set((titleNorm.match(/[a-z]{4,}|[\u4e00-\u9fff]{2,4}/g) || []).slice(0, 20));
  const scored = pieces.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    let score = Math.max(0, 18 - index * 1.5);
    for (const token of titleTokens) if (lower.includes(token)) score += 5;
    if (/\d+(?:\.\d+)?\s*(?:%|％|gw|mw|kwh|亿|万|元|美元)/i.test(sentence)) score += 8;
    if (/政策|价格|产能|装机|并网|中标|签约|投产|量产|效率|突破|关税|补贴|收购|合作|预计|意味着|影响|将|计划|目标|policy|capacity|price|launch|agreement|target|impact/i.test(sentence)) score += 6;
    return { sentence, index, score };
  });
  const chosen = [];
  // 首句负责交代事件，再补充最高信息密度和影响/后续，形成有首有尾的短总结。
  chosen.push(scored[0]);
  for (const candidate of scored.slice().sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (chosen.some((item) => item.index === candidate.index)) continue;
    const projected = chosen.reduce((n, item) => n + item.sentence.length, 0) + candidate.sentence.length;
    if (projected > maxChars + 70) continue;
    chosen.push(candidate);
    if (chosen.length >= 3) break;
  }
  chosen.sort((a, b) => a.index - b.index);
  let summary = chosen.map((item) => item.sentence).join('');
  if (summary.length > maxChars) {
    const clipped = summary.slice(0, maxChars);
    const end = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('！'), clipped.lastIndexOf('？'));
    summary = end >= 90 ? clipped.slice(0, end + 1) : completeSentence(clipped);
  }
  return summary;
}

function extractArticleDetails(html, url, title, fallbackSummary) {
  if (!html || html.length < 500) return null;
  const jsonLd = collectJsonLd(html, url);
  const description = jsonLd.description || extractMetaContent(html, ['og:description', 'twitter:description', 'description']);
  const body = jsonLd.body || extractParagraphText(html);
  const image = jsonLd.image || normalizeArticleImage(
    extractMetaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']),
    url
  );
  const summaryCandidate = summarizeArticleText(body, description || fallbackSummary, title, detectLang(title) === 'zh' ? 300 : 650);
  const summary = isMojibake(summaryCandidate) ? '' : summaryCandidate;
  if (!summary && !image) return null;
  return { articleUrl: url, summary, image, fetchedAt: new Date().toISOString() };
}

async function decodeGoogleNewsUrl(sourceUrl) {
  if (!/https?:\/\/news\.google\.com\/(?:rss\/)?articles\//i.test(sourceUrl || '') || typeof fetch !== 'function') return '';
  try {
    const parsed = new URL(sourceUrl);
    const base64Str = parsed.pathname.split('/').filter(Boolean).pop();
    if (!base64Str) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const page = await fetch(`https://news.google.com/rss/articles/${base64Str}`, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    clearTimeout(timer);
    if (!page.ok) return '';
    const html = await page.text();
    const signature = (html.match(/data-n-a-sg=["']([^"']+)/i) || [])[1];
    const timestamp = (html.match(/data-n-a-ts=["']([^"']+)/i) || [])[1];
    if (!signature || !timestamp) return '';
    const payload = [
      'Fbv4je',
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`,
    ];
    const postController = new AbortController();
    const postTimer = setTimeout(() => postController.abort(), 10000);
    const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: postController.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
        'Origin': 'https://news.google.com',
        'Referer': 'https://news.google.com/',
      },
      body: `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`,
    });
    clearTimeout(postTimer);
    if (!response.ok) return '';
    const text = await response.text();
    for (const chunk of text.split('\n\n')) {
      const jsonChunk = chunk.trim().replace(/^\d+\s*\n/, '');
      if (!jsonChunk.startsWith('[[')) continue;
      try {
        const parsedChunk = JSON.parse(jsonChunk);
        for (const row of parsedChunk) {
          if ((row[0] === 'wrb.fr' || row[0] === 'w779db') && row[1] === 'Fbv4je') {
            const inner = JSON.parse(row[2]);
            if (inner[1] && /^https?:\/\//.test(inner[1])) return inner[1];
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return '';
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function enrichArticleCandidates(items, log) {
  if (!ENRICH_LIMIT || !items.length) return items;
  const now = Date.now();
  const ranked = items
    .slice()
    .sort((a, b) => {
      const aToday = (toBJ(a.pubDate) || {}).dateKey === beijingDateKey() ? 1 : 0;
      const bToday = (toBJ(b.pubDate) || {}).dateKey === beijingDateKey() ? 1 : 0;
      const aShort = (a.summary || '').length < 120 ? 1 : 0;
      const bShort = (b.summary || '').length < 120 ? 1 : 0;
      return bToday - aToday
        || bShort - aShort
        || Number(isTrustedSource(b.source)) - Number(isTrustedSource(a.source))
        || (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0);
    });
  const direct = ranked.filter((it) => !/news\.google\.com/.test(it.link || ''));
  const google = ranked.filter((it) => /news\.google\.com/.test(it.link || ''));
  const directQuota = Math.min(direct.length, Math.ceil(ENRICH_LIMIT * .40));
  const candidates = [
    ...direct.slice(0, directQuota),
    ...google.slice(0, ENRICH_LIMIT - directQuota),
  ];
  if (candidates.length < ENRICH_LIMIT) {
    const used = new Set(candidates);
    candidates.push(...ranked.filter((it) => !used.has(it)).slice(0, ENRICH_LIMIT - candidates.length));
  }
  let decoded = 0;
  let detailed = 0;
  await mapLimit(candidates, 4, async (it) => {
    const key = crypto.createHash('sha1').update(it.link || it.title).digest('hex');
    let cached = ARTICLE_CACHE[key];
    if (cached && isMojibake(cached.summary)) {
      delete ARTICLE_CACHE[key];
      cached = null;
    }
    if (cached && now - new Date(cached.fetchedAt || 0).getTime() < 7 * 86400000) {
      if (cached.summary && cached.summary.length > (it.summary || '').length) it.summary = cached.summary;
      if (cached.image) it.image = cached.image;
      if (cached.articleUrl) {
        it.googleNewsUrl = /news\.google\.com/.test(it.link || '') ? it.link : '';
        it.link = cached.articleUrl;
      }
      detailed++;
      return;
    }
    let articleUrl = it.link;
    if (/news\.google\.com/.test(articleUrl || '')) {
      if (decoded >= GOOGLE_DECODE_LIMIT) return;
      decoded++;
      articleUrl = await decodeGoogleNewsUrl(articleUrl);
      if (!articleUrl) return;
      it.googleNewsUrl = it.link;
      it.link = articleUrl;
    }
    const html = await fetchURL(articleUrl, false, 9000);
    const details = extractArticleDetails(html, articleUrl, it.title, it.summary);
    if (!details) {
      ARTICLE_CACHE[key] = {
        articleUrl,
        summary: '',
        image: '',
        fetchedAt: new Date().toISOString(),
      };
      return;
    }
    ARTICLE_CACHE[key] = details;
    if (details.summary && details.summary.length > (it.summary || '').length) it.summary = details.summary;
    if (details.image) it.image = details.image;
    if (articleUrl !== it.link && !it.googleNewsUrl) {
      it.googleNewsUrl = it.link;
      it.link = articleUrl;
    }
    detailed++;
  });
  saveArticleCache();
  log(`article-enrich: candidates=${candidates.length} detailed=${detailed} googleDecoded=${decoded}`);
  return items;
}

/* ---------- Google News RSS 抓取（现有逻辑，保留不动）---------- */
function fetchRSS(query) {
  const baseQuery = typeof query === 'string' ? query : query.q;
  // 显式要求最近 7 天，既补齐历史资料，也避免 Google News 返回多年前的高权重旧稿。
  const q = `(${baseQuery}) when:${MAX_AGE_DAYS}d`;
  const zh = typeof query === 'object' && query.locale === 'zh';
  const locale = zh
    ? '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'
    : '&hl=en-US&gl=US&ceid=US:en-US';
  const url = 'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) + locale;
  function tryGet(u, redirects) {
    return new Promise((resolve) => {
      if (redirects > 5) return resolve([]);
      const req = https.get(u, { headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return resolve(tryGet(next, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return resolve([]); }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(parseItems(buf)));
      });
      req.on('error', () => resolve([]));
      req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    });
  }
  return tryGet(url, 0);
}

/* ---------- 直接 RSS 抓取（PV Magazine / PV-Tech / CleanTechnica）---------- */
async function fetchDirectRSS(url) {
  const xml = await fetchURL(url, false);
  if (!xml) return [];
  return parseGenericRSS(xml, '');
}

/* ---------- RSSHub 抓取（微博 / 微信公众号，localhost:1200）---------- */
async function fetchRSSHub(route) {
  // 失效的 freewechat 路由很常见；单源最多等 25 秒，避免拖慢整轮小时级刷新。
  const xml = await fetchURL(RSSHUB_BASE + route, true, 25000);
  if (!xml) return [];
  return parseGenericRSS(xml, '');
}

/* ---------- 分批并发控制（避免同时打爆 RSSHub）---------- */
async function batchFetch(routes, batchSize, fetchFn) {
  const results = [];
  for (let i = 0; i < routes.length; i += batchSize) {
    const batch = routes.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(r => fetchFn(r)));
    results.push(...batchResults);
    if (i + batchSize < routes.length) {
      // 批次间等 1 秒，让 RSSHub 喘口气
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
}

/* ---------- HTML 抓取（国内 PV 新闻站，提取 <a> 标签中的新闻链接）---------- */
async function fetchScrape(config) {
  const html = await fetchURL(config.url, false);
  if (!html) return [];
  const items = [];
  const seen = new Set();
  // 匹配所有 <a href="...">text</a> 标签
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    let href = m[1].trim();
    const rawText = m[2];
    // 解析 /、../ 等相对 URL。
    if (!/^https?:\/\//i.test(href)) {
      try { href = new URL(href, config.url).href; } catch (e) { continue; }
    }
    // 检查是否匹配文章 URL 模式
    if (!config.linkPattern.test(href)) continue;
    // 去重
    if (seen.has(href)) continue;
    seen.add(href);
    // 提取标题（strip HTML，清理空白）
    let title = stripHtml(rawText).trim();
    // 也检查 title 属性（有时 <a> 的文本是缩略，title 属性是完整标题）
    const titleAttr = m[0].match(/title=["']([^"']+)["']/i);
    if (titleAttr && titleAttr[1].trim().length > title.length) title = titleAttr[1].trim();
    // 标题太短跳过
    if (title.length < 8) continue;
    // 从 URL 解析日期
    let dateStr = null;
    if (config.dateFromUrl) {
      dateStr = config.dateFromUrl(href);
    }
    if (!dateStr && config.dateFromContext) dateStr = config.dateFromContext(html, m.index, m[0]);
    if (!dateStr) {
      const snippet = html.slice(Math.max(0, m.index - 220), m.index + m[0].length + 300);
      const ymd = snippet.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      if (ymd) dateStr = `${ymd[1]}-${pad(Number(ymd[2]))}-${pad(Number(ymd[3]))}`;
    }
    // 日期无法验证的首页链接不进入最近 7 天数据，避免把旧文章伪装成今天。
    if (!dateStr) continue;
    const pubDate = dateStr + 'T00:00:00Z';
    items.push({ title, link: href, pubDate, source: config.source, summary: '' });
    if (items.length >= (config.maxItems || 20)) break;
  }
  return items;
}

function cleanText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

/* ---------- 从标题中提取 1-2 个关键话题（用作 tag） ---------- */
/* v3.0.4: 彻底重写——优先匹配 PV 行业词典，n-gram 提取做位置去重避免碎片 */
const STOP_CHARS = new Set('的了在是有和与或也但就都还又再已将被把给向到从对于为以因其所而则且着过吗呢吧啊呀哦哈嗯'.split(''));
const PV_KEYWORDS = [
  '光伏','太阳能','光储','光电','光热','钙钛矿','异质结','HJT','TOPCon','BC电池','钙钛矿叠层',
  '硅料','多晶硅','单晶硅','硅片','电池片','组件','逆变器','支架','跟踪支架','BIPV',
  '储能','电化学储能','液流电池','锂电池','钠离子电池','氢能','绿氢','电解槽',
  '电站','光伏电站','太阳能电站','分布式光伏','集中式光伏','屋顶光伏','漂浮式光伏',
  '装机','并网','消纳','特高压','智能电网','微电网','虚拟电厂',
  '碳达峰','碳中和','碳排放','碳交易','绿证','绿电','CCER',
  '反倾销','关税','贸易壁垒','双反','UFLPA',
  'N型','P型','IGBT','Sic','半导体','晶圆','银浆','铝浆','玻璃','背板','胶膜',
  '产能','出货','招标','EPC','度电成本','LCOE','平价上网','竞价',
  '隆基','晶科','天合','通威','晶澳','阿特斯','阳光电源','华为','固德威','锦浪',
  '德业','昱能','禾迈','爱旭','东方日升','中环','协鑫','大全','特变',
  '美国','欧盟','印度','巴西','中东','非洲','东南亚','澳大利亚','日本','韩国',
  '新疆','内蒙古','青海','甘肃','宁夏','山西','河北','江苏','浙江',
  '内卷','供给侧','产能过剩','去库存','价格战','行业洗牌',
];
function isCn(c) { return c >= '\u4e00' && c <= '\u9fff'; }
function extractTopics(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const t = (text.match(/[\u4e00-\u9fff]+/g) || []).join('');
  if (t.length < 4) return [];

  // 1. 优先匹配 PV 行业词典（含中英文）
  const matched = [];
  const usedPos = new Set(); // 标记已匹配的字符位置，避免重叠
  for (const kw of PV_KEYWORDS) {
    if (matched.length >= 2) break;
    const kwLower = kw.toLowerCase();
    // 中文关键词在提取的纯中文串中找
    if (/[\u4e00-\u9fff]/.test(kw)) {
      let idx = t.indexOf(kw);
      while (idx !== -1) {
        const positions = [];
        for (let j = 0; j < kw.length; j++) positions.push(idx + j);
        if (!positions.some(p => usedPos.has(p))) {
          matched.push(kw);
          positions.forEach(p => usedPos.add(p));
          break;
        }
        idx = t.indexOf(kw, idx + 1);
      }
    } else {
      // 英文关键词在原文小写中找
      if (lower.includes(kwLower) && !matched.includes(kw)) {
        matched.push(kw);
      }
    }
  }
  if (matched.length >= 2) return matched;

  // 2. 词典不足 2 个时，用 4-gram 补充（做位置去重，过滤末尾碎片字符）
  const need = 2 - matched.length;
  const FRAG_TAIL = new Set('的了在是有和与或也但就都还又再已将被把给向到从对为以及其所而则且着过即引等把将此因由至为以免设建者所'.split(''));
  const candidates = [];
  for (let i = 0; i <= t.length - 4; i++) {
    if ([0,1,2,3].some(j => usedPos.has(i + j))) continue;
    const g = t.slice(i, i + 4);
    if ([...g].some(c => STOP_CHARS.has(c))) continue;
    if (FRAG_TAIL.has(g[3])) continue; // 末尾是碎片字符则跳过
    candidates.push({ gram: g, pos: i, len: 4 });
  }
  // 按频次排序（同频取更长的），选 need 个且不重叠
  const cnt = {};
  candidates.forEach(c => cnt[c.gram] = (cnt[c.gram] || 0) + 1);
  candidates.sort((a, b) => cnt[b.gram] - cnt[a.gram] || b.len - a.len);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= need) break;
    // 检查与已选 n-gram 是否重叠
    const positions = [...Array(c.len).keys()].map(j => c.pos + j);
    if (positions.some(p => usedPos.has(p))) continue;
    picked.push(c.gram);
    positions.forEach(p => usedPos.add(p));
  }

  return [...matched, ...picked].slice(0, 2);
}

/* ---------- 强力去尾源 ---------- */
function stripTrailingSource(s) {
  if (!s) return s;
  let out = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out.replace(/[\s\-–—·|,，：:]+(?:Reuters|Bloomberg|Nikkei|Xinhua|AFP|AP|UPI|CNN|BBC|NYT|WaPo|WSJ|EUobserver|EuroNews|Engadget|TechCrunch|TheVerge|The\s?Verge)\s*\.?$/i, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z][A-Za-z]*\s?)+(?:News|Times|Asia|Report|Weekly|Daily|Journal|Post|Tribune|Herald|Standard|Gazette|Magazine|Blog)\s*\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:by|BY|By)\s+[A-Za-z0-9_\-\u4e00-\u9fff\s]{2,40}\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z]{2,}(?:\s+[A-Z]{2,}){1,3})\s*\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){1,3})\s*\.?$/, '').trim();
    const single = out.replace(/\s+[-–—|]\s*[A-Za-z][A-Za-z0-9.&\-]{1,14}\s*$/, '').trim();
    if (single !== out && single.length >= 8) out = single;
    out = out.replace(/[\s]*[\(（][^\(\)（）]{1,30}[\)）]\s*\.?$/, '').trim();
    if (out === before) break;
  }
  return out.replace(/[\s\-–—·|,，：:.]+$/, '').trim();
}

/* ---------- 卡片短总结：正文级、完整句、约 120-300 字 ---------- */
function buildBody(it) {
  const rawSummary = ((it && (it.summary_cn || (it.lang === 'zh' ? it.summary : ''))) || '');
  let real = isMojibake(rawSummary)
    ? ''
    : stripTrailingSource(rawSummary.replace(/\s+/g, ' ').trim());
  const category = (it && (it.cat || it.category)) || '光伏行业';
  const contextClose = `该进展涉及${category}领域，后续仍需关注项目规模、执行时间与官方披露。`;
  // 清理可能残留的 [YYYY-MM-DD] 日期前缀
  real = real.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '');
  if (/^(「.+」方向|英文聚合自动译中|行业最新进展|.+ 方向 .+ 报道)/.test(real)) real = '';
  if (real.length >= 15) {
    if (real.length <= 300) {
      const complete = completeSentence(real);
      return complete.length >= 70 ? complete : (complete + contextClose).slice(0, 300);
    }
    const sub = real.slice(0, 300);
    const ends = [sub.lastIndexOf('。'), sub.lastIndexOf('！'), sub.lastIndexOf('？')];
    const end = Math.max(...ends);
    if (end >= 100) return sub.slice(0, end + 1);
    return completeSentence(sub);
  }
  const full = cleanText((it && (it.title_cn || it.title)) || '')
    .replace(/\s+[-–—]\s+(?:Reuters|Bloomberg|AP|AFP|BBC|CNN|CNBC|Euronews)\s*$/i, '')
    .trim();
  if (!full) return '';
  const m = full.slice(8).search(/[；;：，、—–|·]/);
  if (m !== -1) {
    const rest = full.slice(8 + m + 1).trim();
    if (rest.length >= 45 && rest.length < full.length - 4) return completeSentence(rest.slice(0, 260));
  }
  const source = cleanText((it && (it.author || it.source)) || '原始信源')
    .replace(/[-_]+/g, ' ')
    .slice(0, 32);
  const lead = `据${source || '原始信源'}报道，${full.replace(/[。！？!?]+$/, '')}。`;
  const close = `现有公开信息显示，该进展涉及${category}领域；项目规模、执行时间及后续官方披露仍值得持续关注。`;
  return (lead + close).slice(0, 300);
}

/* ---------- 推荐理由：基于事实(数字/机构/政策关键词)模板化生成 ---------- */
const REASON_CAT_MAP = {
  '政策': '政策与监管', '价格': '价格走势',
  '硅料': '硅料价格与产能', '硅片': '硅片供应格局', '电池片': '电池技术路线',
  '组件': '组件出货与认证', '逆变器': '逆变器产品迭代', '支架BOS': '支架与 BOS',
  '储能': '光储耦合', '电站': '电站 EPC 与招标', '行情': '市场行情与产能',
};
function buildReason(it) {
  const rawSummary = ((it && it.summary_cn) || '');
  const sum = isMojibake(rawSummary) ? '' : rawSummary.replace(/\s+/g, ' ').trim();
  const title = ((it && (it.title_cn || it.title)) || '').replace(/\s+/g, ' ').trim();
  const cat = (it && (it.cat || it.category)) || '行情';
  const text = title + ' ' + sum;
  const catCn = REASON_CAT_MAP[cat] || cat;

  const numM = text.match(/\d+(?:\.\d+)?\s*(?:%|％|GW|MW|kWh|亿|万|元|美元|\/W|美元\/W|元\/W|美元\/kWh|元\/kWh)/);
  const orgM = title.match(/[A-Z][A-Za-z&]{2,18}(?:\s[A-Z][A-Za-z&]{2,18}){0,2}/);
  const firstSent = sum ? (sum.split(/[。！？!?]/)[0] || sum).trim() : '';
  const fact = firstSent.length > 45 ? firstSent.slice(0, 45) + '…' : firstSent;

  if (numM && orgM) {
    if (fact && fact.includes(numM[0])) {
      return `数据信号明确：${fact}。${orgM[0]} 在${catCn}方向的这一量级变化，做产能规划、价格跟踪与对标分析时值得纳入参考。`;
    }
    return `数据信号明确${fact ? '：' + fact : ''}。${orgM[0]} 在${catCn}方向出现 ${numM[0]} 量级变化，做产能规划、价格跟踪与对标分析时值得纳入参考。`;
  }
  if (numM) {
    if (fact && fact.includes(numM[0])) {
      return `数据信号：${fact}。这一量级变化对${catCn}的供需节奏与价格走势有直接参考意义。`;
    }
    return `数据信号${fact ? '：' + fact : ''}。出现 ${numM[0]} 量级变化，对${catCn}的供需节奏与价格走势有直接参考意义。`;
  }
  if (orgM) {
    return `${orgM[0]} 在${catCn}方向的最新动向${fact ? '——' + fact : ''}。同环节企业可作对标，下游采购可关注其产品节奏与定价。`;
  }
  if (/政策|关税|补贴|标准|法规|监管|制裁|豁免|配额/.test(text)) {
    return `政策信号${fact ? '：' + fact : ''}。影响${catCn}的准入门槛与成本结构，建议跟踪后续细则与落地节奏。`;
  }
  if (/发布|推出|上市|量产|投产|并网|签约|中标|收购|合作/.test(text)) {
    return `${fact || '企业动作'}。属于${catCn}方向值得持续跟踪的新进展，建议关注后续产能释放与市场反应。`;
  }
  return `${fact ? fact + '。' : ''}属于${catCn}方向的新进展，建议关注后续企业动作与产业链联动效应。`;
}

// InfoLink 现货价格抓取已独立到 fetch_prices.js（每天 7am cron 单独运行）
// fetch_pv_news.js 只负责新闻抓取，不再抓取价格数据

/* ---------- v3b：多信源聚合 + 推荐分 ---------- */

/* 标题归一化：去标点空格转小写，提取核心词 */
function normalizeTitle(s) {
  return (s || '')
    .replace(/[\s\-_—–|·•·，。！？：；""''()（）\[\]【】{}<>《》.,!?;:'"/\\@#$%^&*+=~`]/g, '')
    .toLowerCase()
    .trim();
}

/* 取标题的 bigram 集合（用于 Jaccard 相似度） */
function titleBigrams(s) {
  const n = normalizeTitle(s);
  if (n.length < 4) return new Set([n]);
  const set = new Set();
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2));
  return set;
}

/* Jaccard 相似度（0-1） */
function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/*
 * 多信源聚合：翻译后，按标题相似度聚类合并。
 * 同一事件被多个信源报道 → 合并为 1 条，sourceCount = N，sources = [...]。
 * 保留最佳 summary 的那条作为主条目，合并 sources 数组，取最新 pubDate。
 */
function aggregateMultiSource(items) {
  if (!items.length) return items;
  const clusters = []; // [{ rep, members: [it, ...] }]
  for (const it of items) {
    const bg = titleBigrams(it.title_cn || it.title || '');
    let matched = null;
    for (const c of clusters) {
      const sim = jaccard(bg, c.bg);
      if (sim >= 0.45) { matched = c; break; }
    }
    if (matched) {
      matched.members.push(it);
      // 取有 summary_cn 最长的作为 rep
      const cur = matched.rep;
      const curLen = (cur.summary_cn || cur.summary || '').length;
      const newLen = (it.summary_cn || it.summary || '').length;
      if (newLen > curLen) {
        matched.rep = it;
        matched.bg = bg; // 用更好标题的 bigrams
      }
      // 取最新 pubDate
      if (new Date(it.pubDate).getTime() > new Date(matched.rep.pubDate).getTime()) {
        matched.repPubDate = it.pubDate;
      }
    } else {
      clusters.push({ rep: it, members: [it], bg, repPubDate: it.pubDate });
    }
  }

  return clusters.map(c => {
    const rep = c.rep;
    const sources = [];
    const seenSrc = new Set();
    for (const m of c.members) {
      const src = (m.source || 'google-news').toLowerCase().replace(/\s+/g, '-').slice(0, 24);
      if (!seenSrc.has(src)) { seenSrc.add(src); sources.push(src); }
    }
    // 如果只有一个成员，直接返回（sourceCount=1）
    if (c.members.length === 1) {
      rep._sourceCount = 1;
      rep._sources = sources;
      rep._pubDate = c.repPubDate;
      return rep;
    }
    // v3.5: collect author/avatar from wechat members
    if (!rep.author || !rep.avatar) {
      for (const m of c.members) {
        if (!rep.author && m.author) rep.author = m.author;
        if (!rep.avatar && m.avatar) rep.avatar = m.avatar;
        if (rep.author && rep.avatar) break;
      }
    }
    // 代表条目可能来自另一家信源；保留同事件中已成功提取的正文主图与最长摘要。
    if (!rep.image) {
      const withImage = c.members.find((m) => m.image);
      if (withImage) rep.image = withImage.image;
    }
    const richest = c.members
      .slice()
      .sort((a, b) => (b.summary_cn || b.summary || '').length - (a.summary_cn || a.summary || '').length)[0];
    if (richest) {
      if (!rep.summary && richest.summary) rep.summary = richest.summary;
      if (!rep.summary_cn && richest.summary_cn) rep.summary_cn = richest.summary_cn;
    }
    // 多成员：在 rep 上附加聚合信息
    rep._sourceCount = sources.length;
    rep._sources = sources;
    rep._pubDate = c.repPubDate;
    rep._allTitles = c.members.map(m => m.title_cn || m.title);
    return rep;
  });
}

function computeScoreDetails(it) {
  const sourceCount = it._sourceCount || it.sourceCount || 1;
  const sourceText = [it.source, ...(it.sources || [])].join(' ');
  const body = it.summary || it.summary_cn || '';
  const title = `${it.title_cn || it.title || ''} ${body}`;
  const dateKey = it.dateKey || (toBJ(it.pubDate) || {}).dateKey || '';
  const isToday = dateKey === beijingDateKey();
  const ageHours = Math.max(0, (Date.now() - new Date(it.pubDate).getTime()) / 3600000);
  const recency = isToday ? Math.max(8, Math.round(20 - ageHours * .7)) : Math.max(0, 8 - Math.floor(ageHours / 24));
  const crossSource = Math.min(24, Math.max(0, sourceCount - 1) * 9);
  const authority = isTrustedSource(sourceText) ? 12 : 4;
  const official = /国家能源局|发改委|工信部|中国光伏行业协会|cpia|iea|irena|nrel|seia|reuters/i.test(sourceText) ? 5 : 0;
  const richness = (body.length >= 110 ? 6 : body.length >= 45 ? 3 : 0) + (it.image ? 4 : 0);
  let importance = 0;
  if (/政策|监管|关税|补贴|标准|法规|反倾销|中标|招标|并网|投产|量产|收购|合作|签约|突破|效率|纪录|price|tariff|policy|acquisition|launch|record/i.test(title)) importance += 6;
  if (/\d+(?:\.\d+)?\s*(?:%|％|GW|MW|kWh|亿|万|元|美元|\/W)/i.test(title)) importance += 6;
  const penalty = GENERIC_SOCIAL_SOURCE_RE.test(sourceText) ? 10 : 0;
  const base = 24;
  const score = Math.max(1, Math.min(100, Math.round(base + recency + crossSource + authority + official + richness + importance - penalty)));
  return {
    score,
    networkHeat: Math.min(100, 35 + crossSource * 2 + (isTrustedSource(sourceText) ? 15 : 0) + Math.min(15, importance)),
    breakdown: { recency, crossSource, authority, official, richness, importance, penalty },
  };
}

function computeScore(it) {
  return computeScoreDetails(it).score;
}

function writeSourceHealth({ gnewsResults, rssResults, scrapeResults, rsshubResults, wechatSnapshot }) {
  const checkedAt = new Date().toISOString();
  const entry = (config, kind, count) => ({
    id: config.id || config.source || config.name || config.q,
    name: config.label || config.name || config.source || config.id,
    kind,
    tier: config.tier || 2,
    status: count > 0 ? 'ok' : 'empty',
    items: count,
    checkedAt,
  });
  const sources = [
    ...QUERIES.map((config, i) => entry(config, 'google-news', (gnewsResults[i] || []).length)),
    ...RSS_FEEDS.map((config, i) => entry(config, 'rss', (rssResults[i] || []).length)),
    ...SCRAPE_SOURCES.map((config, i) => entry(config, 'scrape', (scrapeResults[i] || []).length)),
    ...RSSHUB_ROUTES.map((config, i) => entry(config, 'rsshub-wechat', (rsshubResults[i] || []).length)),
  ];
  const wechatHealth = Array.isArray(wechatSnapshot && wechatSnapshot.health)
    ? wechatSnapshot.health
    : [];
  const ok = sources.filter((s) => s.status === 'ok').length;
  const report = {
    schemaVersion: 1,
    registryVersion: REGISTRY_VERSION,
    checkedAt,
    configured: {
      googleQueries: QUERIES.length,
      rss: RSS_FEEDS.length,
      scrape: SCRAPE_SOURCES.length,
      rsshubWechat: RSSHUB_ROUTES.length,
      wechatAccounts: WECHAT_ACCOUNTS.length,
    },
    summary: {
      checked: sources.length,
      ok,
      empty: sources.length - ok,
      wechatCachedItems: Number(wechatSnapshot && wechatSnapshot.count) || 0,
    },
    sources,
    wechat: {
      fetchedAt: wechatSnapshot && wechatSnapshot.fetchedAt || null,
      monitoredAccounts: Number(wechatSnapshot && wechatSnapshot.monitoredAccounts) || WECHAT_ACCOUNTS.length,
      queriedAccounts: wechatSnapshot && wechatSnapshot.queriedAccounts || [],
      health: wechatHealth,
    },
  };
  try {
    atomicWriteJsonSync(SOURCE_HEALTH_FILE, report, {
      space: 2,
      validate: (value) => value && Array.isArray(value.sources),
    });
  } catch (e) {
    console.error('source health write error:', e.message);
  }
  return report;
}

async function runMain() {
  const log = (msg) => {
    const line = '[' + new Date().toISOString() + '] ' + msg;
    console.log(line); fs.appendFileSync(LOG, line + '\n');
  };
  log('START fetch v3.0 (multi-source), gnews=' + QUERIES.length + ' rss=' + RSS_FEEDS.length +
      ' scrape=' + SCRAPE_SOURCES.length + ' rsshub=' + RSSHUB_ROUTES.length);

  // === 并行抓取（RSSHub 分批，避免打爆本地 RSSHub 服务）===
  const [gnewsResults, rssResults, scrapeResults, rsshubResults] = await Promise.all([
    Promise.all(QUERIES.map(q => fetchRSS(q))),
    Promise.all(RSS_FEEDS.map(s => fetchDirectRSS(s.url))),
    Promise.all(SCRAPE_SOURCES.map(s => fetchScrape(s))),
    batchFetch(RSSHUB_ROUTES, 8, (s) => fetchRSSHub(s.route)),
  ]);

  // === 合并 + 跨源去重（link 去重）===
  const seen = new Set();
  const merged = [];

  // Google News
  let gcount = 0;
  gnewsResults.forEach((arr, idx) => {
    const cat = QUERIES[idx].cat;
    arr.forEach((it) => {
      const key = cleanText(it.link);
      if (seen.has(key)) return;
      seen.add(key);
      // v3.0.1: 始终用 classify 权威分类（源 cat 仅用于查询，不直接赋值，防 Silicon Valley 污染）
      const classified = classify(it.title + ' ' + it.summary);
      const finalCat = (cat !== 'ALL' && classified === '行情') ? cat : classified;
      merged.push({ ...it, cat: finalCat });
      gcount++;
    });
  });

  // 直接 RSS
  let rcount = 0;
  rssResults.forEach((arr, idx) => {
    const src = RSS_FEEDS[idx];
    arr.forEach((it) => {
      const key = cleanText(it.link);
      if (seen.has(key)) return;
      seen.add(key);
      const classified = classify(it.title + ' ' + it.summary);
      const finalCat = (src.cat !== 'ALL' && classified === '行情') ? src.cat : classified;
      merged.push({ ...it, cat: finalCat, source: src.source });
      rcount++;
    });
  });

  // HTML 抓取
  let scount = 0;
  scrapeResults.forEach((arr, idx) => {
    const src = SCRAPE_SOURCES[idx];
    arr.forEach((it) => {
      const key = cleanText(it.link);
      if (seen.has(key)) return;
      seen.add(key);
      const classified = classify(it.title + ' ' + it.summary);
      const finalCat = (src.cat !== 'ALL' && classified === '行情') ? src.cat : classified;
      merged.push({ ...it, cat: finalCat, source: src.source });
      scount++;
    });
  });

  // RSSHub
  // v3.0.3: freewechat 的 pubDate 是缓存日期（常为数月甚至数年前），不可靠。
  // 超过 MAX_AGE_DAYS 的 freewechat 文章直接丢弃，不做日期伪造，确保只出当天/近期新闻。
  let hcount = 0;
  rsshubResults.forEach((arr, idx) => {
    const src = RSSHUB_ROUTES[idx];
    arr.forEach((it) => {
      const key = cleanText(it.link);
      if (seen.has(key)) return;
      // freewechat 文章如果日期超过 MAX_AGE_DAYS，直接跳过（历史缓存文章不要）
      if (it.pubDate) {
        const itemAge = Date.now() - new Date(it.pubDate).getTime();
        if (itemAge > MAX_AGE_DAYS * 86400 * 1000) return;
      }
      seen.add(key);
      const classified = classify(it.title + ' ' + it.summary);
      const finalCat = (src.cat !== 'ALL' && classified === '行情') ? src.cat : classified;
      merged.push({ ...it, cat: finalCat, source: src.name || src.source });
      hcount++;
    });
  });

  // === Puppeteer 抓取的微信文章（fetch_wechat.js 产出）===
  let wcount = 0;
  let wechatSnapshot = null;
  try {
    const wechatPath = path.join(__dirname, 'wechat_items.json');
    if (fs.existsSync(wechatPath)) {
      const wc = JSON.parse(fs.readFileSync(wechatPath, 'utf8'));
      wechatSnapshot = wc;
      if (wc.items && Array.isArray(wc.items)) {
        wc.items.forEach((it) => {
          const key = cleanText(it.link);
          if (seen.has(key)) return;
          if (it.pubDate) {
            const itemAge = Date.now() - new Date(it.pubDate).getTime();
            if (itemAge > MAX_AGE_DAYS * 86400 * 1000) return;
          }
          seen.add(key);
          const classified = classify(it.title + ' ' + (it.summary || ''));
          merged.push({ ...it, cat: classified, source: '公众号', author: (it.sources && it.sources[0] && it.sources[0].name) || it.account || '', avatar: it.avatar || (it.sources && it.sources[0] && it.sources[0].avatar) || '' });
          wcount++;
        });
      }
    }
  } catch (e) {
    log('wechat_items.json read error: ' + e.message);
  }

  log('sources: gnews=' + gcount + ' rss=' + rcount + ' scrape=' + scount + ' rsshub=' + hcount + ' wechat=' + wcount + ' merged=' + merged.length);
  const health = writeSourceHealth({ gnewsResults, rssResults, scrapeResults, rsshubResults, wechatSnapshot });
  log('source-health: registry=' + REGISTRY_VERSION + ' ok=' + health.summary.ok + '/' + health.summary.checked +
      ' wechatAccounts=' + health.configured.wechatAccounts + ' cachedWechat=' + health.summary.wechatCachedItems);

  // === 只保留最近 7 个北京时间自然日；未来时间一律剔除 ===
  const allowedDateKeys = new Set(recentBeijingDateKeys(MAX_AGE_DAYS));
  const futureLimit = Date.now() + 2 * 3600000;
  const fresh = merged.filter(it => {
    const t = new Date(it.pubDate).getTime();
    const bj = toBJ(it.pubDate);
    return !isNaN(t)
      && t <= futureLimit
      && bj
      && allowedDateKeys.has(bj.dateKey)
      && isRelevantItem(it);
  });
  fresh.sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0));
  const balancedFresh = balanceSources(fresh);
  log('quality: relevant=' + fresh.length + ' balanced=' + balancedFresh.length + ' dropped=' + (merged.length - balancedFresh.length));

  // 按源统计
  const stats = {};
  balancedFresh.forEach(it => {
    const s = it.source || 'google-news';
    stats[s] = (stats[s] || 0) + 1;
  });
  log('fresh(<= ' + MAX_AGE_DAYS + 'd)=' + balancedFresh.length + ' bySource=' + JSON.stringify(stats));

  // === 按时间倒序 ===
  balancedFresh.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime() || 0;
    const tb = new Date(b.pubDate).getTime() || 0;
    return tb - ta;
  });

  // === 抓取原文正文与主图；有缓存的文章不会重复请求 ===
  await enrichArticleCandidates(balancedFresh, log);

  // === 自动识别语言 + 翻译英文（带缓存）===
  let enDone = 0;
  for (const it of balancedFresh) {
    it.lang = detectLang(it.title);
    if (it.lang === 'en' && enDone < MAX_ITEMS) {
      enDone++;
      const tCn = await translate(it.title);
      const sCn = await translate(it.summary || '');
      if (tCn) it.title_cn = stripTrailingSource(tCn);
      if (sCn) it.summary_cn = stripTrailingSource(sCn);
    } else if (it.lang === 'zh') {
      // 中文源：无需翻译，summary_cn 直接用 summary（让 buildBody 能读到）
      if (it.summary && !it.summary_cn) it.summary_cn = it.summary;
    }
  }
  log('lang: translated ' + enDone + ' english items, ' + (balancedFresh.length - enDone) + ' chinese items (no translation)');

  // === v3b：多信源聚合（翻译后按标题相似度合并同事件）===
  const aggregated = aggregateMultiSource(balancedFresh);
  const multiCount = aggregated.filter(it => (it._sourceCount || 1) > 1).length;
  log('aggregate: ' + balancedFresh.length + ' → ' + aggregated.length + ' items (' + multiCount + ' multi-source clusters)');
  const outputCandidates = selectAcrossDays(aggregated, MAX_ITEMS);

  // === 构建输出 items ===
  const now = Date.now();
  const items = outputCandidates.map((it, i) => {
    const bj = toBJ(it._pubDate || it.pubDate);
    const cat = it.cat;
    const ageH = Math.max(0, (now - (new Date(it._pubDate || it.pubDate).getTime() || now - 86400000)) / 3600000);
    const heat = Math.max(42, Math.min(96, Math.round(92 - ageH * 1.4)));
    const id = 'pv' + crypto.createHash('sha1').update(it.link || it.title || String(i)).digest('hex').slice(0, 14);
    const sourceCount = it._sourceCount || 1;
    const sources = it._sources || [it.source || 'google-news'];
    const sourceName = it.author || sources[0] || '行业信源';
    const user = {
      name: sourceName,
      handle: sourceCount > 1 ? `${sourceCount} 个信源聚合` : '原文信源',
      color: pickUser(cat).color,
    };
    const obj = {
      id,
      title: it.title,
      title_cn: it.title_cn || '',
      link: it.link,
      googleNewsUrl: it.googleNewsUrl || '',
      summary: buildBody(it),
      summary_cn: isMojibake(it.summary_cn) ? '' : (it.summary_cn || ''),
      reason: buildReason(it),
      category: cat,
      lang: it.lang || 'zh',
      pubDate: bj ? bj.iso : new Date().toISOString().slice(0, 19),
      dateKey: bj ? bj.dateKey : new Date().toISOString().slice(0, 10),
      source: sources[0],
      sourceCount,
      sources,
      heat,
      tags: [...new Set([cat, ...extractTopics(it.title_cn || it.title)])].slice(0, 3),
      pubTime: bj ? bj.pubTime : '--:--',
      retweetCount: Math.round(heat * 0.32),
      user,
      author: it.author || "",
      avatar: it.avatar || "",
      image: normalizeArticleImage(it.image, it.link),
      summaryMode: (
        !isMojibake(it.summary_cn || (it.lang === 'zh' ? it.summary : ''))
        && (it.summary_cn || (it.lang === 'zh' ? it.summary : '') || '').length >= 45
      ) ? 'article' : 'headline',
      related: [],
    };
    const scoreDetails = computeScoreDetails({ ...obj, _sourceCount: sourceCount });
    obj.score = scoreDetails.score;
    obj.networkHeat = scoreDetails.networkHeat;
    obj.scoreBreakdown = scoreDetails.breakdown;
    return obj;
  });

  // AI 精选只允许北京时间当天新闻；以跨源热度、来源权威度、时效和产业重要性综合选出。
  const todayKey = beijingDateKey();
  const todayItems = items
    .filter((it) => it.dateKey === todayKey)
    .sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount || b.pubDate.localeCompare(a.pubDate));
  const featuredCap = Math.min(20, Math.max(8, Math.ceil(todayItems.length * .22)));
  const featuredIds = new Set(todayItems.slice(0, featuredCap).map((it) => it.id));
  items.forEach((it) => { it.featured = it.dateKey === todayKey && featuredIds.has(it.id); });
  const dayCounts = {};
  items.forEach((it) => { dayCounts[it.dateKey] = (dayCounts[it.dateKey] || 0) + 1; });
  log(`selection: today=${todayItems.length} featured=${featuredIds.size} history=${JSON.stringify(dayCounts)}`);

  if (items.length < 5) {
    log('WARN only ' + items.length + ' items, keep old data_raw.json');
    return;
  }

  const meta = {
    siteName: '光伏 HOT',
    siteSub: 'PV 行业动态聚合 · 多源抓取 · 每日精选',
    date: todayKey,
    weekday: beijingWeekday(),
    updated: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()).replace('T', ' '),
    generator: `光伏 HOT (source registry ${REGISTRY_VERSION} · Google News + RSS + Scrape + WeChat)`,
    sourceRegistryVersion: REGISTRY_VERSION,
    monitoredSources: health.configured,
  };
  const categories = ['全部','政策','价格','硅料','硅片','电池片','组件','逆变器','支架BOS','储能','电站','行情'];

  // 价格抓取已独立到 fetch_prices.js（每天 7am cron），fetch_pv_news.js 不再抓取价格
  // 但需要保留 data_raw.json 中已有的 prices 字段（由 fetch_prices.js 每日 7am 更新）
  // 否则每次覆盖 data_raw.json 时会丢掉 prices，导致前端价格面板空白
  withProcessLockSync(DATA_LOCK_OPTIONS, () => {
    let existingPrices = null;
    try {
      const oldRaw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      if (oldRaw && oldRaw.prices) existingPrices = oldRaw.prices;
    } catch (e) { /* 首次运行无旧文件 */ }

    const out = { meta, categories, items, prices: existingPrices };
    atomicWriteJsonSync(OUT, out, {
      space: 2,
      validate: (value) => value && Array.isArray(value.items) && Array.isArray(value.categories),
    });
    log('OK wrote ' + items.length + ' items' + (existingPrices ? ' + existing prices' : ' (no prices yet)') + ' -> ' + OUT + ' (merge.js 将生成 data.json)');
  });

  // 同步把 site_texts.json 包成 site_texts_fallback.js
  try {
    const TEXTS = path.join(ROOT, 'site_texts.json');
    if (fs.existsSync(TEXTS)) {
      const t = JSON.parse(fs.readFileSync(TEXTS, 'utf8'));
      const fb = '// 由 fetch_pv_news.js 自动生成，与 site_texts.json 同步\n'
        + 'window.SITE_TEXTS = ' + JSON.stringify(t, null, 2) + ';\n';
      atomicWriteUtf8Sync(path.join(ROOT, 'site_texts_fallback.js'), fb);
      log('OK wrote site_texts_fallback.js');
    } else {
      log('WARN: site_texts.json 不存在，跳过 fallback 写入');
    }
  } catch (e) { log('WARN site_texts_fallback: ' + e.message); }
}

async function main() {
  return withProcessLock(NEWS_LOCK_OPTIONS, runMain);
}

if (require.main === module) {
  main().catch((e) => {
    fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] FATAL ' + (e && e.stack || e) + '\n');
    process.exit(1);
  });
}

module.exports = {
  main,
  decodeGoogleNewsUrl,
  extractArticleDetails,
  summarizeArticleText,
  buildBody,
  computeScoreDetails,
  beijingDateKey,
  decodeResponseBuffer,
  isMojibake,
};
