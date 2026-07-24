#!/usr/bin/env node
'use strict';
// 光伏 HOT 自动抓取：Google News RSS 多关键词 -> 兼容前端的 data.json
// 自动识别语言：中文源直接采用；英文源经 Google 翻译 gtx 接口译为中文（MyMemory 兜底 + 缓存）
// 零依赖（仅 node 内置 https / fs / path）
// 关键修复 2026-07-23：
//   1) Google News RSS 现会 302 重定向到 hl=en-US，fetchRSS 必须跟随；
//   2) 中文 q 在 Google News RSS 搜不到，全改英文关键词；
//   3) toBJ 时区修正为北京时间；
//   4) 只保留最近 MAX_AGE_DAYS 天的新闻，避免历史文混进时间线；
//   5) 抓取上限提到 MAX_ITEMS，让每日时间线足够密集。

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = '/var/www/pvhot';
const OUT = path.join(ROOT, 'data.json');
const LOG = path.join(ROOT, 'fetch.log');
const CACHE_FILE = path.join(ROOT, 'translate_cache.json');

// 分类 -> 关键词（中英文，命中即归此类）
const CATS = [
  { cat: '硅料',   keys: ['polysilicon', 'poly silicon', 'multicrystalline', '多晶硅', '硅料'] },
  { cat: '硅片',   keys: ['wafer', 'ingot', '硅片', '硅锭', '铸锭'] },
  { cat: '电池片', keys: ['solar cell', 'perovskite', 'hjt', 'topcon', 'bc cell', '钙钛矿', '电池片', '电池'] },
  { cat: '组件',   keys: ['solar module', 'solar panel', 'pv module', '组件', '光伏组件', '太阳能板'] },
  { cat: '逆变器', keys: ['solar inverter', 'pv inverter', 'inverter', '逆变器', '逆变'] },
  { cat: '支架BOS', keys: ['solar tracker', 'solar mount', 'bos', '支架', '跟踪支架'] },
  { cat: '储能',   keys: ['battery storage', 'solar storage', 'solar battery', 'bess', '储能', '电池储能'] },
  { cat: '电站',   keys: ['solar plant', 'solar project', 'solar farm', 'epc', '电站', '光伏项目', '光伏电站'] },
  { cat: '行情',   keys: ['solar price', 'polysilicon price', 'tariff', 'solar capacity', 'solar stock', '股价', '产能', '价格', '招标', '行情'] },
];

