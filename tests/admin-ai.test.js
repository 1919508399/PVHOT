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
    child.once('error', reject);
    child.stdout.on('data', onData);
  });
}

test('admin AI settings keep the API key server-side and return only a mask', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-admin-ai-'));
  const root = path.join(sandbox, 'current');
  const shared = path.join(sandbox, 'shared');
  fs.mkdirSync(root, { recursive:true });
  fs.mkdirSync(path.join(shared, 'config'), { recursive:true });
  fs.mkdirSync(path.join(shared, 'data'), { recursive:true });
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ categories:[], items:[] }));
  fs.writeFileSync(path.join(root, 'admin.html'), '<!doctype html><title>admin</title>');
  const port = await reservePort();
  const loginValue = 'test_admin_ai_login';
  const placeholderKey = 'test-provider-credential-placeholder';
  const child = spawn(process.execPath, [path.join(process.cwd(), 'admin_server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PVHOT_ROOT: root,
      PVHOT_ADMIN_HOST: '127.0.0.1',
      PVHOT_ADMIN_PORT: String(port),
      PVHOT_ADMIN_PASSWORD_HASH: crypto.createHash('sha256').update(loginValue).digest('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(sandbox, { recursive:true, force:true });
  });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await fetch(`${base}/admin/api/ai-config`)).status, 401);
  const login = await fetch(`${base}/admin/api/login`, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ pass:loginValue }),
  });
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];
  const initial = await (await fetch(`${base}/admin/api/ai-config`, { headers:{ Cookie:cookie } })).json();
  assert.equal(initial.enabled, false);
  assert.equal(initial.apiKeyConfigured, false);
  assert.equal('apiKey' in initial, false);

  const savedResponse = await fetch(`${base}/admin/api/ai-config`, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json', Cookie:cookie },
    body:JSON.stringify({
      enabled:false, provider:'deepseek', model:'editor-model', apiKey:placeholderKey,
      dailyArticleLimit:60, timeoutMs:20000, maxInputChars:6000,
      features:{ classify:true, summarize:true, eventCluster:true, ranking:true },
    }),
  });
  const savedText = await savedResponse.text();
  const saved = JSON.parse(savedText);
  assert.equal(savedResponse.status, 200);
  assert.equal(saved.config.apiKeyConfigured, true);
  assert.equal(savedText.includes(placeholderKey), false);
  assert.equal('apiKey' in saved.config, false);

  const stored = JSON.parse(fs.readFileSync(path.join(shared, 'config', 'ai_config.json'), 'utf8'));
  assert.equal(stored.apiKey, placeholderKey);
  const rereadText = await (await fetch(`${base}/admin/api/ai-config`, { headers:{ Cookie:cookie } })).text();
  assert.equal(rereadText.includes(placeholderKey), false);

  const cleared = await (await fetch(`${base}/admin/api/ai-config`, {
    method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookie },
    body:JSON.stringify({ enabled:false, clearApiKey:true }),
  })).json();
  assert.equal(cleared.config.apiKeyConfigured, false);
});
