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

const ROOT = '/var/www/pvhot';
const OUT = path.join(ROOT, 'data_raw.json');
const LOG = path.join(ROOT, 'fetch.log');
const CACHE_FILE = path.join(ROOT, 'translate_cache.json');
const RSSHUB_BASE = 'http://127.0.0.1:1200';

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

// === 信源1: Google News RSS（英文关键词，hl=en-US 才能稳定返回）===
const QUERIES = [
  { cat: 'ALL',     q: 'solar OR photovoltaic OR solar panel' },
  { cat: '政策',    q: 'solar policy OR photovoltaic policy OR solar subsidy OR solar tariff OR "Inflation Reduction Act" OR "anti-dumping" solar' },
  { cat: '价格',    q: 'solar price OR polysilicon price OR wafer price OR cell price OR module price OR "solar price trend"' },
  { cat: '硅料',    q: 'polysilicon OR "poly silicon" OR 多晶硅' },
  { cat: '硅片',    q: 'solar wafer OR ingot' },
  { cat: '电池片',  q: 'solar cell OR perovskite OR HJT OR TOPCon' },
  { cat: '组件',    q: 'solar module OR solar panel OR PV module' },
  { cat: '逆变器',  q: 'solar inverter OR PV inverter' },
  { cat: '支架BOS', q: 'solar tracker OR solar mounting' },
  { cat: '储能',    q: 'solar battery storage OR BESS' },
  { cat: '电站',    q: 'solar plant OR solar project OR solar farm OR EPC' },
  { cat: '行情',    q: 'solar capacity OR solar stock OR solar market OR PV market' },
];

// === 信源2: 直接 RSS（国外 PV 新闻站，已验证可用）===
const RSS_FEEDS = [
  { url: 'https://www.pv-magazine.com/feed/', source: 'pv-magazine', cat: 'ALL' },
  { url: 'https://www.pv-tech.org/feed',      source: 'pv-tech',     cat: 'ALL' },
  { url: 'https://cleantechnica.com/feed/',   source: 'cleantechnica', cat: 'ALL' },
];

