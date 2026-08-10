#!/usr/bin/env node
'use strict';
// 光伏 HOT 后台系统：管理 data.json 内容（增/删/改/标记精选/手动添加/触发抓取）
// 监听 127.0.0.1:8777，由 nginx /admin/ 反代。读写 admin_edits.json 后自动跑 merge.js。
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { merge } = require('./merge.js');
const {
  atomicWriteBufferSync,
  atomicWriteJsonSync,
  atomicWriteUtf8Sync,
} = require('./lib/safe_io');
const {
  CustomSourceError,
  addCustomSource,
  buildGoogleNewsSiteQuery,
  loadCustomSources,
  normalizeSourceInput,
  removeCustomSource,
  updateCustomSource,
} = require('./lib/custom_sources');
const { parseRss, probeRss } = require('./lib/safe_remote_fetch');
const { probeXAccount, validXApiToken } = require('./lib/x_sources');
const { buildHealthEntry, normalizeStatus, summarizeHealth } = require('./lib/source_health');
const { withProcessLockSync } = require('./lib/process_lock');
const {
  AiConfigError,
  loadAiConfig,
  normalizeAiConfig,
  publicAiConfig,
  resolveAiConfigPath,
  saveAiConfig,
} = require('./lib/ai_config');
const { loadUsage, testAiConnection } = require('./lib/ai_editor');
const { buildSourceCatalog } = require('./lib/source_catalog');
const {
  TOPIC_QUERIES,
  CURATED_SEARCH_QUERIES,
  RSS_FEEDS,
  SCRAPE_SOURCES,
  X_ACCOUNTS,
  WECHAT_ACCOUNTS,
} = require('./source_registry');

const ROOT = process.env.PVHOT_ROOT || '/var/www/pvhot';
const IS_CURRENT_RELEASE = path.basename(path.resolve(ROOT)) === 'current';
const HAS_SHARED_ROOT = Boolean(process.env.PVHOT_SHARED_DIR);
const SHARED_ROOT = process.env.PVHOT_SHARED_DIR
  || (IS_CURRENT_RELEASE ? path.join(path.dirname(ROOT), 'shared') : ROOT);
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
const CUSTOM_SOURCES_FILE = process.env.PVHOT_CUSTOM_SOURCES_FILE
  || (IS_CURRENT_RELEASE || HAS_SHARED_ROOT
    ? path.join(SHARED_ROOT, 'data', 'custom_sources.json')
    : path.join(ROOT, 'custom_sources.json'));
const AI_CONFIG_FILE = process.env.PVHOT_AI_CONFIG_FILE
  || resolveAiConfigPath(ROOT, SHARED_ROOT);
const AI_USAGE_FILE = process.env.PVHOT_AI_USAGE_FILE
  || (IS_CURRENT_RELEASE || HAS_SHARED_ROOT
    ? path.join(SHARED_ROOT, 'data', 'ai_usage.json')
    : path.join(ROOT, 'ai_usage.json'));
const ADMIN_TASK_RUNTIME_DIR = process.env.PVHOT_TASK_RUNTIME_DIR
  || (IS_CURRENT_RELEASE || HAS_SHARED_ROOT
    ? path.join(SHARED_ROOT, 'runtime', 'admin')
    : path.join(ROOT, '.runtime', 'admin'));
const SOURCE_HEALTH_LOCK_OPTIONS = {
  root: ROOT,
  name: 'pvhot-source-health-write',
  timeoutMs: Number(process.env.PVHOT_SOURCE_HEALTH_LOCK_TIMEOUT_MS || 30_000),
  staleMs: Number(process.env.PVHOT_SOURCE_HEALTH_LOCK_STALE_MS || 15 * 60_000),
};
const TRUSTED_PROXY_IPS = new Set(
  String(process.env.PVHOT_TRUSTED_PROXY_IPS || '127.0.0.1,::1')
    .split(',').map((value) => value.trim()).filter(Boolean)
);
const STATS_SALT = String(process.env.PVHOT_STATS_SALT || `pvhot:${ROOT}:stats`);
// 允许 3MB 图片经过 base64 膨胀后的 JSON 请求，同时拦截异常大请求。
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BODY_BYTES = 32 * 1024;
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

/* ---------------- 访问统计 ---------------- */
function todayKey() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch (e) { return { days: {}, total: { pv: 0, uv: 0, ips: [] } }; }
}
function saveStats(s) {
  try { atomicWriteJsonSync(STATS_FILE, s); }
  catch (e) { console.error('[stats] save error', e); }
}
function requestIp(req) {
  const peer = String(req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  if (!TRUSTED_PROXY_IPS.has(peer)) return peer;
  return String(req.headers['x-forwarded-for'] || peer).split(',')[0].trim().replace(/^::ffff:/, '') || peer;
}
function privacyId(value) {
  return crypto.createHmac('sha256', STATS_SALT).update(String(value || 'unknown')).digest('hex');
}
function recordVisit(ip, path, referrer) {
  const visitorId = privacyId(ip);
  const s = loadStats();
  const dk = todayKey();
  if (!s.days[dk]) s.days[dk] = { pv: 0, uv: 0, ips: [], paths: {}, refs: {} };
  const d = s.days[dk];
  d.pv++;
  if (!d.ips.includes(visitorId)) { d.ips.push(visitorId); d.uv = d.ips.length; }
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
  if (!s.total.ips.includes(visitorId)) { s.total.ips.push(visitorId); s.total.uv = s.total.ips.length; }
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
    const d = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
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
  status.refreshLastResult = refreshLastResult;
  return status;
}

function getPublicHealth() {
  const now = Date.now();
  let data = null;
  let dataStat = null;
  let dataError = null;
  try {
    data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    dataStat = fs.statSync(DATA);
    if (!data || !Array.isArray(data.items)) throw new TypeError('data.items must be an array');
  } catch (error) {
    dataError = error.message;
  }

  let release = {};
  try {
    release = JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8'));
  } catch (error) {}

  const dataAgeSeconds = dataStat
    ? Math.max(0, Math.round((now - dataStat.mtimeMs) / 1000))
    : null;
  return {
    ok: !dataError,
    status: dataError ? 'unhealthy' : (dataAgeSeconds > 2 * 3600 ? 'degraded' : 'ok'),
    service: 'pvhot-admin',
    release: release.gitSha || release.sha || process.env.PVHOT_RELEASE_SHA || 'unversioned',
    startedAt: new Date(now - process.uptime() * 1000).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    data: {
      items: data && data.items.length || 0,
      updatedAt: data && (data.updated || data.meta?.updated) || null,
      fileModifiedAt: dataStat ? dataStat.mtime.toISOString() : null,
      ageSeconds: dataAgeSeconds,
      fresh: dataAgeSeconds !== null && dataAgeSeconds <= 2 * 3600,
    },
    error: dataError,
    checkedAt: new Date(now).toISOString(),
  };
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
const INVALID_JSON_BODY = Symbol('invalid-json-body');
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(Buffer.from(c));
    });
    req.on('end', () => {
      if (tooLarge) return resolve(null);
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { resolve(INVALID_JSON_BODY); }
    });
  });
}
async function getBodyOrReject(req, res) {
  const body = await readBody(req);
  if (body === null) { send(res, 413, { error: '请求内容过大' }); return null; }
  if (body === INVALID_JSON_BODY) { send(res, 400, { error: '内容格式不正确，请重新提交' }); return null; }
  return body;
}

