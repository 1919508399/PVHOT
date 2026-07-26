#!/usr/bin/env node
'use strict';
// 光伏 HOT 后台系统：管理 data.json 内容（增/删/改/标记精选/手动添加/触发抓取）
// 监听 127.0.0.1:8777，由 nginx /admin/ 反代。读写 admin_edits.json 后自动跑 merge.js。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { merge } = require('./merge.js');

const ROOT = process.env.PVHOT_ROOT || '/var/www/pvhot';
const PORT = Number(process.env.PVHOT_ADMIN_PORT || 8777);
const HOST = process.env.PVHOT_ADMIN_HOST || '127.0.0.1';
const NODE = process.env.PVHOT_NODE || '/usr/bin/node';
const PASS_FILE = path.join(ROOT, 'admin_pass.txt');
const EDITS = path.join(ROOT, 'admin_edits.json');
const DATA = path.join(ROOT, 'data.json');
const LOG = path.join(ROOT, 'fetch.log');
const ADMIN_HTML = path.join(ROOT, 'admin.html');
const TEXTS_FILE = path.join(ROOT, 'site_texts.json');
const SKILL_FILE = path.join(ROOT, 'pvhot-skill', 'SKILL.md');
const FEEDBACK_FILE = path.join(ROOT, 'feedback.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const QRCODE_FILE = path.join(UPLOAD_DIR, 'qrcode.png');
const STATS_FILE = path.join(ROOT, 'stats.json');
const SOURCE_HEALTH_FILE = path.join(ROOT, 'source_health.json');
// 允许 3MB 图片经过 base64 膨胀后的 JSON 请求，同时拦截异常大请求。
const MAX_BODY_BYTES = 5 * 1024 * 1024;
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

/* ---------------- 访问统计 ---------------- */
function todayKey() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch (e) { return { days: {}, total: { pv: 0, uv: 0, ips: [] } }; }
}
function saveStats(s) { try { fs.writeFileSync(STATS_FILE, JSON.stringify(s)); } catch (e) { console.error('[stats] save error', e); } }
function recordVisit(ip, path, referrer) {
  const s = loadStats();
  const dk = todayKey();
  if (!s.days[dk]) s.days[dk] = { pv: 0, uv: 0, ips: [], paths: {}, refs: {} };
  const d = s.days[dk];
  d.pv++;
  if (!d.ips.includes(ip)) { d.ips.push(ip); d.uv = d.ips.length; }
  // 保留最多 500 个 IP（防内存膨胀）
  if (d.ips.length > 500) d.ips = d.ips.slice(-500);
  // 路径统计
  const pkey = (path || '/').slice(0, 80);
  d.paths[pkey] = (d.paths[pkey] || 0) + 1;
  // 来源统计
  let ref = '直接访问';
  if (referrer) {
    try { const u = new URL(referrer); ref = u.hostname; } catch (e) { ref = '其他'; }
  }
  d.refs[ref] = (d.refs[ref] || 0) + 1;
  // 总计
  s.total.pv = (s.total.pv || 0) + 1;
  if (!s.total.ips) s.total.ips = [];
  if (!s.total.ips.includes(ip)) { s.total.ips.push(ip); s.total.uv = s.total.ips.length; }
  if (s.total.ips.length > 2000) s.total.ips = s.total.ips.slice(-2000);
  // 清理 90 天前的旧数据
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  Object.keys(s.days).forEach(k => { if (k < cutoff) delete s.days[k]; });
  saveStats(s);
}
function getStatsSummary() {
  const s = loadStats();
  const dk = todayKey();
  const today = s.days[dk] || { pv: 0, uv: 0, paths: {}, refs: {} };
  // 最近7天
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const dd = s.days[d] || { pv: 0, uv: 0 };
    last7.push({ date: d, pv: dd.pv || 0, uv: dd.uv || 0 });
  }
  // 热门页面 top 10
  const topPaths = Object.entries(today.paths || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  // 热门来源 top 10
  const topRefs = Object.entries(today.refs || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    today: { pv: today.pv, uv: today.uv, topPaths, topRefs },
    total: { pv: s.total.pv || 0, uv: s.total.uv || 0 },
    last7,
  };
}
function getSystemStatus() {
  const status = {};
  // data.json
  try {
    const data = loadData();
    status.items = (data.items || []).length;
    status.categories = (data.categories || []).length;
    const st = fs.statSync(DATA);
    status.dataSize = st.size;
    status.dataMtime = st.mtime;
  } catch (e) { status.items = 0; status.dataError = e.message; }
  // data_raw.json
  try {
    const rawSt = fs.statSync(path.join(ROOT, 'data_raw.json'));
    status.rawSize = rawSt.size;
    status.rawMtime = rawSt.mtime;
  } catch (e) {}
  // fetch.log 最后修改时间
  try {
    const logSt = fs.statSync(LOG);
    status.logMtime = logSt.mtime;
    // 读最后几行获取上次抓取时间
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-5);
    status.lastLog = lines;
  } catch (e) { status.lastLog = []; }
  // 信源注册表与最近一次健康检查
  try {
    const health = JSON.parse(fs.readFileSync(SOURCE_HEALTH_FILE, 'utf8'));
    status.sourceHealth = {
      checkedAt: health.checkedAt || null,
      registryVersion: health.registryVersion || null,
      configured: health.configured || {},
      summary: health.summary || {},
      queriedAccounts: health.wechat && health.wechat.queriedAccounts || [],
    };
  } catch (e) {
    status.sourceHealth = null;
  }
  // RSSHub 健康
  status.rsshub = 'unknown';
  // admin_edits
  try {
    const edits = loadEdits();
    status.deletedCount = (edits.deleted || []).length;
    status.overrideCount = Object.keys(edits.overrides || {}).length;
    status.addedCount = (edits.added || []).length;
  } catch (e) {}
  // 磁盘
  try {
    const { execSync } = require('child_process');
    const df = execSync('df -h /var/www/pvhot --output=size,used,avail,pcent 2>/dev/null | tail -1', { encoding: 'utf8' }).trim();
    status.disk = df;
  } catch (e) {}
  // 内存
  try {
    const mem = process.memoryUsage();
    status.memRSS = Math.round(mem.rss / 1024 / 1024) + ' MB';
    status.memHeap = Math.round(mem.heapUsed / 1024 / 1024) + '/' + Math.round(mem.heapTotal / 1024 / 1024) + ' MB';
  } catch (e) {}
  // 运行时间
  status.uptime = Math.round(process.uptime()) + 's';
  status.refreshRunning = !!refreshJob;
  status.refreshStartedAt = refreshStartedAt;
  return status;
}
const COOKIE = 'pvhot_sid';
const TTL = 3600 * 1000 * 8; // 8h