// === 信源3: HTML 抓取（国内 PV 新闻站，无 RSS，需抓页面提取链接）===
const SCRAPE_SOURCES = [
  { url: 'https://news.solarbe.com/', source: 'solarbe', cat: 'ALL',
    linkPattern: /news\.solarbe\.com\/\d{6}\/\d+\/\d+\.html/,
    dateFromUrl: function(url) {
      const m = url.match(/\/(\d{4})(\d{2})\/(\d{2})\//);
      return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
    },
    maxItems: 20 },
  { url: 'https://guangfu.bjx.com.cn/', source: 'bjx-guangfu', cat: 'ALL',
    linkPattern: /guangfu\.bjx\.com\.cn\/news\/\d{8}\/\d+\.shtml/,
    dateFromUrl: function(url) {
      const m = url.match(/\/news\/(\d{4})(\d{2})(\d{2})\//);
      return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
    },
    maxItems: 20 },
  { url: 'https://www.ne21.com/', source: 'ne21', cat: 'ALL',
    linkPattern: /ne21\.com\/news\/show-\d+\.html/,
    dateFromUrl: null,
    maxItems: 20 },
];

// === 信源4: RSSHub 路由（社交媒体，需服务器部署 RSSHub）===
// RSSHub 路由：微博搜索 + 微信公众号（freewechat 精确账号 + sogou 通用搜索）
const RSSHUB_ROUTES = [
  // 微博搜索（通用，路径修正：/weibo/keyword/ 而非 /weibo/search/keyword/）
  { route: '/weibo/keyword/光伏', source: 'weibo', name: '微博搜索', cat: 'ALL' },
  // 微信公众号 — freewechat 精确账号（用户指定 + 行业大V）
  { route: '/freewechat/profile/MzAxNjU2NjAyNA==', source: 'wechat', name: '光伏們', cat: 'ALL' },
  { route: '/freewechat/profile/MzI2NzIwMDg4NQ==', source: 'wechat', name: '光伏头条', cat: 'ALL' },
  { route: '/freewechat/profile/MjM5MzgyMjY2MQ==', source: 'wechat', name: '索比光伏网', cat: 'ALL' },
  { route: '/freewechat/profile/MjM5MzI1NzEyMA==', source: 'wechat', name: 'PV-Tech', cat: 'ALL' },
  { route: '/freewechat/profile/MzA3NjQxMjkxOA==', source: 'wechat', name: '光伏资讯', cat: 'ALL' },
  { route: '/freewechat/profile/MzU1NDY3OTAyNw==', source: 'wechat', name: '风芒能源', cat: 'ALL' },
  { route: '/freewechat/profile/Mzg2Mjc2MzQ4Mg==', source: 'wechat', name: '储能与电力市场', cat: 'ALL' },
  { route: '/freewechat/profile/MzA5MDMwMDc1MQ==', source: 'wechat', name: '北极星分布式光伏', cat: 'ALL' },
  { route: '/freewechat/profile/MzAwNTM2NzYxNA==', source: 'wechat', name: '光伏见闻', cat: 'ALL' },
  { route: '/freewechat/profile/Mzg4NTY5MjUxMg==', source: 'wechat', name: '天合跟踪', cat: 'ALL' },
  { route: '/freewechat/profile/Mzg2NTg0MzAxMg==', source: 'wechat', name: '天合光能系统解决方案', cat: 'ALL' },
  { route: '/freewechat/profile/Mzg3MjU2MzA4Ng==', source: 'wechat', name: '天合光能产品中心', cat: 'ALL' },
  { route: '/freewechat/profile/MjM5MzUwNzk2Mg==', source: 'wechat', name: '中关村储能产业技术联盟', cat: 'ALL' },
  { route: '/freewechat/profile/MzAwMTc0MzcxOQ==', source: 'wechat', name: '电能革新', cat: 'ALL' },
  { route: '/freewechat/profile/MzA3MTQ2MzQxMg==', source: 'wechat', name: '维科网光伏', cat: 'ALL' },
  { route: '/freewechat/profile/MzkzMjY4MjE5Mg==', source: 'wechat', name: '东吴光伏圈', cat: 'ALL' },
  { route: '/freewechat/profile/MzkwNzM4NDI2Mg==', source: 'wechat', name: 'ACMI硅基新材料', cat: 'ALL' },
  { route: '/freewechat/profile/MjM5MzY2NDE2NA==', source: 'wechat', name: '昱能科技', cat: 'ALL' },
  { route: '/freewechat/profile/Mzg3ODY1NDgyMw==', source: 'wechat', name: '隆基氢能', cat: 'ALL' },
  { route: '/freewechat/profile/MzUwOTAxNDM0Nw==', source: 'wechat', name: '阳光电源', cat: 'ALL' },
  { route: '/freewechat/profile/MjM5NTAyMTI1NQ==', source: 'wechat', name: '国际能源网', cat: 'ALL' },
  // 微信公众号 — sogou 通用搜索（兜底，覆盖未找到 biz ID 的账号）
  { route: '/wechat/sogou/光伏', source: 'wechat', name: '微信搜索光伏', cat: 'ALL' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_AGE_DAYS = 14;   // 只保留最近 14 天
const MAX_ITEMS = 150;      // 输出上限（v3.0 提到 150 适配多源）

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
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(CACHE)); } catch (e) {}
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

/* ---------- 通用 URL 抓取（跟随 30x 重定向，返回 body 字符串）---------- */
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
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(buf));
      });
      req.on('error', (e) => { console.error('fetchURL error: ' + u.slice(0,60) + ' -> ' + (e.message||e)); resolve(''); });
      req.setTimeout(reqTimeout, () => { req.destroy(); resolve(''); });
    });
  }
  return tryGet(url, 0);
}

/* ---------- Google News RSS 抓取（现有逻辑，保留不动）---------- */
function fetchRSS(q) {
  const url = 'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en-US';
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
  // freewechat 路由可能需要 30-60s（RSSHub 从 freewechat.com 实时抓取），用 70s 超时
  const xml = await fetchURL(RSSHUB_BASE + route, true, 70000);
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
    // 解析相对 URL
    if (href.startsWith('/')) href = new URL(href, config.url).href;
    else if (!href.startsWith('http')) continue;
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
    let pubDate = new Date().toISOString();
    if (config.dateFromUrl) {
      const dateStr = config.dateFromUrl(href);
      if (dateStr) pubDate = dateStr + 'T00:00:00Z';
    }
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

/* ---------- v18.10 卡片信息层级（v3.0.3: 摘要精简至80字，有头有尾）---------- */
function buildBody(it) {
  let real = stripTrailingSource(((it && it.summary_cn) || '').replace(/\s+/g, ' ').trim());
  // 清理可能残留的 [YYYY-MM-DD] 日期前缀
  real = real.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '');
  if (/^(「.+」方向|英文聚合自动译中|行业最新进展|.+ 方向 .+ 报道)/.test(real)) real = '';
  if (real.length >= 15) {
    if (real.length <= 80) return real;
    const sub = real.slice(0, 80);
    // 优先在完整句号/问号/叹号处截断（有尾）
    const endM = sub.search(/[。！？!?][^。！？!?]*$/);
    if (endM !== -1 && endM >= 25) return sub.slice(0, endM + 1);
    // 其次在逗号/分号处截断
    const commaM = sub.search(/[，,；;][^，,；;]*$/);
    if (commaM !== -1 && commaM >= 30) return sub.slice(0, commaM) + '…';
    // 硬截断（有头）
    return sub + '…';
  }
  const full = stripTrailingSource(((it && (it.title_cn || it.title)) || '').replace(/\s+/g, ' ').trim());
  if (!full) return '';
  const m = full.slice(8).search(/[；;：，、—–|·]/);
  if (m !== -1) {
    const rest = full.slice(8 + m + 1).trim();
    if (rest.length >= 8 && rest.length < full.length - 4) return rest.slice(0, 80) + (rest.length > 80 ? '…' : '');
  }
  return '';
}

