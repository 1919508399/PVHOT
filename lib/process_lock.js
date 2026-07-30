'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWriteJsonSync } = require('./safe_io');

const HOSTNAME = os.hostname();

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function normalizedPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function safeLockName(name) {
  const normalized = String(name || '').trim().replace(/[^a-zA-Z0-9_.-]+/g, '-');
  if (!normalized) throw new TypeError('lock name is required');
  return normalized;
}

function readOwner(ownerPath) {
  try {
    return JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function processIsAlive(owner) {
  if (!owner || owner.hostname !== HOSTNAME || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    return null;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    // EPERM means the process exists but belongs to another user.
    return true;
  }
}

function lockAgeMilliseconds(lockPath, owner) {
  const ownerStarted = Date.parse(owner && owner.startedAt);
  if (Number.isFinite(ownerStarted)) return Math.max(0, Date.now() - ownerStarted);
  try {
    return Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
  } catch (error) {
    return 0;
  }
}

function recoverStaleLock(lockPath, ownerPath, staleMs) {
  const owner = readOwner(ownerPath);
  const alive = processIsAlive(owner);

  if (owner && owner.hostname === HOSTNAME && owner.pid === process.pid) {
    const error = new Error(`refusing to acquire lock recursively: ${lockPath}`);
    error.code = 'ELOCKREENTRANT';
    throw error;
  }
  if (alive === true || lockAgeMilliseconds(lockPath, owner) <= staleMs) return false;

  const stalePath = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(lockPath, stalePath);
  } catch (error) {
    if (error && ['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
  fs.rmSync(stalePath, { recursive: true, force: true });
  return true;
}

/**
 * Cross-process lock based on atomic directory creation.
 *
 * Normal/exceptional exits release the directory. A hard-killed process leaves
 * owner metadata that can be recovered after staleMs, but a live local PID is
 * never stolen even when it runs longer than the stale threshold.
 */
function acquireProcessLockSync(options = {}) {
  const name = safeLockName(options.name);
  const root = path.resolve(options.root || process.cwd());
  const lockRoot = path.resolve(options.lockDir || process.env.PVHOT_LOCK_DIR || path.join(root, '.locks'));
  const lockPath = path.join(lockRoot, `${name}.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  const timeoutMs = normalizedPositiveNumber(options.timeoutMs, 60_000);
  const staleMs = normalizedPositiveNumber(options.staleMs, 15 * 60_000);
  const pollMs = Math.max(10, normalizedPositiveNumber(options.pollMs, 100));
  const deadline = Date.now() + timeoutMs;
  const token = crypto.randomBytes(18).toString('hex');

  fs.mkdirSync(lockRoot, { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      const owner = {
        schemaVersion: 1,
        name,
        token,
        pid: process.pid,
        hostname: HOSTNAME,
        startedAt: new Date().toISOString(),
      };
      try {
        atomicWriteJsonSync(ownerPath, owner, { space: 2, trailingNewline: true, mode: 0o600 });
      } catch (error) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      const releaseOnExit = () => release();
      process.once('exit', releaseOnExit);

      function release() {
        if (released) return false;
        const currentOwner = readOwner(ownerPath);
        if (!currentOwner || currentOwner.token !== token) {
          released = true;
          process.removeListener('exit', releaseOnExit);
          return false;
        }
        fs.rmSync(lockPath, { recursive: true, force: true });
        released = true;
        process.removeListener('exit', releaseOnExit);
        return true;
      }

      return { name, path: lockPath, token, release };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    if (recoverStaleLock(lockPath, ownerPath, staleMs)) continue;
    if (Date.now() >= deadline) {
      const owner = readOwner(ownerPath);
      const detail = owner ? ` (pid ${owner.pid} on ${owner.hostname})` : '';
      const error = new Error(`timed out waiting for lock ${name}${detail}`);
      error.code = 'ELOCKTIMEOUT';
      error.lockPath = lockPath;
      throw error;
    }
    sleepSync(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

function withProcessLockSync(options, callback) {
  const lock = acquireProcessLockSync(options);
  try {
    return callback(lock);
  } finally {
    lock.release();
  }
}

async function withProcessLock(options, callback) {
  const lock = acquireProcessLockSync(options);
  try {
    return await callback(lock);
  } finally {
    lock.release();
  }
}

module.exports = {
  acquireProcessLockSync,
  withProcessLock,
  withProcessLockSync,
};
