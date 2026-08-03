'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

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

  const testLoginValue = 'test_admin_login_value';
  const child = spawn(process.execPath, [path.join(process.cwd(), 'admin_server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PVHOT_ROOT: root,
      PVHOT_ADMIN_HOST: '127.0.0.1',
      PVHOT_ADMIN_PORT: String(port),
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

  const login = await fetch(`${baseUrl}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass: testLoginValue }),
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];

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
  assert.ok(health.summary.checked > 40);
  assert.ok(health.summary.noNew >= 1);
  const customHealth = health.sources.find((source) => source.id === created.source.id);
  assert.equal(customHealth.custom, true);
  assert.equal(customHealth.name, '测试光伏观察');

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
  const registry = JSON.parse(fs.readFileSync(
    path.join(shared, 'data', 'custom_sources.json'),
    'utf8'
  ));
  assert.equal(registry.sources.length, 0);
  assert.equal(registry.revision, 5);
  assert.equal(fs.existsSync(path.join(root, 'custom_sources.json')), false);
});
