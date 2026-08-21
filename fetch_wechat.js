/**
 * fetch_wechat.js — Puppeteer 抓取微信搜狗搜索结果
 * 通过 weixin.sogou.com 搜索"光伏"等关键词，提取公众号文章
 * 需要 Puppeteer + Chromium（已安装在服务器上）
 * 
 * 用法: node fetch_wechat.js
 * 输出: 写入 /var/www/pvhot/wechat_items.json（供 fetch_pv_news.js 合并）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJsonSync } = require('./lib/safe_io');
const { withProcessLock } = require('./lib/process_lock');
const {
  clearWechatRunFailure,
  writeWechatRunFailure,
  writeWechatRunStart,
} = require('./lib/wechat_run_status');
const { loadCustomSources } = require('./lib/custom_sources');
const {
  REGISTRY_VERSION,
  WECHAT_ACCOUNTS,
  WECHAT_TOPIC_QUERIES,
} = require('./source_registry');

const ROOT = process.env.PVHOT_ROOT || '/var/www/pvhot';
const IS_CURRENT_RELEASE = path.basename(path.resolve(ROOT)) === 'current';
const HAS_SHARED_ROOT = Boolean(process.env.PVHOT_SHARED_DIR);
const SHARED_ROOT = process.env.PVHOT_SHARED_DIR
  || (IS_CURRENT_RELEASE ? path.join(path.dirname(ROOT), 'shared') : ROOT);
const WECHAT_RUN_STATUS_DIR = process.env.PVHOT_WECHAT_RUN_STATUS_DIR
  || (IS_CURRENT_RELEASE || HAS_SHARED_ROOT
    ? path.join(SHARED_ROOT, 'run')
    : path.join(ROOT, '.runtime'));
const MAX_PER_QUERY = 12;
const WECHAT_LINK_RESOLVE_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(30_000, Number(process.env.PVHOT_WECHAT_LINK_RESOLVE_TIMEOUT_MS || 15_000)),
);
const WECHAT_LINK_RESOLVE_WAIT_MS = Math.max(
  0,
  Math.min(3_000, Number(process.env.PVHOT_WECHAT_LINK_RESOLVE_WAIT_MS || 750)),
);
const WECHAT_LINK_RESOLVE_LIMIT = Math.max(
  1,
  Math.min(MAX_PER_QUERY, Number(process.env.PVHOT_WECHAT_LINK_RESOLVE_LIMIT || 4)),
);
const WECHAT_GATEWAY_HEALTH_MAX_AGE_MS = Math.max(
  60 * 60_000,
  Math.min(24 * 60 * 60_000, Number(process.env.PVHOT_WECHAT_GATEWAY_HEALTH_MAX_AGE_MS || 8 * 60 * 60_000)),
);
const OUTPUT_PATH = `${ROOT}/wechat_items.json`;
const GATEWAY_OUTPUT_PATH = process.env.PVHOT_WECHAT_GATEWAY_ITEMS_FILE
  || path.join(ROOT, 'wechat_gateway_items.json');
const ENABLE_WECHAT_GATEWAY = process.env.PVHOT_ENABLE_WECHAT_GATEWAY === '1';
const CUSTOM_SOURCES_FILE = process.env.PVHOT_CUSTOM_SOURCES_FILE
  || (IS_CURRENT_RELEASE || HAS_SHARED_ROOT
    ? path.join(SHARED_ROOT, 'data', 'custom_sources.json')
    : path.join(ROOT, 'custom_sources.json'));
const FRESH_DAYS = 7;
const WECHAT_LOCK_OPTIONS = {
  root: ROOT,
  name: 'pvhot-wechat-fetch',
  timeoutMs: Number(process.env.PVHOT_WECHAT_LOCK_TIMEOUT_MS || 30_000),
  staleMs: Number(process.env.PVHOT_WECHAT_LOCK_STALE_MS || 45 * 60_000),
};
const ACCOUNT_BATCH_SIZE = Math.max(1, Math.min(16, Number(process.env.PVHOT_WECHAT_ACCOUNT_BATCH || 8)));
const CUSTOM_ACCOUNT_BATCH_SIZE = Math.max(1, Math.min(16, Number(process.env.PVHOT_WECHAT_CUSTOM_ACCOUNT_BATCH || 8)));
const TOPIC_BATCH_SIZE = Math.max(1, Math.min(WECHAT_TOPIC_QUERIES.length, Number(process.env.PVHOT_WECHAT_TOPIC_BATCH || 4)));
const MAX_ACCOUNT_SEARCH_TERMS = Math.max(1, Math.min(4, Number(process.env.PVHOT_WECHAT_ACCOUNT_TERMS || 3)));
let MONITORED_WECHAT_ACCOUNTS = WECHAT_ACCOUNTS;

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/admin/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeWechatLink(link) {
  const raw = String(link || '').trim();
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of ['scene', 'clicktime', 'isappinstalled', 'from', 'chksm', 'clicktag', 'source']) {
      url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch (error) {
    return raw;
  }
}

function decodeUrlText(value) {
  let current = String(value || '')
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&#x26;/gi, '&');
  const decoded = [current];
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (!next || next === current) break;
      decoded.push(next);
      current = next;
    } catch {
      break;
    }
  }
  return decoded;
}

/**
 * Only mp.weixin.qq.com article URLs are valid output links. Profiles, Sogou
 * discovery URLs and verification pages are deliberately rejected.
 */