function hasUnreadableCharacters(value) {
  const text = value == null ? '' : String(value);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\u0080-\u009F]/.test(text)) return true;
  if (/锟斤拷|\?{7,}|(?:Ã.|Â.|â€|ï¿½|ðŸ)/.test(text)) return true;
  return /(?:[åæçäèé][\u00A0-\u00FF]{2}){2,}/.test(text);
}

function validateEditableString(value, label, maxLength, allowMarkup = false) {
  if (typeof value !== 'string') return `${label}格式不正确`;
  if (value.length > maxLength) return `${label}内容过长`;
  if (hasUnreadableCharacters(value)) {
    return `${label}包含无法识别的字符，请重新输入`;
  }
  if (allowMarkup && (/<\s*(script|style|iframe|object|embed|svg|math|form|input|button)\b/i.test(value)
    || /\bon\w+\s*=/i.test(value) || /javascript\s*:/i.test(value))) {
    return `${label}包含不安全的格式`;
  }
  return null;
}

function validateEditableTextPayload(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '提交内容格式不正确';
  const checkFields = (fields) => {
    for (const [name, label, maxLength, allowMarkup] of fields) {
      const error = validateEditableString(value[name] == null ? '' : value[name], label, maxLength, allowMarkup);
      if (error) return error;
    }
    return null;
  };
  if (key === 'about') {
    const fieldError = checkFields([
      ['eyebrow','页面小标题',60,false], ['title_html','主标题',500,true], ['sub','一句话介绍',300,false],
      ['fineprint_html','版权与联系说明',1200,true],
    ]);
    if (fieldError) return fieldError;
    if (!Array.isArray(value.poem) || value.poem.length > 12) return '核心介绍格式不正确';
    for (const line of value.poem) {
      const error = validateEditableString(line, '核心介绍', 400, true);
      if (error) return error;
    }
  }
  if (key === 'agent') {
    const fieldError = checkFields([
      ['eyebrow','页面小标题',60,false], ['title_html','主标题',500,true], ['sub_html','页面说明',1200,true],
      ['verify_q','示例问题',400,false], ['note_html','接入说明',1200,true], ['skill_md','接入配置',250000,false],
    ]);
    if (fieldError) return fieldError;
  }
  if (key === 'changelog') {
    if (!Array.isArray(value.items) || value.items.length > 500) return '更新日志格式不正确';
    for (const item of value.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return '更新记录格式不正确';
      for (const [name, label, maxLength] of [
        ['ver','版本标识',40], ['date','发布日期',20], ['time','发布时间',10], ['type','更新类型',30],
        ['title','更新标题',160], ['text','更新说明',1200],
      ]) {
        const error = validateEditableString(item[name] == null ? '' : item[name], label, maxLength, false);
        if (error) return error;
      }
      if (item.bullets != null) {
        if (!Array.isArray(item.bullets) || item.bullets.length > 20) return '具体改动格式不正确';
        for (const line of item.bullets) {
          const error = validateEditableString(line, '具体改动', 500, false);
          if (error) return error;
        }
      }
    }
  }
  return null;
}

function readStrictJson(req, limit = MAX_SOURCE_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ error: 'too_large' });
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({ error: 'invalid_json' });
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return resolve({ error: 'invalid_json' });
        }
        return resolve({ value });
      } catch (error) {
        return resolve({ error: 'invalid_json' });
      }
    });
    req.on('error', () => resolve({ error: 'read_error' }));
  });
}

async function getSourceBodyOrReject(req, res) {
  const result = await readStrictJson(req);
  if (result.error === 'too_large') {
    send(res, 413, { error: '信源设置内容过大' });
    return null;
  }
  if (result.error) {
    send(res, 400, { error: '请求内容不是有效的 JSON' });
    return null;
  }
  return result.value;
}

function mutationOriginAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const expectedHost = forwardedHost || String(req.headers.host || '').trim();
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === expectedHost;
  } catch (error) {
    return false;
  }
}

