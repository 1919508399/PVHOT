'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJsonSync, atomicWriteUtf8Sync } = require('../lib/safe_io');

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function readOrCreateSecret(file, bytes = 32) {
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, 'utf8').trim();
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== bytes) throw new Error(`${path.basename(file)} is not a ${bytes}-byte base64 secret`);
    return decoded;
  }
  const secret = crypto.randomBytes(bytes);
  atomicWriteUtf8Sync(file, `${secret.toString('base64')}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return secret;
}

function encryptText(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptText(value, key) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('unsupported encrypted session value');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function createStorage(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), '.wechat-gateway-data'));
  ensurePrivateDirectory(root);
  const sessionKey = options.sessionKey
    ? Buffer.from(options.sessionKey, 'base64')
    : readOrCreateSecret(path.join(root, 'session.key'));
  if (sessionKey.length !== 32) throw new Error('PVHOT_WECHAT_GATEWAY_KEY must decode to exactly 32 bytes');

  const stateFile = path.join(root, 'state.json');
  const adminTokenFile = path.join(root, 'admin-token');
  // Keep the bearer token identical to the text stored in admin-token so an
  // operator can paste that file verbatim into the local admin page.
  const generatedAdminToken = readOrCreateSecret(adminTokenFile).toString('base64');

  return {
    root,
    sessionKey,
    adminToken: options.adminToken || generatedAdminToken,
    loadState(fallback) {
      try {
        const value = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return value && typeof value === 'object' ? value : fallback;
      } catch {
        return fallback;
      }
    },
    saveState(value) {
      atomicWriteJsonSync(stateFile, value, {
        space: 2,
        validate: (candidate) => candidate && Array.isArray(candidate.sources) && Array.isArray(candidate.articles),
      });
      try { fs.chmodSync(stateFile, 0o600); } catch {}
    },
  };
}

module.exports = {
  createStorage,
  decryptText,
  encryptText,
  readOrCreateSecret,
};