function normalizeOfficialWechatLink(value) {
  const raw = String(value || '').trim().replace(/&amp;/gi, '&');
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'mp.weixin.qq.com'
      || url.port
      || url.username
      || url.password
    ) return '';

    const shortId = url.pathname.match(/^\/s\/([^/]+)\/?$/);
    const legacyArticle = url.pathname === '/s'
      && url.searchParams.has('__biz')
      && url.searchParams.has('mid')
      && url.searchParams.has('sn');
    if ((!shortId || !shortId[1]) && !legacyArticle) return '';
    return normalizeWechatLink(url.toString());
  } catch {
    return '';
  }
}

function extractOfficialWechatLink(values) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const candidate of candidates) {
    for (const decoded of decodeUrlText(candidate)) {
      const direct = normalizeOfficialWechatLink(decoded);
      if (direct) return direct;
      const matches = decoded.match(/(?:https?:)?\/\/mp\.weixin\.qq\.com\/s(?:\/[^\s"'<>\\]+|\?[^\s"'<>\\]+)/ig) || [];
      for (const match of matches) {
        const nested = normalizeOfficialWechatLink(match);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function normalizeSogouDiscoveryLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'weixin.sogou.com'
      || url.pathname !== '/link'
      || !url.searchParams.has('url')
    ) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isWechatVerificationUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.hostname.toLowerCase() !== 'weixin.sogou.com') return false;
    return /\/(?:antispider|verify|captcha)(?:\/|$)/i.test(url.pathname)
      || /(?:antispider|verify|captcha)/i.test(url.searchParams.get('from') || '');
  } catch {
    return false;
  }
}

async function readWechatNavigationPage(page) {
  let currentUrl = '';
  let title = '';
  let metadata = {};
  try { currentUrl = String(page.url() || ''); } catch {}
  try { title = String(await page.title() || ''); } catch {}
  try {
    metadata = await page.evaluate(() => ({
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      ogUrl: document.querySelector('meta[property="og:url"]')?.content || '',
      itemUrl: document.querySelector('meta[itemprop="url"]')?.content || '',
      bodyText: (document.body?.innerText || '').slice(0, 500),
    })) || {};
  } catch {}
  return { currentUrl, title, ...metadata };
}

/**
 * Follow a Sogou result once through a normal browser navigation. This does
 * not solve or work around verification. If Sogou requests verification we
 * return `captcha`, so the caller can stop resolving further results.
 */
async function resolveWechatArticleLink(values, page, options = {}) {
  const candidates = Array.isArray(values) ? values : [values];
  const embeddedOfficial = extractOfficialWechatLink(candidates);
  if (embeddedOfficial) {
    return { link: embeddedOfficial, status: 'official', discoveryUrl: '' };
  }

  const discoveryUrl = candidates.map(normalizeSogouDiscoveryLink).find(Boolean) || '';
  if (!discoveryUrl || !page || typeof page.goto !== 'function') {
    return { link: '', status: 'invalid', discoveryUrl };
  }

  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(discoveryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Number(options.timeoutMs ?? WECHAT_LINK_RESOLVE_TIMEOUT_MS),
      ...(options.referer ? { referer: options.referer } : {}),
    });
  } catch (error) {
    navigationError = error;
  }

  const waitMs = Number(options.waitMs ?? WECHAT_LINK_RESOLVE_WAIT_MS);
  if (waitMs > 0) await sleep(waitMs);

  const redirectCandidates = [];
  try { redirectCandidates.push(response?.url?.()); } catch {}
  try {
    const chain = response?.request?.().redirectChain?.() || [];
    for (const request of chain) {
      redirectCandidates.push(request.url?.());
      redirectCandidates.push(request.response?.()?.headers?.().location);
    }
  } catch {}
  const pageState = await readWechatNavigationPage(page);
  redirectCandidates.push(pageState.currentUrl, pageState.canonical, pageState.ogUrl, pageState.itemUrl);
  const resolved = extractOfficialWechatLink(redirectCandidates);
  if (resolved) return { link: resolved, status: 'resolved', discoveryUrl };

  const blockedText = `${pageState.title}\n${pageState.bodyText || ''}`;
  const blocked = redirectCandidates.some(isWechatVerificationUrl)
    || /(?:请输入验证码|访问(?:过于|过度)?频繁|访问频率过高|异常访问|captcha|antispider)/i.test(blockedText);
  return {
    link: '',
    status: blocked ? 'captcha' : 'unresolved',
    discoveryUrl,
    error: navigationError ? navigationError.message : '',
  };
}

