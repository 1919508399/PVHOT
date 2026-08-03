'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  CustomSourceError,
  MAX_CUSTOM_SOURCES,
  addCustomSource,
  buildGoogleNewsSiteQuery,
  createCustomSource,
  createEmptyRegistry,
  customWebsiteQuery,
  fetchCustomRss,
  isSafeCustomArticleUrl,
  loadCustomSources,
  normalizeKeywords,
  normalizeXUrl,
  probeCustomSource,
  saveCustomSources,
  updateCustomSource,
  validateRegistry,
} = require('../lib/custom_sources');
const {
  DEFAULT_MAX_BYTES,
  SafeRemoteFetchError,
  isPublicIp,
  parseRss,
  probeRss,
  resolvePublicAddresses,
  safeFetch,
  validateArticleUrl,
  validateRemoteUrl,
} = require('../lib/safe_remote_fetch');

const FIXED_NOW = new Date('2026-07-30T02:00:00.000Z');
const FIXED_UUID = '123e4567-e89b-42d3-a456-426614174000';

function temporaryRegistry(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-custom-sources-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'custom_sources.json');
}

function makeUuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function publicLookup(map = {}) {
  return async (hostname) => map[hostname] || [{ address: '93.184.216.34', family: 4 }];
}

function fakeRequest(routes, observations = []) {
  return (options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = (milliseconds, handler) => {
      request.idleTimeout = { milliseconds, handler };
    };
    request.destroy = (error) => {
      if (request.destroyed) return;
      request.destroyed = true;
      if (error) process.nextTick(() => request.emit('error', error));
    };
    request.end = () => {
      const route = routes[options.path] || routes.default;
      if (!route || route.never) return;
      options.lookup(options.hostname, { all: false }, (error, address, family) => {
        observations.push({
          hostname: options.hostname,
          path: options.path,
          address,
          family,
          error,
        });
      });
      process.nextTick(() => {
        if (route.error) {
          request.emit('error', route.error);
          return;
        }
        const body = Buffer.isBuffer(route.body)
          ? route.body
          : Buffer.from(route.body || '', 'utf8');
        const response = Readable.from(route.chunks || [body]);
        response.statusCode = route.statusCode == null ? 200 : route.statusCode;
        response.headers = {
          'content-type': 'application/rss+xml; charset=utf-8',
          ...(route.headers || {}),
        };
        callback(response);
      });
    };
    return request;
  };
}

test('keywords accept English/Chinese comma text and are deduplicated', () => {
  assert.deepEqual(
    normalizeKeywords('光伏, solar，组件；SOLAR\n价格'),
    ['光伏', 'solar', '组件', '价格']
  );
});

test('custom source text rejects unreadable encoding artifacts', () => {
  assert.throws(() => createCustomSource({
    name: '异常' + String.fromCharCode(0xFFFD) + '信源',
    type: 'website',
    url: 'https://example.com',
    keywords: '光伏',
    category: '组件',
  }), (error) => error instanceof CustomSourceError && error.code === 'INVALID_FIELD');
});

test('server creates the source id and normalizes website sources to a site domain', () => {
  const source = createCustomSource({
    name: '示例光伏网站',
    type: 'website',
    url: 'news.example.com/private/path?tracking=discarded',
    keywords: '光伏, solar',
    category: '组件',
  }, {
    now: FIXED_NOW,
    randomUUID: () => FIXED_UUID,
  });

  assert.equal(source.id, `custom-${FIXED_UUID}`);
  assert.equal(source.url, 'https://news.example.com/');
  assert.deepEqual(source.keywords, ['光伏', 'solar']);
  assert.equal(source.category, '组件');
  assert.equal(
    buildGoogleNewsSiteQuery(source),
    'site:news.example.com (光伏 OR solar)'
  );
});

test('caller cannot provide an id and category/type are allowlisted', () => {
  assert.throws(() => createCustomSource({
    id: 'caller-controlled',
    name: 'bad',
    type: 'website',
    url: 'example.com',
  }), (error) => error instanceof CustomSourceError && error.code === 'UNSUPPORTED_FIELD');

  assert.throws(() => createCustomSource({
    name: 'bad category',
    type: 'rss',
    url: 'https://example.com/feed.xml',
    category: '财经',
  }), (error) => error instanceof CustomSourceError && error.code === 'INVALID_CATEGORY');

  assert.throws(() => createCustomSource({
    name: 'bad type',
    type: 'script',
    url: 'https://example.com/',
  }), (error) => error instanceof CustomSourceError && error.code === 'INVALID_SOURCE_TYPE');
});

