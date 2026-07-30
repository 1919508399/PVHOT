#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { acquireProcessLockSync } = require('../../lib/process_lock');

const [, , root, markerPath, holdMilliseconds = '0'] = process.argv;
if (!root || !markerPath) {
  console.error('usage: lock-worker.js <root> <marker> [hold-ms]');
  process.exit(2);
}

const startedAt = Date.now();
const lock = acquireProcessLockSync({
  name: 'competition',
  root,
  timeoutMs: 5_000,
  staleMs: 30_000,
  pollMs: 15,
});
const state = {
  pid: process.pid,
  startedAt,
  acquiredAt: Date.now(),
};
fs.mkdirSync(path.dirname(markerPath), { recursive: true });
fs.writeFileSync(markerPath, JSON.stringify(state), 'utf8');

const delay = Math.max(0, Number(holdMilliseconds) || 0);
if (delay) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delay);
}

state.releasingAt = Date.now();
lock.release();
state.releasedAt = Date.now();
fs.writeFileSync(markerPath, JSON.stringify(state), 'utf8');