function normalizeOfficialWechatItem(item) {
  if (!item || typeof item !== 'object') return null;
  const link = extractOfficialWechatLink([item.link, item.links?.original]);
  if (!link) return null;
  const sources = Array.isArray(item.sources)
    ? item.sources.map((source) => ({ ...source, link }))
    : item.sources;
  return {
    ...item,
    link,
    ...(sources ? { sources } : {}),
    ...(item.links ? { links: { ...item.links, original: link } } : {}),
  };
}

function extractItemId(link) {
  return 'pv' + crypto.createHash('sha1').update(normalizeWechatLink(link)).digest('hex').slice(0, 14);
}

function normalizeAccountName(value) {
  return (value || '').toLowerCase().replace(/[\s·\-—_（）()｜|]/g, '');
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    const key = normalizeAccountName(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function expandAccountAliases(account) {
  const base = [account && account.name, ...((account && account.aliases) || [])];
  const expanded = [];
  for (const value of base) {
    const text = String(value || '').trim();
    if (!text) continue;
    expanded.push(text);
    const chineseParts = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const englishParts = text.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) || [];
    expanded.push(...chineseParts, ...englishParts);
  }
  return uniqueNonEmpty(expanded);
}

function findMonitoredAccount(value) {
  const actual = normalizeAccountName(value);
  if (!actual) return null;
  return MONITORED_WECHAT_ACCOUNTS.find((account) =>
    expandAccountAliases(account)
      .map(normalizeAccountName)
      .some((alias) => actual.includes(alias) || alias.includes(actual))
  ) || null;
}

function isRegistryAccount(value) {
  return !!findMonitoredAccount(value);
}

/** Parse sogou's messy date format into ISO date string */
function parseSogouDate(raw) {
  if (!raw) return null;
  const now = new Date();

  // Pattern 1: document.write(timeConvert('1234567890'))54分钟前
  let m = raw.match(/timeConvert\('(\d+)'\)/);
  if (m) {
    const ts = parseInt(m[1]);
    const d = new Date(ts * 1000);
    return d.toISOString();
  }

  // Pattern 2: relative time "N分钟前"
  m = raw.match(/(\d+)\s*分钟前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 60000).toISOString();
  }

  // Pattern 3: relative time "N小时前"
  m = raw.match(/(\d+)\s*小时前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 3600000).toISOString();
  }

  // Pattern 4: relative time "N天前"
  m = raw.match(/(\d+)\s*天前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 86400000).toISOString();
  }

  // Pattern 5: "昨天"
  if (raw.includes('昨天')) {
    return new Date(now.getTime() - 86400000).toISOString();
  }

  // Pattern 6: "前天"
  if (raw.includes('前天')) {
    return new Date(now.getTime() - 2 * 86400000).toISOString();
  }

  // Pattern 7: absolute date "2026-7-24" or "2026/7/24"
  m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T08:00:00Z`);
    return d.toISOString();
  }

  return null;
}

function isFresh(pubDateStr) {
  if (!pubDateStr) return false;
  const d = new Date(pubDateStr);
  if (isNaN(d.getTime())) return false;
  const ageDays = (Date.now() - d.getTime()) / 86400000;
  return ageDays <= FRESH_DAYS;
}

function loadGatewayItems(filePath = GATEWAY_OUTPUT_PATH) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || !Array.isArray(value.items)) {
      return { items: [], health: [], provider: '', enabled: false, fetchedAt: '' };
    }
    return {
      items: value.items
        .map(normalizeOfficialWechatItem)
        .filter((item) => item && isFresh(item.pubDate)),
      health: Array.isArray(value.health) ? value.health : [],
      provider: String(value.provider || ''),
      enabled: value.enabled === true,
      fetchedAt: String(value.fetchedAt || ''),
    };
  } catch {
    return { items: [], health: [], provider: '', enabled: false, fetchedAt: '' };
  }
}

function isFreshGatewayHealthEntry(
  entry,
  gatewayFetchedAt,
  nowMs = Date.now(),
  maxAgeMs = WECHAT_GATEWAY_HEALTH_MAX_AGE_MS,
) {
  const entryTimestamp = Date.parse(String(entry && entry.lastPolledAt || ''));
  const snapshotTimestamp = Date.parse(String(gatewayFetchedAt || ''));
  const checkedAt = Number.isFinite(entryTimestamp) ? entryTimestamp : snapshotTimestamp;
  const current = Number(nowMs);
  const maximumAge = Number(maxAgeMs);
  return Number.isFinite(checkedAt)
    && Number.isFinite(current)
    && Number.isFinite(maximumAge)
    && checkedAt <= current + 5 * 60_000
    && current - checkedAt <= maximumAge;
}

async function searchWechat(keyword, page, targetAccount = null) {
  const now = new Date();
  // 搜狗默认会优先返回多年以前的高热文章；加入年份（月度主题再加月份）可显著提高近期命中率。
  const searchTerm = targetAccount
    ? `${keyword} ${now.getFullYear()}`
    : `${keyword} ${now.getFullYear()} ${now.getMonth() + 1}月`;
  const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(searchTerm)}&ie=utf8`;
  console.log(`[wechat] searching: ${searchTerm}${targetAccount ? ` [account:${targetAccount.name}]` : ''} -> ${url}`);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Check if we hit a verification/captcha page
  const pageTitle = await page.title();
  if (
    isWechatVerificationUrl(page.url())
    || pageTitle.includes('验证')
    || pageTitle.includes('verify')
    || pageTitle.includes('captcha')
  ) {
    console.log(`[wechat] captcha detected for "${keyword}", skipping`);
    return {
      items: [],
      rawCount: 0,
      accountMatchCount: 0,
      linkCandidateCount: 0,
      linkUnresolvedCount: 0,
      captchaCount: 1,
      status: 'captcha',
    };
  }

  // Extract article entries - evaluate in browser context
  const rawItems = await page.evaluate(() => {
    const results = [];
    // Sogou weixin search uses .news-list li as article containers
    const cards = document.querySelectorAll('.news-list li, .news-box .news-list li');
    
    cards.forEach((card) => {
      try {
        // Title + link
        const titleEl = card.querySelector('h3 a, h4 a, .tit a');
        const title = titleEl ? titleEl.textContent.trim().replace(/\s+/g, ' ') : '';
        const link = titleEl ? titleEl.href : '';
        const linkCandidates = titleEl ? [
          link,
          titleEl.getAttribute('href') || '',
          titleEl.getAttribute('data-url') || '',
          titleEl.getAttribute('data-href') || '',
          titleEl.getAttribute('data-link') || '',
          titleEl.getAttribute('data-share-url') || '',
          ...Array.from(card.querySelectorAll('a[href*="mp.weixin.qq.com"]')).map((anchor) => anchor.href),
        ].filter(Boolean) : [];

        // Summary (exclude .s-p which contains account name + date, not summary)
        const summaryEl = card.querySelector('.txt-info, p.txt-info');
        const summary = summaryEl ? summaryEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : '';

        // Account name — Sogou WeChat uses .all-time-y2 inside .s-p
        const accountEl = card.querySelector('.s-p .all-time-y2, .all-time-y2');
        let account = accountEl ? accountEl.textContent.trim().replace(/\s+/g, ' ') : '';
        // Fallback: parse from .s-p text (format: "AccountName2021-2-22" or "AccountName3小时前")
        if (!account) {
          const sp = card.querySelector('.s-p');
          if (sp) {
            const spText = sp.textContent.trim().replace(/\s+/g, ' ');
            // Account name is before the date/time portion
            const m = spText.match(/^(.+?)(?=\d{4}[-/]\d|\d+\s*(?:分钟|小时|天)前|昨天|前天)/);
            if (m && m[1].trim() && m[1].trim().length < 30) account = m[1].trim();
          }
        }
        
        // Avatar: try account-specific avatar first, then article thumbnail
        let avatar = '';
        const avatarImg = card.querySelector('.account-box img, .account img, img.account, img.avatar, .account-wrap img, .wx-news-box img:first-child, .img-box img');
        if (avatarImg && avatarImg.src) {
          avatar = avatarImg.src;
        }

        // Date: sogou uses script tags with timeConvert
        const allText = card.textContent;
        // Also try to get the raw HTML for date parsing
        const scriptMatch = allText.match(/timeConvert\('(\d+)'\)/);
        const relativeMatch = allText.match(/(\d+(?:分钟|小时|天)前|昨天|前天)/);
        const absDateMatch = allText.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);

        let rawDate = '';
        if (scriptMatch) rawDate = `timeConvert('${scriptMatch[1]}')`;
        else if (relativeMatch) rawDate = relativeMatch[1];
        else if (absDateMatch) rawDate = absDateMatch[1];

        if (title && linkCandidates.length) {
          results.push({ title, link, linkCandidates, summary, account, avatar, rawDate });
        }
      } catch (e) {}
    });

    return results;
  });

  // Parse dates and filter fresh
  const items = [];
  let accountMatchCount = 0;
  let linkCandidateCount = 0;
  let linkUnresolvedCount = 0;
  let captchaCount = 0;
  for (const raw of rawItems) {
    if (targetAccount) {
      const actual = normalizeAccountName(raw.account);
      const aliases = expandAccountAliases(targetAccount).map(normalizeAccountName);
      if (!actual || !aliases.some((alias) => actual.includes(alias) || alias.includes(actual))) continue;
    } else if (!isRegistryAccount(raw.account)) {
      // Topic searches can contain many unrelated accounts. Do not spend
      // Sogou redirect requests on results that cannot be emitted anyway.
      continue;
    }
    accountMatchCount += 1;
    const pubDate = parseSogouDate(raw.rawDate);
    if (!isFresh(pubDate)) {
      console.log(`[wechat] skip old: ${raw.title.slice(0, 40)} (date: ${raw.rawDate})`);
      continue;
    }
    if (linkCandidateCount >= WECHAT_LINK_RESOLVE_LIMIT) break;
    linkCandidateCount += 1;
    const resolved = await resolveWechatArticleLink(raw.linkCandidates || [raw.link], page, {
      referer: url,
    });
    if (!resolved.link) {
      if (resolved.status === 'captcha') {
        captchaCount += 1;
        console.log(`[wechat] verification reached while resolving "${raw.title.slice(0, 40)}"; stopping link resolution`);
        break;
      }
      linkUnresolvedCount += 1;
      console.log(`[wechat] skip unresolved original: ${raw.title.slice(0, 40)} (${resolved.status})`);
      continue;
    }
    items.push({
      title: raw.title,
      link: resolved.link,
      summary: raw.summary,
      account: raw.account || '微信公众号',
      avatar: raw.avatar || '',
      pubDate: pubDate
    });
    if (items.length >= MAX_PER_QUERY) break;
  }

  console.log(`[wechat] "${keyword}": ${rawItems.length} raw -> ${linkCandidateCount} link candidates -> ${items.length} official`);
  return {
    items,
    rawCount: rawItems.length,
    accountMatchCount,
    linkCandidateCount,
    linkUnresolvedCount,
    captchaCount,
    status: captchaCount
      ? 'captcha'
      : (items.length ? 'ok' : (linkCandidateCount ? 'link_unresolved' : 'empty')),
  };
}

