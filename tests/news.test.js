'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  beijingDateKey,
  computeScoreDetails,
  decodeResponseBuffer,
  inspectFeedStructure,
  isMojibake,
  mapLimit,
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

test('custom sources cannot inherit the built-in trusted-source score', () => {
  const common = {
    source: 'pv-magazine',
    sourceCount: 1,
    title: 'Solar market update',
    summary: 'A detailed solar market update with policy and project information.',
    pubDate: new Date().toISOString(),
    dateKey: beijingDateKey(),
  };
  const builtIn = computeScoreDetails(common);
  const custom = computeScoreDetails({ ...common, _customSourceId: 'custom-feed-id' });

  assert.equal(builtIn.breakdown.authority, 12);
  assert.equal(custom.breakdown.authority, 4);
  assert.ok(custom.score < builtIn.score);
});

test('feed structure check separates a valid empty feed from broken parsing', () => {
  const empty = inspectFeedStructure(
    '<?xml version="1.0"?><rss><channel></channel></rss>',
    []
  );
  assert.deepEqual(empty, { ok: true, declaredItems: 0 });

  const truncated = inspectFeedStructure(
    '<?xml version="1.0"?><rss><channel><item><title>News</title>',
    []
  );
  assert.equal(truncated.ok, false);
  assert.equal(truncated.errorCode, 'truncated_feed');

  const changed = inspectFeedStructure(
    '<rss><channel><item><title>News</title><link></link></item></channel></rss>',
    []
  );
  assert.equal(changed.ok, false);
  assert.equal(changed.errorCode, 'feed_items_unparsed');
});

test('mapLimit caps concurrent source requests and preserves result order', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.equal(peak, 2);
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});
