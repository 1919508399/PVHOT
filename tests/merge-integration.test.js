'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('merge writes three complete, parseable outputs under a temporary PVHOT_ROOT', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-merge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const previousRoot = process.env.PVHOT_ROOT;
  const previousLockDir = process.env.PVHOT_LOCK_DIR;
  process.env.PVHOT_ROOT = root;
  process.env.PVHOT_LOCK_DIR = path.join(root, '.locks');
  t.after(() => {
    if (previousRoot === undefined) delete process.env.PVHOT_ROOT;
    else process.env.PVHOT_ROOT = previousRoot;
    if (previousLockDir === undefined) delete process.env.PVHOT_LOCK_DIR;
    else process.env.PVHOT_LOCK_DIR = previousLockDir;
  });

  fs.writeFileSync(path.join(root, 'data_raw.json'), JSON.stringify({
    meta: {
      date: '2026-07-29',
      updated: '2026-07-29 12:00',
    },
    categories: ['all', 'market'],
    items: [
      {
        id: 'today',
        title: 'Solar capacity reaches 10 GW',
        source: 'pv-magazine',
        category: 'market',
        dateKey: '2026-07-29',
        pubDate: '2026-07-29T12:00:00',
        summary: 'A detailed and readable solar market update.',
        featured: true,
        score: 90,
      },
      {
        id: 'older',
        title: 'Previous solar market update',
        source: 'pv-tech',
        category: 'market',
        dateKey: '2026-07-28',
        pubDate: '2026-07-28T12:00:00',
        summary: 'Previous context for the market.',
        score: 70,
      },
    ],
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'admin_edits.json'), JSON.stringify({
    deleted: [],
    overrides: {},
    added: [],
  }), 'utf8');

  const mergeModulePath = require.resolve('../merge');
  delete require.cache[mergeModulePath];
  const { merge } = require('../merge');
  assert.equal(merge(), true);

  const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
  const bootstrap = JSON.parse(fs.readFileSync(path.join(root, 'data_bootstrap.json'), 'utf8'));
  const fallbackSource = fs.readFileSync(path.join(root, 'data_fallback.js'), 'utf8');
  const fallbackMatch = fallbackSource.match(/window\.__PV_FALLBACK_DATA\s*=\s*(.+);\s*$/s);
  assert.ok(fallbackMatch, 'fallback output should contain one JSON assignment');
  const fallback = JSON.parse(fallbackMatch[1]);

  assert.equal(data.items.length, 2);
  assert.ok(bootstrap.items.length > 0);
  assert.deepEqual(fallback, data);
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.endsWith('.tmp')),
    []
  );
});
