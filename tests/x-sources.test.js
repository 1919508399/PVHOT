'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildXIndirectQuery,
  extractXArticleUrl,
  fetchXSources,
  normalizeExternalArticleUrl,
  parseXTimeline,
  probeXAccount,
  validXHandle,
} = require('../lib/x_sources');
const { X_ACCOUNTS } = require('../source_registry');

const ACCOUNT = {
  id: 'x-pv-magazine',
  name: 'PV Magazine Global',
  handle: 'pvmagazine',
  domains: ['pv-magazine.com'],
};

test('the built-in X registry contains 12 unique, valid, domain-pinned accounts', () => {
  assert.equal(X_ACCOUNTS.length, 12);
  assert.equal(new Set(X_ACCOUNTS.map((account) => account.id)).size, X_ACCOUNTS.length);
  assert.equal(
    new Set(X_ACCOUNTS.map((account) => account.handle.toLowerCase())).size,
    X_ACCOUNTS.length
  );
  for (const account of X_ACCOUNTS) {
    assert.equal(validXHandle(account.handle), true, account.handle);
    assert.ok(Array.isArray(account.domains) && account.domains.length > 0, account.handle);
    assert.equal(account.staleAfterHours, 168);
  }
});

test('X handles and article links are validated against the official publication domain', () => {
  assert.equal(validXHandle('pvmagazine'), true);
  assert.equal(validXHandle('bad-handle'), false);
  assert.equal(
    normalizeExternalArticleUrl('https://www.pv-magazine.com/2026/08/03/story/?utm_source=x#top', ACCOUNT.domains),
    'https://www.pv-magazine.com/2026/08/03/story/?utm_source=x'
  );
  assert.equal(normalizeExternalArticleUrl('https://x.com/pvmagazine/status/1', ACCOUNT.domains), '');
  assert.equal(normalizeExternalArticleUrl('https://lookalike.example/story', ACCOUNT.domains), '');

  assert.equal(extractXArticleUrl({
    entities: {
      urls: [{
        expanded_url: 'https://t.co/short',
        unwound_url: 'https://pv-magazine.com/2026/08/03/story/',
      }],
    },
  }, ACCOUNT), 'https://pv-magazine.com/2026/08/03/story/');
});

test('X timeline parsing keeps traceability but only emits official article links', () => {
  const result = parseXTimeline({
    data: [
      {
        id: '200',
        text: 'New solar record https://t.co/a',
        created_at: '2026-08-03T02:30:00.000Z',
        entities: { urls: [{ unwound_url: 'https://www.pv-magazine.com/solar-record/' }] },
        public_metrics: { like_count: 20, retweet_count: 4, reply_count: 1, quote_count: 2 },
      },
      {
        id: '199',
        text: 'A post without an article',
        created_at: '2026-08-03T01:00:00.000Z',
        entities: { urls: [{ expanded_url: 'https://x.com/pvmagazine/status/199' }] },
      },
    ],
  }, ACCOUNT);

  assert.equal(result.postsSeen, 2);
  assert.equal(result.newestPostId, '200');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]._xArticleDateConfirmed, false);
  assert.equal(result.items[0].link, 'https://www.pv-magazine.com/solar-record/');
  assert.equal(result.items[0].xPostUrl, 'https://x.com/pvmagazine/status/200');
  assert.equal(result.items[0].title, 'New solar record');
  assert.deepEqual(result.items[0].xMetrics, { likes: 20, reposts: 4, replies: 1, quotes: 2 });
});

test('custom X source keywords filter adopted articles without hiding account activity', () => {
  const result = parseXTimeline({
    data: [
      {
        id: '300', text: 'Wind market update https://t.co/a', created_at: '2026-08-03T04:00:00Z',
        entities: { urls: [{ expanded_url: 'https://example.com/wind/' }] },
      },
      {
        id: '301', text: 'Solar market update https://t.co/b', created_at: '2026-08-03T05:00:00Z',
        entities: { urls: [{ expanded_url: 'https://example.com/solar/' }] },
      },
    ],
  }, {
    id: 'custom-x', name: 'Custom X', handle: 'custom_x', custom: true,
    domains: [], keywords: ['solar'],
  });

  assert.equal(result.postsSeen, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].link, 'https://example.com/solar/');
});

test('missing X API credentials report blocked without making a network request', async () => {
  let requested = false;
  const results = await fetchXSources([ACCOUNT], { sources: [] }, {
    token: '',
    requestJson: async () => {
      requested = true;
      throw new Error('must not run');
    },
  });

  assert.equal(requested, false);
  assert.equal(results.length, 1);
  assert.equal(results[0].length, 0);
  assert.equal(results[0]._health.blocked, true);
  assert.equal(results[0]._health.errorCode, 'x_api_not_configured');
});

