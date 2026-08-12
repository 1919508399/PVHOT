'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadGatewayItems } = require('../fetch_wechat');
const {
  WechatGateway,
  normalizeArticle,
  officialArticleRows,
  reconcileSources,
} = require('../wechat_gateway/gateway');
const { PlatformError, WeReadPlatformClient } = require('../wechat_gateway/platform_client');
const { createStorage, decryptText, encryptText } = require('../wechat_gateway/storage');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-wechat-gateway-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('gateway storage encrypts the login token and never exposes it in public state', async (t) => {
  const directory = temporaryDirectory(t);
  const storage = createStorage({ root: path.join(directory, 'state') });
  const sessionValue = crypto.randomBytes(24).toString('base64url');
  const encrypted = encryptText(sessionValue, storage.sessionKey);

  assert.notEqual(encrypted, sessionValue);
  assert.equal(decryptText(encrypted, storage.sessionKey), sessionValue);

  const client = {
    async createLoginSession() {
      return { uuid: 'session_123', scanUrl: 'https://open.weixin.qq.com/connect/confirm?uuid=session_123' };
    },
    async waitForLogin() {
      return { vid: 12345, token: sessionValue, username: '原型账号' };
    },
    async getArticles(mpId) {
      return [{ id: `article_${mpId}`, title: '测试文章', picUrl: 'https://example.com/cover.jpg', publishTime: Math.floor(Date.now() / 1000) }];
    },
  };
  const outputPath = path.join(directory, 'wechat_gateway_items.json');
  const gateway = new WechatGateway({ storage, client, outputPath, refreshHours: 6 });
  const login = await gateway.startLogin();
  assert.match(login.qrcode, /^data:image\/png;base64,/);

  const completed = await gateway.completeLogin(login.id);
  assert.equal(completed.complete, true);
  assert.equal(gateway.publicState().enabled, true);
  assert.equal(gateway.publicState().account.name, '原型账号');
  assert.equal(JSON.stringify(gateway.publicState()).includes(sessionValue), false);

  const refreshed = await gateway.refreshNextDue();
  assert.equal(refreshed.status, 'ok');
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(output.experimental, true);
  assert.equal(output.enabled, true);
  assert.equal(output.items.length, 1);
  assert.match(output.items[0].link, /^https:\/\/mp\.weixin\.qq\.com\/s\//);
});

test('normalized gateway articles preserve the official account as the source', () => {
  const item = normalizeArticle({
    id: 'abc123',
    title: '阳光电源发布新品',
    picUrl: 'https://example.com/pic.jpg',
    publishTime: 1_800_000_000,
  }, { name: '阳光电源', tier: 1 });

  assert.equal(item.account, '阳光电源');
  assert.equal(item.sources[0].name, '阳光电源');
  assert.equal(item._sourceMode, 'weread-session-prototype');
  assert.equal(item.reason, '');
});

test('platform client does not retry deterministic WeReadError400 responses', async () => {
  const client = new WeReadPlatformClient();
  let attempts = 0;
  client.request = async () => {
    attempts += 1;
    throw new PlatformError('WeReadError400', { status: 400, code: 'WeReadError400' });
  };

  await assert.rejects(
    () => client.getArticles('2393507962', { id: 'reader', token: 'secret' }),
    /WeReadError400/,
  );
  assert.equal(attempts, 1);
});

test('official WeRead search keeps exact account articles and official links', () => {
  const rows = officialArticleRows({
    results: [{
      books: [
        { bookInfo: { title: '储能行业下午更新', author: '中关村储能产业技术联盟', originalId: 'abc~def', updateTime: 1_800_000_000, intro: '摘要' } },
        { bookInfo: { title: '同名误匹配', author: '其他公众号', originalId: 'wrong', updateTime: 1_800_000_000 } },
      ],
    }],
  }, { name: '中关村储能产业技术联盟' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link, 'https://mp.weixin.qq.com/s/abc_def');
  assert.equal(rows[0].digest, '摘要');
});

test('official WeRead API key is encrypted and never returned in public state', async (t) => {
  const directory = temporaryDirectory(t);
  const storage = createStorage({ root: path.join(directory, 'state') });
  const key = 'wrk-exampleOfficialKey123456';
  const client = {
    async searchOfficialAccounts() { return { results: [] }; },
    async searchOfficialArticles() { return { results: [] }; },
  };
  const gateway = new WechatGateway({
    storage,
    client,
    outputPath: path.join(directory, 'wechat_gateway_items.json'),
    refreshHours: 12,
  });
  await gateway.configureOfficialApiKey(key);
  assert.equal(gateway.publicState().provider, 'weread-official-agent-api');
  assert.equal(gateway.publicState().account.status, 'active');
  assert.equal(JSON.stringify(gateway.publicState()).includes(key), false);
  assert.equal(storage.loadState({}).account.agentKeyEncrypted.includes(key), false);
});

test('official API setup validates the article search path rather than account search', async (t) => {
  const directory = temporaryDirectory(t);
  let accountSearches = 0;
  let articleSearches = 0;
  const gateway = new WechatGateway({
    storage: createStorage({ root: path.join(directory, 'state') }),
    client: {
      async searchOfficialAccounts() { accountSearches += 1; throw new Error('-2041'); },
      async searchOfficialArticles() { articleSearches += 1; return { results: [] }; },
    },
    outputPath: path.join(directory, 'wechat_gateway_items.json'),
  });
  await gateway.configureOfficialApiKey('wrk-exampleOfficialKey123456');
  assert.equal(accountSearches, 0);
  assert.equal(articleSearches, 1);
});

test('gateway only classifies WeReadError429 as risk control', (t) => {
  const directory = temporaryDirectory(t);
  const gateway = new WechatGateway({
    storage: createStorage({ root: path.join(directory, 'state') }),
    client: {},
    outputPath: path.join(directory, 'wechat_gateway_items.json'),
  });

  assert.deepEqual(
    gateway.classifyError(new PlatformError('WeReadError429', { code: 'WeReadError429' })),
    { status: 'risk_control', delayHours: 24 },
  );
  assert.deepEqual(
    gateway.classifyError(new PlatformError('WeReadError400', { code: 'WeReadError400' })),
    { status: 'upstream_bad_request', delayHours: 24 },
  );
});

test('gateway resolves an internal mp id from an official article link', async (t) => {
  const directory = temporaryDirectory(t);
  const storage = createStorage({ root: path.join(directory, 'state') });
  const token = crypto.randomBytes(24).toString('base64url');
  const client = {
    async createLoginSession() { return { uuid: 'resolve_session', scanUrl: 'https://example.com/qr' }; },
    async waitForLogin() { return { vid: 9, token, username: '解析账号' }; },
    async getMpInfo(url, account) {
      assert.equal(url, 'https://mp.weixin.qq.com/s/example');
      assert.equal(account.id, '9');
      return [{ id: 'internal-mp-id', name: '中关村储能产业技术联盟' }];
    },
  };
  const gateway = new WechatGateway({
    storage,
    client,
    outputPath: path.join(directory, 'wechat_gateway_items.json'),
  });
  const login = await gateway.startLogin();
  await gateway.completeLogin(login.id);

  const results = await gateway.resolveMpInfo('https://mp.weixin.qq.com/s/example');
  assert.equal(results[0].id, 'internal-mp-id');
  await assert.rejects(() => gateway.resolveMpInfo('https://example.com/not-wechat'), /有效的微信公众号文章链接/);
});

test('saved numeric prototype ids migrate to the original WeChat biz ids', () => {
  const sources = reconcileSources([{
    mpId: '2393507962',
    name: '中关村储能产业技术联盟',
    kind: '机构',
    tier: 1,
    status: 'risk_control',
    error: 'WeReadError400',
  }]);
  const cnesa = sources.find((source) => source.name === '中关村储能产业技术联盟');
  assert.equal(cnesa.mpId, 'MP_WXS_2393507962');
  assert.equal(cnesa.status, 'pending');
  assert.equal(cnesa.nextRefreshAt, new Date(0).toISOString());
  assert.equal(cnesa.error, '');
});

test('fetch_wechat only accepts fresh official WeChat links from gateway output', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'gateway.json');
  fs.writeFileSync(file, JSON.stringify({
    provider: 'test-provider',
    health: [{ id: 'account:test', status: 'ok' }],
    items: [
      { title: '保留', link: 'https://mp.weixin.qq.com/s/current', pubDate: new Date().toISOString() },
      { title: '错误域名', link: 'https://example.com/not-wechat', pubDate: new Date().toISOString() },
      { title: '过期', link: 'https://mp.weixin.qq.com/s/old', pubDate: new Date(Date.now() - 9 * 86400_000).toISOString() },
    ],
  }), 'utf8');

  const result = loadGatewayItems(file);
  assert.equal(result.provider, 'test-provider');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '保留');
});