test('RSS sources require safe HTTPS and WeChat uses keywords instead of URLs', () => {
  assert.throws(() => createCustomSource({
    name: 'HTTP feed',
    type: 'rss',
    url: 'http://example.com/feed.xml',
  }), (error) => error instanceof CustomSourceError && error.code === 'INVALID_SOURCE_URL');

  const wechat = createCustomSource({
    name: '光伏公众号',
    type: 'wechat',
    keywords: '',
  }, {
    now: FIXED_NOW,
    randomUUID: () => FIXED_UUID,
  });
  assert.equal(wechat.url, '');
  assert.deepEqual(wechat.keywords, ['光伏公众号']);

  assert.throws(() => createCustomSource({
    name: 'unsafe WeChat',
    type: 'wechat',
    url: 'https://mp.weixin.qq.com/',
  }), (error) => error instanceof CustomSourceError &&
    error.code === 'WECHAT_URL_NOT_ALLOWED');
});

test('X sources accept handles and profile URLs while storing one canonical URL', async () => {
  for (const value of [
    '@PV_Tech',
    'PV_Tech',
    'x.com/PV_Tech',
    'twitter.com/PV_Tech',
    'https://www.x.com/PV_Tech/',
    'https://twitter.com/PV_Tech/',
  ]) {
    assert.equal(normalizeXUrl(value), 'https://x.com/pv_tech', value);
  }

  const source = createCustomSource({
    name: 'PV Tech on X',
    type: 'x',
    url: '@PV_Tech',
    category: 'ALL',
  }, { now: FIXED_NOW, randomUUID: () => FIXED_UUID });
  assert.equal(source.url, 'https://x.com/pv_tech');
  assert.equal(source.staleAfterHours, 168);
  assert.deepEqual(source.keywords, []);

  const probe = await probeCustomSource(source);
  assert.equal(probe.mode, 'x-official-api');
  assert.equal(probe.probeStatus, 'pending');
  assert.equal(probe.reasonCode, 'WAITING_FOR_X_FETCH');
  assert.doesNotMatch(probe.detail, /token\s*[:=]\s*\S+/i);
});

test('X source validation rejects post pages, credentials, ports and invalid handles', () => {
  const invalid = [
    'http://x.com/pvmagazine',
    'https://user:pass@x.com/pvmagazine',
    'https://x.com:8443/pvmagazine',
    'https://example.com/pvmagazine',
    'https://x.com/pvmagazine/status/123456',
    'https://x.com/pvmagazine/lists/solar',
    'https://x.com/pvmagazine?lang=en',
    'https://x.com/pvmagazine#post',
    'https://x.com/pv-magazine',
    '@this_handle_is_far_too_long',
    'https://x.com/home',
  ];
  for (const value of invalid) {
    assert.throws(
      () => normalizeXUrl(value),
      (error) => error instanceof CustomSourceError &&
        ['INVALID_X_URL', 'INVALID_X_HANDLE'].includes(error.code),
      value
    );
  }
});

test('add/load/update uses atomic strict registry data and rejects duplicate URLs', (t) => {
  const file = temporaryRegistry(t);
  assert.deepEqual(loadCustomSources(file), createEmptyRegistry());

  const first = addCustomSource(file, {
    name: 'Feed A',
    type: 'rss',
    url: 'https://feeds.example.com/rss',
    keywords: 'solar',
  }, {
    now: FIXED_NOW,
    randomUUID: () => FIXED_UUID,
  });
  assert.equal(first.registry.revision, 1);
  assert.equal(loadCustomSources(file).sources.length, 1);

  assert.throws(() => addCustomSource(file, {
    name: 'Duplicate feed',
    type: 'rss',
    url: 'https://feeds.example.com/rss',
  }, {
    now: new Date(FIXED_NOW.getTime() + 1000),
    randomUUID: () => makeUuid(2),
  }), (error) => error instanceof CustomSourceError && error.code === 'DUPLICATE_URL');

  const changed = updateCustomSource(file, first.source.id, {
    enabled: false,
    keywords: '组件，电池片',
  }, { now: new Date(FIXED_NOW.getTime() + 2000) });
  assert.equal(changed.registry.revision, 2);
  assert.equal(changed.source.enabled, false);
  assert.deepEqual(changed.source.keywords, ['组件', '电池片']);
});