/* 反馈简单限频：同 IP 1 分钟 5 条 */
const fbRate = new Map(); // ip -> [timestamps]
function rateOk(ip) {
  const now = Date.now();
  const arr = (fbRate.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 5) { fbRate.set(ip, arr); return false; }
  arr.push(now); fbRate.set(ip, arr); return true;
}

/* ---------------- 认证 ---------------- */
function getPassHash() {
  const envHash = (process.env.PVHOT_ADMIN_PASSWORD_HASH || '').trim();
  if (/^[a-f0-9]{64}$/i.test(envHash)) return envHash.toLowerCase();
  try {
    const c = fs.readFileSync(PASS_FILE, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(c)) return c.toLowerCase();
  } catch (e) {}
  return null;
}
const sessions = new Map(); // token -> expiry
const loginAttempts = new Map(); // ip -> { count, firstAt, blockedUntil }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function hashEquals(actual, expected) {
  if (!expected || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
const newToken = () => crypto.randomBytes(24).toString('hex');
function parseCookies(s) {
  const o = {};
  (s || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
function authed(req) {
  const t = parseCookies(req.headers.cookie || '')[COOKIE];
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function loginAllowed(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec) return true;
  if (rec.blockedUntil && rec.blockedUntil > now) return false;
  if (now - rec.firstAt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return true;
  }
  return rec.count < 8;
}
function recordLoginAttempt(ip, success) {
  if (success) { loginAttempts.delete(ip); return; }
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, firstAt: now, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= 8) rec.blockedUntil = now + 15 * 60 * 1000;
  loginAttempts.set(ip, rec);
}

/* ---------------- 工具 ---------------- */
function send(res, code, obj, extra) {
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }, extra || {}));
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let b = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) { tooLarge = true; b = ''; return; }
      b += c;
    });
    req.on('end', () => {
      if (tooLarge) return resolve(null);
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); }
    });
  });
}
async function getBodyOrReject(req, res) {
  const body = await readBody(req);
  if (body === null) { send(res, 413, { error: '请求内容过大' }); return null; }
  return body;
}
function loadEdits() {
  try { return JSON.parse(fs.readFileSync(EDITS, 'utf8')); } catch (e) { return { deleted: [], overrides: {}, added: [] }; }
}
function saveEdits(e) { fs.writeFileSync(EDITS, JSON.stringify(e, null, 2)); }
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { return { meta: {}, categories: [], items: [] }; }
}
function runMerge() { try { return merge(); } catch (e) { console.error('[admin] merge error', e); return false; } }
function publicItem(item) {
  return {
    id: item.id,
    title: item.title_cn || item.title || '',
    title_original: item.title || '',
    summary: item.summary_cn || item.summary || '',
    category: item.category || '行情',
    featured: item.featured === true,
    source: item.source || '',
    sourceCount: item.sourceCount || 1,
    sources: item.sources || [item.source].filter(Boolean),
    networkHeat: item.networkHeat || item.heat || 0,
    score: item.score || 0,
    pubDate: item.pubDate || '',
    dateKey: item.dateKey || String(item.pubDate || '').slice(0, 10),
    link: item.link || '',
    image: item.image || '',
    reason: item.reason || '',
    tags: item.tags || [],
    attribution: (item.sources || [item.source]).filter(Boolean).join(', '),
  };
}
function queryPublicNews(url, maxLimit = 100) {
  const data = loadData();
  const category = (url.searchParams.get('category') || '').trim();
  const date = (url.searchParams.get('date') || '').trim().toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const featured = ['1', 'true', 'yes'].includes((url.searchParams.get('featured') || '').toLowerCase());
  const limit = Math.min(maxLimit, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
  const today = todayKey();
  const cutoff7 = new Date(Date.now() + 8 * 3600000 - 6 * 86400000).toISOString().slice(0, 10);
  let items = (data.items || []).slice();
  if (category && category !== '全部') items = items.filter((item) => item.category === category);
  if (date === 'today') items = items.filter((item) => (item.dateKey || String(item.pubDate || '').slice(0, 10)) === today);
  else if (date === '7d') items = items.filter((item) => (item.dateKey || String(item.pubDate || '').slice(0, 10)) >= cutoff7);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) items = items.filter((item) => (item.dateKey || String(item.pubDate || '').slice(0, 10)) === date);
  if (featured) items = items.filter((item) => item.featured === true);
  if (q) items = items.filter((item) => [
    item.title_cn, item.title, item.summary_cn, item.summary, item.source,
    ...(item.sources || []), ...(item.tags || []),
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
  items.sort((a, b) => String(b.pubDate || '').localeCompare(String(a.pubDate || '')));
  const total = items.length;
  return {
    data,
    total,
    limit,
    filters: { date: date || 'all', category: category || '全部', featured, q },
    items: items.slice(0, limit).map(publicItem),
  };
}
function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function publicHeaders(cache = 'public, max-age=60, stale-while-revalidate=120') {
  return {
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*',
    'X-PVHOT-API-Version': '1.1.0',
  };
}
function cookieHeader(token) {
  return COOKIE + '=' + token + '; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (TTL / 1000);
}

let refreshJob = null;
let refreshStartedAt = null;

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  // 后台页面
  if ((p === '/admin' || p === '/admin/') && method === 'GET') {
    try {
      const html = fs.readFileSync(ADMIN_HTML);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      });
      res.end(html);
    } catch (e) { send(res, 500, { error: 'admin.html 缺失，请部署' }); }
    return;
  }

  if (!p.startsWith('/admin/api/') && !p.startsWith('/api/')) { send(res, 404, { error: 'not found' }); return; }

  /* ---------- 登录 / 退出（无需登录） ---------- */
  if (p === '/admin/api/login' && method === 'POST') {
    const body = await getBodyOrReject(req, res); if (!body) return;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    if (!loginAllowed(ip)) {
      send(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
      return;
    }
    const passHash = getPassHash();
    if (!passHash) { send(res, 503, { error: '管理员密码尚未配置' }); return; }
    if (hashEquals(sha(body.pass || ''), passHash)) {
      recordLoginAttempt(ip, true);
      const t = newToken();
      sessions.set(t, Date.now() + TTL);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieHeader(t) });
      res.end(JSON.stringify({ ok: true }));
    } else {
      recordLoginAttempt(ip, false);
      send(res, 401, { error: '密码错误' });
    }
    return;
  }
  if (p === '/admin/api/logout' && method === 'POST') {
    const t = parseCookies(req.headers.cookie || '')[COOKIE];
    if (t) sessions.delete(t);
    send(res, 200, { ok: true }, {
      'Set-Cookie': COOKIE + '=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    });
    return;
  }

  /* ---------- 公共：健康检查（部署脚本使用，无副作用，不写文件） ---------- */
  if ((p === '/api/ping' || p === '/api/healthz') && (method === 'GET' || method === 'HEAD')) {
    send(res, 200, { ok: true, ts: Date.now(), svc: "pvhot-admin" });
    return;
  }

  /* ---------- Public Agent API: read-only, anonymous, cache-friendly ---------- */
  if (p.startsWith('/api/v1/') && method === 'OPTIONS') {
    res.writeHead(204, {
      ...publicHeaders(),
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (p === '/api/v1/status' && (method === 'GET' || method === 'HEAD')) {
    const data = loadData();
    const items = Array.isArray(data.items) ? data.items : [];
    const today = todayKey();
    const todayItems = items.filter((item) => (item.dateKey || String(item.pubDate || '').slice(0, 10)) === today);
    const sources = new Set();
    const categories = new Set();
    for (const item of items) {
      const itemSources = Array.isArray(item.sources) ? item.sources : [];
      itemSources.forEach((source) => {
        const name = String(source?.name || source || '').trim();
        if (name) sources.add(name);
      });
      if (!itemSources.length && item.source) sources.add(String(item.source).trim());
      if (item.category) categories.add(String(item.category).trim());
    }
    const body = {
      status: 'ok',
      apiVersion: '1.1.0',
        updated: data.updated || data.meta?.updated || null,
      items: items.length,
      today: todayItems.length,
      featuredToday: todayItems.filter((item) => Boolean(item.featured)).length,
      sources: sources.size,
      categories: Array.from(categories).filter(Boolean).sort(),
    };
    if (method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...publicHeaders() });
      res.end();
      return;
    }
    send(res, 200, body, publicHeaders());
    return;
  }

  if (p === '/api/v1/news' && (method === 'GET' || method === 'HEAD')) {
    const result = queryPublicNews(url);
    const body = {
      apiVersion: '1.1.0',
      generatedAt: new Date().toISOString(),
        updated: result.data.updated || result.data.meta?.updated || null,
      total: result.total,
      count: result.items.length,
      filters: result.filters,
      items: result.items,
    };
    if (method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...publicHeaders() });
      res.end();
      return;
    }
    send(res, 200, body, publicHeaders());
    return;
  }

  if (p === '/api/v1/rss.xml' && (method === 'GET' || method === 'HEAD')) {
    const result = queryPublicNews(url, 50);
    const host = String(req.headers.host || 'pvhot.bbroot.com').replace(/[^\w.:-]/g, '');
    const origin = `https://${host}`;
    const selfUrl = `${origin}${url.pathname}${url.search}`;
    const itemXml = result.items.map((item) => {
      const published = item.pubDate && !Number.isNaN(new Date(item.pubDate).getTime())
        ? new Date(item.pubDate).toUTCString()
        : new Date().toUTCString();
      return [
        '<item>',
        `<title>${xmlEscape(item.title)}</title>`,
        `<link>${xmlEscape(item.link || origin)}</link>`,
        `<guid isPermaLink="false">${xmlEscape(item.id || item.link || item.title)}</guid>`,
        `<pubDate>${xmlEscape(published)}</pubDate>`,
        `<category>${xmlEscape(item.category || '光伏')}</category>`,
        `<source>${xmlEscape(item.source || 'PV HOT')}</source>`,
        `<description>${xmlEscape(item.summary || item.title)}</description>`,
        '</item>',
      ].join('');
    }).join('');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '<channel>',
      '<title>PV HOT 光伏情报</title>',
      `<link>${xmlEscape(origin)}</link>`,
      '<description>经过聚合、去重与 AI 提炼的光伏行业动态</description>',
      '<language>zh-CN</language>',
      `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
      `<atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml"/>`,
      itemXml,
      '</channel>',
      '</rss>',
    ].join('');
    res.writeHead(200, {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      ...publicHeaders(),
    });
    res.end(method === 'HEAD' ? '' : xml);
    return;
  }

  /* ---------- 公共：用户提交反馈（无需登录） ---------- */
  if (p === '/api/feedback' && method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!rateOk(ip)) { send(res, 429, { error: '请求过于频繁，1 分钟后再试' }); return; }
    const body = await getBodyOrReject(req, res); if (!body) return;
    const msg = (body.msg || '').toString().trim();
    if (!msg) { send(res, 400, { error: '内容不能为空' }); return; }
    if (msg.length > 4000) { send(res, 400, { error: '内容超过 4000 字' }); return; }
    const email = (body.email || '').toString().trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { send(res, 400, { error: '邮箱格式不对' }); return; }
    let list = [];
    try { list = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); if (!Array.isArray(list)) list = []; } catch (e) { list = []; }
    const item = {
      id: 'fb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      t: new Date().toISOString(),
      msg,
      email,
      page: (body.page || '').toString().slice(0, 200),
      ua: (body.ua || '').toString().slice(0, 200),
      ip: String(ip).slice(0, 60),
      read: false,
    };
    list.unshift(item);
    // 最多保留 1000 条
    if (list.length > 1000) list = list.slice(0, 1000);
    try { fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2)); } catch (e) { send(res, 500, { error: '写入失败' }); return; }
    console.log('[fb] from', ip, 'len', msg.length, 'email?', !!email);
    send(res, 200, { ok: true, id: item.id });
    return;
  }
  if (p === '/api/feedback' && method === 'GET') { send(res, 405, { error: 'GET not allowed' }); return; }

  /* ---------- 公共：访问统计上报（无需登录） ---------- */
  if (p === '/api/track' && method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '').slice(0, 60);
    const body = await getBodyOrReject(req, res); if (!body) return;
    const visitedPath = (body.path || '/').toString().slice(0, 120);
    const referrer = (body.ref || '').toString().slice(0, 200);
    // 不追踪 admin 页面和 API 请求
    if (!visitedPath.startsWith('/admin') && !visitedPath.startsWith('/api/')) {
      recordVisit(ip, visitedPath, referrer);
    }
    send(res, 200, { ok: true });
    return;
  }
  if (p === '/api/track' && method === 'GET') { send(res, 200, { ok: true }); return; }

  /* ---------- 公共：基本统计（今日PV/UV，无需登录） ---------- */
  if (p === '/api/stats' && method === 'GET') {
    const s = getStatsSummary();
    send(res, 200, { today: { pv: s.today.pv, uv: s.today.uv }, total: s.total });
    return;
  }

  /* ---------- 公共：二维码状态查询（无需登录，仅元数据） ---------- */
  if (p === '/admin/api/qrcode' && method === 'GET') {
    try {
      const st = fs.statSync(QRCODE_FILE);
      send(res, 200, { exists: true, size: st.size, mtime: st.mtimeMs, file: 'qrcode.png' });
    } catch (e) {
      send(res, 200, { exists: false });
    }
    return;
  }

  /* ---------- 鉴权：texts / feedback 管理 ---------- */
  if (!authed(req)) { send(res, 401, { error: '未登录' }); return; }

  if (p === '/admin/api/texts' && method === 'GET') {
    let t;
    try { t = JSON.parse(fs.readFileSync(TEXTS_FILE, 'utf8')); } catch (e) { t = null; }
    if (t?.agent) {
      try { t.agent.skill_md = fs.readFileSync(SKILL_FILE, 'utf8'); } catch (e) {}
    }
    send(res, 200, { texts: t, missing: !t });
    return;
  }

  if (p.startsWith('/admin/api/texts/') && method === 'PUT') {
    const seg = p.split('/').filter(Boolean); // ['admin','api','texts',':key']
    const key = decodeURIComponent(seg[3] || '');
    if (!['about','agent','changelog'].includes(key)) { send(res, 400, { error: '当前只允许编辑 about / agent / changelog' }); return; }
    const body = await getBodyOrReject(req, res); if (!body) return;
    let t;
    try { t = JSON.parse(fs.readFileSync(TEXTS_FILE, 'utf8')); } catch (e) { t = { about: {}, agent: {}, changelog: { items: [] } }; }
    t[key] = body.value !== undefined ? body.value : body;
    try { fs.writeFileSync(TEXTS_FILE, JSON.stringify(t, null, 2)); }
    catch (e) { send(res, 500, { error: '写入失败：' + e.message }); return; }
    // 同步重写 fallback（供 file:// 打开）
    try {
      const fb = '// 由 admin_server.js 同步自 site_texts.json\nwindow.SITE_TEXTS = ' + JSON.stringify(t, null, 2) + ';\n';
      fs.writeFileSync(path.join(ROOT, 'site_texts_fallback.js'), fb, 'utf8');
    } catch (e) {}
    // agent 保存时，若有 skill_md 则同步重写线上 SKILL.md（让其他 Agent 能装）
    if (key === 'agent' && body.value && typeof body.value.skill_md === 'string') {
      try {
        fs.mkdirSync(path.join(ROOT, 'pvhot-skill'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'pvhot-skill', 'SKILL.md'), body.value.skill_md, 'utf8');
      } catch (e) { /* 不影响主保存 */ }
    }
    send(res, 200, { ok: true, key });
    return;
  }

  if (p === '/admin/api/feedback' && method === 'GET') {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); if (!Array.isArray(list)) list = []; } catch (e) {}
    const unread = list.filter((x) => !x.read).length;
    send(res, 200, { total: list.length, unread, items: list });
    return;
  }

  if (p.startsWith('/admin/api/feedback/') && (method === 'PUT' || method === 'DELETE')) {
    const seg = p.split('/').filter(Boolean);
    const id = decodeURIComponent(seg[3] || '');
    let list = [];
    try { list = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); if (!Array.isArray(list)) list = []; } catch (e) {}
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) { send(res, 404, { error: 'not found' }); return; }
    if (method === 'DELETE') {
      list.splice(idx, 1);
      try { fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2)); } catch (e) { send(res, 500, { error: '写入失败' }); return; }
      send(res, 200, { ok: true, deleted: id });
      return;
    }
    // PUT: 标记已读 / 切换
    const body = await getBodyOrReject(req, res); if (!body) return;
    if (typeof body.read === 'boolean') list[idx].read = body.read;
    if (typeof body.note === 'string') list[idx].note = body.note.slice(0, 2000);
    try { fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2)); } catch (e) { send(res, 500, { error: '写入失败' }); return; }
    send(res, 200, { ok: true, item: list[idx] });
    return;
  }

  /* ---------- 二维码（POST 上传 / DELETE 删除，需登录） ---------- */
  if (p === '/admin/api/qrcode' && method === 'POST') {
    const body = await getBodyOrReject(req, res); if (!body) return;
    const data = (body.data || '').toString();
    const m = /^data:([\w\/+\-.]+);base64,(.+)$/i.exec(data);
    if (!m) { send(res, 400, { error: 'data 字段格式不对（应是 data:image/...;base64,XXX）' }); return; }
    const mime = m[1].toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) { send(res, 400, { error: '只支持 png/jpg/webp/gif' }); return; }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) { send(res, 400, { error: '内容为空' }); return; }
    if (buf.length > 3 * 1024 * 1024) { send(res, 400, { error: '图片不能超过 3MB' }); return; }
    try { fs.writeFileSync(QRCODE_FILE, buf); }
    catch (e) { send(res, 500, { error: '写入失败：' + e.message }); return; }
    const st = fs.statSync(QRCODE_FILE);
    send(res, 200, { ok: true, size: st.size, mtime: st.mtimeMs, file: 'qrcode.png' });
    return;
  }
  if (p === '/admin/api/qrcode' && method === 'DELETE') {
    try { fs.unlinkSync(QRCODE_FILE); send(res, 200, { ok: true, deleted: true }); }
    catch (e) { if (e.code === 'ENOENT') send(res, 200, { ok: true, deleted: false }); else send(res, 500, { error: '删除失败：' + e.message }); }
    return;
  }

  /* ---------- 统计面板（需登录） ---------- */
  if (p === '/admin/api/stats' && method === 'GET') {
    const summary = getStatsSummary();
    // 异步检查 RSSHub 健康（不阻塞响应）
    let sent = false;
    const done = (val) => { if (!sent) { sent = true; summary.rsshub = val; send(res, 200, summary); } };
    http.get('http://127.0.0.1:1200/', { timeout: 3000 }, (r) => {
      r.resume();
      r.on('end', () => done(r.statusCode < 500 ? 'ok' : 'err:' + r.statusCode));
    }).on('error', () => done('down')).on('timeout', function() { this.destroy(); done('timeout'); });
    return;
  }

  if (p === '/admin/api/status' && method === 'GET') {
    const sys = getSystemStatus();
    send(res, 200, sys);
    return;
  }

  // 列表（搜索 + 分类 + 分页）
  if (p === '/admin/api/items' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const cat = url.searchParams.get('cat') || '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('pageSize') || '20', 10)));
    const data = loadData();
    const allItems = data.items || [];
    const currentDate = todayKey();
    const overview = {
      total: allItems.length,
      today: allItems.filter((i) => (i.dateKey || String(i.pubDate || '').slice(0, 10)) === currentDate).length,
      featured: allItems.filter((i) => i.featured === true).length,
      images: allItems.filter((i) => !!i.image).length,
      sources: new Set(allItems.flatMap((i) => i.sources || [i.source]).filter(Boolean)).size,
      updated: data.meta && data.meta.updated || '',
    };
    let items = allItems;
    if (cat && cat !== '全部') items = items.filter((i) => i.category === cat);
    if (q) items = items.filter((i) => ((i.title_cn || i.title || '') + ' ' + (i.summary_cn || i.summary || '')).toLowerCase().includes(q));
    const total = items.length;
    const start = (page - 1) * pageSize;
    send(res, 200, { total, page, pageSize, overview, items: items.slice(start, start + pageSize) });
    return;
  }

  // 新增
  if (p === '/admin/api/items' && method === 'POST') {
    const body = await getBodyOrReject(req, res); if (!body) return;
    if (!body.title && !body.title_cn) { send(res, 400, { error: '标题必填' }); return; }
    const e = loadEdits();
    const iso = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19);
    const cat = body.category || '行情';
    const item = {
      id: 'pvman' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: body.title || '',
      title_cn: body.title_cn || body.title || '',
      link: body.link || '',
      summary: body.summary || '',
      summary_cn: body.summary_cn || body.summary || '',
      category: cat,
      lang: body.lang || 'zh',
      pubDate: iso,
      dateKey: iso.slice(0, 10),
      source: (body.source || '手动录入').toLowerCase().replace(/\s+/g, '-').slice(0, 24),
      sourceCount: 1,
      sources: [body.source || '手动录入'],
      heat: body.heat || 80,
      reason: body.reason || ('「' + cat + '」方向手动录入。'),
      tags: body.tags || [cat],
      pubTime: iso.slice(11, 16),
      retweetCount: Math.round((body.heat || 80) * 0.32),
      user: { name: body.source || '手动录入', handle: (body.source || 'manual').toLowerCase().replace(/\s+/g, '_').slice(0, 20), color: '#1d6f8b' },
      related: [],
      featured: !!body.featured,
    };
    e.added = e.added || [];
    e.added.push(item);
    saveEdits(e);
    runMerge();
    send(res, 200, { ok: true, item });
    return;
  }

  // /admin/api/items/:id[/feature]
  const seg = p.split('/').filter(Boolean);
  if (seg[0] === 'admin' && seg[1] === 'api' && seg[2] === 'items' && seg.length >= 4) {
    const id = decodeURIComponent(seg[3]);

    // 单条详情
    if (seg.length === 4 && method === 'GET') {
      const item = (loadData().items || []).find((i) => i.id === id);
      send(res, item ? 200 : 404, item || { error: 'not found' });
      return;
    }
    // 编辑（覆盖部分字段）
    if (seg.length === 4 && method === 'PUT') {
      const body = await getBodyOrReject(req, res); if (!body) return;
      const cur = (loadData().items || []).find((i) => i.id === id);
      if (!cur) { send(res, 404, { error: '原数据无此条' }); return; }
      const e = loadEdits();
      const ov = Object.assign({}, e.overrides[id] || {});
      ['title_cn', 'title', 'summary_cn', 'summary', 'reason', 'category', 'featured', 'link', 'tags'].forEach((k) => {
        if (k in body) ov[k] = body[k];
      });
      e.overrides[id] = ov;
      saveEdits(e);
      runMerge();
      send(res, 200, { ok: true });
      return;
    }
    // 删除
    if (seg.length === 4 && method === 'DELETE') {
      const e = loadEdits();
      if (!e.deleted.includes(id)) e.deleted.push(id);
      delete e.overrides[id];
      saveEdits(e);
      runMerge();
      send(res, 200, { ok: true });
      return;
    }
    // 标记精选
    if (seg.length === 5 && seg[4] === 'feature' && method === 'POST') {
      const body = await getBodyOrReject(req, res); if (!body) return;
      const e = loadEdits();
      const ov = Object.assign({}, e.overrides[id] || {});
      ov.featured = !!body.featured;
      e.overrides[id] = ov;
      saveEdits(e);
      runMerge();
      send(res, 200, { ok: true });
      return;
    }
  }

  // 触发抓取（异步，立即返回，稍后看日志）
  if (p === '/admin/api/refresh' && method === 'POST') {
    if (refreshJob) {
      send(res, 409, { error: '抓取任务正在运行，请勿重复触发', startedAt: refreshStartedAt });
      return;
    }
    send(res, 200, { ok: true, msg: '已触发抓取，稍后点「查看日志」刷新' });
    refreshStartedAt = new Date().toISOString();
    refreshJob = spawn(NODE, [path.join(ROOT, 'fetch_pv_news.js')], { cwd: ROOT });
    refreshJob.on('error', (e) => {
      console.error('[admin] refresh error', e);
      refreshJob = null;
      refreshStartedAt = null;
    });
    refreshJob.on('close', () => {
      try { merge(); } catch (e) {}
      refreshJob = null;
      refreshStartedAt = null;
    });
    return;
  }

  // 抓取日志
  if (p === '/admin/api/log' && method === 'GET') {
    try {
      const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-200);
      send(res, 200, { lines });
    } catch (e) { send(res, 200, { lines: [] }); }
    return;
  }

  send(res, 404, { error: 'unknown' });
});

server.listen(PORT, HOST, () => console.log('[admin] Pvhot admin on http://' + HOST + ':' + PORT));
