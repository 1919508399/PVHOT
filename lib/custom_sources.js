'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { atomicWriteJsonSync } = require('./safe_io');
const {
  probeRss,
  validateRemoteUrl,
} = require('./safe_remote_fetch');

const SCHEMA_VERSION = 1;
const MAX_CUSTOM_SOURCES = 100;
const SOURCE_TYPES = Object.freeze(['website', 'rss', 'wechat']);
const CATEGORY_ALLOWLIST = Object.freeze([
  'ALL',
  '政策',
  '价格',
  '硅料',
  '硅片',
  '电池片',
  '组件',
  '逆变器',
  '支架BOS',
  '储能',
  '电站',
  '行情',
]);
const SOURCE_KEYS = new Set([
  'id',
  'name',
  'type',
  'url',
  'keywords',
  'category',
  'enabled',
  'staleAfterHours',
  'createdAt',
  'updatedAt',
]);
const INPUT_KEYS = new Set([
  'name',
  'type',
  'url',
  'keywords',
  'category',
  'enabled',
  'staleAfterHours',
]);
const REGISTRY_KEYS = new Set(['schemaVersion', 'revision', 'updatedAt', 'sources']);

class CustomSourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CustomSourceError';
    this.code = code;
    if (details.cause) this.cause = details.cause;
  }
}

function fail(code, message, details) {
  throw new CustomSourceError(code, message, details);
}

function assertPlainObject(value, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code, `${label} must be a plain object`);
  }
}

function rejectUnknownKeys(value, allowed, code, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    fail(code, `${label} contains unsupported fields: ${unexpected.join(', ')}`);
  }
}

function cleanText(value, label, maxLength, options = {}) {
  if (typeof value !== 'string') fail('INVALID_FIELD', `${label} must be text`);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if ((!normalized && !options.allowEmpty) || normalized.length > maxLength ||
      /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('INVALID_FIELD', `${label} is empty, too long, or contains control characters`);
  }
  return normalized;
}