function accountSearchTerms(account) {
  const aliases = expandAccountAliases(account);
  const first = aliases.find((term) => /[\u4e00-\u9fa5]/.test(term) && !/[A-Za-z]/.test(term));
  return uniqueNonEmpty([
    first,
    ...aliases,
  ]).slice(0, MAX_ACCOUNT_SEARCH_TERMS);
}

function selectCustomAccountsForRun(customAccounts, hourSlot) {
  if (!customAccounts.length) return [];
  const now = Date.now();
  const recent = customAccounts.filter((account) => {
    const stamp = Date.parse(account.createdAt || account.updatedAt || '');
    return Number.isFinite(stamp) && now - stamp <= 24 * 3600_000;
  });
  const start = (hourSlot * CUSTOM_ACCOUNT_BATCH_SIZE) % customAccounts.length;
  const rotating = Array.from({
    length: Math.min(CUSTOM_ACCOUNT_BATCH_SIZE, customAccounts.length),
  }, (_, i) => customAccounts[(start + i) % customAccounts.length]);
  const byId = new Map();
  for (const account of [...recent, ...rotating]) {
    if (byId.size >= CUSTOM_ACCOUNT_BATCH_SIZE) break;
    byId.set(account.id || account.name, account);
  }
  return [...byId.values()];
}

