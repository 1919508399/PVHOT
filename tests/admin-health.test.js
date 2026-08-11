'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { RSS_FEEDS, SCRAPE_SOURCES, WECHAT_ACCOUNTS, WEIBO_ROUTES, X_ACCOUNTS } = require('../source_registry');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('admin server did not start')), 5000);
    const onData = (chunk) => {
      if (!String(chunk).includes('Pvhot admin')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', onData);
  });
}

test('public health endpoint reports release and data freshness without authentication', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-admin-health-'));
  const port = await reservePort();
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({
    updated: new Date().toISOString(),
    items: [{ id: 'health-item' }],
  }));
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ gitSha: 'test-sha' }));
  fs.writeFileSync(path.join(root, 'admin.html'), '<!doctype html><title>admin</title>');

  const child = spawn(process.execPath, [path.join(process.cwd(), 'admin_server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PVHOT_ROOT: root,
      PVHOT_ADMIN_HOST: '127.0.0.1',
      PVHOT_ADMIN_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitForReady(child);
  const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.ok, true);
  assert.equal(body.release, 'test-sha');
  assert.equal(body.data.items, 1);
  assert.equal(body.data.fresh, true);
  assert.equal(body.error, null);
});

test('authenticated source health API manages a custom WeChat source safely', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-admin-sources-'));
  const root = path.join(sandbox, 'current');
  const shared = path.join(sandbox, 'shared');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(shared, 'data'), { recursive: true });
  fs.mkdirSync(path.join(shared, 'config'), { recursive: true });
  const port = await reservePort();
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({
    updated: new Date().toISOString(),
    categories: [],
    items: [],
  }));
  fs.writeFileSync(path.join(root, 'admin.html'), '<!doctype html><title>admin</title>');
  fs.writeFileSync(path.join(shared, 'data', 'custom_sources.json'), JSON.stringify({
    schemaVersion: 1,
    revision: 0,
    updatedAt: null,
    sources: [],
  }));
  fs.writeFileSync(path.join(shared, 'data', 'source_health.json'), JSON.stringify({
    schemaVersion: 2,
    checkedAt: '2026-08-03T05:00:00.000Z',
    sources: [{
      id: 'x-pvmagazine', name: 'PV Magazine Global', kind: 'x', type: 'x',
      status: 'blocked', errorCode: 'x_api_not_configured', reasonCode: 'x_api_not_configured',
      detail: '未配置 X 官方 API', items: 0, itemsSeen: 0,
    }],
  }));
  const bootstrapToken = 'test-bootstrap-token-value-1234567890';
  fs.writeFileSync(path.join(shared, 'config', 'wechat-bootstrap-token'), `${bootstrapToken}\n`);

  const testLoginValue = 'test_admin_login_value';
  const child = spawn(process.execPath, [path.join(process.cwd(), 'admin_server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PVHOT_ROOT: root,
      PVHOT_ADMIN_HOST: '127.0.0.1',
      PVHOT_ADMIN_PORT: String(port),
      PVHOT_X_BEARER_TOKEN: '',
      PVHOT_ADMIN_PASSWORD_HASH: crypto.createHash('sha256').update(testLoginValue).digest('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  await waitForReady(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  const anonymous = await fetch(`${baseUrl}/admin/api/source-health`);
  assert.equal(anonymous.status, 401);
  const anonymousGateway = await fetch(`${baseUrl}/admin/api/wechat-gateway`);
  assert.equal(anonymousGateway.status, 401);
  const missingBootstrapToken = await fetch(`${baseUrl}/internal/wechat-bootstrap/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad' }),
  });
  assert.equal(missingBootstrapToken.status, 403);
  const proxiedBootstrap = await fetch(`${baseUrl}/internal/wechat-bootstrap/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PVHOT-Bootstrap-Token': bootstrapToken,
      'X-Forwarded-For': '203.0.113.8',
    },
    body: JSON.stringify({ id: 'bad' }),
  });
  assert.equal(proxiedBootstrap.status, 403);
  const invalidBootstrapSession = await fetch(`${baseUrl}/internal/wechat-bootstrap/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PVHOT-Bootstrap-Token': bootstrapToken,
    },
    body: JSON.stringify({ id: 'bad' }),
  });
  assert.equal(invalidBootstrapSession.status, 400);
  const bootstrapStatusResponse = await fetch(`${baseUrl}/internal/wechat-bootstrap/status`, {
    method: 'POST',
    headers: { 'X-PVHOT-Bootstrap-Token': bootstrapToken },
  });
  const bootstrapStatus = await bootstrapStatusResponse.json();
  assert.equal(bootstrapStatusResponse.status, 200);
  assert.equal(bootstrapStatus.enabled, false);
  assert.equal(bootstrapStatus.account, null);

  const login = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass: testLoginValue }),
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];

  const initialHealthResponse = await fetch(`${baseUrl}/admin/api/source-health`, {
    headers: { Cookie: cookie },
  });
  const initialHealth = await initialHealthResponse.json();
  assert.equal(initialHealthResponse.status, 200);
  assert.equal(initialHealth.integrations.xApiConfigured, false);
  assert.equal(initialHealth.integrations.xIndirectEnabled, true);
  assert.ok(initialHealth.catalog.publisherCount > 40);
  assert.equal(
    initialHealth.catalog.channelCount,
    RSS_FEEDS.length + SCRAPE_SOURCES.length + X_ACCOUNTS.length + WECHAT_ACCOUNTS.length + WEIBO_ROUTES.length
  );
  assert.equal(initialHealth.catalog.discoveryRuleCount, 28);
  const builtInX = initialHealth.sources.filter((source) =>
    source.type === 'x' && source.custom !== true
  );
  assert.equal(builtInX.length, 12);
  assert.ok(builtInX.every((source) => source.status === 'pending'));
  assert.ok(builtInX.every((source) => source.monitorMode === 'search-indirect'));
  assert.ok(builtInX.every((source) => source.reasonCode == null));
  assert.match(builtInX.find((source) => source.id === 'x-pvmagazine').detail, /间接监控已启用/);
  assert.ok(builtInX.some((source) => source.handle === 'pvmagazine'));

  const gatewayResponse = await fetch(`${baseUrl}/admin/api/wechat-gateway`, {
    headers: { Cookie: cookie },
  });
  const gatewayState = await gatewayResponse.json();
  assert.equal(gatewayResponse.status, 200);
  assert.equal(gatewayState.enabled, false);
  assert.equal(gatewayState.account, null);
  assert.equal(gatewayState.sources.length, 5);

  const duplicateBuiltInX = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '重复 PV Magazine',
      type: 'x',
      url: '@pvmagazine',
      category: 'ALL',
    }),
  });
  assert.equal(duplicateBuiltInX.status, 409);

  const invalidXPost = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '错误帖子地址',
      type: 'x',
      url: 'https://x.com/SolarSignalHQ/status/123456789',
      category: 'ALL',
    }),
  });
  const invalidXPostBody = await invalidXPost.json();
  assert.equal(invalidXPost.status, 400);
  assert.match(invalidXPostBody.error, /X 地址无效/);
  assert.doesNotMatch(invalidXPostBody.error, /X account|INVALID_/);

  const forbiddenValue = 'must-not-appear-in-any-response';
  const secretFieldX = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '不应接收凭证',
      type: 'x',
      url: '@SolarSignalHQ',
      category: 'ALL',
      ['bearer' + 'Token']: forbiddenValue,
    }),
  });
  const secretFieldBody = await secretFieldX.text();
  assert.equal(secretFieldX.status, 400);
  assert.doesNotMatch(secretFieldBody, new RegExp(forbiddenValue));

  const createX = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'Solar Signal on X',
      type: 'x',
      url: '@SolarSignalHQ',
      category: 'ALL',
      staleAfterHours: 168,
    }),
  });
  const createdX = await createX.json();
  assert.equal(createX.status, 201);
  assert.equal(createdX.source.type, 'x');
  assert.equal(createdX.source.url, 'https://x.com/solarsignalhq');
  assert.equal(createdX.probe.ok, false);
  assert.equal(createdX.probe.status, 'blocked');
  assert.equal(createdX.probe.reasonCode, 'X_API_NOT_CONFIGURED');
  assert.match(createdX.probe.detail, /尚未配置 X 官方 API/);

  const create = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '测试光伏观察',
      type: 'wechat',
      keywords: '测试光伏观察，光伏',
      category: 'ALL',
      staleAfterHours: 168,
    }),
  });
  const created = await create.json();
  assert.equal(create.status, 201);
  assert.equal(created.source.type, 'wechat');
  assert.deepEqual(created.source.keywords, ['测试光伏观察', '光伏']);
  assert.match(created.source.id, /^custom-/);

  const healthResponse = await fetch(`${baseUrl}/admin/api/source-health`, {
    headers: { Cookie: cookie },
  });
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.ok(health.summary.total > 40);
  assert.ok(health.summary.pending > 40);
  const customHealth = health.sources.find((source) => source.id === created.source.id);
  assert.equal(customHealth.custom, true);
  assert.equal(customHealth.name, '测试光伏观察');
  const customXHealth = health.sources.find((source) => source.id === createdX.source.id);
  assert.equal(customXHealth.custom, true);
  assert.equal(customXHealth.type, 'x');
  assert.equal(customXHealth.status, 'blocked');

  const disable = await fetch(`${baseUrl}/admin/api/sources/${encodeURIComponent(created.source.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ enabled: false }),
  });
  const disabled = await disable.json();
  assert.equal(disable.status, 200);
  assert.equal(disabled.source.enabled, false);

  const unsafeRss = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '危险地址',
      type: 'rss',
      url: 'http://127.0.0.1/private.xml',
      category: 'ALL',
    }),
  });
  assert.equal(unsafeRss.status, 400);

  const saveOnly = await fetch(`${baseUrl}/admin/api/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: '仅保存测试网站',
      type: 'website',
      url: 'https://example.com/news',
      category: 'ALL',
      probe: false,
    }),
  });
  const savedOnly = await saveOnly.json();
  assert.equal(saveOnly.status, 201);
  assert.equal(savedOnly.probe.reasonCode, 'SAVED_WITHOUT_PROBE');
  assert.equal(savedOnly.source.url, 'https://example.com/');

  const removeSavedOnly = await fetch(
    `${baseUrl}/admin/api/sources/${encodeURIComponent(savedOnly.source.id)}`,
    { method: 'DELETE', headers: { Cookie: cookie } }
  );
  assert.equal(removeSavedOnly.status, 200);

  const remove = await fetch(`${baseUrl}/admin/api/sources/${encodeURIComponent(created.source.id)}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  assert.equal(remove.status, 200);
  const removeX = await fetch(`${baseUrl}/admin/api/sources/${encodeURIComponent(createdX.source.id)}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  assert.equal(removeX.status, 200);
  const registry = JSON.parse(fs.readFileSync(
    path.join(shared, 'data', 'custom_sources.json'),
    'utf8'
  ));
  assert.equal(registry.sources.length, 0);
  assert.equal(registry.revision, 7);
  assert.equal(fs.existsSync(path.join(root, 'custom_sources.json')), false);
});
