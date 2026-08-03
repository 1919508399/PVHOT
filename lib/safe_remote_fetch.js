'use strict';

const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_IDLE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = 'PVHOT-Source-Monitor/1.0 (+https://pvhot.bbroot.com)';
const BLOCKED_HOST_SUFFIXES = Object.freeze([
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.test',
  '.invalid',
  '.example',
  '.onion',
  '.arpa',
  '.svc',
  '.cluster.local',
]);
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
]);
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 407, 429, 451]);

class SafeRemoteFetchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SafeRemoteFetchError';
    this.code = code;
    if (details.statusCode != null) this.statusCode = details.statusCode;
    if (details.cause) this.cause = details.cause;
  }
}

function fail(code, message, details) {
  throw new SafeRemoteFetchError(code, message, details);
}

function parseIpv4(address) {
  if (net.isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  return octets.length === 4 && octets.every((value) =>
    Number.isInteger(value) && value >= 0 && value <= 255
  ) ? octets : null;
}

function isPublicIpv4(address) {
  const bytes = parseIpv4(address);
  if (!bytes) return false;
  const [a, b, c, d] = bytes;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;

  // IETF protocol assignments, documentation and benchmarking networks.
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;

  // Limited broadcast is already covered by a >= 224, but retain the exact
  // check to make the intended policy explicit.
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  return true;
}

function expandIpv6(address) {
  if (typeof address !== 'string' || net.isIP(address) !== 6) return null;
  let input = address.toLowerCase();
  const zoneIndex = input.indexOf('%');
  if (zoneIndex >= 0) input = input.slice(0, zoneIndex);

  let ipv4Tail = null;
  const lastColon = input.lastIndexOf(':');
  const possibleIpv4 = input.slice(lastColon + 1);
  if (possibleIpv4.includes('.')) {
    ipv4Tail = parseIpv4(possibleIpv4);
    if (!ipv4Tail) return null;
    const high = ((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16);
    const low = ((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16);
    input = `${input.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const bytes = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return { bytes, ipv4Tail };
}

function isPublicIpv6(address) {
  const parsed = expandIpv6(address);
  if (!parsed) return false;
  const bytes = parsed.bytes;

  // IPv4-compatible/mapped addresses and every address in ::/8 are rejected.
  // Public IPv4 destinations must arrive as ordinary A records.
  if (bytes[0] === 0 || parsed.ipv4Tail) return false;

  // Only globally routed 2000::/3 space is accepted.
  if ((bytes[0] & 0xe0) !== 0x20) return false;

  // Documentation, benchmarking and transition ranges within 2000::/3.
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    const thirdFourth = (bytes[2] << 8) | bytes[3];
    if (thirdFourth === 0x0000) return false; // Teredo 2001:0000::/32
    if (thirdFourth === 0x0002) return false; // benchmarking 2001:2::/48
    if (thirdFourth >= 0x0010 && thirdFourth <= 0x002f) return false; // ORCHID
    if (thirdFourth === 0x0db8) return false; // documentation
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4
  if (bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0) return false; // 3fff::/20 docs
  return true;
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function validateRemoteUrl(rawUrl) {
  if (typeof rawUrl !== 'string') fail('INVALID_URL', 'URL must be a string');
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) fail('INVALID_URL', 'URL is empty or too long');

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    fail('INVALID_URL', 'URL is not valid', { cause: error });
  }
  if (parsed.protocol !== 'https:') {
    fail('UNSAFE_SCHEME', 'Only public HTTPS URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    fail('URL_CREDENTIALS', 'Credentials in URLs are not allowed');
  }
  if (parsed.port && parsed.port !== '443') {
    fail('UNSAFE_PORT', 'Only the standard HTTPS port is allowed');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253 || !hostname.includes('.')) {
    fail('UNSAFE_HOST', 'A public fully-qualified hostname is required');
  }
  if (net.isIP(hostname)) fail('IP_LITERAL', 'IP address URLs are not allowed');
  if (BLOCKED_HOSTS.has(hostname) ||
      BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    fail('UNSAFE_HOST', 'Local and infrastructure hostnames are not allowed');
  }
  const labels = hostname.split('.');
  if (labels.some((label) =>
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  )) {
    fail('UNSAFE_HOST', 'Hostname labels are not valid');
  }

  parsed.hostname = hostname;
  parsed.port = '';
  parsed.hash = '';
  return parsed;
}

async function resolvePublicAddresses(hostname, options = {}) {
  const lookup = options.lookup || dns.promises.lookup;
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    fail('DNS_ERROR', 'The source hostname could not be resolved', { cause: error });
  }
  if (!Array.isArray(records)) records = records ? [records] : [];
  const normalized = records.map((record) => {
    if (typeof record === 'string') {
      return { address: record, family: net.isIP(record) };
    }
    return {
      address: String(record && record.address || ''),
      family: Number(record && record.family) || net.isIP(String(record && record.address || '')),
    };
  });
  if (!normalized.length || normalized.some((record) =>
    !record.address || ![4, 6].includes(record.family) || !isPublicIp(record.address)
  )) {
    fail('NON_PUBLIC_DNS', 'The source hostname does not resolve exclusively to public addresses');
  }

  const seen = new Set();
  return normalized.filter((record) => {
    const key = `${record.family}:${record.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.family - right.family);
}

function withDeadline(promise, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Promise.reject(new SafeRemoteFetchError('TIMEOUT', 'The source request timed out'));
  }
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(
        new SafeRemoteFetchError('TIMEOUT', 'The source request timed out')
      ), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function pinnedLookup(record) {
  return function lookup(_hostname, options, callback) {
    if (options && options.all) {
      callback(null, [{ address: record.address, family: record.family }]);
      return;
    }
    callback(null, record.address, record.family);
  };
}

function requestOnce(url, address, options) {
  const requestImpl = options.requestImpl || https.request;
  const maxBytes = options.maxBytes;
  const requestTimeoutMs = options.timeoutMs;
  const idleTimeoutMs = Math.min(options.idleTimeoutMs, requestTimeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (error) reject(error);
      else resolve(value);
    };
    const overallTimer = setTimeout(() => {
      const error = new SafeRemoteFetchError('TIMEOUT', 'The source request timed out');
      if (request && typeof request.destroy === 'function') request.destroy(error);
      finish(error);
    }, requestTimeoutMs);

    const requestOptions = {
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      method: 'GET',
      path: `${url.pathname || '/'}${url.search || ''}`,
      servername: url.hostname,
      rejectUnauthorized: true,
      agent: false,
      autoSelectFamily: false,
      lookup: pinnedLookup(address),
      headers: {
        'User-Agent': options.userAgent,
        Accept: options.accept,
        'Accept-Encoding': 'identity',
        Connection: 'close',
      },
    };

    try {
      request = requestImpl(requestOptions, (response) => {
        const statusCode = Number(response.statusCode) || 0;
        const headers = response.headers || {};

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          if (typeof response.resume === 'function') response.resume();
          finish(null, {
            statusCode,
            headers,
            redirectLocation: String(headers.location),
            body: Buffer.alloc(0),
          });
          return;
        }

        const declaredLength = Number(headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          if (typeof response.destroy === 'function') response.destroy();
          finish(new SafeRemoteFetchError('RESPONSE_TOO_LARGE', 'The source response exceeds the size limit'));
          return;
        }
        const contentEncoding = String(headers['content-encoding'] || 'identity').toLowerCase();
        if (contentEncoding && contentEncoding !== 'identity') {
          if (typeof response.destroy === 'function') response.destroy();
          finish(new SafeRemoteFetchError(
            'UNSUPPORTED_ENCODING',
            'Compressed source responses are not accepted'
          ));
          return;
        }

        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += value.length;
          if (size > maxBytes) {
            if (typeof response.destroy === 'function') response.destroy();
            finish(new SafeRemoteFetchError(
              'RESPONSE_TOO_LARGE',
              'The source response exceeds the size limit'
            ));
            return;
          }
          chunks.push(value);
        });
        response.once('end', () => finish(null, {
          statusCode,
          headers,
          redirectLocation: null,
          body: Buffer.concat(chunks, size),
        }));
        response.once('aborted', () => finish(
          new SafeRemoteFetchError('RESPONSE_ABORTED', 'The source response was interrupted')
        ));
        response.once('error', (error) => finish(
          new SafeRemoteFetchError('NETWORK_ERROR', 'The source response failed', { cause: error })
        ));
      });
    } catch (error) {
      finish(new SafeRemoteFetchError('NETWORK_ERROR', 'The source request could not start', {
        cause: error,
      }));
      return;
    }

    request.once('error', (error) => {
      if (error instanceof SafeRemoteFetchError) finish(error);
      else finish(new SafeRemoteFetchError('NETWORK_ERROR', 'The source request failed', {
        cause: error,
      }));
    });
    if (typeof request.setTimeout === 'function') {
      request.setTimeout(idleTimeoutMs, () => {
        const error = new SafeRemoteFetchError('TIMEOUT', 'The source request timed out');
        if (typeof request.destroy === 'function') request.destroy(error);
        finish(error);
      });
    }
    request.end();
  });
}

