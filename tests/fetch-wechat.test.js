const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountSearchTerms,
  appendGlobalWechatBlockHealth,
  assessWechatAccountRun,
  extractOfficialWechatLink,
  expandAccountAliases,
  isFreshGatewayHealthEntry,
  isWechatVerificationUrl,
  normalizeOfficialWechatItem,
  normalizeOfficialWechatLink,
  normalizeSogouDiscoveryLink,
  resolveWechatArticleLink,
  selectCustomAccountsForRun,
} = require('../fetch_wechat');

test('custom WeChat search terms split mixed Chinese and English account names', () => {
  const account = {
    name: '华晟新能源 Huasun',
    aliases: ['华晟新能源 Huasun'],
  };

  assert.deepEqual(accountSearchTerms(account), [
    '华晟新能源',
    '华晟新能源 Huasun',
    'Huasun',
  ]);
  assert.deepEqual(expandAccountAliases(account), [
    '华晟新能源 Huasun',
    '华晟新能源',
    'Huasun',
  ]);
});

test('recent custom WeChat accounts are prioritized before normal rotation', () => {
  const now = Date.now();
  const accounts = [
    { id: 'old-1', name: '旧账号1', createdAt: new Date(now - 10 * 86400_000).toISOString() },
    { id: 'old-2', name: '旧账号2', createdAt: new Date(now - 10 * 86400_000).toISOString() },
    { id: 'new-1', name: '华晟新能源 Huasun', createdAt: new Date(now - 2 * 3600_000).toISOString() },
  ];

  const selected = selectCustomAccountsForRun(accounts, 0).map((account) => account.id);
  assert.equal(selected[0], 'new-1');
  assert.ok(selected.includes('old-1'));
});

test('only official WeChat article URLs pass output validation', () => {
  assert.equal(
    normalizeOfficialWechatLink('https://mp.weixin.qq.com/s/article_123?scene=1&foo=bar#wechat_redirect'),
    'https://mp.weixin.qq.com/s/article_123?foo=bar',
  );

  const legacy = normalizeOfficialWechatLink(
    'https://mp.weixin.qq.com/s?__biz=MzA1&mid=123&idx=1&sn=abc&scene=1',
  );
  assert.equal(new URL(legacy).hostname, 'mp.weixin.qq.com');
  assert.equal(new URL(legacy).searchParams.get('__biz'), 'MzA1');
  assert.equal(new URL(legacy).searchParams.has('scene'), false);

  const signedSogou = normalizeOfficialWechatLink(
    'https://mp.weixin.qq.com/s?src=11&timestamp=1787302386&ver=6917'
      + '&signature=2O26PUGifo0KOoqokBrPGGL1EIi38X6khDd3YDAlUW-Ut2pnZkEyN8hdVPvRk6nx*new&new=1',
  );
  assert.equal(new URL(signedSogou).pathname, '/s');
  assert.equal(new URL(signedSogou).searchParams.get('src'), '11');
  assert.equal(new URL(signedSogou).searchParams.get('signature').endsWith('*new'), true);

  assert.equal(normalizeOfficialWechatLink('http://mp.weixin.qq.com/s/insecure'), '');
  assert.equal(normalizeOfficialWechatLink('https://mp.weixin.qq.com.evil.example/s/lookalike'), '');
  assert.equal(normalizeOfficialWechatLink('https://mp.weixin.qq.com/mp/profile_ext?action=home'), '');
  assert.equal(normalizeOfficialWechatLink('https://mp.weixin.qq.com/s?src=11&timestamp=1787302386&ver=6917'), '');
  assert.equal(normalizeOfficialWechatLink('https://mp.weixin.qq.com/s?src=12&timestamp=1787302386&ver=6917&signature=abcdefghijklmnopqrstuvwxyz123456'), '');
  assert.equal(normalizeOfficialWechatLink('https://weixin.sogou.com/antispider/?from=%2flink'), '');
});

test('embedded and percent-encoded official article URLs are preferred without navigation', async () => {
  const official = 'https://mp.weixin.qq.com/s/encoded_article';
  assert.equal(extractOfficialWechatLink(`data-url="${encodeURIComponent(official)}"`), official);

  let navigations = 0;
  const result = await resolveWechatArticleLink([
    'https://weixin.sogou.com/link?url=opaque-token',
    encodeURIComponent(official),
  ], {
    async goto() { navigations += 1; },
  }, { waitMs: 0 });

  assert.equal(result.status, 'official');
  assert.equal(result.link, official);
  assert.equal(navigations, 0);
});

test('a normal Sogou navigation may resolve to an official article URL', async () => {
  const discovery = 'https://weixin.sogou.com/link?url=opaque-token';
  const official = 'https://mp.weixin.qq.com/s?src=11&timestamp=1787302386&ver=6917'
    + '&signature=2O26PUGifo0KOoqokBrPGGL1EIi38X6khDd3YDAlUW-Ut2pnZkEyN8hdVPvRk6nx*new&new=1';
  let currentUrl = discovery;
  let gotoOptions = null;
  const page = {
    async goto(url, options) {
      assert.equal(url, discovery);
      gotoOptions = options;
      currentUrl = official;
      return {
        url: () => official,
        request: () => ({ redirectChain: () => [] }),
      };
    },
    url: () => currentUrl,
    async title() { return '公众号文章'; },
    async evaluate() { return { canonical: official, bodyText: 'article' }; },
  };

  const result = await resolveWechatArticleLink(discovery, page, {
    referer: 'https://weixin.sogou.com/weixin?type=2&query=solar',
    waitMs: 0,
  });
  assert.equal(result.status, 'resolved');
  assert.equal(new URL(result.link).hostname, 'mp.weixin.qq.com');
  assert.equal(new URL(result.link).searchParams.get('signature').endsWith('*new'), true);
  assert.equal(gotoOptions.referer, 'https://weixin.sogou.com/weixin?type=2&query=solar');
});