test('custom WeChat account names cannot be added twice', (t) => {
  const file = temporaryRegistry(t);
  addCustomSource(file, {
    name: '测试光伏号',
    type: 'wechat',
    keywords: '测试光伏号',
  }, {
    now: FIXED_NOW,
    randomUUID: () => FIXED_UUID,
  });
  assert.throws(() => addCustomSource(file, {
    name: ' 测试光伏号 ',
    type: 'wechat',
    keywords: '另一个别名',
  }, {
    now: new Date(FIXED_NOW.getTime() + 1000),
    randomUUID: () => makeUuid(2),
  }), (error) => error instanceof CustomSourceError && error.code === 'DUPLICATE_NAME');
});

test('custom X handles are case-insensitive duplicates', (t) => {
  const file = temporaryRegistry(t);
  addCustomSource(file, {
    name: 'First X source',
    type: 'x',
    url: '@PV_Tech',
  }, {
    now: FIXED_NOW,
    randomUUID: () => FIXED_UUID,
  });
  assert.throws(() => addCustomSource(file, {
    name: 'Duplicate X source',
    type: 'x',
    url: 'https://twitter.com/pv_tech',
  }, {
    now: new Date(FIXED_NOW.getTime() + 1000),
    randomUUID: () => makeUuid(2),
  }), (error) => error instanceof CustomSourceError && error.code === 'DUPLICATE_URL');
});

test('strict loading rejects corrupt or unexpected data without overwriting the old file', (t) => {
  const file = temporaryRegistry(t);
  fs.writeFileSync(file, '{"schemaVersion":1,"revision":0,"updatedAt":null,"sources":[]}', 'utf8');
  const original = fs.readFileSync(file, 'utf8');

  assert.throws(() => saveCustomSources(file, {
    ...createEmptyRegistry(),
    unexpected: true,
  }), (error) => error instanceof CustomSourceError && error.code === 'INVALID_REGISTRY');
  assert.equal(fs.readFileSync(file, 'utf8'), original);

  fs.writeFileSync(file, '{"schemaVersion":1,"sources":', 'utf8');
  assert.throws(
    () => loadCustomSources(file),
    (error) => error instanceof CustomSourceError && error.code === 'INVALID_REGISTRY_JSON'
  );
});

test('registry enforces a maximum of 100 sources', (t) => {
  const file = temporaryRegistry(t);
  const sources = Array.from({ length: MAX_CUSTOM_SOURCES }, (_, index) =>
    createCustomSource({
      name: `WeChat ${index}`,
      type: 'wechat',
      keywords: `account-${index}`,
    }, {
      now: FIXED_NOW,
      randomUUID: () => makeUuid(index),
    })
  );
  saveCustomSources(file, {
    schemaVersion: 1,
    revision: 1,
    updatedAt: FIXED_NOW.toISOString(),
    sources,
  });
  assert.throws(() => addCustomSource(file, {
    name: 'Too many',
    type: 'wechat',
    keywords: 'extra',
  }), (error) => error instanceof CustomSourceError && error.code === 'SOURCE_LIMIT');
});

test('URL validation rejects unsafe schemes, credentials, ports, literals and infrastructure hosts', () => {
  const unsafe = [
    'http://example.com/feed',
    'file:///etc/passwd',
    'https://user:pass@example.com/feed',
    'https://example.com:8443/feed',
    'https://127.0.0.1/feed',
    'https://2130706433/feed',
    'https://0x7f000001/feed',
    'https://[::1]/feed',
    'https://metadata.google.internal/feed',
    'https://service.cluster.local/feed',
  ];
  for (const value of unsafe) {
    assert.throws(
      () => validateRemoteUrl(value),
      (error) => error instanceof SafeRemoteFetchError,
      value
    );
  }
  assert.equal(
    validateRemoteUrl('https://Feeds.Example.com:443/rss#ignored').href,
    'https://feeds.example.com/rss'
  );
});

test('public IP classification rejects private, metadata, documentation and special IPv6', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.100.100.200',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:0808:0808::1',
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('1.1.1.1'), true);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('DNS validation fails closed when any answer is private', async () => {
  await assert.rejects(
    resolvePublicAddresses('mixed.example.com', {
      lookup: publicLookup({
        'mixed.example.com': [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ],
      }),
    }),
    (error) => error instanceof SafeRemoteFetchError && error.code === 'NON_PUBLIC_DNS'
  );
});

