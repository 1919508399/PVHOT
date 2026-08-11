'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildBootstrap,
  isMojibake,
  sanitizeItem,
} = require('../merge');

test('isMojibake distinguishes readable text from replacement characters', () => {
  assert.equal(isMojibake('光伏行业持续更新'), false);
  assert.equal(isMojibake('broken \uFFFD\uFFFD text'), true);
});

test('sanitizeItem preserves a healthy title and replaces a broken summary', () => {
  const item = sanitizeItem({
    id: 'example',
    title: 'Solar capacity reaches a new record',
    source: 'pv-magazine',
    category: 'market',
    summary: '\uFFFD\uFFFD',
  });

  assert.equal(item.title, 'Solar capacity reaches a new record');
  assert.equal(item.source, 'PV Magazine Global');
  assert.equal(item.sourceDisplayName, 'PV Magazine Global（网页）');
  assert.equal(item.sourceInfo.domain, 'pv-magazine.com');
  assert.equal(item.reason, '');
  assert.equal(item.summaryMode, 'headline');
  assert.ok(item.summary.length > 20);
});

test('sanitizeItem retains recommendation reasons only for featured items', () => {
  const featured = sanitizeItem({
    id: 'featured', title: 'Featured item', source: 'pv-tech',
    link: 'https://www.pv-tech.org/example', featured: true, reason: 'A useful reason for selection.',
  });
  const regular = sanitizeItem({
    id: 'regular', title: 'Regular item', source: 'pv-tech',
    link: 'https://www.pv-tech.org/example-2', featured: false, reason: 'Must not leak.',
  });
  assert.equal(featured.recommendationReason, 'A useful reason for selection.');
  assert.equal(regular.recommendationReason, '');
  assert.equal(regular.reason, '');
});

test('buildBootstrap prioritizes today featured and high-score items', () => {
  const today = '2026-07-29';
  const items = [
    { id: 'older', dateKey: '2026-07-28', pubDate: '2026-07-28T10:00:00', score: 100 },
    { id: 'normal', dateKey: today, pubDate: '2026-07-29T12:00:00', score: 30 },
    { id: 'featured', dateKey: today, pubDate: '2026-07-29T09:00:00', score: 70, featured: true },
    { id: 'high-score', dateKey: today, pubDate: '2026-07-29T11:00:00', score: 90 },
  ];
  const bootstrap = buildBootstrap({
    meta: { date: today },
    categories: ['all'],
    items,
  }, 2);

  assert.deepEqual(
    bootstrap.items.slice(0, 3).map((item) => item.id),
    ['featured', 'high-score', 'normal']
  );
  assert.equal(bootstrap.meta.bootstrap, true);
  assert.equal(bootstrap.meta.totalItems, 4);
  assert.equal(new Set(bootstrap.items.map((item) => item.id)).size, bootstrap.items.length);
});
