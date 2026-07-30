'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const {
  acquireProcessLockSync,
  withProcessLockSync,
} = require('../lib/process_lock');

const WORKER = path.join(__dirname, 'fixtures', 'lock-worker.js');

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function waitForFile(file, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(file)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${file}`));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

function waitForChild(child) {
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited with ${code || signal}: ${stderr.trim()}`));
    });
  });
}

test('withProcessLockSync releases the lock after a callback throws', (t) => {
  const root = temporaryDirectory(t, 'pvhot-lock-error-');
  const options = {
    name: 'exception-test',
    root,
    timeoutMs: 200,
    pollMs: 10,
  };

  assert.throws(() => {
    withProcessLockSync(options, () => {
      throw new Error('expected callback failure');
    });
  }, /expected callback failure/);

  const secondLock = acquireProcessLockSync(options);
  assert.equal(secondLock.release(), true);
});

test('a second process waits until the first process releases the lock', async (t) => {
  const root = temporaryDirectory(t, 'pvhot-lock-race-');
  const firstMarker = path.join(root, 'first.json');
  const secondMarker = path.join(root, 'second.json');
  const children = [];
  t.after(() => {
    children.forEach((child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
  });

  const first = spawn(process.execPath, [WORKER, root, firstMarker, '900'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(first);
  const firstDone = waitForChild(first);
  await waitForFile(firstMarker);

  const second = spawn(process.execPath, [WORKER, root, secondMarker, '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(second);
  const secondDone = waitForChild(second);
  await Promise.all([firstDone, secondDone]);

  const firstState = JSON.parse(fs.readFileSync(firstMarker, 'utf8'));
  const secondState = JSON.parse(fs.readFileSync(secondMarker, 'utf8'));
  assert.ok(
    secondState.startedAt < firstState.releasingAt,
    'test workers did not overlap while the first process held the lock'
  );
  assert.ok(
    secondState.acquiredAt >= firstState.releasingAt,
    'second process acquired the lock before the first began releasing it'
  );
});
