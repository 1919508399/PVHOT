#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DENIED_DIRECTORIES = new Set([
  '.git',
  '.github',
  'deploy',
  'node_modules',
  'scripts',
  'tests',
]);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.sh', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function sendError(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(message);
}

function resolvePublicFile(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return { statusCode: 400, message: 'Bad request' };
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.')) || DENIED_DIRECTORIES.has(segments[0])) {
    return { statusCode: 404, message: 'Not found' };
  }

  const absolutePath = path.resolve(root, ...segments);
  const relativeToRoot = path.relative(root, absolutePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return { statusCode: 403, message: 'Forbidden' };
  }
  return { absolutePath };
}

function createStaticServer(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(res, 405, 'Method not allowed');
      return;
    }

    const resolved = resolvePublicFile(root, req.url || '/');
    if (!resolved.absolutePath) {
      sendError(res, resolved.statusCode, resolved.message);
      return;
    }

    fs.stat(resolved.absolutePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        sendError(res, 404, 'Not found');
        return;
      }

      const contentType = MIME_TYPES.get(path.extname(resolved.absolutePath).toLowerCase());
      if (!contentType) {
        sendError(res, 415, 'Unsupported file type');
        return;
      }

      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(resolved.absolutePath);
      stream.on('error', () => {
        if (!res.headersSent) sendError(res, 500, 'Read error');
        else res.destroy();
      });
      stream.pipe(res);
    });
  });
}

function startFromCommandLine() {
  const host = process.env.PVHOT_DEV_HOST || '127.0.0.1';
  const port = Number(process.env.PVHOT_DEV_PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PVHOT_DEV_PORT must be an integer between 0 and 65535');
  }

  const server = createStaticServer();
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`PVHOT local preview: http://${host}:${address.port}`);
  });

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (require.main === module) {
  startFromCommandLine();
}

module.exports = {
  createStaticServer,
  resolvePublicFile,
};