function appendGlobalWechatBlockHealth(health, accounts, checkedAt = new Date().toISOString()) {
  const target = Array.isArray(health) ? health : [];
  const recordedAccounts = new Set(
    target
      .filter((entry) => String(entry && entry.id || '').startsWith('account:'))
      .map((entry) => String(entry && entry.name || '').trim())
  );
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account || recordedAccounts.has(account.name)) continue;
    target.push({
      id: `account:${account.name}`,
      name: account.name,
      kind: account.kind || '公众号',
      tier: account.tier || 2,
      status: 'captcha',
      raw: 0,
      rawSearchCount: 0,
      accountMatchCount: 0,
      linkCandidateCount: 0,
      linkUnresolvedCount: 0,
      captchaCount: 1,
      fresh: 0,
      freshItemCount: 0,
      lastPolledAt: checkedAt,
      queryTerms: [],
      error: '搜狗微信触发验证，本轮剩余账号轮询已停止',
    });
  }
  return target;
}

function assessWechatAccountRun(health, accounts) {
  const accountIdPattern = /^(?:gateway:)?account:/i;
  const byName = new Map();
  for (const entry of Array.isArray(health) ? health : []) {
    const id = String(entry && entry.id || '').trim();
    if (!accountIdPattern.test(id)) continue;
    const name = String(entry && entry.name || id.replace(accountIdPattern, '')).trim();
    if (!name) continue;
    const isGatewayPending = /^gateway:account:/i.test(id)
      && String(entry.status || '').trim().toLowerCase() === 'pending';
    if (isGatewayPending && byName.has(name)) continue;
    byName.set(name, entry);
  }
  const expectedNames = [...new Set(
    (Array.isArray(accounts) ? accounts : [])
      .map((account) => String(account && account.name || '').trim())
      .filter(Boolean)
  )];
  const failureStatuses = new Set([
    'captcha',
    'blocked',
    'risk_control',
    'session_invalid',
    'waiting_for_login',
    'error',
    'parse_error',
    'parse_failed',
    'link_unresolved',
    'upstream_bad_request',
  ]);
  const checked = expectedNames.map((name) => byName.get(name)).filter(Boolean);
  const failed = checked.filter((entry) => failureStatuses.has(String(entry.status || '').toLowerCase()));
  const healthyStatuses = new Set(['ok', 'normal', 'no_new', 'no_new_items']);
  const healthy = checked.filter((entry) => healthyStatuses.has(String(entry.status || '').toLowerCase()));
  const majorityFailed = failed.length >= Math.ceil(expectedNames.length / 2);
  const incompleteChecks = checked.length < expectedNames.length;
  const noUsableSignal = checked.length === expectedNames.length && healthy.length === 0;
  return {
    expectedAccounts: expectedNames.length,
    checkedAccounts: checked.length,
    failedAccounts: failed.length,
    healthyAccounts: healthy.length,
    reason: majorityFailed
      ? 'majority_failed'
      : (incompleteChecks ? 'incomplete_account_checks' : (noUsableSignal ? 'no_usable_signal' : '')),
    degraded: expectedNames.length > 0 && (majorityFailed || incompleteChecks || noUsableSignal),
  };
}

