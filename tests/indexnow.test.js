'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { articleUrl } = require('../lib/seo');
const { ENDPOINT, HOST, KEY, KEY_LOCATION, loadUrls, submitIndexNow } = require('../scripts/submit-indexnow');

test('IndexNow URL list contains the homepage, archive and unique article pages', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-indexnow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({
    items: [{ id: 'one' }, { id: 'one' }, { id: 'two' }],
  }));
  assert.deepEqual(loadUrls(root), [
    `https://${HOST}/`,
    `https://${HOST}/api/v1/archive/`,
    articleUrl('one'),
    articleUrl('two'),
  ]);
});

test('IndexNow submits a verified batch and accepts 202 pending validation', async () => {
  let captured;
  const result = await submitIndexNow({
    urls: [`https://${HOST}/`],
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { status: 202 };
    },
  });
  assert.equal(result.status, 202);
  assert.equal(captured.url, ENDPOINT);
  const body = JSON.parse(captured.options.body);
  assert.equal(body.host, HOST);
  assert.equal(body.key, KEY);
  assert.equal(body.keyLocation, KEY_LOCATION);
  assert.deepEqual(body.urlList, [`https://${HOST}/`]);
});

test('IndexNow reports rejected submissions', async () => {
  await assert.rejects(
    submitIndexNow({
      urls: [`https://${HOST}/`],
      fetchImpl: async () => ({ status: 403 }),
    }),
    /HTTP 403/
  );
});
