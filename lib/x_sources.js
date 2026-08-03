'use strict';

const https = require('node:https');

const X_API_ORIGIN = 'https://api.x.com';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const BLOCKED_STATUSES = new Set([401, 403, 407, 429, 451]);
const EXCLUDED_LINK_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  't.co',
]);

function attachHealth(items, diagnostics) {
  Object.defineProperty(items, '_health', {
    value: diagnostics || {},
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return items;
}

function validXHandle(value) {
  return X_HANDLE_RE.test(String(value || '').replace(/^@/, ''));
}

function validXApiToken(value) {
  const token = String(value == null ? '' : value).trim();
  return token.length > 0 && token.length <= 4096 && !/[\r\n]/.test(token);
}

function normalizedHandle(value) {
  const handle = String(value || '').trim().replace(/^@/, '');
  return validXHandle(handle) ? handle : '';
}

function hostnameMatches(hostname, domains) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const allowed = (Array.isArray(domains) ? domains : [])
    .map((domain) => String(domain || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, ''))
    .filter(Boolean);
  if (!allowed.length) return true;
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function normalizeExternalArticleUrl(value, domains) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return '';
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || EXCLUDED_LINK_HOSTS.has(hostname)) return '';
    if (/^(?:localhost|.+\.localhost)$/.test(hostname)) return '';
    if (/^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) return '';
    if (!hostnameMatches(hostname, domains)) return '';
    if (!parsed.pathname || parsed.pathname === '/') return '';
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return '';
  }
}

function extractXArticleUrl(post, account) {
  const links = post && post.entities && Array.isArray(post.entities.urls)
    ? post.entities.urls
    : [];
  for (const link of links) {
    for (const value of [link && link.unwound_url, link && link.expanded_url]) {
      const articleUrl = normalizeExternalArticleUrl(value, account && account.domains);
      if (articleUrl) return articleUrl;
    }
  }
  return '';
}

function cleanPostText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function newerSnowflake(current, candidate) {
  const a = String(current || '');
  const b = String(candidate || '');
  if (!b) return a;
  if (!a) return b;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    try { return BigInt(b) > BigInt(a) ? b : a; } catch (error) {}
  }
  return b > a ? b : a;
}

function parseXTimeline(payload, account) {
  const handle = normalizedHandle(account && account.handle);
  if (!handle) throw new Error('invalid X handle');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('X API returned an invalid response');
  }
  if (payload.data == null && (!payload.meta || (Array.isArray(payload.errors) && payload.errors.length))) {
    throw new Error('X API timeline response is incomplete');
  }
  const posts = payload.data == null ? [] : payload.data;
  if (!Array.isArray(posts)) throw new Error('X API timeline data is not an array');

  const items = [];
  let newestPostId = '';
  let latestPostAt = '';
  for (const post of posts) {
    if (!post || typeof post !== 'object' || !post.id) continue;
    newestPostId = newerSnowflake(newestPostId, post.id);
    const createdAt = typeof post.created_at === 'string' && !Number.isNaN(Date.parse(post.created_at))
      ? new Date(post.created_at).toISOString()
      : '';
    if (createdAt && (!latestPostAt || Date.parse(createdAt) > Date.parse(latestPostAt))) {
      latestPostAt = createdAt;
    }
    const articleUrl = extractXArticleUrl(post, account);
    if (!articleUrl || !createdAt) continue;
    const text = cleanPostText(post.text);
    const keywords = account && account.custom && Array.isArray(account.keywords)
      ? account.keywords.map((keyword) => String(keyword || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (keywords.length && !keywords.some((keyword) => text.toLowerCase().includes(keyword))) continue;
    const metrics = post.public_metrics && typeof post.public_metrics === 'object'
      ? {
        likes: Number(post.public_metrics.like_count) || 0,
        reposts: Number(post.public_metrics.retweet_count) || 0,
        replies: Number(post.public_metrics.reply_count) || 0,
        quotes: Number(post.public_metrics.quote_count) || 0,
      }
      : null;
    items.push({
      title: text.slice(0, 260) || `${account.name || `@${handle}`} 发布新文章`,
      summary: text.slice(0, 500),
      link: articleUrl,
      pubDate: createdAt,
      source: account.name || `@${handle}`,
      xPostUrl: `https://x.com/${handle}/status/${post.id}`,
      xHandle: handle,
      xSignalCount: 1,
      xMetrics: metrics,
      _xSourceId: account.id || `x:${handle.toLowerCase()}`,
      // X only discovers the official article. The article's own publication
      // date must be confirmed during enrichment before it can be published.
      _xArticleDateConfirmed: false,
      ...(account.custom ? {
        _customSourceId: account.id,
        _customSourceType: 'x',
      } : {}),
    });
  }
  return {
    items,
    postsSeen: posts.length,
    newestPostId,
    latestPostAt,
  };
}

function apiFailure(statusCode, durationMs, code, detail) {
  const blocked = BLOCKED_STATUSES.has(Number(statusCode));
  return {
    ok: false,
    statusCode: Number(statusCode) || null,
    durationMs,
    blocked,
    parseError: !blocked,
    errorCode: code || (statusCode ? `x_http_${statusCode}` : 'x_api_error'),
    detail: detail || (blocked ? `X API 拒绝访问（HTTP ${statusCode}）` : 'X API 请求失败'),
  };
}

function requestXJson(pathname, token, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const startedAt = Date.now();
  const url = new URL(pathname, X_API_ORIGIN);
  if (url.origin !== X_API_ORIGIN || !url.pathname.startsWith('/2/')) {
    return Promise.resolve(apiFailure(null, 0, 'x_invalid_api_path', 'X API 请求路径无效'));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'PVHOT-X-Monitor/1.0',
      },
    }, (res) => {
      const statusCode = Number(res.statusCode) || null;
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (settled) return;
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (size > maxBytes) {
          req.destroy();
          finish(apiFailure(statusCode, Date.now() - startedAt, 'x_response_too_large', 'X API 返回内容过大'));
          return;
        }
        chunks.push(value);
      });
      res.on('end', () => {
        if (settled) return;
        const durationMs = Date.now() - startedAt;
        const body = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = body ? JSON.parse(body) : {};
        } catch (error) {
          finish(apiFailure(statusCode, durationMs, 'x_invalid_json', 'X API 返回内容无法解析'));
          return;
        }
        if (statusCode !== 200) {
          const apiDetail = Array.isArray(json.errors) && json.errors[0]
            ? (json.errors[0].detail || json.errors[0].title)
            : (json.detail || json.title || '');
          finish(apiFailure(statusCode, durationMs, null, String(apiDetail || '').slice(0, 300)));
          return;
        }
        finish({ ok: true, statusCode, durationMs, json });
      });
    });
    req.on('error', (error) => {
      finish(apiFailure(null, Date.now() - startedAt, `x_${String(error.code || 'network_error').toLowerCase()}`, 'X API 网络请求失败'));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(apiFailure(null, Date.now() - startedAt, 'x_timeout', 'X API 请求超时'));
    });
  });
}

