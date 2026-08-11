'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadGatewayItems } = require('../fetch_wechat');
const { WechatGateway, normalizeArticle } = require('../wechat_gateway/gateway');
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
  assert.equal(gateway.publicState().account.name, '原型账号');
  assert.equal(JSON.stringify(gateway.publicState()).includes(sessionValue), false);

  const refreshed = await gateway.refreshNextDue();
  assert.equal(refreshed.status, 'ok');
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(output.experimental, true);
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