test('safe fetch pins the validated address and does not perform a second DNS lookup', async () => {
  let lookupCalls = 0;
  const observations = [];
  const result = await safeFetch('https://feeds.example.com/rss', {
    lookup: async () => {
      lookupCalls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
    requestImpl: fakeRequest({
      '/rss': { body: '<rss><channel></channel></rss>' },
    }, observations),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(lookupCalls, 1);
  assert.deepEqual(observations.map((item) => item.address), ['93.184.216.34']);
});

test('every redirect is revalidated and redirects to private DNS are blocked', async () => {
  const observations = [];
  await assert.rejects(
    safeFetch('https://feeds.example.com/start', {
      lookup: publicLookup({
        'feeds.example.com': [{ address: '93.184.216.34', family: 4 }],
        'internal.example.com': [{ address: '10.0.0.10', family: 4 }],
      }),
      requestImpl: fakeRequest({
        '/start': {
          statusCode: 302,
          headers: { location: 'https://internal.example.com/feed' },
        },
      }, observations),
    }),
    (error) => error instanceof SafeRemoteFetchError && error.code === 'NON_PUBLIC_DNS'
  );
  assert.equal(observations.length, 1);

  await assert.rejects(
    safeFetch('https://feeds.example.com/downgrade', {
      lookup: publicLookup(),
      requestImpl: fakeRequest({
        '/downgrade': {
          statusCode: 301,
          headers: { location: 'http://feeds.example.com/insecure' },
        },
      }),
    }),
    (error) => error instanceof SafeRemoteFetchError && error.code === 'UNSAFE_SCHEME'
  );
});

test('safe fetch aborts declared and streamed responses over 2 MB', async () => {
  await assert.rejects(
    safeFetch('https://feeds.example.com/declared', {
      lookup: publicLookup(),
      requestImpl: fakeRequest({
        '/declared': {
          headers: { 'content-length': String(DEFAULT_MAX_BYTES + 1) },
          body: '',
        },
      }),
    }),
    (error) => error instanceof SafeRemoteFetchError &&
      error.code === 'RESPONSE_TOO_LARGE'
  );

  await assert.rejects(
    safeFetch('https://feeds.example.com/chunked', {
      lookup: publicLookup(),
      requestImpl: fakeRequest({
        '/chunked': {
          chunks: [
            Buffer.alloc(DEFAULT_MAX_BYTES),
            Buffer.alloc(1),
          ],
        },
      }),
    }),
    (error) => error instanceof SafeRemoteFetchError &&
      error.code === 'RESPONSE_TOO_LARGE'
  );
});

test('safe fetch rejects unexpected compressed bodies to avoid decompression bombs', async () => {
  await assert.rejects(
    safeFetch('https://feeds.example.com/compressed', {
      lookup: publicLookup(),
      requestImpl: fakeRequest({
        '/compressed': {
          headers: { 'content-encoding': 'gzip' },
          body: Buffer.from('not actually needed'),
        },
      }),
    }),
    (error) => error instanceof SafeRemoteFetchError &&
      error.code === 'UNSUPPORTED_ENCODING'
  );
});

test('safe fetch has an overall timeout', async () => {
  await assert.rejects(
    safeFetch('https://feeds.example.com/slow', {
      lookup: publicLookup(),
      requestImpl: fakeRequest({ '/slow': { never: true } }),
      timeoutMs: 30,
      idleTimeoutMs: 30,
    }),
    (error) => error instanceof SafeRemoteFetchError && error.code === 'TIMEOUT'
  );
});

test('RSS parser supports RSS and Atom while dropping unsafe article links', () => {
  const rss = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[Public solar story]]></title>
        <link>https://news.example.com/story-1</link>
        <pubDate>Thu, 30 Jul 2026 01:00:00 GMT</pubDate>
        <description><![CDATA[<p>Solar summary</p>]]></description>
      </item>
      <item>
        <title>Internal target</title>
        <link>https://127.0.0.1/admin</link>
      </item>
    </channel></rss>`;
  const items = parseRss(rss, 'https://feeds.example.com/rss');
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://news.example.com/story-1');
  assert.equal(items[0].summary, 'Solar summary');
  assert.doesNotThrow(() => validateArticleUrl(items[0].link));

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Atom solar story</title>
      <link rel="alternate" href="/article/2"/>
      <updated>2026-07-30T01:10:00Z</updated>
      <summary>Atom summary</summary>
    </entry>
  </feed>`;
  assert.equal(
    parseRss(atom, 'https://feeds.example.com/feed')[0].link,
    'https://feeds.example.com/article/2'
  );
});

test('RSS probe returns parsed items and classifies upstream blocking', async () => {
  const xml = `<rss><channel><item>
    <title>Solar module update</title>
    <link>https://news.example.com/update</link>
    <pubDate>2026-07-30T01:00:00Z</pubDate>
  </item></channel></rss>`;
  const healthy = await probeRss('https://feeds.example.com/ok', {
    lookup: publicLookup(),
    requestImpl: fakeRequest({ '/ok': { body: xml } }),
  });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.status, 'normal');
  assert.equal(healthy.items.length, 1);

  const blocked = await probeRss('https://feeds.example.com/blocked', {
    lookup: publicLookup(),
    requestImpl: fakeRequest({
      '/blocked': { statusCode: 403, body: 'Access denied' },
    }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonCode, 'HTTP_403');
});

test('fetchCustomRss marks items and exposes non-enumerable health diagnostics', async () => {
  const xml = `<rss><channel><item>
    <title>Custom solar update</title>
    <link>https://news.example.com/custom-update</link>
  </item></channel></rss>`;
  const source = createCustomSource({
    name: 'Custom Feed',
    type: 'rss',
    url: 'https://feeds.example.com/custom',
  }, { now: FIXED_NOW, randomUUID: () => FIXED_UUID });
  const items = await fetchCustomRss(source, {
    lookup: publicLookup(),
    requestImpl: fakeRequest({ '/custom': { body: xml } }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'Custom Feed');
  assert.equal(items[0]._customSourceId, source.id);
  assert.equal(items._health.status, 'normal');
  assert.equal(Object.keys(items).includes('_health'), false);
});

test('custom source compatibility helpers keep websites on Google and WeChat pending polling', async () => {
  const website = createCustomSource({
    name: 'Solar Example',
    type: 'website',
    url: 'https://solar.example.com/news',
    keywords: 'solar, module',
    category: '组件',
  }, { now: FIXED_NOW, randomUUID: () => FIXED_UUID });
  const query = customWebsiteQuery(website);
  assert.deepEqual(
    Object.keys(query),
    [
      'id',
      'name',
      'label',
      'q',
      'locale',
      'cat',
      'kind',
      'type',
      'custom',
      'enabled',
      'staleAfterHours',
    ]
  );
  assert.equal(query.q, 'site:solar.example.com (solar OR module)');
  const websiteProbe = await probeCustomSource(website);
  assert.equal(websiteProbe.mode, 'google-news-site');
  assert.equal(websiteProbe.probeStatus, 'ready');

  const wechat = createCustomSource({
    name: 'PV Account',
    type: 'wechat',
    keywords: 'PV Account, photovoltaic',
  }, { now: FIXED_NOW, randomUUID: () => makeUuid(9) });
  const wechatProbe = await probeCustomSource(wechat);
  assert.equal(wechatProbe.mode, 'wechat-keywords');
  assert.equal(wechatProbe.probeStatus, 'pending');

  assert.equal(isSafeCustomArticleUrl('https://news.example.com/story'), true);
  assert.equal(isSafeCustomArticleUrl('http://news.example.com/story'), false);
  assert.equal(isSafeCustomArticleUrl('https://127.0.0.1/story'), false);
});

test('registry validator detects duplicate persisted URLs', () => {
  const first = createCustomSource({
    name: 'First',
    type: 'rss',
    url: 'https://feeds.example.com/rss',
  }, { now: FIXED_NOW, randomUUID: () => makeUuid(1) });
  const second = createCustomSource({
    name: 'Second',
    type: 'rss',
    url: 'https://feeds.example.com/rss',
  }, { now: FIXED_NOW, randomUUID: () => makeUuid(2) });
  assert.throws(() => validateRegistry({
    schemaVersion: 1,
    revision: 1,
    updatedAt: FIXED_NOW.toISOString(),
    sources: [first, second],
  }), (error) => error instanceof CustomSourceError && error.code === 'DUPLICATE_URL');
});
