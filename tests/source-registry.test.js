'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SCRAPE_SOURCES, WEIBO_ROUTES } = require('../source_registry');
const { looksBlocked } = require('../fetch_pv_news');

test('CPIA parser accepts the current StaticPage article path', () => {
  const source = SCRAPE_SOURCES.find((item) => item.id === 'cpia');
  assert.ok(source);
  assert.equal(
    source.linkPattern.test('https://www.chinapv.org.cn/StaticPage/Association/content_1941.html'),
    true
  );
});

test('BJX direct scraping has a root-domain fallback query', () => {
  const source = SCRAPE_SOURCES.find((item) => item.id === 'bjx-guangfu');
  assert.equal(source.fallbackQuery, 'site:bjx.com.cn');
});

test('Aliyun WAF challenge pages are classified as blocked', () => {
  assert.equal(looksBlocked('<meta name="aliyun_waf_aa" content="challenge"><div id="renderData"></div>'), true);
});

test('major PV company websites have direct article patterns and a site-search fallback', () => {
  const examples = new Map([
    ['longi-official', 'https://www.longi.com/cn/news/longi-rwe-italy/'],
    ['jinkosolar-official', 'https://www.jinkosolar.com/site/newsdetail/3292'],
    ['tongwei-official', 'https://www.tongwei.com/news/detail/171121.html'],
    ['gcltech-official', 'https://www.gcltech.com/newsinfo/1113.html'],
    ['das-solar-official', 'https://www.das-solar.com/site/news_details/2009'],
    ['sungrow-official', 'https://dl.sungrowpower.com/news/1737.html'],
    ['huawei-solar-official', 'https://solar.huawei.com/cn/news/2026/snec2026/'],
    ['goodwe-official', 'https://www.goodwe.com/news-exhibition/news/4821.html'],
    ['trinasolar-official', 'https://www.trinasolar.com/cn/newsroom202604201718/'],
    ['jasolar-official', 'https://www.jasolar.com/index.php?m=content&c=index&a=show&catid=5&id=1234'],
    ['canadian-solar-official', 'https://cn.csisolar.com/press/sample-release/'],
  ]);

  for (const [id, url] of examples) {
    const source = SCRAPE_SOURCES.find((item) => item.id === id);
    assert.ok(source, `${id} should be registered`);
    assert.equal(source.linkPattern.test(url), true, `${id} should accept its article URL`);
    assert.match(source.fallbackQuery, /^site:/);
  }
});

test('Weibo keyword routes are encoded and explicitly labeled as discovery sources', () => {
  assert.equal(WEIBO_ROUTES.length, 10);
  assert.ok(WEIBO_ROUTES.every((source) => source.route.startsWith('/weibo/keyword/')));
  assert.ok(WEIBO_ROUTES.every((source) => source.source.startsWith('微博：')));
  assert.match(
    WEIBO_ROUTES.find((source) => source.id === 'weibo-company-longi').route,
    /%E9%9A%86%E5%9F%BA%E7%BB%BF%E8%83%BD/
  );
});
