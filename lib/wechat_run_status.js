'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJsonSync } = require('./safe_io');

const DEFAULT_MAX_AGE_MS = 30 * 60_000;

function normalizeCallerPid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid WeChat caller pid');
  return pid;
}

function statusFile(runtimeDir, callerPid) {
  const directory = path.resolve(String(runtimeDir || ''));
  if (!runtimeDir || directory === path.parse(directory).root) {
    throw new Error('invalid WeChat run status directory');
  }
  return path.join(directory, `wechat-fetch-failure-${normalizeCallerPid(callerPid)}.json`);
}

function clearWechatRunFailure(runtimeDir, callerPid) {
  const file = statusFile(runtimeDir, callerPid);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeWechatRunRecord(runtimeDir, callerPid, status, error, nowMs = Date.now()) {
  const pid = normalizeCallerPid(callerPid);
  const directory = path.resolve(String(runtimeDir || ''));
  const file = statusFile(directory, pid);
  fs.mkdirSync(directory, { recursive: true });
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!['running', 'failed'].includes(normalizedStatus)) {
    throw new Error('invalid WeChat run status');
  }
  const timestamp = new Date(Number(nowMs)).toISOString();
  const rawCode = String(error && error.code || 'WECHAT_FETCH_FAILED').trim();
  const errorCode = normalizedStatus === 'failed'
    ? (rawCode.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || 'WECHAT_FETCH_FAILED')
    : '';
  const record = {
    schemaVersion: 1,
    status: normalizedStatus,
    callerPid: pid,
    ...(normalizedStatus === 'running' ? { startedAt: timestamp } : { finishedAt: timestamp }),
    errorCode,
  };
  atomicWriteJsonSync(file, record, {
    space: 2,
    validate: (value) => value
      && value.status === normalizedStatus
      && value.callerPid === pid
      && typeof (value.startedAt || value.finishedAt) === 'string',
  });
  return record;
}

function writeWechatRunStart(runtimeDir, callerPid, nowMs = Date.now()) {
  return writeWechatRunRecord(runtimeDir, callerPid, 'running', null, nowMs);
}

function writeWechatRunFailure(runtimeDir, callerPid, error, nowMs = Date.now()) {
  return writeWechatRunRecord(runtimeDir, callerPid, 'failed', error, nowMs);
}

function consumeWechatRunFailure(runtimeDir, callerPid, options = {}) {
  const pid = normalizeCallerPid(callerPid);
  const file = statusFile(runtimeDir, pid);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    try { clearWechatRunFailure(runtimeDir, pid); } catch {}
    return null;
  }

  const nowMs = Number(options.nowMs ?? Date.now());
  const maxAgeMs = Number(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
  const recordedAt = Date.parse(String(record && (record.finishedAt || record.startedAt) || ''));
  const valid = record
    && ['running', 'failed'].includes(record.status)
    && Number(record.callerPid) === pid
    && Number.isFinite(nowMs)
    && Number.isFinite(maxAgeMs)
    && maxAgeMs > 0
    && Number.isFinite(recordedAt)
    && recordedAt <= nowMs + 5 * 60_000
    && nowMs - recordedAt <= maxAgeMs;

  try { clearWechatRunFailure(runtimeDir, pid); } catch {}
  if (!valid) return null;
  return {
    ...record,
    errorCode: record.status === 'running'
      ? 'WECHAT_FETCH_INCOMPLETE'
      : (record.errorCode || 'WECHAT_FETCH_FAILED'),
  };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  clearWechatRunFailure,
  consumeWechatRunFailure,
  statusFile,
  writeWechatRunFailure,
  writeWechatRunStart,
};