function customSourceErrorResponse(res, error) {
  const code = error && error.code;
  if (code === 'SOURCE_NOT_FOUND') {
    send(res, 404, { error: '没有找到这个自定义信源', code });
    return;
  }
  if (['DUPLICATE_URL', 'DUPLICATE_ID', 'DUPLICATE_NAME', 'SOURCE_LIMIT'].includes(code)) {
    send(res, 409, { error: code === 'SOURCE_LIMIT' ? '自定义信源已达到 100 个上限' : '这个信源已经添加过了', code });
    return;
  }
  if (error instanceof CustomSourceError) {
    const friendlyMessages = {
      INVALID_SOURCE: '提交内容格式不正确，请刷新页面后重试',
      UNSUPPORTED_FIELD: '提交内容包含不支持的项目，请刷新页面后重试',
      INVALID_FIELD: '请检查信源名称和关键词，不能留空、过长或包含乱码',
      INVALID_KEYWORDS: '关键词格式不正确，请用逗号分隔',
      TOO_MANY_KEYWORDS: '关键词最多填写 20 个',
      INVALID_SOURCE_TYPE: '请选择支持的信源类型',
      INVALID_CATEGORY: '请选择列表中的行业分类',
      INVALID_SOURCE_URL: '网站地址无效，请填写公开的 HTTPS 地址',
      INVALID_X_HANDLE: 'X 账号格式不正确，请填写公开账号名',
      INVALID_X_URL: 'X 地址无效，请填写账号主页，不要填写单条帖子',
      INVALID_STALE_WINDOW: '长期未更新的判断时间设置不正确',
      WECHAT_KEYWORDS_REQUIRED: '公众号至少需要填写一个名称或关键词',
      WECHAT_URL_NOT_ALLOWED: '公众号请填写名称和关键词，不需要填写网址',
    };
    const internalCodes = new Set([
      'INVALID_REGISTRY', 'INVALID_REGISTRY_JSON', 'INVALID_STORED_SOURCE',
      'INVALID_TIMESTAMP', 'NON_CANONICAL_SOURCE', 'REGISTRY_READ_FAILED', 'UNSUPPORTED_SCHEMA',
    ]);
    const status = internalCodes.has(code) ? 500 : 400;
    const message = internalCodes.has(code)
      ? '信源数据暂时无法读取，请联系维护人员处理'
      : (friendlyMessages[code] || '信源设置不符合要求，请检查后重试');
    send(res, status, { error: message, code: code || 'INVALID_SOURCE' });
    return;
  }
  console.error('[sources] error', error);
  send(res, 500, { error: '信源设置保存失败，请稍后重试' });
}

function aiConfigErrorResponse(res, error) {
  if (error instanceof AiConfigError) {
    send(res, 400, { error: error.message, code: error.code || 'INVALID_AI_CONFIG' });
    return;
  }
  const message = String(error && error.message || 'AI 服务暂时不可用')
    .replace(/(?:sk|key|token)-[A-Za-z0-9_-]{6,}/gi, '[已隐藏]')
    .slice(0, 220);
  send(res, 502, { error: message || 'AI 服务暂时不可用', code: 'AI_CONNECTION_FAILED' });
}

function loadSourceHealthReport() {
  try {
    const report = JSON.parse(fs.readFileSync(SOURCE_HEALTH_FILE, 'utf8'));
    return report && typeof report === 'object' ? report : { sources: [] };
  } catch (error) {
    return { schemaVersion: 2, checkedAt: null, sources: [] };
  }
}

function xApiConfigured() {
  return validXApiToken(process.env.PVHOT_X_BEARER_TOKEN);
}