async function probeXAccount(handleValue, options = {}) {
  const handle = normalizedHandle(handleValue);
  const token = String(options.token == null ? process.env.PVHOT_X_BEARER_TOKEN || '' : options.token).trim();
  const requestJson = options.requestJson || requestXJson;
  if (!validXHandle(handle)) {
    return {
      ok: false,
      status: 'parse_error',
      reasonCode: 'INVALID_X_HANDLE',
      detail: 'X 账号格式无效',
      configured: validXApiToken(token),
      items: [],
    };
  }
  if (!token) {
    return {
      ok: false,
      status: 'blocked',
      reasonCode: 'X_API_NOT_CONFIGURED',
      detail: 'X 账号格式已验证，但服务器尚未配置 X 官方 API；账号可以先保存并等待配置',
      mode: 'x-official-api',
      configured: false,
      items: [],
    };
  }
  if (!validXApiToken(token)) {
    return {
      ok: false,
      status: 'blocked',
      reasonCode: 'X_API_INVALID_TOKEN_FORMAT',
      detail: '服务器上的 X API 凭证格式无效，请由管理员重新配置',
      mode: 'x-official-api',
      configured: false,
      items: [],
    };
  }

  let response;
  try {
    response = await requestJson(
      `/2/users/by?usernames=${encodeURIComponent(handle)}&user.fields=id,username`,
      token,
      options
    );
  } catch (error) {
    response = apiFailure(null, null, 'x_api_request_failed', 'X API 请求异常');
  }
  if (!response || !response.ok) {
    return {
      ok: false,
      status: response && response.blocked ? 'blocked' : 'parse_error',
      reasonCode: String(response && response.errorCode || 'x_api_error').toUpperCase(),
      detail: response && response.detail || '暂时无法通过 X 官方 API 核验账号',
      httpStatus: response && response.statusCode || null,
      durationMs: response && response.durationMs || null,
      mode: 'x-official-api',
      configured: true,
      items: [],
    };
  }
  const users = response.json && Array.isArray(response.json.data) ? response.json.data : [];
  const user = users.find((candidate) =>
    String(candidate && candidate.username || '').toLowerCase() === handle.toLowerCase()
  );
  if (!user || !user.id) {
    return {
      ok: false,
      status: 'parse_error',
      reasonCode: 'X_USER_NOT_FOUND',
      detail: `X 官方 API 未找到账号 @${handle}，请检查名称是否正确`,
      httpStatus: response.statusCode || null,
      durationMs: response.durationMs || null,
      mode: 'x-official-api',
      configured: true,
      items: [],
    };
  }
  return {
    ok: true,
    status: 'no_new',
    reasonCode: 'X_ACCOUNT_VERIFIED',
    detail: `已通过 X 官方 API 核验 @${handle}，保存后会进入定时监控`,
    httpStatus: response.statusCode || 200,
    durationMs: response.durationMs || null,
    mode: 'x-official-api',
    configured: true,
    xUserId: String(user.id),
    items: [],
  };
}

