'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  beijingDateKey,
  computeScoreDetails,
  decodeResponseBuffer,
  isMojibake,
} = require('../fetch_pv_news');

test('beijingDateKey changes day at UTC+8 midnight', () => {
  assert.equal(beijingDateKey(new Date('2026-07-28T15:59:59Z')), '2026-07-28');
  assert.equal(beijingDateKey(new Date('2026-07-28T16:00:00Z')), '2026-07-29');
});

test('decodeResponseBuffer preserves valid UTF-8 Chinese text', () => {
  const source = '光伏组件价格与产能更新';
  const decoded = decodeResponseBuffer(
    Buffer.from(source, 'utf8'),
    { 'content-type': 'text/html; charset=utf-8' }
  );
  assert.equal(decoded, source);
  assert.equal(isMojibake(decoded), false);
});

test('computeScoreDetails returns a bounded score with an explainable breakdown', () => {
  const now = new Date();
  const result = computeScoreDetails({
    source: 'pv-magazine',
    sourceCount: 3,
    title: 'Solar capacity reaches 10 GW',
    summary: 'A detailed market update with policy, capacity, price and project information.'.repeat(2),
    image: 'https://example.com/solar.jpg',
    pubDate: now.toISOString(),
    dateKey: beijingDateKey(now),
  });

  assert.ok(result.score >= 1 && result.score <= 100);
  assert.ok(result.networkHeat >= 0 && result.networkHeat <= 100);
  assert.ok(result.breakdown.crossSource > 0);
  assert.ok(result.breakdown.recency > 0);
});