test('no-token indirect mode searches only registered official domains', async () => {
  const query = buildXIndirectQuery(ACCOUNT);
  assert.match(query, /site:pv-magazine\.com/);
  assert.doesNotMatch(query, /x\.com|twitter\.com/);

  let requestJsonCalled = false;
  let receivedQuery = '';
  const results = await fetchXSources([ACCOUNT], { sources: [] }, {
    token: '',
    requestJson: async () => { requestJsonCalled = true; },
    indirectSearch: async (_account, value) => {
      receivedQuery = value;
      return [{
        title: 'Official solar article',
        summary: 'A search-engine discovery that still requires official-page verification.',
        link: 'https://news.google.com/rss/articles/example',
        pubDate: '2026-08-03T04:00:00.000Z',
      }];
    },
  });

  assert.equal(requestJsonCalled, false);
  assert.equal(receivedQuery, query);
  assert.equal(results[0].length, 1);
  assert.equal(results[0][0]._xIndirect, true);
  assert.deepEqual(results[0][0]._xAllowedDomains, ['pv-magazine.com']);
  assert.equal(results[0][0]._xArticleDateConfirmed, false);
  assert.equal(results[0][0].xPostUrl, undefined);
  assert.equal(results[0]._health.blocked, false);
  assert.equal(results[0]._health.mode, 'search-indirect');
  assert.match(results[0]._health.detail, /未使用 X 官方 API/);
});

test('no-token indirect mode refuses an X account without a verified official domain', async () => {
  let searched = false;
  const results = await fetchXSources([{
    id:'custom-x', name:'Custom X', handle:'custom_x', domains:[], custom:true,
  }], { sources: [] }, {
    token: '',
    indirectSearch: async () => { searched = true; return []; },
  });

  assert.equal(searched, false);
  assert.equal(results[0].length, 0);
  assert.equal(results[0]._health.blocked, true);
  assert.equal(results[0]._health.errorCode, 'x_indirect_official_domain_missing');
});

test('manual X account probe verifies the handle through the official API', async () => {
  let requestPath = '';
  const result = await probeXAccount('pvmagazine', {
    token: 'test-token',
    requestJson: async (pathname) => {
      requestPath = pathname;
      return {
        ok: true,
        statusCode: 200,
        durationMs: 4,
        json: { data: [{ id: '42', username: 'pvmagazine' }] },
      };
    },
  });

  assert.match(requestPath, /^\/2\/users\/by\?/);
  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'X_ACCOUNT_VERIFIED');
  assert.equal(result.xUserId, '42');
});

