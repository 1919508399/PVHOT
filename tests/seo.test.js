'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  articleIdFromToken,
  articleToken,
  articleUrl,
  renderArticlePage,
  renderSitemap,
} = require('../lib/seo');

test('article tokens are reversible, URL-safe and stable for Unicode IDs', () => {
  const id = '微信公众号/2026-08-12/一号';
  const token = articleToken(id);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(articleIdFromToken(token), id);
  assert.equal(articleUrl(id), `https://pvhot.bbroot.com/api/v1/articles/${token}/`);
  assert.equal(articleIdFromToken('../bad'), null);
});

test('article HTML escapes untrusted content and exposes NewsArticle metadata', () => {
  const html = renderArticlePage({
    id: 'one',
    title_cn: '<script>alert(1)</script> 光伏新闻',
    summary_cn: '摘要 & 说明',
    source: '测试信源',
    category: '组件',
    pubDate: '2026-08-12T01:00:00.000Z',
    link: 'https://example.com/story',
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /"@type":"NewsArticle"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/pvhot\.bbroot\.com\/api\/v1\/articles\/b25l\/">/);
});

test('article HTML omits unsafe original-source URLs', () => {
  const html = renderArticlePage({
    id: 'unsafe-link',
    title_cn: 'Unsafe link regression',
    summary_cn: 'Unsafe links must not reach an href or structured data.',
    link: 'javascript:alert(1)',
  });
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /查看原始信源/);
});

test('sitemap contains unique homepage, archive and article URLs with fresh dates', () => {
  const xml = renderSitemap({
    meta: { updated: '2026-08-12T02:00:00.000Z' },
    items: [
      { id: 'one', pubDate: '2026-08-12T01:00:00.000Z' },
      { id: 'one', pubDate: '2026-08-12T01:00:00.000Z' },
    ],
  });
  assert.match(xml, /<loc>https:\/\/pvhot\.bbroot\.com\/api\/v1\/articles\/b25l\/<\/loc><lastmod>2026-08-12<\/lastmod>/);
  assert.equal((xml.match(/\/api\/v1\/articles\/b25l\//g) || []).length, 1);
  assert.doesNotMatch(xml, /news:news|mobile:mobile/);
});