function normalizeKeywords(value, fallback = []) {
  let values;
  if (value == null || value === '') {
    values = fallback;
  } else if (typeof value === 'string') {
    values = value.split(/[,，;；\n\r]+/);
  } else if (Array.isArray(value)) {
    values = value;
  } else {
    fail('INVALID_KEYWORDS', 'keywords must be an array or comma-separated text');
  }

  const result = [];
  const seen = new Set();
  for (const item of values) {
    if (typeof item !== 'string') {
      fail('INVALID_KEYWORDS', 'each keyword must be text');
    }
    const keyword = cleanText(item, 'keyword', 40, { allowEmpty: true });
    if (!keyword) continue;
    const safeKeyword = keyword
      .replace(/["'`(){}\[\]:\\|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!safeKeyword) continue;
    const key = safeKeyword.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(safeKeyword);
    if (result.length > 20) fail('TOO_MANY_KEYWORDS', 'A source may contain at most 20 keywords');
  }
  return result;
}

function normalizeWebsiteUrl(value) {
  const raw = cleanText(value, 'url', 2048);
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = validateRemoteUrl(withScheme);
  } catch (error) {
    fail('INVALID_SOURCE_URL', 'website must use a safe public HTTPS hostname', { cause: error });
  }

  // Website sources are monitored through Google News site:domain queries.
  // Paths, query strings and fragments are intentionally discarded so this
  // value is never mistaken for an arbitrary page that the server should GET.
  return `https://${parsed.hostname}/`;
}

function normalizeRssUrl(value) {
  const raw = cleanText(value, 'url', 2048);
  let parsed;
  try {
    parsed = validateRemoteUrl(raw);
  } catch (error) {
    fail('INVALID_SOURCE_URL', 'RSS sources must use a safe public HTTPS URL', { cause: error });
  }
  return parsed.href;
}

function normalizeSourceInput(input) {
  assertPlainObject(input, 'INVALID_SOURCE', 'source');
  rejectUnknownKeys(input, INPUT_KEYS, 'UNSUPPORTED_FIELD', 'source');

  const type = cleanText(input.type, 'type', 16);
  if (!SOURCE_TYPES.includes(type)) {
    fail('INVALID_SOURCE_TYPE', `type must be one of: ${SOURCE_TYPES.join(', ')}`);
  }
  const name = cleanText(input.name, 'name', 80);
  const category = input.category == null || input.category === ''
    ? 'ALL'
    : cleanText(input.category, 'category', 16);
  if (!CATEGORY_ALLOWLIST.includes(category)) {
    fail('INVALID_CATEGORY', 'category is not in the supported PVHOT category list');
  }
  if (input.enabled != null && typeof input.enabled !== 'boolean') {
    fail('INVALID_FIELD', 'enabled must be a boolean');
  }
  const enabled = input.enabled == null ? true : input.enabled;
  const staleAfterHours = input.staleAfterHours == null
    ? (type === 'wechat' ? 168 : 72)
    : Number(input.staleAfterHours);
  if (!Number.isInteger(staleAfterHours) ||
      staleAfterHours < 24 || staleAfterHours > 720) {
    fail('INVALID_STALE_WINDOW', 'staleAfterHours must be an integer from 24 to 720');
  }

  let url = '';
  if (type === 'website') {
    url = normalizeWebsiteUrl(input.url);
  } else if (type === 'rss') {
    url = normalizeRssUrl(input.url);
  } else if (input.url != null && String(input.url).trim()) {
    fail('WECHAT_URL_NOT_ALLOWED', 'WeChat sources are monitored by account keywords, not by URL');
  }

  const keywords = normalizeKeywords(input.keywords, type === 'wechat' ? [name] : []);
  if (type === 'wechat' && !keywords.length) {
    fail('WECHAT_KEYWORDS_REQUIRED', 'A WeChat source requires at least one account keyword');
  }

  return {
    name,
    type,
    url,
    keywords,
    category,
    enabled,
    staleAfterHours,
  };
}

function validIsoTimestamp(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(new Date(value).getTime());
}

function createCustomSource(input, options = {}) {
  const normalized = normalizeSourceInput(input);
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now == null ? Date.now() : options.now);
  if (Number.isNaN(now.getTime())) fail('INVALID_TIMESTAMP', 'now is not a valid timestamp');
  const uuid = (options.randomUUID || crypto.randomUUID)();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    fail('INVALID_GENERATED_ID', 'The server UUID generator returned an invalid value');
  }
  const timestamp = now.toISOString();
  return {
    id: `custom-${uuid.toLowerCase()}`,
    ...normalized,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateStoredSource(value) {
  assertPlainObject(value, 'INVALID_STORED_SOURCE', 'stored source');
  rejectUnknownKeys(value, SOURCE_KEYS, 'INVALID_STORED_SOURCE', 'stored source');
  if (typeof value.id !== 'string' ||
      !/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) {
    fail('INVALID_STORED_SOURCE', 'stored source id is invalid');
  }
  if (!validIsoTimestamp(value.createdAt) || !validIsoTimestamp(value.updatedAt)) {
    fail('INVALID_STORED_SOURCE', 'stored source timestamps are invalid');
  }
  if (new Date(value.updatedAt).getTime() < new Date(value.createdAt).getTime()) {
    fail('INVALID_STORED_SOURCE', 'stored source updatedAt precedes createdAt');
  }

  const normalized = normalizeSourceInput({
    name: value.name,
    type: value.type,
    url: value.url,
    keywords: value.keywords,
    category: value.category,
    enabled: value.enabled,
    staleAfterHours: value.staleAfterHours,
  });
  if (JSON.stringify(normalized) !== JSON.stringify({
    name: value.name,
    type: value.type,
    url: value.url,
    keywords: value.keywords,
    category: value.category,
    enabled: value.enabled,
    staleAfterHours: value.staleAfterHours,
  })) {
    fail('NON_CANONICAL_SOURCE', 'stored source is not in canonical form');
  }
  return {
    id: value.id.toLowerCase(),
    ...normalized,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function assertNoDuplicates(sources) {
  const ids = new Set();
  const urls = new Map();
  const wechatNames = new Map();
  for (const source of sources) {
    if (ids.has(source.id)) fail('DUPLICATE_ID', `duplicate source id: ${source.id}`);
    ids.add(source.id);
    if (source.type === 'wechat') {
      const nameKey = source.name.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
      if (wechatNames.has(nameKey)) {
        fail('DUPLICATE_NAME', `WeChat account already belongs to ${wechatNames.get(nameKey)}`);
      }
      wechatNames.set(nameKey, source.id);
    }
    if (!source.url) continue;
    const urlKey = source.url;
    if (urls.has(urlKey)) {
      fail('DUPLICATE_URL', `source URL already belongs to ${urls.get(urlKey)}`);
    }
    urls.set(urlKey, source.id);
  }
}

function validateRegistry(value) {
  assertPlainObject(value, 'INVALID_REGISTRY', 'custom source registry');
  rejectUnknownKeys(value, REGISTRY_KEYS, 'INVALID_REGISTRY', 'custom source registry');
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail('UNSUPPORTED_SCHEMA', `custom source schema must be version ${SCHEMA_VERSION}`);
  }
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    fail('INVALID_REGISTRY', 'registry revision must be a non-negative integer');
  }
  if (value.updatedAt !== null && !validIsoTimestamp(value.updatedAt)) {
    fail('INVALID_REGISTRY', 'registry updatedAt must be null or a UTC ISO timestamp');
  }
  if (!Array.isArray(value.sources) || value.sources.length > MAX_CUSTOM_SOURCES) {
    fail('INVALID_REGISTRY', `registry sources must be an array of at most ${MAX_CUSTOM_SOURCES} entries`);
  }
  const sources = value.sources.map(validateStoredSource);
  assertNoDuplicates(sources);
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: value.revision,
    updatedAt: value.updatedAt,
    sources,
  };
}

