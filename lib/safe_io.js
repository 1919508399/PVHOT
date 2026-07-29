'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function targetMode(targetPath) {
  try {
    return fs.statSync(targetPath).mode & 0o777;
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return 0o644;
  }
}

function resolveTargetPath(targetPath) {
  let current = path.resolve(targetPath);
  const visited = new Set();

  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(current)) throw new Error(`symbolic link cycle detected for ${targetPath}`);
    visited.add(current);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isSymbolicLink()) return current;
      current = path.resolve(path.dirname(current), fs.readlinkSync(current));
    } catch (error) {
      if (error && error.code === 'ENOENT') return current;
      throw error;
    }
  }
  throw new Error(`too many symbolic links for ${targetPath}`);
}

function makeTemporaryPath(targetPath) {
  const directory = path.dirname(targetPath);
  const basename = path.basename(targetPath);
  const nonce = crypto.randomBytes(8).toString('hex');
  return path.join(directory, `.${basename}.${process.pid}.${Date.now()}.${nonce}.tmp`);
}

function renameWithRetrySync(sourcePath, targetPath, retries = 6) {
  let attempt = 0;
  while (true) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      const retryable = error
        && ['EACCES', 'EBUSY', 'EPERM'].includes(error.code)
        && attempt < retries;
      if (!retryable) throw error;
      attempt += 1;
      sleepSync(Math.min(10 * (2 ** attempt), 160));
    }
  }
}

/**
 * Replace a UTF-8 text file without exposing a partially written target.
 *
 * The temporary file is created in the target directory so the final rename
 * stays on one filesystem. It is flushed and closed before the rename, which
 * works on both Linux and Windows.
 */
function atomicWriteUtf8Sync(targetPath, text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('atomicWriteUtf8Sync expects a string');
  }

  // Preserve a shared-data symlink instead of replacing the link itself.
  const resolvedTarget = resolveTargetPath(targetPath);
  const directory = path.dirname(resolvedTarget);
  fs.mkdirSync(directory, { recursive: true });

  const temporaryPath = makeTemporaryPath(resolvedTarget);
  const mode = options.mode == null ? targetMode(resolvedTarget) : options.mode;
  let descriptor;

  try {
    descriptor = fs.openSync(temporaryPath, 'wx', mode);
    fs.writeFileSync(descriptor, text, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    renameWithRetrySync(temporaryPath, resolvedTarget, options.renameRetries);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (closeError) {}
    }
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') {
        // Keep the original write error; a same-directory .tmp file is harmless
        // and can be inspected after a filesystem failure.
      }
    }
    throw error;
  }
}

/**
 * Atomically replace a binary file. This is used for uploaded images so a
 * reader never observes a partially written asset.
 */
function atomicWriteBufferSync(targetPath, value, options = {}) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('atomicWriteBufferSync expects a Buffer or Uint8Array');
  }

  const resolvedTarget = resolveTargetPath(targetPath);
  const directory = path.dirname(resolvedTarget);
  fs.mkdirSync(directory, { recursive: true });

  const temporaryPath = makeTemporaryPath(resolvedTarget);
  const mode = options.mode == null ? targetMode(resolvedTarget) : options.mode;
  let descriptor;

  try {
    descriptor = fs.openSync(temporaryPath, 'wx', mode);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    renameWithRetrySync(temporaryPath, resolvedTarget, options.renameRetries);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (closeError) {}
    }
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') {
        // Preserve the original error; cleanup failure is secondary.
      }
    }
    throw error;
  }
}

/**
 * Serialize and parse the result before replacing the target. An optional
 * validator can reject structurally invalid output by throwing or returning
 * false.
 */
function atomicWriteJsonSync(targetPath, value, options = {}) {
  const serialized = JSON.stringify(
    value,
    options.replacer == null ? null : options.replacer,
    options.space == null ? 0 : options.space
  );
  if (typeof serialized !== 'string') {
    throw new TypeError('value cannot be serialized as JSON');
  }

  const parsed = JSON.parse(serialized);
  if (typeof options.validate === 'function') {
    const result = options.validate(parsed);
    if (result === false) {
      throw new TypeError(`JSON validation failed for ${targetPath}`);
    }
  }

  const suffix = options.trailingNewline ? '\n' : '';
  atomicWriteUtf8Sync(targetPath, serialized + suffix, options);
}

module.exports = {
  atomicWriteBufferSync,
  atomicWriteJsonSync,
  atomicWriteUtf8Sync,
};