function sourceHealthPayload() {
  const catalog = buildSourceCatalog();
  const channelById = new Map(catalog.channels.map((channel) => [channel.id, channel]));
  const report = loadSourceHealthReport();
  let customRegistry;
  let configError = null;
  try {
    customRegistry = loadCustomSources(CUSTOM_SOURCES_FILE);
  } catch (error) {
    configError = '自定义信源配置文件损坏或无法读取，请检查服务器日志';
    console.error('[sources] registry read error', error);
    customRegistry = { revision: 0, updatedAt: null, sources: [] };
  }
  const customById = new Map(customRegistry.sources.map((source) => [source.id, source]));
  const seen = new Set();
  const sources = (Array.isArray(report.sources) ? report.sources : []).map((source) => {
    const custom = customById.get(source.id);
    seen.add(source.id);
    return {
      ...source,
      status: normalizeStatus(source.status) || 'parse_error',
      itemsSeen: source.itemsSeen == null ? Number(source.items) || 0 : source.itemsSeen,
      todayItems: source.todayItems == null ? null : source.todayItems,
      latestPublishedAt: source.latestPublishedAt || source.lastItemAt || null,
      lastCheckedAt: source.lastCheckedAt || source.checkedAt || null,
      reasonCode: source.reasonCode || source.errorCode || null,
      ...(custom || {}),
      custom: !!custom || source.custom === true,
      origin: custom ? 'custom' : (source.origin || 'built-in'),
      enabled: custom ? custom.enabled : source.enabled !== false,
    };
  });
  const healthLabels = {
    'pv-magazine': 'PV Magazine',
    'pv-tech': 'PV Tech',
    cleantechnica: 'CleanTechnica',
    solarquarter: 'SolarQuarter',
    solarbe: '索比光伏网',
    'bjx-guangfu': '北极星太阳能光伏网',
    ne21: '世纪新能源网',
    'nea-renewable': '国家能源局',
    cpia: '中国光伏行业协会',
  };
  const builtInSources = [
    ...[...TOPIC_QUERIES, ...CURATED_SEARCH_QUERIES].map((source) => ({
      id: source.id,
      name: source.label || source.name
        || (String(source.id || '').startsWith('topic-')
          ? (source.cat === 'ALL' ? '全行业主题搜索' : `${source.cat || '行业'}主题搜索`)
          : source.id),
      kind: 'google-news',
      type: 'google-news',
      tier: source.tier || 2,
      category: source.cat || 'ALL',
    })),
    ...RSS_FEEDS.map((source) => ({
      id: source.id,
      name: healthLabels[source.id] || source.source || source.name || source.id,
      kind: 'rss',
      type: 'rss',
      tier: source.tier || 2,
      category: source.cat || 'ALL',
    })),
    ...SCRAPE_SOURCES.map((source) => ({
      id: source.id,
      name: healthLabels[source.id] || source.source || source.name || source.id,
      kind: 'scrape',
      type: 'website',
      tier: source.tier || 2,
      category: source.cat || 'ALL',
    })),
    ...X_ACCOUNTS.map((source) => ({
      id: source.id,
      name: source.name,
      handle: source.handle,
      url: `https://x.com/${source.handle}`,
      kind: 'x',
      type: 'x',
      tier: source.tier || 1,
      category: source.cat || 'ALL',
      staleAfterHours: source.staleAfterHours || 168,
      domains: Array.isArray(source.domains) ? source.domains : [],
    })),
    ...WECHAT_ACCOUNTS.map((source) => ({
      id: `wechat:${source.name}`,
      name: source.name,
      kind: 'wechat',
      type: 'wechat',
      tier: source.tier || 2,
      category: 'ALL',
    })),
  ];
  for (const source of builtInSources) {
    if (seen.has(source.id)) {
      const existing = sources.find((item) => item.id === source.id);
      if (existing && existing.custom !== true) {
        existing.name = source.name;
        existing.kind = source.kind;
        existing.type = source.type;
        if (source.type === 'x' && !xApiConfigured() && Array.isArray(source.domains) && source.domains.length) {
          existing.monitorMode = 'search-indirect';
          if (existing.reasonCode === 'X_API_NOT_CONFIGURED' || existing.errorCode === 'x_api_not_configured') {
            existing.status = 'no_new';
            existing.errorCode = null;
            existing.reasonCode = null;
            existing.detail = '无 Token 间接监控已启用，等待下一轮搜索官网文章线索';
          }
        }
      }
      continue;
    }
    seen.add(source.id);
    const awaitingXApi = source.type === 'x';
    const indirectX = awaitingXApi && !xApiConfigured() && Array.isArray(source.domains) && source.domains.length > 0;
    const missingXApi = awaitingXApi && !xApiConfigured() && !indirectX;
    sources.push({
      ...source,
      status: missingXApi ? 'blocked' : 'pending',
      items: 0,
      itemsSeen: 0,
      todayItems: null,
      newItems: 0,
      checkedAt: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastNewAt: null,
      lastItemAt: null,
      latestPublishedAt: null,
      consecutiveFailures: 0,
      consecutiveNoNew: 0,
      errorCode: missingXApi ? 'X_API_NOT_CONFIGURED' : null,
      reasonCode: missingXApi ? 'X_API_NOT_CONFIGURED' : null,
      detail: missingXApi
        ? '服务器尚未配置 X 官方 API，账号已登记并等待配置'
        : (indirectX
          ? '无 Token 间接监控已启用，等待下一轮搜索官网文章线索'
          : (awaitingXApi ? '等待正式抓取任务首次检查 X 账号' : '等待首次健康检查')),
      monitorMode: indirectX ? 'search-indirect' : (awaitingXApi ? 'official-api' : null),
      custom: false,
      origin: 'built-in',
      enabled: true,
    });
  }
  for (const source of customRegistry.sources) {
    if (seen.has(source.id)) continue;
    const missingXApi = source.type === 'x' && !xApiConfigured();
    sources.push({
      ...source,
      kind: source.type === 'website' ? 'google-news' : source.type,
      status: missingXApi ? 'blocked' : 'pending',
      items: 0,
      itemsSeen: 0,
      todayItems: null,
      newItems: 0,
      checkedAt: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastNewAt: null,
      lastItemAt: null,
      latestPublishedAt: null,
      consecutiveFailures: 0,
      consecutiveNoNew: 0,
      errorCode: missingXApi ? 'X_API_NOT_CONFIGURED' : null,
      reasonCode: missingXApi ? 'X_API_NOT_CONFIGURED' : null,
      detail: source.enabled
        ? (missingXApi
          ? '服务器尚未配置 X 官方 API，账号已保存并等待配置'
          : (source.type === 'x' ? '已保存，等待正式抓取任务检查 X 账号' : '已保存，等待下一轮抓取'))
        : '当前已停用',
      custom: true,
      origin: 'custom',
    });
  }
  const counts = summarizeHealth(sources);
  for (const source of sources) {
    const channel = channelById.get(source.id);
    if (!channel) continue;
    source.publisherId = channel.publisherId;
    source.channelMode = channel.mode;
  }
  return {
    schemaVersion: 2,
    checkedAt: report.checkedAt || null,
    registryVersion: report.registryVersion || null,
    customRevision: customRegistry.revision || 0,
    integrations: { xApiConfigured: xApiConfigured(), xIndirectEnabled: true },
    catalog: {
      publisherCount: catalog.publishers.length,
      channelCount: catalog.channels.length,
      discoveryRuleCount: catalog.discoveryRules.length,
    },
    configError,
    summary: {
      checked: counts.checked,
      total: counts.total,
      normal: counts.normal,
      noNew: counts.no_new,
      blocked: counts.blocked,
      parseError: counts.parse_error,
      stale: counts.stale,
      pending: counts.pending,
      healthy: counts.healthy,
      issues: counts.issues,
    },
    sources,
  };
}