// 主源：Google News RSS（英文关键词，hl=en-US 才能稳定返回）
const QUERIES = [
  { cat: 'ALL',     q: 'solar OR photovoltaic OR solar panel' },
  { cat: '硅料',    q: 'polysilicon OR silicon' },
  { cat: '硅片',    q: 'solar wafer OR ingot' },
  { cat: '电池片',  q: 'solar cell OR perovskite OR HJT OR TOPCon' },
  { cat: '组件',    q: 'solar module OR solar panel OR PV module' },
  { cat: '逆变器',  q: 'solar inverter OR PV inverter' },
  { cat: '支架BOS', q: 'solar tracker OR solar mounting' },
  { cat: '储能',    q: 'solar battery storage OR BESS' },
  { cat: '电站',    q: 'solar plant OR solar project OR solar farm OR EPC' },
  { cat: '行情',    q: 'solar price OR polysilicon price OR solar capacity OR solar tariff' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_AGE_DAYS = 14;   // 只保留最近 14 天
const MAX_ITEMS = 120;      // 输出上限

function classify(text) {
  const t = (text || '').toLowerCase();
  for (const c of CATS) {
    for (const k of c.keys) {
      if (t.indexOf(k.toLowerCase()) !== -1) return c.cat;
    }
  }
  return '行情';
}

function pickUser(cat) {
  const map = {
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
    /* 过滤 Google News 跟踪链接噪音（CBMi.../news.google.com） */
    summary = summary.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const dm = summary.match(/^[^-–—]{1,40}\s*[-–—]\s*([\s\S]+)$/);
    if (dm) summary = dm[1];
    summary = summary.trim().slice(0, 220);
    /* 摘要过短（基本只有 URL 或空）时丢弃摘要 */
    if (summary.length < 25) summary = '';
    /* 摘要与标题高度重合时清空（Google News 现 description=标题+来源，无增量信息） */
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

/* ---------- 去 HTML 标签 + 解码实体（防 Google News 锚标签污染 summary） ---------- */
function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')           // 去所有标签（<a> <font> <br> ...）
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

/* ---------- fetchRSS：跟随 30x 重定向 ---------- */
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

function cleanText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

async function main() {
  const log = (msg) => {
    const line = '[' + new Date().toISOString() + '] ' + msg;
    console.log(line); fs.appendFileSync(LOG, line + '\n');
  };
  log('START fetch, queries=' + QUERIES.length);

  const results = await Promise.all(QUERIES.map(q => fetchRSS(q.q)));

  // 去重：link 去重
  const seen = new Set();
  const merged = [];
  results.forEach((arr, idx) => {
    const cat = QUERIES[idx].cat;
    arr.forEach((it) => {
      const key = cleanText(it.link);
      if (seen.has(key)) return;
      seen.add(key);
      const finalCat = cat === 'ALL' ? classify(it.title + ' ' + it.summary) : cat;
      merged.push({ ...it, cat: finalCat });
    });
  });

  // 只保留最近 MAX_AGE_DAYS 天
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
  const fresh = merged.filter(it => {
    const t = new Date(it.pubDate).getTime();
    return !isNaN(t) && t >= cutoff;
  });
  log('merged=' + merged.length + ' fresh(<= ' + MAX_AGE_DAYS + 'd)=' + fresh.length);

  // 按时间倒序
  fresh.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime() || 0;
    const tb = new Date(b.pubDate).getTime() || 0;
    return tb - ta;
  });

  // 自动识别语言 + 翻译英文（带缓存，最多翻译 MAX_ITEMS 条兜底）
  let enDone = 0;
  for (const it of fresh) {
    it.lang = detectLang(it.title);
    if (it.lang === 'en' && enDone < MAX_ITEMS) {
      enDone++;
      const tCn = await translate(it.title);
      const sCn = await translate(it.summary || '');
      if (tCn) it.title_cn = tCn;
      if (sCn) it.summary_cn = sCn;
    }
  }
  log('lang: translated ' + enDone + ' english items');

  const now = Date.now();
  const items = fresh.slice(0, MAX_ITEMS).map((it, i) => {
    const bj = toBJ(it.pubDate);
    const cat = it.cat;
    const ageH = bj ? Math.max(0, (now - new Date(bj.iso).getTime()) / 3600000) : 24;
    const heat = Math.max(42, Math.min(96, Math.round(92 - ageH * 1.4)));
    const user = pickUser(cat);
    const id = 'pv' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + pad((i + 1) % 100);
    return {
      id,
      title: it.title,
      title_cn: it.title_cn || '',
      link: it.link,
      summary: it.summary || '',
      summary_cn: it.summary_cn || '',
      category: cat,
      lang: it.lang || 'zh',
      pubDate: bj ? bj.iso : new Date().toISOString().slice(0, 19),
      dateKey: bj ? bj.dateKey : new Date().toISOString().slice(0, 10),
      source: (it.source || 'google-news').toLowerCase().replace(/\s+/g, '-').slice(0, 24),
      sourceCount: 1,
      sources: [it.source || 'google-news'],
      heat,
      reason: '来自 Google News 的「' + cat + '」方向聚合' + (it.lang === 'en' ? '（英文自动译中）' : '') + '。',
      tags: [cat],
      pubTime: bj ? bj.pubTime : '--:--',
      retweetCount: Math.round(heat * 0.32),
      user,
      related: [],
    };
  });

  if (items.length < 5) {
    log('WARN only ' + items.length + ' items, keep old data.json');
    return;
  }

  const meta = {
    siteName: '光伏 HOT',
    siteSub: 'PV 行业动态聚合 · 每日精选与光伏日报',
    date: new Date().toISOString().slice(0, 10),
    weekday: ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()],
    updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    generator: '光伏 HOT (fetch_pv_news.js · Google News RSS · 自动识别语言 + 翻译)',
  };
  const categories = ['全部','硅料','硅片','电池片','组件','逆变器','支架BOS','储能','电站','行情'];
  const out = { meta, categories, items };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  log('OK wrote ' + items.length + ' items -> ' + OUT);
}

main().catch((e) => {
  fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] FATAL ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
