'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSourceCatalog, resolveItemSource } = require('../lib/source_catalog');
const { RSS_FEEDS, SCRAPE_SOURCES, WECHAT_ACCOUNTS, WEIBO_ROUTES, X_ACCOUNTS } = require('../source_registry');

test('source catalog separates publishers, collection channels and discovery rules', () => {
  const catalog = buildSourceCatalog();
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(catalog.publishers.length > 40);
  assert.equal(
    catalog.channels.length,
    RSS_FEEDS.length + SCRAPE_SOURCES.length + X_ACCOUNTS.length + WECHAT_ACCOUNTS.length + WEIBO_ROUTES.length
  );
  assert.equal(catalog.discoveryRules.length, 28);

  const pvTechChannels = catalog.channels.filter((channel) =>
    channel.publisherId === 'publisher:pv-tech-org'
  );
  assert.ok(pvTechChannels.some((channel) => channel.type === 'rss'));
  assert.ok(pvTechChannels.some((channel) => channel.type === 'x'));
  assert.ok(pvTechChannels.some((channel) => channel.type === 'wechat'));
  assert.equal(new Set(pvTechChannels.map((channel) => channel.publisherId)).size, 1);
  assert.equal(pvTechChannels.find((channel) => channel.type === 'rss').displayName, 'PV Tech（RSS）');
  assert.equal(catalog.publishers.some((publisher) => publisher.domains.includes('x.com')), false);
  assert.ok(catalog.channels.some((channel) =>
    channel.id === 'weibo-topic-pv' && channel.displayName === '微博：光伏行业'
  ));
});

test('legacy collector ids resolve to readable publishers and explicit channels', () => {
  const latitude = resolveItemSource({
    source: 'latitude-media',
    link: 'https://news.google.com/articles/example',
    googleNewsUrl: 'https://news.google.com/articles/example',
    _sourceChannelType: 'google-news',
  });
  assert.equal(latitude.name, 'Latitude Media');
  assert.equal(latitude.displayName, 'Latitude Media（Google News）');
  assert.equal(latitude.originalResolved, false);

  const rss = resolveItemSource({
    source: 'solar-power-world',
    link: 'https://www.solarpowerworldonline.com/example',
    _sourceChannelType: 'rss',
  });
  assert.equal(rss.displayName, 'Solar Power World（RSS）');
  assert.equal(rss.originalResolved, true);

  const wechat = resolveItemSource({
    source: '公众号',
    author: '晶科能源JinkoSolar',
    link: 'https://mp.weixin.qq.com/s/example',
    _sourceChannelType: 'wechat',
  });
  assert.equal(wechat.displayName, '公众号：晶科能源JinkoSolar');
  assert.equal(wechat.kind, 'company');
  assert.notEqual(wechat.domain, 'mp.weixin.qq.com');

  const weibo = resolveItemSource({
    source: '微博：隆基绿能', author: '隆基绿能', link: 'https://weibo.com/123/example',
  });
  assert.equal(weibo.channelType, 'weibo');
  assert.equal(weibo.displayName, '微博：隆基绿能');
  assert.equal(weibo.official, false);

  const company = resolveItemSource({
    source: '华晟新能源',
    link: 'https://www.huasunsolar.com/news/example',
    _sourceChannelType: 'website',
  });
  assert.equal(company.displayName, '华晟新能源：新闻中心（企业官网）');
  assert.equal(company.official, true);
});