function fixedHttpsText(url, timeoutMs = 12000, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const request = https.get(url, {
      headers: {
        'User-Agent': 'PVHOT-Source-Monitor/1.0 (+https://pvhot.bbroot.com)',
        'Accept': 'application/rss+xml,application/xml,text/xml',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        reject(Object.assign(new Error('unexpected redirect'), { code: 'GOOGLE_REDIRECT', statusCode: response.statusCode }));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' }));
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    request.on('error', reject);
  });
}

async function probeCustomSource(sourceOrInput) {
  const source = normalizeSourceInput({
    name: sourceOrInput.name,
    type: sourceOrInput.type,
    url: sourceOrInput.url,
    keywords: sourceOrInput.keywords,
    category: sourceOrInput.category,
    enabled: sourceOrInput.enabled,
    staleAfterHours: sourceOrInput.staleAfterHours,
  });
  if (source.type === 'wechat') {
    return {
      ok: true,
      status: 'no_new',
      reasonCode: 'WAITING_FOR_WECHAT_ROTATION',
      detail: '公众号已通过名称校验，保存后会进入轮询队列',
      items: [],
    };
  }
  if (source.type === 'x') {
    return probeXAccount(xHandleFromSource(source), {
      token: process.env.PVHOT_X_BEARER_TOKEN || '',
      timeoutMs: 8000,
    });
  }
  if (source.type === 'website') {
    const query = buildGoogleNewsSiteQuery(source);
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(`(${query}) when:7d`)
      + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';
    try {
      const result = await fixedHttpsText(url);
      const blocked = [401, 403, 407, 429, 451].includes(result.statusCode);
      let items = [];
      let parseError = null;
      if (!blocked && result.statusCode === 200) {
        try {
          items = parseRss(result.text, url, { maxItems: 30 });
        } catch (error) {
          parseError = error;
        }
      }
      const count = items.length;
      const validEnvelope = /<(?:rss|feed|rdf:RDF)\b/i.test(result.text.slice(0, 4096));
      const parsed = !parseError && validEnvelope;
      return {
        ok: !blocked && result.statusCode === 200 && parsed,
        status: blocked ? 'blocked' : (parsed ? (count ? 'normal' : 'no_new') : 'parse_error'),
        reasonCode: blocked
          ? `HTTP_${result.statusCode}`
          : (parsed ? 'GOOGLE_NEWS_READY' : (parseError ? 'INVALID_RSS' : `HTTP_${result.statusCode || 'NO_ITEMS'}`)),
        detail: blocked
          ? 'Google News 暂时限制了查询'
          : (parsed
              ? (count ? `定向监控可用，最近识别到 ${count} 条结果` : '定向监控可用，最近 7 天暂无结果')
              : '暂时无法解析 Google News 定向监控结果'),
        httpStatus: result.statusCode,
        durationMs: result.durationMs,
        items,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'parse_error',
        reasonCode: error.code || 'GOOGLE_NEWS_ERROR',
        detail: '暂时无法验证 Google News 定向监控',
        items: [],
      };
    }
  }
  return probeRss(source.url, { maxItems: 30 });
}

function normalizedAccountKey(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
    .replace(/[\s·\-—_（）()｜|]/g, '');
}

function duplicatesBuiltInWechat(source) {
  if (!source || source.type !== 'wechat') return false;
  const candidate = normalizedAccountKey(source.name);
  return WECHAT_ACCOUNTS.some((account) =>
    [account.name, ...(account.aliases || [])]
      .map(normalizedAccountKey)
      .some((existing) => candidate && candidate === existing)
  );
}

function xHandleFromSource(source) {
  if (!source || source.type !== 'x' || !source.url) return '';
  try {
    return decodeURIComponent(new URL(source.url).pathname.split('/').filter(Boolean)[0] || '')
      .toLowerCase();
  } catch (error) {
    return '';
  }
}

function duplicatesBuiltInX(source) {
  const candidate = xHandleFromSource(source);
  return !!candidate && X_ACCOUNTS.some((account) =>
    String(account.handle || '').toLowerCase() === candidate
  );
}

function builtInSourceConflict(source) {
  if (duplicatesBuiltInWechat(source)) return '这个公众号已经在内置信源名单中';
  if (duplicatesBuiltInX(source)) return '这个 X 账号已经在内置权威信源名单中';
  return '';
}

const sourceProbeRate = new Map();
let sourceProbeBusy = false;
const aiTestRate = new Map();
let aiTestBusy = false;
function sourceProbeAllowed(req) {
  const ip = requestIp(req);
  const now = Date.now();
  const recent = (sourceProbeRate.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 5) {
    sourceProbeRate.set(ip, recent);
    return false;
  }
  recent.push(now);
  sourceProbeRate.set(ip, recent);
  return true;
}

function aiTestAllowed(req) {
  const ip = requestIp(req);
  const now = Date.now();
  const recent = (aiTestRate.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 3) {
    aiTestRate.set(ip, recent);
    return false;
  }
  recent.push(now);
  aiTestRate.set(ip, recent);
  return true;
}

function probeDiagnostics(probe) {
  const status = probe && probe.status;
  return {
    blocked: status === 'blocked',
    parseError: status === 'parse_failed' || status === 'parse_error',
    httpStatus: probe && probe.httpStatus,
    durationMs: probe && probe.durationMs,
    errorCode: probe && probe.ok ? null : (probe && probe.reasonCode),
    detail: probe && probe.detail,
  };
}

function persistCustomProbeUnlocked(source, probe) {
  const report = loadSourceHealthReport();
  const sources = Array.isArray(report.sources) ? report.sources.slice() : [];
  const index = sources.findIndex((item) => item.id === source.id);
  const previous = index >= 0 ? sources[index] : null;
  const next = {
    ...buildHealthEntry(
      { ...source, kind: source.type === 'website' ? 'google-news' : source.type },
      probe.items || [],
      previous,
      probeDiagnostics(probe),
      new Date()
    ),
    ...source,
    custom: true,
    origin: 'custom',
  };
  if (index >= 0) sources[index] = next;
  else sources.push(next);
  const summary = summarizeHealth(sources);
  const nextReport = {
    ...report,
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    summary: { ...summary, wechatCachedItems: Number(report.summary && report.summary.wechatCachedItems) || 0 },
    sources,
  };
  atomicWriteJsonSync(SOURCE_HEALTH_FILE, nextReport, {
    space: 2,
    trailingNewline: true,
    validate: (value) => value && Array.isArray(value.sources),
  });
  return next;
}

function persistCustomProbe(source, probe) {
  return withProcessLockSync(SOURCE_HEALTH_LOCK_OPTIONS, () => {
    // A source may be deleted while its network probe is in flight. Re-read
    // the registry while holding the health-file lock so a late response
    // cannot recreate a deleted source's health row.
    const registry = loadCustomSources(CUSTOM_SOURCES_FILE);
    const registered = registry.sources.find((item) => item.id === source.id);
    if (!registered) {
      throw new CustomSourceError('SOURCE_NOT_FOUND', 'custom source no longer exists');
    }
    return persistCustomProbeUnlocked(registered, probe);
  });
}

function removeCustomHealthUnlocked(id) {
  const report = loadSourceHealthReport();
  const sources = (Array.isArray(report.sources) ? report.sources : [])
    .filter((source) => source.id !== id);
  const summary = summarizeHealth(sources);
  atomicWriteJsonSync(SOURCE_HEALTH_FILE, {
    ...report,
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    summary: { ...summary, wechatCachedItems: Number(report.summary && report.summary.wechatCachedItems) || 0 },
    sources,
  }, {
    space: 2,
    trailingNewline: true,
    validate: (value) => value && Array.isArray(value.sources),
  });
}

function removeCustomHealth(id) {
  return withProcessLockSync(
    SOURCE_HEALTH_LOCK_OPTIONS,
    () => removeCustomHealthUnlocked(id)
  );
}

async function runRateLimitedSourceProbe(req, res, source) {
  if (!sourceProbeAllowed(req)) {
    send(res, 429, { error: '检测太频繁，请 1 分钟后再试' });
    return null;
  }
  if (sourceProbeBusy) {
    send(res, 409, { error: '已有一个信源正在检测，请稍后再试' });
    return null;
  }
  sourceProbeBusy = true;
  try {
    return await probeCustomSource(source);
  } finally {
    sourceProbeBusy = false;
  }
}
function loadEdits() {
  try { return JSON.parse(fs.readFileSync(EDITS, 'utf8')); } catch (e) { return { deleted: [], overrides: {}, added: [] }; }
}
function saveEdits(e) { atomicWriteJsonSync(EDITS, e, { space: 2, trailingNewline: true }); }
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
let refreshLastResult = null;

function runNodeTask(filename, options = {}) {
  return new Promise((resolve, reject) => {
    const taskHome = path.join(ADMIN_TASK_RUNTIME_DIR, 'home');
    const taskCache = path.join(ADMIN_TASK_RUNTIME_DIR, 'cache');
    fs.mkdirSync(taskHome, { recursive: true });
    fs.mkdirSync(taskCache, { recursive: true });
    const child = spawn(NODE, [path.join(ROOT, filename)], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: taskHome,
        XDG_CACHE_HOME: taskCache,
        PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pvhot/chrome/chrome',
        PVHOT_WECHAT_LOCK_TIMEOUT_MS: process.env.PVHOT_WECHAT_LOCK_TIMEOUT_MS || '120000',
        PVHOT_NEWS_LOCK_TIMEOUT_MS: process.env.PVHOT_NEWS_LOCK_TIMEOUT_MS || '120000',
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${filename} exited with ${signal || code}`);
      error.code = 'ECHILDTASK';
      reject(error);
    });
  }).catch((error) => {
    if (options.allowFailure) {
      console.error(`[admin] ${filename} failed; continuing`, error.message);
      return;
    }
    throw error;
  });
}

async function runRefreshPipeline() {
  const startedAt = refreshStartedAt || new Date().toISOString();
  try {
    await runNodeTask('fetch_wechat.js', { allowFailure: true });
    await runNodeTask('fetch_pv_news.js');
    merge();
    refreshLastResult = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[admin] refresh pipeline error', error);
    refreshLastResult = {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: '抓取未完整完成，请查看运行日志',
    };
  } finally {
    refreshJob = null;
    refreshStartedAt = null;
  }
}

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
    const ip = requestIp(req);
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
  if (p === '/api/ping' && (method === 'GET' || method === 'HEAD')) {
    if (method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(res, 200, { ok: true, ts: Date.now(), service: 'pvhot-admin' }, { 'Cache-Control': 'no-store' });
    return;
  }
  if (p === '/api/healthz' && (method === 'GET' || method === 'HEAD')) {
    const health = getPublicHealth();
    const statusCode = health.ok ? 200 : 503;
    if (method === 'HEAD') {
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(res, statusCode, health, { 'Cache-Control': 'no-store' });
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
    const ip = requestIp(req);
    if (!rateOk(ip)) { send(res, 429, { error: '请求过于频繁，1 分钟后再试' }); return; }
    const body = await getBodyOrReject(req, res); if (!body) return;
    const msg = (body.msg || '').toString().trim();
    if (!msg) { send(res, 400, { error: '内容不能为空' }); return; }
    if (msg.length > 4000) { send(res, 400, { error: '内容超过 4000 字' }); return; }
    if (hasUnreadableCharacters(msg)) { send(res, 400, { error: '内容包含无法识别的字符，请重新输入' }); return; }
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
      ipHash: privacyId(ip),
      read: false,
    };
    list.unshift(item);
    // 最多保留 1000 条
    if (list.length > 1000) list = list.slice(0, 1000);
    try { atomicWriteJsonSync(FEEDBACK_FILE, list, { space: 2, trailingNewline: true }); }
    catch (e) { send(res, 500, { error: '写入失败' }); return; }
    console.log('[fb] received len', msg.length, 'email?', !!email);
    send(res, 200, { ok: true, id: item.id });
    return;
  }
  if (p === '/api/feedback' && method === 'GET') { send(res, 405, { error: 'GET not allowed' }); return; }

  /* ---------- 公共：访问统计上报（无需登录） ---------- */
  if (p === '/api/track' && method === 'POST') {
    const ip = requestIp(req);
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

  /* ---------- 信源健康与自定义信源（需登录） ---------- */
  if (p === '/admin/api/ai-config' && method === 'GET') {
    try {
      const config = loadAiConfig(AI_CONFIG_FILE);
      send(res, 200, {
        ...publicAiConfig(config),
        usage: loadUsage(AI_USAGE_FILE),
      });
    } catch (error) {
      aiConfigErrorResponse(res, error);
    }
    return;
  }

  if (p.startsWith('/admin/api/ai-config') && method !== 'GET' && !mutationOriginAllowed(req)) {
    send(res, 403, { error: '请求来源校验失败，请刷新后台页面后重试' });
    return;
  }

  if (p === '/admin/api/ai-config' && method === 'PUT') {
    const body = await getBodyOrReject(req, res); if (!body) return;
    try {
      const config = saveAiConfig(AI_CONFIG_FILE, body);
      send(res, 200, {
        ok: true,
        config: publicAiConfig(config),
        usage: loadUsage(AI_USAGE_FILE),
        message: config.enabled
          ? 'AI 编辑已启用，将从下一轮新闻抓取开始生效'
          : 'AI 编辑配置已保存，目前保持关闭',
      });
    } catch (error) {
      aiConfigErrorResponse(res, error);
    }
    return;
  }

  if (p === '/admin/api/ai-config/test' && method === 'POST') {
    const body = await getBodyOrReject(req, res); if (!body) return;
    if (!aiTestAllowed(req)) {
      send(res, 429, { error: '测试太频繁，请 1 分钟后再试，避免产生额外费用' });
      return;
    }
    if (aiTestBusy) {
      send(res, 409, { error: '已有一个 AI 连接测试正在进行，请稍后再试' });
      return;
    }
    aiTestBusy = true;
    try {
      const current = loadAiConfig(AI_CONFIG_FILE);
      const draft = normalizeAiConfig(body, current);
      const result = await testAiConnection(draft);
      send(res, 200, result);
    } catch (error) {
      aiConfigErrorResponse(res, error);
    } finally {
      aiTestBusy = false;
    }
    return;
  }

  if (p === '/admin/api/source-health' && method === 'GET') {
    send(res, 200, sourceHealthPayload());
    return;
  }

  if (p === '/admin/api/sources' && method === 'GET') {
    try {
      const registry = loadCustomSources(CUSTOM_SOURCES_FILE);
      send(res, 200, registry);
    } catch (error) {
      customSourceErrorResponse(res, error);
    }
    return;
  }

  if (p.startsWith('/admin/api/sources') && method !== 'GET' && !mutationOriginAllowed(req)) {
    send(res, 403, { error: '请求来源校验失败，请刷新后台页面后重试' });
    return;
  }

  if (p === '/admin/api/sources/probe' && method === 'POST') {
    const body = await getSourceBodyOrReject(req, res); if (!body) return;
    try {
      const normalized = normalizeSourceInput(body);
      const conflict = builtInSourceConflict(normalized);
      if (conflict) {
        send(res, 409, { error: conflict });
        return;
      }
      const probe = await runRateLimitedSourceProbe(req, res, normalized);
      if (!probe) return;
      send(res, 200, { ok: probe.ok, source: normalized, probe });
    } catch (error) {
      customSourceErrorResponse(res, error);
    }
    return;
  }

  if (p === '/admin/api/sources' && method === 'POST') {
    const body = await getSourceBodyOrReject(req, res); if (!body) return;
    try {
      const shouldProbe = body.probe !== false;
      const sourceInput = { ...body };
      delete sourceInput.probe;
      const normalized = normalizeSourceInput(sourceInput);
      const conflict = builtInSourceConflict(normalized);
      if (conflict) {
        send(res, 409, { error: conflict });
        return;
      }
      const probe = shouldProbe
        ? await runRateLimitedSourceProbe(req, res, normalized)
        : {
            ok: true,
            status: 'no_new',
            reasonCode: 'SAVED_WITHOUT_PROBE',
            detail: normalized.enabled ? '已保存，等待下一轮抓取' : '信源已保存并停用',
            items: [],
          };
      if (!probe) return;
      if (shouldProbe && normalized.type === 'rss' && !probe.ok) {
        send(res, 422, { error: probe.detail || 'RSS 地址暂时无法读取', probe });
        return;
      }
      const { source, registry } = addCustomSource(CUSTOM_SOURCES_FILE, normalized);
      let health = null;
      try { health = persistCustomProbe(source, probe); } catch (error) {
        console.error('[sources] health write error', error);
      }
      send(res, 201, {
        ok: true,
        source,
        probe,
        health,
        revision: registry.revision,
        message: source.type === 'wechat'
          ? '已加入公众号轮询队列'
          : (source.type === 'x'
            ? (xApiConfigured()
              ? '已加入 X 官方 API 监控队列'
              : 'X 账号已保存；自定义账号需配置官方 API 后才能直接抓取')
            : '已保存，将在下一轮抓取中持续监控'),
      });
    } catch (error) {
      customSourceErrorResponse(res, error);
    }
    return;
  }

  const sourceMatch = p.match(/^\/admin\/api\/sources\/([^/]+)(?:\/(check|test))?$/);
  if (sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1] || '');
    const action = sourceMatch[2] || '';
    if ((action === 'check' || action === 'test') && method === 'POST') {
      try {
        const registry = loadCustomSources(CUSTOM_SOURCES_FILE);
        const source = registry.sources.find((item) => item.id === id);
        if (!source) {
          send(res, 404, { error: '没有找到这个自定义信源' });
          return;
        }
        const probe = await runRateLimitedSourceProbe(req, res, source);
        if (!probe) return;
        const health = persistCustomProbe(source, probe);
        send(res, 200, { ok: probe.ok, source, probe, health });
      } catch (error) {
        customSourceErrorResponse(res, error);
      }
      return;
    }
    if (!action && method === 'PUT') {
      const body = await getSourceBodyOrReject(req, res); if (!body) return;
      try {
        const registry = loadCustomSources(CUSTOM_SOURCES_FILE);
        const current = registry.sources.find((item) => item.id === id);
        if (!current) {
          send(res, 404, { error: '没有找到这个自定义信源' });
          return;
        }
        const normalized = normalizeSourceInput({
          name: current.name,
          type: current.type,
          url: current.url,
          keywords: current.keywords,
          category: current.category,
          enabled: current.enabled,
          staleAfterHours: current.staleAfterHours,
          ...body,
        });
        const conflict = builtInSourceConflict(normalized);
        if (conflict) {
          send(res, 409, { error: conflict });
          return;
        }
        let probe = {
          ok: true,
          status: normalized.enabled ? 'no_new' : 'no_new',
          reasonCode: normalized.enabled ? 'SETTINGS_UPDATED' : 'SOURCE_DISABLED',
          detail: normalized.enabled ? '设置已更新，等待下一轮抓取' : '信源已停用',
          items: [],
        };
        const connectionChanged = normalized.type !== current.type || normalized.url !== current.url;
        if (normalized.enabled && connectionChanged) {
          probe = await runRateLimitedSourceProbe(req, res, normalized);
          if (!probe) return;
          if (normalized.type === 'rss' && !probe.ok) {
            send(res, 422, { error: probe.detail || 'RSS 地址暂时无法读取', probe });
            return;
          }
        }
        const result = updateCustomSource(CUSTOM_SOURCES_FILE, id, body);
        const health = persistCustomProbe(result.source, probe);
        send(res, 200, { ok: true, source: result.source, probe, health, revision: result.registry.revision });
      } catch (error) {
        customSourceErrorResponse(res, error);
      }
      return;
    }
    if (!action && method === 'DELETE') {
      try {
        const result = removeCustomSource(CUSTOM_SOURCES_FILE, id);
        try { removeCustomHealth(id); } catch (error) {
          console.error('[sources] health cleanup error', error);
        }
        send(res, 200, { ok: true, deleted: result.source, revision: result.registry.revision });
      } catch (error) {
        customSourceErrorResponse(res, error);
      }
      return;
    }
  }

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
    const nextValue = body.value !== undefined ? body.value : body;
    const validationError = validateEditableTextPayload(key, nextValue);
    if (validationError) { send(res, 400, { error: validationError }); return; }
    t[key] = nextValue;
    try { atomicWriteJsonSync(TEXTS_FILE, t, { space: 2, trailingNewline: true }); }
    catch (e) { send(res, 500, { error: '写入失败：' + e.message }); return; }
    // 同步重写 fallback（供 file:// 打开）
    try {
      const fb = '// 由 admin_server.js 同步自 site_texts.json\nwindow.SITE_TEXTS = ' + JSON.stringify(t, null, 2) + ';\n';
      atomicWriteUtf8Sync(path.join(ROOT, 'site_texts_fallback.js'), fb);
    } catch (e) {}
    // agent 保存时，若有 skill_md 则同步重写线上 SKILL.md（让其他 Agent 能装）
    if (key === 'agent' && body.value && typeof body.value.skill_md === 'string') {
      try {
        fs.mkdirSync(path.join(ROOT, 'pvhot-skill'), { recursive: true });
        atomicWriteUtf8Sync(path.join(ROOT, 'pvhot-skill', 'SKILL.md'), body.value.skill_md);
      } catch (e) { /* 不影响主保存 */ }
    }
    send(res, 200, { ok: true, key });
    return;
  }

  if (p === '/admin/api/feedback-summary' && method === 'GET') {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); if (!Array.isArray(list)) list = []; } catch (e) {}
    send(res, 200, { total:list.length, unread:list.filter((item) => !item.read).length });
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
      try { atomicWriteJsonSync(FEEDBACK_FILE, list, { space: 2, trailingNewline: true }); }
      catch (e) { send(res, 500, { error: '写入失败' }); return; }
      send(res, 200, { ok: true, deleted: id });
      return;
    }
    // PUT: 标记已读 / 切换
    const body = await getBodyOrReject(req, res); if (!body) return;
    if (typeof body.read === 'boolean') list[idx].read = body.read;
    if (typeof body.note === 'string') list[idx].note = body.note.slice(0, 2000);
    try { atomicWriteJsonSync(FEEDBACK_FILE, list, { space: 2, trailingNewline: true }); }
    catch (e) { send(res, 500, { error: '写入失败' }); return; }
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
    if (mime !== 'image/png') { send(res, 400, { error: '请选择 PNG 图片' }); return; }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) { send(res, 400, { error: '内容为空' }); return; }
    if (buf.length > 2 * 1024 * 1024) { send(res, 400, { error: '图片不能超过 2MB' }); return; }
    const pngSignature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    if (buf.length < pngSignature.length || !buf.subarray(0, pngSignature.length).equals(pngSignature)) {
      send(res, 400, { error: '图片内容不是有效的 PNG 文件' }); return;
    }
    try { atomicWriteBufferSync(QRCODE_FILE, buf); }
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
    send(res, 200, getStatsSummary());
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

  // 触发完整抓取（公众号 → 网站/RSS → 合并），异步执行并立即返回。
  if (p === '/admin/api/refresh' && method === 'POST') {
    if (refreshJob) {
      send(res, 409, { error: '抓取任务正在运行，请勿重复触发', startedAt: refreshStartedAt });
      return;
    }
    refreshStartedAt = new Date().toISOString();
    refreshLastResult = {
      ok: null,
      startedAt: refreshStartedAt,
      finishedAt: null,
    };
    refreshJob = runRefreshPipeline();
    send(res, 202, {
      ok: true,
      startedAt: refreshStartedAt,
      msg: '已触发完整抓取：公众号、网站、RSS 会依次更新',
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