async function safeFetch(rawUrl, options = {}) {
  const maxBytes = Math.max(1, Math.min(
    Number(options.maxBytes) || DEFAULT_MAX_BYTES,
    DEFAULT_MAX_BYTES
  ));
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const idleTimeoutMs = Math.max(1, Number(options.idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS);
  const maxRedirects = Math.max(0, Math.min(
    Number.isInteger(options.maxRedirects) ? options.maxRedirects : DEFAULT_MAX_REDIRECTS,
    DEFAULT_MAX_REDIRECTS
  ));
  const startedAt = Date.now();
  let currentUrl = validateRemoteUrl(rawUrl);
  let redirects = 0;

  while (true) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    const addresses = await withDeadline(
      resolvePublicAddresses(currentUrl.hostname, { lookup: options.lookup }),
      remaining
    );
    const selected = addresses[redirects % addresses.length];
    const response = await requestOnce(currentUrl, selected, {
      requestImpl: options.requestImpl,
      maxBytes,
      timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)),
      idleTimeoutMs,
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
      accept: options.accept ||
        'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, text/plain;q=0.5',
    });

    if (response.redirectLocation) {
      if (redirects >= maxRedirects) {
        fail('TOO_MANY_REDIRECTS', 'The source redirected too many times');
      }
      let target;
      try {
        target = new URL(response.redirectLocation, currentUrl);
      } catch (error) {
        fail('INVALID_REDIRECT', 'The source returned an invalid redirect', { cause: error });
      }
      currentUrl = validateRemoteUrl(target.href);
      redirects += 1;
      continue;
    }

    return {
      url: currentUrl.href,
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
      text: response.body.toString('utf8'),
      bytes: response.body.length,
      redirects,
      durationMs: Date.now() - startedAt,
      resolvedFamily: selected.family,
    };
  }
}

