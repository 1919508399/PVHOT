'use strict';

const STATUS_NORMAL = 'normal';
const STATUS_NO_NEW = 'no_new';
const STATUS_BLOCKED = 'blocked';
const STATUS_PARSE_ERROR = 'parse_error';
const STATUS_STALE = 'stale';
const STATUS_PENDING = 'pending';

const HEALTH_STATUS = Object.freeze({
  NORMAL: STATUS_NORMAL,
  NO_NEW: STATUS_NO_NEW,
  BLOCKED: STATUS_BLOCKED,
  PARSE_ERROR: STATUS_PARSE_ERROR,
  STALE: STATUS_STALE,
  PENDING: STATUS_PENDING,
});

const HEALTH_STATUSES = Object.freeze(Object.values(HEALTH_STATUS));

const DEFAULT_STALE_AFTER_HOURS = Object.freeze({
  'google-news': 72,
  rss: 72,
  scrape: 72,
  media: 72,
  official: 14 * 24,
  wechat: 7 * 24,
  'wechat-account': 7 * 24,
  'wechat-topic': 7 * 24,
  'rsshub-wechat': 7 * 24,
  x: 7 * 24,
  twitter: 7 * 24,
  default: 7 * 24,
});

const BLOCKED_HTTP_STATUSES = new Set([401, 403, 429, 451]);
const BLOCKED_ERROR_RE = /(?:captcha|cloudflare|access[_ -]?denied|forbidden|rate[_ -]?limit|blocked|challenge|验证码|人机验证|访问受限|被拦截)/i;

