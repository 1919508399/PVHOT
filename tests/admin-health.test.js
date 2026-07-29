'use strict';

const assert = require('node:assert/strict');
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