async function searchAccountWechat(account, page) {
  const terms = accountSearchTerms(account);
  const items = [];
  let rawCount = 0;
  let accountMatchCount = 0;
  let linkCandidateCount = 0;
  let linkUnresolvedCount = 0;
  let captchaCount = 0;
  let blocked = false;
  let parseError = false;
  for (const term of terms) {
    const result = await searchWechat(term, page, account);
    rawCount += result.rawCount || 0;
    accountMatchCount += result.accountMatchCount || 0;
    linkCandidateCount += result.linkCandidateCount || 0;
    linkUnresolvedCount += result.linkUnresolvedCount || 0;
    captchaCount += result.captchaCount || 0;
    if ((result.captchaCount || 0) > 0) blocked = true;
    if (result.status === 'error' || result.status === 'parse_error') parseError = true;
    items.push(...result.items);
    if (result.items.length || blocked || linkCandidateCount >= WECHAT_LINK_RESOLVE_LIMIT) break;
    await sleep(1500);
  }
  return {
    items,
    rawCount,
    accountMatchCount,
    linkCandidateCount,
    linkUnresolvedCount,
    captchaCount,
    terms,
    status: blocked
      ? 'captcha'
      : (items.length
          ? 'ok'
          : (parseError
              ? 'parse_failed'
              : (linkCandidateCount
                  ? 'link_unresolved'
                  : (rawCount ? 'account_not_matched' : 'not_indexed')))),
  };
}