function decodeXml(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => {
      const codePoint = parseInt(value, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&#(\d+);/g, (_, value) => {
      const codePoint = Number(value);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

function stripMarkup(value) {
  return decodeXml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(block, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(
      `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
      'i'
    ));
    if (match) return decodeXml(match[1]);
  }
  return '';
}

function atomLink(block) {
  const alternate = block.match(
    /<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i
  );
  if (alternate) return decodeXml(alternate[1]);
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return any ? decodeXml(any[1]) : '';
}

function normalizeItemLink(value, baseUrl) {
  if (!value) return '';
  try {
    const resolved = new URL(decodeXml(value), baseUrl);
    return validateRemoteUrl(resolved.href).href;
  } catch (error) {
    return '';
  }
}

function parseRss(xml, baseUrl, options = {}) {
  if (Buffer.isBuffer(xml)) xml = xml.toString('utf8');
  if (typeof xml !== 'string') fail('INVALID_RSS', 'RSS content must be text');
  if (Buffer.byteLength(xml, 'utf8') > DEFAULT_MAX_BYTES) {
    fail('RESPONSE_TOO_LARGE', 'RSS content exceeds the size limit');
  }
  if (/<!DOCTYPE/i.test(xml)) fail('INVALID_RSS', 'RSS documents with a DOCTYPE are not accepted');

  const maxItems = Math.max(1, Math.min(Number(options.maxItems) || 50, 100));
  const blocks = [];
  const itemPattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null && blocks.length < maxItems * 3) {
    blocks.push({ kind: match[1].toLowerCase(), body: match[2] });
  }

  const items = [];
  for (const block of blocks) {
    const title = stripMarkup(tagValue(block.body, ['title'])).slice(0, 500);
    const rawLink = block.kind === 'entry'
      ? atomLink(block.body) || tagValue(block.body, ['link'])
      : tagValue(block.body, ['link']);
    const link = normalizeItemLink(rawLink, baseUrl);
    if (!title || !link) continue;

    const rawDate = tagValue(block.body, ['pubDate', 'published', 'updated', 'dc:date']);
    const dateValue = rawDate && new Date(rawDate);
    const pubDate = dateValue && !Number.isNaN(dateValue.getTime())
      ? dateValue.toISOString()
      : '';
    const summary = stripMarkup(tagValue(
      block.body,
      ['description', 'summary', 'content:encoded', 'content']
    )).slice(0, 4000);
    const guid = stripMarkup(tagValue(block.body, ['guid', 'id'])).slice(0, 1000);
    const source = stripMarkup(tagValue(block.body, ['source', 'author'])).slice(0, 120);
    items.push({ title, link, guid, pubDate, summary, source });
    if (items.length >= maxItems) break;
  }
  return items;
}

function looksLikeBlockPage(text) {
  return /(?:cf-chl-|cloudflare ray id|captcha|access denied|verify you are human|unusual traffic|请求过于频繁|访问被拒绝)/i
    .test(String(text || '').slice(0, 64 * 1024));
}

function contentTypeIsRss(headers, text) {
  const contentType = String(headers && headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if ([
    'application/rss+xml',
    'application/atom+xml',
    'application/xml',
    'text/xml',
    'text/plain',
  ].includes(contentType)) return true;
  if (['text/html', 'application/octet-stream', ''].includes(contentType)) {
    return /<(?:rss|feed|rdf:RDF)\b/i.test(String(text || '').slice(0, 4096));
  }
  return false;
}

function redactUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function errorProbeResult(error) {
  const code = error && error.code || 'UNKNOWN_ERROR';
  return {
    ok: false,
    status: 'parse_error',
    reasonCode: code,
    detail: code === 'NON_PUBLIC_DNS' || code === 'IP_LITERAL' || code === 'UNSAFE_HOST'
      ? '该地址不属于可抓取的公网信源'
      : '无法安全读取或解析该 RSS 信源',
    items: [],
  };
}

async function probeRss(rawUrl, options = {}) {
  let result;
  try {
    result = await safeFetch(rawUrl, options);
  } catch (error) {
    return errorProbeResult(error);
  }

  if (BLOCKED_HTTP_STATUSES.has(result.statusCode) || looksLikeBlockPage(result.text)) {
    return {
      ok: false,
      status: 'blocked',
      reasonCode: `HTTP_${result.statusCode || 'CHALLENGE'}`,
      detail: '目标网站拒绝或限制了服务器抓取',
      httpStatus: result.statusCode,
      durationMs: result.durationMs,
      finalUrl: redactUrl(result.url),
      items: [],
    };
  }
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return {
      ok: false,
      status: 'parse_error',
      reasonCode: `HTTP_${result.statusCode || 'UNKNOWN'}`,
      detail: '目标网站没有返回可用的 RSS 内容',
      httpStatus: result.statusCode,
      durationMs: result.durationMs,
      finalUrl: redactUrl(result.url),
      items: [],
    };
  }
  if (!contentTypeIsRss(result.headers, result.text)) {
    return {
      ok: false,
      status: 'parse_error',
      reasonCode: 'UNSUPPORTED_CONTENT_TYPE',
      detail: '该地址返回的内容不是 RSS 或 Atom',
      httpStatus: result.statusCode,
      durationMs: result.durationMs,
      finalUrl: redactUrl(result.url),
      items: [],
    };
  }

  let items;
  try {
    items = parseRss(result.text, result.url, { maxItems: options.maxItems });
  } catch (error) {
    return {
      ...errorProbeResult(error),
      httpStatus: result.statusCode,
      durationMs: result.durationMs,
      finalUrl: redactUrl(result.url),
    };
  }
  if (!items.length) {
    return {
      ok: false,
      status: 'parse_error',
      reasonCode: 'NO_VALID_ITEMS',
      detail: '已访问该地址，但没有识别出包含安全原文链接的文章',
      httpStatus: result.statusCode,
      durationMs: result.durationMs,
      finalUrl: redactUrl(result.url),
      items: [],
    };
  }
  return {
    ok: true,
    status: 'normal',
    reasonCode: 'OK',
    detail: `成功识别 ${items.length} 篇文章`,
    httpStatus: result.statusCode,
    durationMs: result.durationMs,
    finalUrl: redactUrl(result.url),
    bytes: result.bytes,
    items,
  };
}

module.exports = {
  BLOCKED_HTTP_STATUSES,
  DEFAULT_MAX_BYTES,
  SafeRemoteFetchError,
  contentTypeIsRss,
  errorProbeResult,
  isPublicIp,
  isPublicIpv4,
  isPublicIpv6,
  looksLikeBlockPage,
  normalizeItemLink,
  parseRss,
  probeRss,
  redactUrl,
  resolvePublicAddresses,
  safeFetch,
  validateArticleUrl: validateRemoteUrl,
  validateRemoteUrl,
};