function toTimestamp(value) {
  if (value instanceof Date) {
    const valueOf = value.getTime();
    return Number.isFinite(valueOf) ? valueOf : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function firstValidIso(...values) {
  for (const value of values) {
    const iso = toIso(value);
    if (iso) return iso;
  }
  return null;
}

function normalizeNow(now) {
  const timestamp = toTimestamp(now === undefined ? Date.now() : now);
  if (timestamp === null) throw new TypeError('now must be a valid date, timestamp, or ISO string');
  return timestamp;
}

function normalizeCount(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeStatus(status) {
  if (HEALTH_STATUSES.includes(status)) return status;
  if (status === 'ok') return STATUS_NORMAL;
  if (status === 'empty') return STATUS_NO_NEW;
  if (status === 'error') return STATUS_PARSE_ERROR;
  return null;
}

function defaultStaleAfterHours(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (DEFAULT_STALE_AFTER_HOURS[normalized]) return DEFAULT_STALE_AFTER_HOURS[normalized];
  if (normalized.includes('wechat') || normalized.includes('公众号')) {
    return DEFAULT_STALE_AFTER_HOURS.wechat;
  }
  if (normalized === 'x' || normalized.includes('twitter')) {
    return DEFAULT_STALE_AFTER_HOURS.x;
  }
  if (normalized.includes('official') || normalized.includes('机构')) {
    return DEFAULT_STALE_AFTER_HOURS.official;
  }
  if (normalized.includes('media') || normalized.includes('媒体')) {
    return DEFAULT_STALE_AFTER_HOURS.media;
  }
  return DEFAULT_STALE_AFTER_HOURS.default;
}

function resolveStaleAfterHours(config) {
  const configured = Number(config && config.staleAfterHours);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(365 * 24, Math.max(1, configured));
  }
  return defaultStaleAfterHours(config && config.kind);
}

function itemPublishedTimestamp(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [
    item.pubDate,
    item.publishedAt,
    item.published,
    item.updatedAt,
    item.dateKey,
    item.date,
  ];
  for (const candidate of candidates) {
    const timestamp = toTimestamp(candidate);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function beijingDateKey(timestamp) {
  return new Date(timestamp + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function latestItemTimestamp(items, diagnostics) {
  const timestamps = [];
  const diagnosticTime = toTimestamp(
    diagnostics && (diagnostics.latestItemAt || diagnostics.lastItemAt)
  );
  if (diagnosticTime !== null) timestamps.push(diagnosticTime);
  for (const item of Array.isArray(items) ? items : []) {
    const timestamp = itemPublishedTimestamp(item);
    if (timestamp !== null) timestamps.push(timestamp);
  }
  return timestamps.length ? Math.max(...timestamps) : null;
}

function normalizeDetail(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || null;
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  return status;
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) return null;
  return Math.round(duration);
}

function isBlockedDiagnostics(diagnostics) {
  const diag = diagnostics || {};
  const httpStatus = normalizeHttpStatus(diag.httpStatus);
  if (diag.blocked === true || BLOCKED_HTTP_STATUSES.has(httpStatus)) return true;
  return BLOCKED_ERROR_RE.test(`${diag.errorCode || ''} ${diag.detail || ''}`);
}

function isParseErrorDiagnostics(diagnostics, blocked) {
  if (blocked) return false;
  const diag = diagnostics || {};
  const httpStatus = normalizeHttpStatus(diag.httpStatus);
  if (diag.parseError) return true;
  if (diag.errorCode) return true;
  return httpStatus !== null && httpStatus >= 300;
}

function explicitNewItemCount(diagnostics) {
  const diag = diagnostics || {};
  for (const key of ['newItems', 'newItemCount']) {
    if (diag[key] === undefined || diag[key] === null) continue;
    return normalizeCount(diag[key]);
  }
  return null;
}

function deriveNewItemCount(items, previousLastItemAt, currentLatestItemAt, diagnostics) {
  const explicit = explicitNewItemCount(diagnostics);
  if (explicit !== null) return explicit;

  const list = Array.isArray(items) ? items : [];
  if (!list.length) return 0;

  const previousTimestamp = toTimestamp(previousLastItemAt);
  if (previousTimestamp === null) return list.length;

  const datedItems = list
    .map(itemPublishedTimestamp)
    .filter((timestamp) => timestamp !== null);
  if (datedItems.length) {
    return datedItems.filter((timestamp) => timestamp > previousTimestamp).length;
  }

  // Without publication dates there is no safe way to compare individual items.
  // Treat a positive result as new unless the caller supplies diagnostics.newItems.
  return currentLatestItemAt === null ? list.length : 0;
}

function buildHealthEntry(config, items, previous, diagnostics, now) {
  const sourceConfig = config && typeof config === 'object' ? config : {};
  const prior = previous && typeof previous === 'object' ? previous : {};
  const diag = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
  const nowTimestamp = normalizeNow(now);
  const checkedAt = new Date(nowTimestamp).toISOString();
  const list = Array.isArray(items) ? items : [];

  const id = String(
    sourceConfig.id || sourceConfig.source || sourceConfig.name || sourceConfig.label || ''
  ).trim();
  const name = String(
    sourceConfig.label || sourceConfig.name || sourceConfig.source || sourceConfig.id || ''
  ).trim();
  const kind = String(sourceConfig.kind || prior.kind || 'unknown').trim() || 'unknown';
  const staleAfterHours = resolveStaleAfterHours({ ...sourceConfig, kind });

  const previousStatus = normalizeStatus(prior.status);
  const previousLastItemAt = firstValidIso(prior.lastItemAt, prior.latestItemAt);
  const currentLatestTimestamp = latestItemTimestamp(list, diag);
  const previousLatestTimestamp = toTimestamp(previousLastItemAt);
  const retainedLatestTimestamp = [previousLatestTimestamp, currentLatestTimestamp]
    .filter((timestamp) => timestamp !== null)
    .reduce((latest, timestamp) => Math.max(latest, timestamp), -Infinity);
  const lastItemAt = Number.isFinite(retainedLatestTimestamp)
    ? new Date(retainedLatestTimestamp).toISOString()
    : null;

  const newItems = deriveNewItemCount(
    list,
    previousLastItemAt,
    currentLatestTimestamp,
    diag
  );
  const blocked = isBlockedDiagnostics(diag);
  const parseError = isParseErrorDiagnostics(diag, blocked);
  const successfulFetch = !blocked && !parseError;

  const firstCheckedAt = firstValidIso(prior.firstCheckedAt, prior.checkedAt, checkedAt);
  const priorLastSuccessAt = firstValidIso(
    prior.lastSuccessAt,
    previousStatus === STATUS_NORMAL || previousStatus === STATUS_NO_NEW || previousStatus === STATUS_STALE
      ? prior.checkedAt
      : null
  );
  const lastSuccessAt = successfulFetch ? checkedAt : priorLastSuccessAt;

  const priorLastNewAt = firstValidIso(
    prior.lastNewAt,
    prior.lastNewItemAt,
    previousStatus === STATUS_NORMAL ? prior.checkedAt : null
  );
  const lastNewAt = successfulFetch && newItems > 0 ? checkedAt : priorLastNewAt;

  const staleReference = firstValidIso(lastItemAt, lastNewAt, firstCheckedAt);
  const staleReferenceTimestamp = toTimestamp(staleReference);
  const isStale = successfulFetch
    && staleReferenceTimestamp !== null
    && nowTimestamp - staleReferenceTimestamp >= staleAfterHours * 3600 * 1000;

  let status;
  if (blocked) status = STATUS_BLOCKED;
  else if (parseError) status = STATUS_PARSE_ERROR;
  else if (isStale) status = STATUS_STALE;
  else if (newItems === 0) status = STATUS_NO_NEW;
  else status = STATUS_NORMAL;

  const priorFailures = normalizeCount(prior.consecutiveFailures);
  const consecutiveFailures = blocked || parseError ? priorFailures + 1 : 0;
  const priorNoNew = normalizeCount(prior.consecutiveNoNew);
  const consecutiveNoNew = successfulFetch
    ? (newItems > 0 ? 0 : priorNoNew + 1)
    : priorNoNew;
  const lastStatusChangeAt = previousStatus === status
    ? firstValidIso(prior.lastStatusChangeAt, prior.checkedAt, checkedAt)
    : checkedAt;

  const httpStatus = normalizeHttpStatus(diag.httpStatus);
  let errorCode = normalizeDetail(diag.errorCode);
  if (blocked && !errorCode) errorCode = httpStatus ? `http_${httpStatus}` : 'blocked';
  if (parseError && !errorCode) errorCode = httpStatus ? `http_${httpStatus}` : 'parse_error';
  if (!blocked && !parseError) errorCode = null;
  const todayKey = beijingDateKey(nowTimestamp);
  const todayItems = list.filter((item) => {
    const timestamp = itemPublishedTimestamp(item);
    return timestamp !== null && beijingDateKey(timestamp) === todayKey;
  }).length;

  return {
    id,
    name,
    kind,
    tier: normalizeCount(sourceConfig.tier || prior.tier, 2) || 2,
    status,
    items: list.length,
    itemsSeen: list.length,
    todayItems,
    newItems,
    checkedAt,
    lastCheckedAt: checkedAt,
    firstCheckedAt,
    lastSuccessAt,
    lastNewAt,
    lastItemAt,
    latestPublishedAt: lastItemAt,
    lastStatusChangeAt,
    consecutiveFailures,
    consecutiveNoNew,
    staleAfterHours,
    httpStatus,
    durationMs: normalizeDuration(diag.durationMs),
    errorCode,
    reasonCode: errorCode,
    detail: normalizeDetail(diag.detail || (typeof diag.parseError === 'string' ? diag.parseError : null)),
  };
}

function advanceHealthEntry(config, previous, now, options = {}) {
  const sourceConfig = config && typeof config === 'object' ? config : {};
  const prior = previous && typeof previous === 'object' ? previous : null;
  if (!prior) return null;

  const nowTimestamp = normalizeNow(now);
  const evaluatedAt = new Date(nowTimestamp).toISOString();
  const kind = String(sourceConfig.kind || prior.kind || 'unknown').trim() || 'unknown';
  const staleAfterHours = resolveStaleAfterHours({
    ...prior,
    ...sourceConfig,
    kind,
  });
  const previousStatus = normalizeStatus(prior.status) || STATUS_NO_NEW;
  let status = previousStatus;

  const staleReference = firstValidIso(
    prior.lastItemAt,
    prior.latestPublishedAt,
    prior.lastNewAt,
    prior.firstCheckedAt,
    prior.checkedAt
  );
  const staleReferenceTimestamp = toTimestamp(staleReference);
  const canBecomeStale = options.allowStale !== false
    && (previousStatus === STATUS_NORMAL
      || previousStatus === STATUS_NO_NEW
      || previousStatus === STATUS_STALE);
  if (canBecomeStale
      && staleReferenceTimestamp !== null
      && nowTimestamp - staleReferenceTimestamp >= staleAfterHours * 3600 * 1000) {
    status = STATUS_STALE;
  }

  const changed = status !== previousStatus;
  const detail = options.detail !== undefined
    ? normalizeDetail(options.detail)
    : (changed && status === STATUS_STALE
      ? `超过 ${staleAfterHours} 小时未检测到新稿`
      : normalizeDetail(prior.detail));

  return {
    ...prior,
    kind,
    status,
    staleAfterHours,
    statusEvaluatedAt: evaluatedAt,
    lastStatusChangeAt: changed
      ? evaluatedAt
      : firstValidIso(prior.lastStatusChangeAt, prior.checkedAt, evaluatedAt),
    detail,
  };
}

function summarizeHealth(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const counts = {
    [STATUS_NORMAL]: 0,
    [STATUS_NO_NEW]: 0,
    [STATUS_BLOCKED]: 0,
    [STATUS_PARSE_ERROR]: 0,
    [STATUS_STALE]: 0,
    [STATUS_PENDING]: 0,
  };

  let unknown = 0;
  for (const source of list) {
    const status = normalizeStatus(source && source.status);
    if (status) counts[status] += 1;
    else unknown += 1;
  }

  return {
    checked: list.length - counts[STATUS_PENDING],
    total: list.length,
    normal: counts[STATUS_NORMAL],
    no_new: counts[STATUS_NO_NEW],
    blocked: counts[STATUS_BLOCKED],
    parse_error: counts[STATUS_PARSE_ERROR],
    stale: counts[STATUS_STALE],
    pending: counts[STATUS_PENDING],
    healthy: counts[STATUS_NORMAL] + counts[STATUS_NO_NEW],
    issues: counts[STATUS_BLOCKED] + counts[STATUS_PARSE_ERROR] + counts[STATUS_STALE],
    unknown,
    byStatus: { ...counts },
    // Compatibility aliases for the existing summary widget.
    ok: counts[STATUS_NORMAL],
    empty: counts[STATUS_NO_NEW] + counts[STATUS_STALE],
  };
}

module.exports = {
  HEALTH_STATUS,
  HEALTH_STATUSES,
  DEFAULT_STALE_AFTER_HOURS,
  STATUS_NORMAL,
  STATUS_NO_NEW,
  STATUS_BLOCKED,
  STATUS_PARSE_ERROR,
  STATUS_STALE,
  STATUS_PENDING,
  advanceHealthEntry,
  buildHealthEntry,
  summarizeHealth,
  defaultStaleAfterHours,
  latestItemTimestamp,
  normalizeStatus,
};
