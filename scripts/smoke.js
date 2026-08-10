#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createStaticServer } = require('./dev-server');

async function assertResponse(baseUrl, pathname, expectedType) {
  const response = await fetch(`${baseUrl}${pathname}`);
  assert.equal(response.status, 200, `${pathname} should return HTTP 200`);
  assert.match(
    response.headers.get('content-type') || '',
    expectedType,
    `${pathname} should have the expected Content-Type`
  );
  return response;
}

async function main() {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const home = await assertResponse(baseUrl, '/', /^text\/html;\s*charset=utf-8/i);
    const html = await home.text();
    assert.match(html, /<meta[^>]+name=["']viewport["']/i);
    assert.match(html, /<script[^>]+src=["']app\.js(?:\?[^"']*)?["']/i);

    await assertResponse(baseUrl, '/styles.css', /^text\/css;\s*charset=utf-8/i);
    await assertResponse(baseUrl, '/app.js', /^text\/javascript;\s*charset=utf-8/i);
    await assertResponse(baseUrl, '/manifest.webmanifest', /^application\/manifest\+json;\s*charset=utf-8/i);
    await assertResponse(baseUrl, '/sw.js', /^text\/javascript;\s*charset=utf-8/i);

    const dataResponse = await assertResponse(baseUrl, '/data.json', /^application\/json;\s*charset=utf-8/i);
    const data = await dataResponse.json();
    assert.ok(Array.isArray(data.items), 'data.json should expose an items array');
    assert.ok(data.items.length > 0, 'data.json should contain at least one item');

    const privateResponse = await fetch(`${baseUrl}/scripts/dev-server.js`);
    assert.equal(privateResponse.status, 404, 'development tooling must not be publicly served');

    const headResponse = await fetch(`${baseUrl}/app.js`, { method: 'HEAD' });
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), '');

    console.log(`Smoke test passed: homepage, assets and ${data.items.length} data items.`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
