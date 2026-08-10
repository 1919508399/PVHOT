'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSourceCatalog } = require('../lib/source_catalog');

test('source catalog separates publishers, collection channels and discovery rules', () => {
  const catalog = buildSourceCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.publishers.length > 40);
  assert.equal(catalog.channels.length, 65);
  assert.equal(catalog.discoveryRules.length, 26);

  const pvTechChannels = catalog.channels.filter((channel) =>
    channel.publisherId === 'publisher:pv-tech-org'
  );
  assert.ok(pvTechChannels.some((channel) => channel.type === 'rss'));
  assert.ok(pvTechChannels.some((channel) => channel.type === 'x'));
  assert.ok(pvTechChannels.some((channel) => channel.type === 'wechat'));
  assert.equal(new Set(pvTechChannels.map((channel) => channel.publisherId)).size, 1);
});
