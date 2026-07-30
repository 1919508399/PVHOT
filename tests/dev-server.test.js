'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const {
  createStaticServer,
  resolvePublicFile,
} = require('../scripts/dev-server');

test('resolvePublicFile keeps requests inside the repository and hides tooling', () => {
  const root = process.cwd();
  assert.equal(resolvePublicFile(root, '/').absolutePath.endsWith('index.html'), true);
  assert.equal(resolvePublicFile(root, '/scripts/dev-server.js').statusCode, 404);
  assert.equal(resolvePublicFile(root, '/.git/config').statusCode, 404);
});

test('static server supports GET and rejects mutating methods', async (t) => {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const getResponse = await fetch(`${baseUrl}/`);
  assert.equal(getResponse.status, 200);
  assert.match(getResponse.headers.get('content-type') || '', /^text\/html/i);

  const postResponse = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get('allow'), 'GET, HEAD');
});