/* ---------- 推荐理由：基于事实(数字/机构/政策关键词)模板化生成 ---------- */
const REASON_CAT_MAP = {
  '政策': '政策与监管', '价格': '价格走势',
  '硅料': '硅料价格与产能', '硅片': '硅片供应格局', '电池片': '电池技术路线',
  '组件': '组件出货与认证', '逆变器': '逆变器产品迭代', '支架BOS': '支架与 BOS',
  '储能': '光储耦合', '电站': '电站 EPC 与招标', '行情': '市场行情与产能',
};
function buildReason(it) {
  const sum = ((it && it.summary_cn) || '').replace(/\s+/g, ' ').trim();
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
    // 多成员：在 rep 上附加聚合信息
    rep._sourceCount = sources.length;
    rep._sources = sources;
    rep._pubDate = c.repPubDate;
    rep._allTitles = c.members.map(m => m.title_cn || m.title);
    return rep;
  });
}

/*
 * 推荐分（AI 推荐排序依据）：
 *   heat(42-96) + (sourceCount-1)*12 + 有正文+8 + 数据信号+6 + 政策信号+5 + 可操作+3
 *   → 范围约 42-140
 */
function computeScore(it) {
  let score = it.heat || 50;
  score += ((it._sourceCount || it.sourceCount || 1) - 1) * 12;
  const body = it.summary || it.summary_cn || '';
  if (body.length >= 25) score += 8;
  const reason = it.reason || '';
  if (/数据信号/.test(reason)) score += 6;
  if (/政策信号/.test(reason)) score += 5;
  if (/对标|跟踪|关注|参考|纳入/.test(reason)) score += 3;
  return Math.round(score);
}