function createEmptyRegistry() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    sources: [],
  };
}

function loadCustomSources(filePath, options = {}) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT' && options.allowMissing !== false) {
      return createEmptyRegistry();
    }
    fail('REGISTRY_READ_FAILED', 'custom source registry could not be read', { cause: error });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail('INVALID_REGISTRY_JSON', 'custom source registry is not valid JSON', { cause: error });
  }
  return validateRegistry(parsed);
}

function saveCustomSources(filePath, registry) {
  const validated = validateRegistry(registry);
  atomicWriteJsonSync(filePath, validated, {
    space: 2,
    trailingNewline: true,
    validate: (value) => {
      validateRegistry(value);
      return true;
    },
  });
  return validated;
}

function nextRegistry(registry, sources, nowValue) {
  const now = nowValue instanceof Date
    ? nowValue
    : new Date(nowValue == null ? Date.now() : nowValue);
  if (Number.isNaN(now.getTime())) fail('INVALID_TIMESTAMP', 'now is not a valid timestamp');
  return validateRegistry({
    schemaVersion: SCHEMA_VERSION,
    revision: registry.revision + 1,
    updatedAt: now.toISOString(),
    sources,
  });
}

function addCustomSource(filePath, input, options = {}) {
  const registry = loadCustomSources(filePath);
  if (registry.sources.length >= MAX_CUSTOM_SOURCES) {
    fail('SOURCE_LIMIT', `at most ${MAX_CUSTOM_SOURCES} custom sources are allowed`);
  }
  const source = createCustomSource(input, options);
  assertNoDuplicates([...registry.sources, source]);
  const updated = nextRegistry(registry, [...registry.sources, source], options.now);
  saveCustomSources(filePath, updated);
  return { registry: updated, source };
}

function updateCustomSource(filePath, id, patch, options = {}) {
  assertPlainObject(patch, 'INVALID_SOURCE', 'source update');
  rejectUnknownKeys(patch, INPUT_KEYS, 'UNSUPPORTED_FIELD', 'source update');
  const registry = loadCustomSources(filePath);
  const index = registry.sources.findIndex((source) => source.id === id);
  if (index < 0) fail('SOURCE_NOT_FOUND', 'custom source does not exist');
  const current = registry.sources[index];
  const normalized = normalizeSourceInput({
    name: current.name,
    type: current.type,
    url: current.url,
    keywords: current.keywords,
    category: current.category,
    enabled: current.enabled,
    staleAfterHours: current.staleAfterHours,
    ...patch,
  });
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now == null ? Date.now() : options.now);
  if (Number.isNaN(now.getTime())) fail('INVALID_TIMESTAMP', 'now is not a valid timestamp');
  const source = {
    id: current.id,
    ...normalized,
    createdAt: current.createdAt,
    updatedAt: now.toISOString(),
  };
  const sources = registry.sources.slice();
  sources[index] = source;
  assertNoDuplicates(sources);
  const updated = nextRegistry(registry, sources, now);
  saveCustomSources(filePath, updated);
  return { registry: updated, source };
}

function removeCustomSource(filePath, id, options = {}) {
  const registry = loadCustomSources(filePath);
  const index = registry.sources.findIndex((source) => source.id === id);
  if (index < 0) fail('SOURCE_NOT_FOUND', 'custom source does not exist');
  const source = registry.sources[index];
  const sources = registry.sources.filter((candidate) => candidate.id !== id);
  const updated = nextRegistry(registry, sources, options.now);
  saveCustomSources(filePath, updated);
  return { registry: updated, source };
}

function buildGoogleNewsSiteQuery(sourceOrUrl, extraKeywords) {
  const source = typeof sourceOrUrl === 'string'
    ? { url: normalizeWebsiteUrl(sourceOrUrl), keywords: [] }
    : sourceOrUrl;
  if (!source || source.type && source.type !== 'website') {
    fail('INVALID_SOURCE_TYPE', 'Google News site queries require a website source');
  }
  const websiteUrl = normalizeWebsiteUrl(source.url);
  const hostname = new URL(websiteUrl).hostname;
  const keywords = normalizeKeywords(
    extraKeywords == null ? source.keywords : extraKeywords,
    ['光伏', '太阳能', 'solar', 'photovoltaic']
  );
  const terms = keywords.length ? keywords : ['光伏', '太阳能', 'solar', 'photovoltaic'];
  return `site:${hostname} (${terms.join(' OR ')})`;
}