test('manual X account probe reports a missing official account honestly', async () => {
  const result = await probeXAccount('unknownsolar', {
    token: 'test-token',
    requestJson: async () => ({
      ok: true,
      statusCode: 200,
      durationMs: 4,
      json: { data: [] },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'parse_error');
  assert.equal(result.reasonCode, 'X_USER_NOT_FOUND');
});

test('X API fetching caches user id, sends since_id, and records adopted articles', async () => {
  const paths = [];
  const prior = {
    sources: [{ id: ACCOUNT.id, xUserId: '42', lastPostId: '150' }],
  };
  const results = await fetchXSources([ACCOUNT], prior, {
    token: 'test-token',
    requestJson: async (pathname) => {
      paths.push(pathname);
      return {
        ok: true,
        statusCode: 200,
        durationMs: 3,
        json: {
          data: [{
            id: '201',
            text: 'Solar manufacturing update https://t.co/a',
            created_at: '2026-08-03T03:00:00Z',
            entities: { urls: [{ expanded_url: 'https://pv-magazine.com/manufacturing/' }] },
          }],
        },
      };
    },
  });

  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/2\/users\/42\/tweets\?/);
  assert.match(paths[0], /since_id=150/);
  assert.equal(results[0].length, 1);
  assert.equal(results[0]._health.newItems, 1);
  assert.equal(results[0]._health.lastPostId, '201');
  assert.equal(results[0]._health.articlesAccepted, 1);
});

test('ordinary X posts do not count as newly adopted articles in source health', async () => {
  const results = await fetchXSources([ACCOUNT], {
    sources: [{ id: ACCOUNT.id, xHandle: ACCOUNT.handle, xUserId: '42', lastPostId: '150' }],
  }, {
    token: 'test-token',
    requestJson: async () => ({
      ok: true,
      statusCode: 200,
      durationMs: 2,
      json: {
        data: [{ id: '201', text: 'A short update without a link', created_at: '2026-08-03T03:00:00Z' }],
      },
    }),
  });

  assert.equal(results[0]._health.postsSeen, 1);
  assert.equal(results[0]._health.articlesAccepted, 0);
  assert.equal(results[0]._health.newItems, 0);
});

test('X API fetching follows pagination before advancing the saved post id', async () => {
  const paths = [];
  const prior = {
    sources: [{ id: ACCOUNT.id, xHandle: ACCOUNT.handle, xUserId: '42', lastPostId: '150' }],
  };
  const results = await fetchXSources([ACCOUNT], prior, {
    token: 'test-token',
    requestJson: async (pathname) => {
      paths.push(pathname);
      const secondPage = pathname.includes('pagination_token=page-2');
      return {
        ok: true,
        statusCode: 200,
        durationMs: 2,
        json: {
          data: [{
            id: secondPage ? '204' : '205',
            text: `Solar article ${secondPage ? 'two' : 'one'} https://t.co/a`,
            created_at: secondPage ? '2026-08-03T02:00:00Z' : '2026-08-03T03:00:00Z',
            entities: { urls: [{ expanded_url: `https://pv-magazine.com/article-${secondPage ? 'two' : 'one'}/` }] },
          }],
          meta: secondPage ? {} : { next_token: 'page-2' },
        },
      };
    },
  });

  assert.equal(paths.length, 2);
  assert.doesNotMatch(paths[0], /pagination_token=/);
  assert.match(paths[1], /pagination_token=page-2/);
  assert.equal(results[0].length, 2);
  assert.equal(results[0]._health.lastPostId, '205');
  assert.equal(results[0]._health.postsSeen, 2);
  assert.equal(results[0]._health.pages, 2);
});

test('an X pagination failure discards the partial batch and preserves the saved post id', async () => {
  let calls = 0;
  const prior = {
    sources: [{ id: ACCOUNT.id, xHandle: ACCOUNT.handle, xUserId: '42', lastPostId: '150' }],
  };
  const results = await fetchXSources([ACCOUNT], prior, {
    token: 'test-token',
    requestJson: async () => {
      calls += 1;
      if (calls === 2) {
        return {
          ok: false,
          statusCode: 503,
          durationMs: 2,
          blocked: false,
          parseError: true,
          errorCode: 'x_http_503',
          detail: 'temporary outage',
        };
      }
      return {
        ok: true,
        statusCode: 200,
        durationMs: 2,
        json: {
          data: [{
            id: '205', text: 'Solar article https://t.co/a', created_at: '2026-08-03T03:00:00Z',
            entities: { urls: [{ expanded_url: 'https://pv-magazine.com/article-one/' }] },
          }],
          meta: { next_token: 'page-2' },
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(results[0].length, 0);
  assert.equal(results[0]._health.lastPostId, '150');
  assert.equal(results[0]._health.errorCode, 'x_http_503');
});

test('editing a custom X handle invalidates the cached user id and since_id', async () => {
  const paths = [];
  const account = { ...ACCOUNT, id: 'custom-x', handle: 'new_handle', domains: [] };
  const prior = {
    sources: [{ id: account.id, xHandle: 'old_handle', xUserId: '42', lastPostId: '150' }],
  };
  await fetchXSources([account], prior, {
    token: 'test-token',
    requestJson: async (pathname) => {
      paths.push(pathname);
      if (pathname.startsWith('/2/users/by?')) {
        return {
          ok: true, statusCode: 200, durationMs: 1,
          json: { data: [{ id: '99', username: 'new_handle' }] },
        };
      }
      return { ok: true, statusCode: 200, durationMs: 1, json: { data: [] } };
    },
  });

  assert.equal(paths.length, 2);
  assert.match(paths[0], /^\/2\/users\/by\?/);
  assert.match(paths[1], /^\/2\/users\/99\/tweets\?/);
  assert.doesNotMatch(paths[1], /since_id=/);
});

test('X API authorization and quota failures map to blocked health diagnostics', async () => {
  const results = await fetchXSources([ACCOUNT], { sources: [] }, {
    token: 'test-token',
    requestJson: async () => ({
      ok: false,
      statusCode: 429,
      durationMs: 2,
      blocked: true,
      parseError: false,
      errorCode: 'x_http_429',
      detail: 'quota reached',
    }),
  });

  assert.equal(results[0]._health.blocked, true);
  assert.equal(results[0]._health.parseError, false);
  assert.equal(results[0]._health.httpStatus, 429);
});

test('an unexpected X request exception stays isolated from the main fetch job', async () => {
  const results = await fetchXSources([ACCOUNT], { sources: [] }, {
    token: 'test-token',
    requestJson: async () => { throw new Error('network failed'); },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].length, 0);
  assert.equal(results[0]._health.parseError, true);
  assert.equal(results[0]._health.errorCode, 'x_api_request_failed');
});