async function main() {
  const log = (msg) => {
    const line = '[' + new Date().toISOString() + '] ' + msg;
    console.log(line); fs.appendFileSync(LOG, line + '\n');
  };
  log('START fetch v3.0 (multi-source), gnews=' + QUERIES.length + ' rss=' + RSS_FEEDS.length +
      ' scrape=' + SCRAPE_SOURCES.length + ' rsshub=' + RSSHUB_ROUTES.length);

  // === 并行抓取（RSSHub 分批，避免打爆本地 RSSHub 服务）===
  const [gnewsResults, rssResults, scrapeResults, rsshubResults] = await Promise.all([
    Promise.all(QUERIES.map(q => fetchRSS(q.q))),
    Promise.all(RSS_FEEDS.map(s => fetchDirectRSS(s.url))),
    Promise.all(SCRAPE_SOURCES.map(s => fetchScrape(s))),
    batchFetch(RSSHUB_ROUTES, 4, (s) => fetchRSSHub(s.route)),
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
  try {
    const wechatPath = path.join(__dirname, 'wechat_items.json');
    if (fs.existsSync(wechatPath)) {
      const wc = JSON.parse(fs.readFileSync(wechatPath, 'utf8'));
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
          merged.push({ ...it, cat: classified, source: '微信公众号' });
          wcount++;
        });
      }
    }
  } catch (e) {
    log('wechat_items.json read error: ' + e.message);
  }

  log('sources: gnews=' + gcount + ' rss=' + rcount + ' scrape=' + scount + ' rsshub=' + hcount + ' wechat=' + wcount + ' merged=' + merged.length);

  // === 只保留最近 MAX_AGE_DAYS 天 ===
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
  const fresh = merged.filter(it => {
    const t = new Date(it.pubDate).getTime();
    return !isNaN(t) && t >= cutoff;
  });

  // 按源统计
  const stats = {};
  fresh.forEach(it => {
    const s = it.source || 'google-news';
    stats[s] = (stats[s] || 0) + 1;
  });
  log('fresh(<= ' + MAX_AGE_DAYS + 'd)=' + fresh.length + ' bySource=' + JSON.stringify(stats));

  // === 按时间倒序 ===
  fresh.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime() || 0;
    const tb = new Date(b.pubDate).getTime() || 0;
    return tb - ta;
  });

  // === 自动识别语言 + 翻译英文（带缓存）===
  let enDone = 0;
  for (const it of fresh) {
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
  log('lang: translated ' + enDone + ' english items, ' + (fresh.length - enDone) + ' chinese items (no translation)');

  // === v3b：多信源聚合（翻译后按标题相似度合并同事件）===
  const aggregated = aggregateMultiSource(fresh);
  const multiCount = aggregated.filter(it => (it._sourceCount || 1) > 1).length;
  log('aggregate: ' + fresh.length + ' → ' + aggregated.length + ' items (' + multiCount + ' multi-source clusters)');

  // === 构建输出 items ===
  const now = Date.now();
  const items = aggregated.slice(0, MAX_ITEMS).map((it, i) => {
    const bj = toBJ(it._pubDate || it.pubDate);
    const cat = it.cat;
    const ageH = bj ? Math.max(0, (now - new Date(bj.iso).getTime()) / 3600000) : 24;
    const heat = Math.max(42, Math.min(96, Math.round(92 - ageH * 1.4)));
    const user = pickUser(cat);
    const id = 'pv' + crypto.createHash('sha1').update(it.link || it.title || String(i)).digest('hex').slice(0, 14);
    const sourceCount = it._sourceCount || 1;
    const sources = it._sources || [it.source || 'google-news'];
    const obj = {
      id,
      title: it.title,
      title_cn: it.title_cn || '',
      link: it.link,
      summary: buildBody(it),
      summary_cn: it.summary_cn || '',
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
      related: [],
    };
    obj.score = computeScore({ ...obj, _sourceCount: sourceCount });
    return obj;
  });

  if (items.length < 5) {
    log('WARN only ' + items.length + ' items, keep old data_raw.json');
    return;
  }

  const meta = {
    siteName: '光伏 HOT',
    siteSub: 'PV 行业动态聚合 · 多源抓取 · 每日精选',
    date: new Date().toISOString().slice(0, 10),
    weekday: ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()],
    updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    generator: '光伏 HOT (fetch_pv_news.js v3.0 · Google News + RSS + Scrape + RSSHub)',
  };
  const categories = ['全部','政策','价格','硅料','硅片','电池片','组件','逆变器','支架BOS','储能','电站','行情'];

  // 价格抓取已独立到 fetch_prices.js（每天 7am cron），fetch_pv_news.js 不再抓取价格
  // 但需要保留 data_raw.json 中已有的 prices 字段（由 fetch_prices.js 每日 7am 更新）
  // 否则每次覆盖 data_raw.json 时会丢掉 prices，导致前端价格面板空白
  let existingPrices = null;
  try {
    const oldRaw = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (oldRaw && oldRaw.prices) existingPrices = oldRaw.prices;
  } catch (e) { /* 首次运行无旧文件 */ }

  const out = { meta, categories, items, prices: existingPrices };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  log('OK wrote ' + items.length + ' items' + (existingPrices ? ' + existing prices' : ' (no prices yet)') + ' -> ' + OUT + ' (merge.js 将生成 data.json)');

  // 同步把 site_texts.json 包成 site_texts_fallback.js
  try {
    const TEXTS = path.join(ROOT, 'site_texts.json');
    if (fs.existsSync(TEXTS)) {
      const t = JSON.parse(fs.readFileSync(TEXTS, 'utf8'));
      const fb = '// 由 fetch_pv_news.js 自动生成，与 site_texts.json 同步\n'
        + 'window.SITE_TEXTS = ' + JSON.stringify(t, null, 2) + ';\n';
      fs.writeFileSync(path.join(ROOT, 'site_texts_fallback.js'), fb, 'utf8');
      log('OK wrote site_texts_fallback.js');
    } else {
      log('WARN: site_texts.json 不存在，跳过 fallback 写入');
    }
  } catch (e) { log('WARN site_texts_fallback: ' + e.message); }
}

main().catch((e) => {
  fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] FATAL ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