function customWebsiteQuery(source) {
  if (!source || source.type !== 'website') {
    fail('INVALID_SOURCE_TYPE', 'customWebsiteQuery requires a website source');
  }
  return {
    id: source.id,
    name: source.name,
    label: source.name,
    q: buildGoogleNewsSiteQuery(source),
    locale: /[\u3400-\u9fff]/.test([source.name, ...(source.keywords || [])].join(' '))
      ? 'zh'
      : 'en',
    cat: source.category || 'ALL',
    kind: 'google-news',
    type: 'website',
    custom: true,
    enabled: source.enabled !== false,
    staleAfterHours: source.staleAfterHours || 72,
  };
}

function rssHealth(result) {
  return {
    status: result.status || (result.ok ? 'normal' : 'parse_error'),
    ok: result.ok === true,
    items: Array.isArray(result.items) ? result.items.length : 0,
    httpStatus: result.httpStatus || null,
    durationMs: result.durationMs || null,
    reasonCode: result.reasonCode || (result.ok ? 'OK' : 'UNKNOWN_ERROR'),
    errorCode: result.ok ? null : (result.reasonCode || 'UNKNOWN_ERROR'),
    blocked: result.status === 'blocked',
    parseError: result.status === 'parse_error',
    detail: result.detail || '',
    finalUrl: result.finalUrl || null,
    checkedAt: new Date().toISOString(),
  };
}

async function fetchCustomRss(source, options = {}) {
  if (!source || source.type !== 'rss') {
    fail('INVALID_SOURCE_TYPE', 'fetchCustomRss requires an RSS source');
  }
  let result;
  try {
    // Syntax validation happens before probeRss performs DNS validation and
    // pins the request to the validated public address.
    validateRemoteUrl(source.url);
    result = await probeRss(source.url, options);
  } catch (error) {
    result = {
      ok: false,
      status: 'parse_error',
      reasonCode: error && error.code || 'INVALID_SOURCE',
      detail: '无法安全读取该自定义 RSS 信源',
      items: [],
    };
  }

  const items = (Array.isArray(result.items) ? result.items : []).map((item) => ({
    ...item,
    source: source.name,
    _customSourceId: source.id,
  }));
  Object.defineProperty(items, '_health', {
    value: rssHealth(result),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return items;
}

function isSafeCustomArticleUrl(url) {
  try {
    validateRemoteUrl(url);
    return true;
  } catch (error) {
    return false;
  }
}

function normalizeProbeSource(sourceOrInput) {
  assertPlainObject(sourceOrInput, 'INVALID_SOURCE', 'source');
  if ('id' in sourceOrInput || 'createdAt' in sourceOrInput || 'updatedAt' in sourceOrInput) {
    return validateStoredSource(sourceOrInput);
  }
  return normalizeSourceInput(sourceOrInput);
}

async function probeCustomSource(sourceOrInput, options = {}) {
  const source = normalizeProbeSource(sourceOrInput);
  if (source.type === 'website') {
    const config = customWebsiteQuery(source);
    return {
      ok: true,
      status: 'normal',
      probeStatus: 'ready',
      reasonCode: 'GOOGLE_NEWS_SITE_READY',
      detail: '网站将通过 Google News 的站点定向检索进行监控，不会由服务器直接访问',
      mode: 'google-news-site',
      query: config.q,
      config,
      items: [],
    };
  }
  if (source.type === 'wechat') {
    return {
      ok: true,
      status: 'normal',
      probeStatus: 'pending',
      reasonCode: 'WECHAT_POLL_READY',
      detail: '公众号关键词已就绪，将在下一轮公众号任务中查询',
      mode: 'wechat-keywords',
      keywords: source.keywords,
      items: [],
    };
  }
  return probeRss(source.url, options);
}

module.exports = {
  CATEGORY_ALLOWLIST,
  CustomSourceError,
  MAX_CUSTOM_SOURCES,
  SCHEMA_VERSION,
  SOURCE_TYPES,
  addCustomSource,
  buildGoogleNewsSiteQuery,
  createCustomSource,
  createEmptyRegistry,
  customWebsiteQuery,
  fetchCustomRss,
  isSafeCustomArticleUrl,
  loadCustomSources,
  normalizeKeywords,
  normalizeRssUrl,
  normalizeSourceInput,
  normalizeWebsiteUrl,
  probeCustomSource,
  removeCustomSource,
  saveCustomSources,
  updateCustomSource,
  validateRegistry,
  validateStoredSource,
};
