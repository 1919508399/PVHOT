#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { articleUrl } = require('../lib/seo');

const ROOT = process.env.PVHOT_ROOT || path.resolve(__dirname, '..');
const HOST = 'pvhot.bbroot.com';
const ORIGIN = `https://${HOST}`;
const KEY = 'cd571181bf9b237f4b5fd56a0640ad17';
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10_000;

function loadUrls(root = ROOT) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
  const items = Array.isArray(data.items) ? data.items : [];
  const urls = [`${ORIGIN}/`, `${ORIGIN}/api/v1/archive/`];
  const seen = new Set(urls);
  for (const item of items) {
    if (urls.length >= MAX_URLS || !item?.id) break;
    const url = articleUrl(item.id);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

async function submitIndexNow(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const urls = options.urls || loadUrls(options.root);
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'PVHOT-IndexNow/1.0',
    },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow returned HTTP ${response.status}`);
  }
  return { status: response.status, count: urls.length };
}

async function main() {
  const result = await submitIndexNow();
  console.log(`[indexnow] accepted ${result.count} URL(s), HTTP ${result.status}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[indexnow] submission failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { ENDPOINT, HOST, KEY, KEY_LOCATION, loadUrls, submitIndexNow };
