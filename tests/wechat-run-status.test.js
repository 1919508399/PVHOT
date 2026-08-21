'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  consumeWechatRunFailure,
  statusFile,
  writeWechatRunFailure,
  writeWechatRunStart,
} = require('../lib/wechat_run_status');

test('only the matching pipeline consumes a fresh WeChat failure marker', (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-wechat-status-'));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-08-21T08:00:00.000Z');

  writeWechatRunFailure(runtimeDir, 1201, { code: 'WECHAT_RUN_DEGRADED' }, now);
  assert.equal(consumeWechatRunFailure(runtimeDir, 1202, { nowMs: now }), null);
  assert.equal(fs.existsSync(statusFile(runtimeDir, 1201)), true);

  const consumed = consumeWechatRunFailure(runtimeDir, 1201, { nowMs: now });
  assert.equal(consumed.errorCode, 'WECHAT_RUN_DEGRADED');
  assert.equal(fs.existsSync(statusFile(runtimeDir, 1201)), false);
});

test('stale WeChat failure markers cannot affect a later pipeline', (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-wechat-status-stale-'));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const finishedAt = Date.parse('2026-08-21T08:00:00.000Z');

  writeWechatRunFailure(runtimeDir, 1301, new Error('failed'), finishedAt);
  const result = consumeWechatRunFailure(runtimeDir, 1301, {
    nowMs: finishedAt + 31 * 60_000,
    maxAgeMs: 30 * 60_000,
  });
  assert.equal(result, null);
  assert.equal(fs.existsSync(statusFile(runtimeDir, 1301)), false);
});

test('an interrupted running marker fails closed for the matching pipeline', (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-wechat-status-running-'));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-08-21T08:00:00.000Z');

  writeWechatRunStart(runtimeDir, 1401, now);
  const consumed = consumeWechatRunFailure(runtimeDir, 1401, { nowMs: now + 60_000 });
  assert.equal(consumed.status, 'running');
  assert.equal(consumed.errorCode, 'WECHAT_FETCH_INCOMPLETE');
  assert.equal(fs.existsSync(statusFile(runtimeDir, 1401)), false);
});

test('CLI merge publishes other data and then propagates the matching WeChat failure', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-wechat-merge-status-'));
  const runtimeDir = path.join(root, '.runtime');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'data_raw.json'), JSON.stringify({
    meta: { date: '2026-08-21' },
    categories: [],
    items: [{
      id: 'other-source-item',
      title: '其他信源仍应发布',
      source: '测试信源',
      pubDate: '2026-08-21T07:00:00.000Z',
    }],
  }));
  fs.writeFileSync(path.join(root, 'admin_edits.json'), JSON.stringify({
    deleted: [], overrides: {}, added: [],
  }));
  writeWechatRunFailure(runtimeDir, process.pid, { code: 'WECHAT_RUN_DEGRADED' });

  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'merge.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PVHOT_ROOT: root,
      PVHOT_WECHAT_RUN_STATUS_DIR: runtimeDir,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /other sources were published/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8')).items.length, 1);
  assert.equal(fs.existsSync(statusFile(runtimeDir, process.pid)), false);
});