async function runMain() {
  console.log('[wechat] START Puppeteer WeChat search');
  const puppeteer = require('puppeteer');
  let customAccounts = [];
  try {
    const registry = loadCustomSources(CUSTOM_SOURCES_FILE);
    customAccounts = registry.sources
      .filter((source) => source.enabled !== false && source.type === 'wechat')
      .map((source) => ({
        id: source.id,
        name: source.name,
        aliases: source.keywords || [source.name],
        kind: '公众号',
        tier: 2,
        category: source.category || 'ALL',
        staleAfterHours: source.staleAfterHours || 168,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        custom: true,
      }));
  } catch (error) {
    console.error('[wechat] custom source registry disabled for this run:', error.message);
  }
  MONITORED_WECHAT_ACCOUNTS = [...WECHAT_ACCOUNTS, ...customAccounts];
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=zh-CN',
      '--window-size=1280,800'
    ]
  });

  const allItems = [];
  const health = [];
  const hourSlot = Math.floor(Date.now() / 3600000);
  const configuredStart = Number(process.env.PVHOT_WECHAT_ACCOUNT_START);
  const accountStart = Number.isInteger(configuredStart)
    ? ((configuredStart % WECHAT_ACCOUNTS.length) + WECHAT_ACCOUNTS.length) % WECHAT_ACCOUNTS.length
    : (hourSlot * ACCOUNT_BATCH_SIZE) % WECHAT_ACCOUNTS.length;
  const builtInAccounts = Array.from({ length: Math.min(ACCOUNT_BATCH_SIZE, WECHAT_ACCOUNTS.length) }, (_, i) =>
    WECHAT_ACCOUNTS[(accountStart + i) % WECHAT_ACCOUNTS.length]
  );
  const customQueriedAccounts = selectCustomAccountsForRun(customAccounts, hourSlot);
  const queriedAccounts = [...customQueriedAccounts, ...builtInAccounts];
  const topicStart = (hourSlot * TOPIC_BATCH_SIZE) % WECHAT_TOPIC_QUERIES.length;
  const topicQueries = Array.from({ length: TOPIC_BATCH_SIZE }, (_, i) =>
    WECHAT_TOPIC_QUERIES[(topicStart + i) % WECHAT_TOPIC_QUERIES.length]
  );
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
    let sogouBlocked = false;

    for (const kw of topicQueries) {
      try {
        const result = await searchWechat(kw, page);
        const trustedItems = result.items.filter((it) => isRegistryAccount(it.account));
        if ((result.captchaCount || 0) > 0) sogouBlocked = true;
        health.push({
          id: `topic:${kw}`,
          name: kw,
          kind: 'topic',
          status: result.status === 'captcha'
            ? 'captcha'
            : (result.status === 'link_unresolved'
                ? 'link_unresolved'
                : (trustedItems.length ? 'ok' : (result.rawCount ? 'account_not_matched' : 'not_indexed'))),
          raw: result.rawCount,
          rawSearchCount: result.rawCount,
          accountMatchCount: result.accountMatchCount,
          candidateFresh: result.linkCandidateCount,
          linkCandidateCount: result.linkCandidateCount,
          linkUnresolvedCount: result.linkUnresolvedCount,
          captchaCount: result.captchaCount,
          fresh: trustedItems.length,
          freshItemCount: trustedItems.length,
          lastPolledAt: new Date().toISOString(),
        });
        for (const it of trustedItems) {
          const monitoredAccount = findMonitoredAccount(it.account);
          allItems.push({
            id: extractItemId(it.link),
            title: it.title,
            title_cn: it.title,
            link: it.link,
            summary: it.summary,
            summary_cn: it.summary,
            reason: '',
            category: 'ALL',
            lang: 'zh',
            pubDate: it.pubDate,
            source: 'wechat',
            sources: [{ name: it.account, source: 'wechat', link: it.link, avatar: it.avatar || '' }],
            sourceCount: 1,
            heat: 45,
            tags: [],
            score: 45,
            avatar: it.avatar || '',
            ...(monitoredAccount && monitoredAccount.custom
              ? { _customSourceId: monitoredAccount.id, _customSourceType: 'wechat' }
              : {}),
          });
        }
      } catch (e) {
        console.error(`[wechat] error for "${kw}": ${e.message}`);
        health.push({ id: `topic:${kw}`, name: kw, kind: 'topic', status: 'error', error: e.message });
      }
      if (sogouBlocked) break;
      await sleep(3000);
    }

    for (const account of queriedAccounts) {
      if (sogouBlocked) break;
      try {
        const result = await searchAccountWechat(account, page);
        if ((result.captchaCount || 0) > 0) sogouBlocked = true;
        health.push({
          id: `account:${account.name}`,
          name: account.name,
          kind: account.kind || '公众号',
          tier: account.tier || 2,
          status: result.status,
          raw: result.rawCount,
          rawSearchCount: result.rawCount,
          accountMatchCount: result.accountMatchCount,
          linkCandidateCount: result.linkCandidateCount,
          linkUnresolvedCount: result.linkUnresolvedCount,
          captchaCount: result.captchaCount,
          fresh: result.items.length,
          freshItemCount: result.items.length,
          lastPolledAt: new Date().toISOString(),
          queryTerms: result.terms,
        });
        for (const it of result.items) {
          allItems.push({
            id: extractItemId(it.link),
            title: it.title,
            title_cn: it.title,
            link: it.link,
            summary: it.summary,
            summary_cn: it.summary,
            reason: '',
            category: 'ALL',
            lang: 'zh',
            pubDate: it.pubDate,
            source: 'wechat',
            sources: [{ name: it.account || account.name, source: 'wechat', link: it.link, avatar: it.avatar || '' }],
            sourceCount: 1,
            heat: account.tier === 1 ? 55 : 48,
            tags: [],
            score: account.tier === 1 ? 55 : 48,
            avatar: it.avatar || '',
            ...(account.custom ? { _customSourceId: account.id, _customSourceType: 'wechat' } : {}),
          });
        }
      } catch (e) {
        console.error(`[wechat] account error for "${account.name}": ${e.message}`);
        health.push({ id: `account:${account.name}`, name: account.name, kind: account.kind || '公众号', status: 'error', error: e.message });
      }
      if (sogouBlocked) break;
      await sleep(3000);
    }

    if (sogouBlocked) {
      appendGlobalWechatBlockHealth(health, queriedAccounts);
    }
  } finally {
    await browser.close();
  }

  let gatewayProvider = '';
  const gateway = loadGatewayItems();
  if (ENABLE_WECHAT_GATEWAY || gateway.enabled) {
    gatewayProvider = gateway.provider;
    allItems.push(...gateway.items.filter((item) =>
      isRegistryAccount(item.account || item.sources?.[0]?.name)
    ));
    const freshGatewayHealth = gateway.health.filter((entry) =>
      isFreshGatewayHealthEntry(entry, gateway.fetchedAt)
    );
    health.push(...freshGatewayHealth.map((entry) => ({
      ...entry,
      id: `gateway:${entry.id || entry.name || 'wechat'}`,
      mode: 'weread-session-prototype',
    })));
    console.log(
      `[wechat] gateway provider=${gatewayProvider || 'unknown'} items=${gateway.items.length}`
      + ` health=${freshGatewayHealth.length}/${gateway.health.length} fresh`
    );
  }

  // 与前几轮结果合并。账号按小时轮询，但最近 7 天的有效文章不会因轮换丢失。
  let previousItems = [];
  try {
    const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    previousItems = Array.isArray(previous.items)
      ? previous.items
        .map(normalizeOfficialWechatItem)
        .filter((it) =>
          it
          && isFresh(it.pubDate)
          && isRegistryAccount(it.sources?.[0]?.name)
        )
      : [];
  } catch (e) {}

  // Deduplicate by id，新结果优先。
  const seen = new Set();
  const seenLinks = new Set();
  const officialItems = [...allItems, ...previousItems]
    .map(normalizeOfficialWechatItem)
    .filter(Boolean);
  const deduped = officialItems.filter(it => {
    if (!isFresh(it.pubDate)) return false;
    const linkKey = normalizeOfficialWechatLink(it.link);
    if (!linkKey) return false;
    if (seen.has(it.id) || (linkKey && seenLinks.has(linkKey))) return false;
    seen.add(it.id);
    if (linkKey) seenLinks.add(linkKey);
    return true;
  }).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Write output
  const output = {
    fetchedAt: new Date().toISOString(),
    registryVersion: REGISTRY_VERSION,
    gatewayProvider,
    monitoredAccounts: MONITORED_WECHAT_ACCOUNTS.length,
    queriedAccounts: queriedAccounts.map((account) => account.name),
    topicQueries,
    health,
    count: deduped.length,
    items: deduped
  };
  
  atomicWriteJsonSync(OUTPUT_PATH, output, {
    space: 2,
    validate: (value) =>
      value
      && Array.isArray(value.items)
      && Number(value.count) === value.items.length
      && value.items.every((item) => Boolean(normalizeOfficialWechatLink(item.link))),
  });
  const runHealth = assessWechatAccountRun(health, queriedAccounts);
  console.log(`[wechat] OK registry=${REGISTRY_VERSION} monitored=${MONITORED_WECHAT_ACCOUNTS.length} queried=${queriedAccounts.length} wrote=${deduped.length} -> ${OUTPUT_PATH}`);
  if (runHealth.degraded) {
    const error = new Error(
      `WeChat run degraded (${runHealth.reason}): failed=${runHealth.failedAccounts},`
      + ` healthy=${runHealth.healthyAccounts}/${runHealth.expectedAccounts} queried accounts`
    );
    error.code = 'WECHAT_RUN_DEGRADED';
    throw error;
  }
}

async function main() {
  const callerPid = process.ppid;
  writeWechatRunStart(WECHAT_RUN_STATUS_DIR, callerPid);
  try {
    const result = await withProcessLock(WECHAT_LOCK_OPTIONS, runMain);
    clearWechatRunFailure(WECHAT_RUN_STATUS_DIR, callerPid);
    return result;
  } catch (error) {
    try {
      writeWechatRunFailure(WECHAT_RUN_STATUS_DIR, callerPid, error);
    } catch (statusError) {
      console.error(`[wechat] failed to persist run status: ${statusError.message}`);
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error('[wechat] FATAL:', e);
    process.exit(1);
  });
}

module.exports = {
  accountSearchTerms,
  appendGlobalWechatBlockHealth,
  assessWechatAccountRun,
  extractOfficialWechatLink,
  expandAccountAliases,
  extractItemId,
  isWechatVerificationUrl,
  isFreshGatewayHealthEntry,
  loadGatewayItems,
  normalizeOfficialWechatItem,
  normalizeOfficialWechatLink,
  normalizeSogouDiscoveryLink,
  normalizeWechatLink,
  resolveWechatArticleLink,
  selectCustomAccountsForRun,
};
