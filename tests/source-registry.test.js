'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SCRAPE_SOURCES } = require('../source_registry');
const { looksBlocked } = require('../fetch_pv_news');

test('CPIA parser accepts the current StaticPage article path', () => {
  const source = SCRAPE_SOURCES.find((item) => item.id === 'cpia');
  assert.ok(source);
  assert.equal(
    source.linkPattern.test('https://www.chinapv.org.cn/StaticPage/Association/content_1941.html'),
    true
  );
});

test('Aliyun WAF challenge pages are classified as blocked', () => {
  assert.equal(looksBlocked('<meta name="aliyun_waf_aa" content="challenge"><div id="renderData"></div>'), true);
});