test('Sogou verification is reported and never emitted as an article link', async () => {
  const discovery = 'https://weixin.sogou.com/link?url=opaque-token';
  const verification = 'https://weixin.sogou.com/antispider/?from=%2flink';
  let navigations = 0;
  const page = {
    async goto() {
      navigations += 1;
      return { url: () => verification };
    },
    // The response URL is authoritative even if Puppeteer still reports the
    // preceding document while a navigation is settling.
    url: () => discovery,
    async title() { return '搜狗微信搜索'; },
    async evaluate() { return { bodyText: '' }; },
  };

  const result = await resolveWechatArticleLink(discovery, page, { waitMs: 0 });
  assert.equal(result.status, 'captcha');
  assert.equal(result.link, '');
  assert.equal(navigations, 1);
  assert.equal(isWechatVerificationUrl(verification), true);
});

test('non-Sogou discovery links are not followed and old discovery-only items are dropped', async () => {
  let navigations = 0;
  const page = { async goto() { navigations += 1; } };
  const result = await resolveWechatArticleLink('https://example.com/redirect?id=1', page, { waitMs: 0 });
  assert.equal(result.status, 'invalid');
  assert.equal(result.link, '');
  assert.equal(navigations, 0);
  assert.equal(normalizeSogouDiscoveryLink('https://weixin.sogou.com/antispider/?from=link'), '');
  assert.equal(normalizeOfficialWechatItem({
    link: 'https://weixin.sogou.com/link?url=opaque-token',
    sources: [{ name: '光伏們', link: 'https://weixin.sogou.com/link?url=opaque-token' }],
  }), null);

  const officialItem = normalizeOfficialWechatItem({
    link: 'https://mp.weixin.qq.com/s/current?scene=1',
    sources: [{ name: '光伏們', link: 'https://weixin.sogou.com/link?url=old' }],
  });
  assert.equal(officialItem.link, 'https://mp.weixin.qq.com/s/current');
  assert.equal(officialItem.sources[0].link, officialItem.link);
});

test('a global Sogou verification marks every skipped account as blocked', () => {
  const existing = [{ id: 'account:光伏們', name: '光伏們', status: 'captcha' }];
  const checkedAt = '2026-08-21T08:00:00.000Z';
  const health = appendGlobalWechatBlockHealth(existing, [
    { name: '光伏們', tier: 1 },
    { name: '索比光伏网', kind: '媒体', tier: 1 },
  ], checkedAt);

  assert.equal(health, existing);
  assert.equal(health.length, 2);
  assert.equal(health[1].id, 'account:索比光伏网');
  assert.equal(health[1].status, 'captcha');
  assert.equal(health[1].lastPolledAt, checkedAt);
  assert.match(health[1].error, /剩余账号轮询已停止/);
});

test('a majority of failed account checks marks the run degraded while a healthy gateway can recover it', () => {
  const accounts = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const failures = [
    { id: 'account:A', name: 'A', status: 'captcha' },
    { id: 'account:B', name: 'B', status: 'link_unresolved' },
    { id: 'account:C', name: 'C', status: 'not_indexed' },
    { id: 'account:D', name: 'D', status: 'no_new' },
  ];
  const degraded = assessWechatAccountRun(failures, accounts);
  assert.equal(degraded.failedAccounts, 2);
  assert.equal(degraded.degraded, true);

  const stillDegraded = assessWechatAccountRun([
    ...failures,
    { id: 'gateway:account:A', name: 'A', status: 'pending' },
  ], accounts);
  assert.equal(stillDegraded.failedAccounts, 2);
  assert.equal(stillDegraded.degraded, true);

  const recovered = assessWechatAccountRun([
    ...failures,
    { id: 'gateway:account:A', name: 'A', status: 'ok' },
  ], accounts);
  assert.equal(recovered.failedAccounts, 1);
  assert.equal(recovered.degraded, false);
});

test('stale gateway success cannot hide a current direct failure', () => {
  const now = Date.parse('2026-08-21T08:00:00.000Z');
  assert.equal(isFreshGatewayHealthEntry({
    status: 'ok',
    lastPolledAt: '2026-08-21T04:00:00.000Z',
  }, '2026-08-21T07:59:00.000Z', now, 8 * 3600_000), true);
  assert.equal(isFreshGatewayHealthEntry({
    status: 'ok',
    lastPolledAt: '2026-08-20T20:00:00.000Z',
  }, '2026-08-21T07:59:00.000Z', now, 8 * 3600_000), false);

  const accounts = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const noSignal = accounts.map(({ name }) => ({
    id: `account:${name}`,
    name,
    status: name === 'D' ? 'account_not_matched' : 'not_indexed',
  }));
  const result = assessWechatAccountRun(noSignal, accounts);
  assert.equal(result.failedAccounts, 0);
  assert.equal(result.healthyAccounts, 0);
  assert.equal(result.reason, 'no_usable_signal');
  assert.equal(result.degraded, true);

  const incomplete = assessWechatAccountRun(noSignal.slice(0, 3), accounts);
  assert.equal(incomplete.checkedAccounts, 3);
  assert.equal(incomplete.reason, 'incomplete_account_checks');
  assert.equal(incomplete.degraded, true);

  const gatewayNoNew = assessWechatAccountRun(accounts.map(({ name }) => ({
    id: `gateway:account:${name}`,
    name,
    status: 'no_new_items',
  })), accounts);
  assert.equal(gatewayNoNew.healthyAccounts, 4);
  assert.equal(gatewayNoNew.degraded, false);
});