function diagnosticsFromFailure(result, extra = {}) {
  return {
    ok: false,
    blocked: result && result.blocked === true,
    parseError: !(result && result.blocked === true),
    httpStatus: result && result.statusCode || null,
    durationMs: result && result.durationMs || null,
    errorCode: result && result.errorCode || 'x_api_error',
    detail: result && result.detail || 'X API 请求失败',
    newItems: 0,
    ...extra,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, run));
  return output;
}

function previousSourceMap(report) {
  const sources = report && Array.isArray(report.sources) ? report.sources : [];
  return new Map(sources.map((source) => [String(source.id), source]));
}

function previousForAccount(priorById, account) {
  const prior = priorById.get(String(account && account.id)) || {};
  const currentHandle = normalizedHandle(account && account.handle).toLowerCase();
  const previousHandle = normalizedHandle(prior.xHandle || prior.handle).toLowerCase();
  // A custom source keeps its id when edited. Never reuse another account's
  // cached user id or since_id after the handle changes.
  return previousHandle && currentHandle && previousHandle !== currentHandle ? {} : prior;
}

async function fetchXSources(accounts, previousReport, options = {}) {
  const configs = Array.isArray(accounts) ? accounts : [];
  const token = String(options.token == null ? process.env.PVHOT_X_BEARER_TOKEN || '' : options.token).trim();
  const requestJson = options.requestJson || requestXJson;
  const priorById = previousSourceMap(previousReport);
  const results = new Array(configs.length);
  const lookupFailures = new Map();

  if (!token) {
    configs.forEach((account, index) => {
      const prior = previousForAccount(priorById, account);
      results[index] = attachHealth([], {
        ok: false,
        blocked: true,
        parseError: false,
        errorCode: 'x_api_not_configured',
        detail: '未配置 X 官方 API；官网、RSS 等信源仍正常工作',
        newItems: 0,
        xHandle: normalizedHandle(account.handle),
        xUserId: prior.xUserId || '',
        lastPostId: prior.lastPostId || '',
      });
    });
    return results;
  }
  if (!validXApiToken(token)) {
    configs.forEach((account, index) => {
      results[index] = attachHealth([], {
        ok: false,
        blocked: true,
        parseError: false,
        errorCode: 'x_api_invalid_token_format',
        detail: 'X API 凭证格式无效，请在服务器安全配置中重新设置',
        newItems: 0,
        xHandle: normalizedHandle(account.handle),
      });
    });
    return results;
  }

  const safeRequestJson = async (pathname) => {
    try {
      return await requestJson(pathname, token, options);
    } catch (error) {
      return apiFailure(null, null, 'x_api_request_failed', 'X API 请求异常');
    }
  };

  const userIds = new Map();
  const missing = [];
  configs.forEach((account) => {
    const prior = previousForAccount(priorById, account);
    if (prior.xUserId) userIds.set(String(account.id), String(prior.xUserId));
    else missing.push(account);
  });

  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const handles = batch.map((account) => normalizedHandle(account.handle)).filter(Boolean);
    if (!handles.length) continue;
    const lookup = await safeRequestJson(
      `/2/users/by?usernames=${encodeURIComponent(handles.join(','))}&user.fields=id,username`,
    );
    if (!lookup.ok) {
      batch.forEach((account) => {
        lookupFailures.set(String(account.id), lookup);
      });
      continue;
    }
    const users = lookup.json && Array.isArray(lookup.json.data) ? lookup.json.data : [];
    const byHandle = new Map(users.map((user) => [String(user.username || '').toLowerCase(), user]));
    batch.forEach((account) => {
      const handle = normalizedHandle(account.handle);
      const user = byHandle.get(handle.toLowerCase());
      if (user && user.id) userIds.set(String(account.id), String(user.id));
      else lookupFailures.set(
        String(account.id),
        apiFailure(404, lookup.durationMs, 'x_user_not_found', `找不到 X 账号 @${handle}`)
      );
    });
  }

  const fetched = await mapWithConcurrency(configs, Math.max(1, Math.min(6, Number(options.concurrency) || 3)), async (account) => {
    const handle = normalizedHandle(account.handle);
    const prior = previousForAccount(priorById, account);
    const xUserId = userIds.get(String(account.id));
    if (!xUserId) {
      return attachHealth([], diagnosticsFromFailure(lookupFailures.get(String(account.id)), {
        xHandle: handle,
        xUserId: '',
        lastPostId: prior.lastPostId || '',
      }));
    }
    const baseParams = new URLSearchParams({
      max_results: String(Math.max(5, Math.min(100, Number(options.maxResults) || 100))),
      exclude: 'retweets,replies',
      'tweet.fields': 'created_at,entities,public_metrics,referenced_tweets',
    });
    if (prior.lastPostId && /^\d+$/.test(String(prior.lastPostId))) {
      baseParams.set('since_id', String(prior.lastPostId));
    } else {
      const lookbackDays = Math.max(1, Math.min(30, Number(options.initialLookbackDays) || 8));
      const startTime = options.startTime || new Date(Date.now() - lookbackDays * 86400000).toISOString();
      baseParams.set('start_time', String(startTime).replace(/\.\d{3}Z$/, 'Z'));
    }
    const maxPages = Math.max(1, Math.min(20, Number(options.maxPages) || 5));
    const adopted = [];
    let postsSeen = 0;
    let newestPostId = '';
    let latestPostAt = '';
    let paginationToken = '';
    let totalDurationMs = 0;
    let lastHttpStatus = 200;
    let pages = 0;
    while (pages < maxPages) {
      const params = new URLSearchParams(baseParams);
      if (paginationToken) params.set('pagination_token', paginationToken);
      const response = await safeRequestJson(`/2/users/${encodeURIComponent(xUserId)}/tweets?${params}`);
      totalDurationMs += Number(response.durationMs) || 0;
      lastHttpStatus = response.statusCode || lastHttpStatus;
      if (!response.ok) {
        return attachHealth([], diagnosticsFromFailure(response, {
          durationMs: totalDurationMs,
          xHandle: handle,
          xUserId,
          lastPostId: prior.lastPostId || '',
        }));
      }
      let parsed;
      try {
        parsed = parseXTimeline(response.json, account);
      } catch (error) {
        return attachHealth([], {
          ok: false,
          parseError: true,
          blocked: false,
          httpStatus: lastHttpStatus,
          durationMs: totalDurationMs,
          errorCode: 'x_timeline_parse_error',
          detail: 'X API 返回结构发生变化，暂未采用内容',
          newItems: 0,
          xHandle: handle,
          xUserId,
          lastPostId: prior.lastPostId || '',
        });
      }
      pages += 1;
      adopted.push(...parsed.items);
      postsSeen += parsed.postsSeen;
      newestPostId = newerSnowflake(newestPostId, parsed.newestPostId);
      if (parsed.latestPostAt && (!latestPostAt || Date.parse(parsed.latestPostAt) > Date.parse(latestPostAt))) {
        latestPostAt = parsed.latestPostAt;
      }
      paginationToken = response.json && response.json.meta && response.json.meta.next_token
        ? String(response.json.meta.next_token)
        : '';
      if (!paginationToken) break;
    }
    if (paginationToken) {
      return attachHealth([], {
        ok: false,
        parseError: true,
        blocked: false,
        httpStatus: lastHttpStatus,
        durationMs: totalDurationMs,
        errorCode: 'x_pagination_incomplete',
        detail: `X 账号新帖超过单轮 ${maxPages * Number(baseParams.get('max_results'))} 条，未推进抓取位置以防漏稿`,
        newItems: 0,
        xHandle: handle,
        xUserId,
        lastPostId: prior.lastPostId || '',
      });
    }
    const uniqueItems = [...new Map(adopted.map((item) => [`${item.xPostUrl}|${item.link}`, item])).values()];
    const lastPostId = newerSnowflake(prior.lastPostId, newestPostId);
    return attachHealth(uniqueItems, {
      ok: true,
      parsed: true,
      parseError: false,
      blocked: false,
      httpStatus: lastHttpStatus,
      durationMs: totalDurationMs,
      errorCode: null,
      detail: postsSeen
        ? `读取 ${postsSeen} 条新帖，采用 ${uniqueItems.length} 条官网文章（${pages} 页）`
        : '本轮没有新帖',
      // Health status follows usable articles; account activity remains
      // separately visible as postsSeen/itemsSeen in the admin panel.
      newItems: uniqueItems.length,
      latestItemAt: latestPostAt || prior.lastItemAt || null,
      xHandle: handle,
      xUserId,
      lastPostId,
      postsSeen,
      articlesAccepted: uniqueItems.length,
      pages,
    });
  });
  return fetched;
}

module.exports = {
  X_API_ORIGIN,
  extractXArticleUrl,
  fetchXSources,
  normalizeExternalArticleUrl,
  normalizedHandle,
  parseXTimeline,
  probeXAccount,
  requestXJson,
  validXApiToken,
  validXHandle,
};
