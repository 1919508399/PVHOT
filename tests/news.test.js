'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  beijingDateKey,
  buildBody,
  buildPublicSummaryCn,
  computeScoreDetails,
  buildReason,
  classify,
  decodeHtmlText,
  decodeResponseBuffer,
  dedupeXArticleSignals,
  extractArticleDetails,
  extractTopics,
  filterPostEnrichmentFresh,
  inspectFeedStructure,
  isMojibake,
  isHighInfluenceWeiboItem,
  isFeaturedEligibleItem,
  isRelevantItem,
  mapLimit,
  normalizeArticleImage,
  normalizeWeiboItem,
  parseGenericRSS,
  parseJsonLdListItems,
  selectArticleEnrichmentCandidates,
  shortenWeiboTitle,
} = require('../fetch_pv_news');

test('rule fallback recommendation reason preserves the concrete procurement signal', () => {
  const reason = buildReason({
    title_cn: '0.525元/Wh！河北1.2GWh储能系统采购中标人公示',
    summary_cn: '河北1.2GWh储能系统采购公布中标结果，折合单价0.525元/Wh。',
    category: '储能',
  });
  assert.match(reason, /0\.525元\/Wh/);
  assert.match(reason, /采购|报价|收益测算/);
  assert.doesNotMatch(reason, /信息明确|影响有限|属于企业动态|值得关注/);
});

test('beijingDateKey changes day at UTC+8 midnight', () => {
  assert.equal(beijingDateKey(new Date('2026-07-28T15:59:59Z')), '2026-07-28');
  assert.equal(beijingDateKey(new Date('2026-07-28T16:00:00Z')), '2026-07-29');
});

test('an X discovery signal does not count the same canonical article twice', () => {
  const article = {
    title: 'Solar record',
    link: 'https://www.example.com/story/?utm_source=x',
    source: 'official-rss',
    summary: 'Official article summary.',
  };
  const xSignal = {
    title: 'Solar record https://t.co/a',
    link: 'https://example.com/story/',
    source: 'X account',
    summary: '',
    xPostUrl: 'https://x.com/example/status/123',
    xHandle: 'example',
    xSignalCount: 1,
    _xSourceId: 'x-example',
  };

  const result = dedupeXArticleSignals([article, xSignal]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'official-rss');
  assert.equal(result[0].xPostUrl, xSignal.xPostUrl);
  assert.equal(result[0].xSignalCount, 1);
});

test('canonical article dedupe ignores tracking and query parameter order', () => {
  const article = {
    title: 'Solar record',
    link: 'https://example.com/story/?b=2&a=1&utm_medium=social',
    source: 'official-rss',
  };
  const xSignal = {
    title: 'Solar record',
    link: 'https://www.example.com/story?a=1&b=2',
    source: 'X account',
    xPostUrl: 'https://x.com/example/status/124',
    _xSourceId: 'x-example',
  };

  const result = dedupeXArticleSignals([article, xSignal]);
  assert.equal(result.length, 1);
  assert.equal(result[0].xPostUrl, xSignal.xPostUrl);
});

test('indirect X discovery deduplicates against the same official article without inventing a post signal', () => {
  const article = {
    title: 'Official solar article',
    link: 'https://example.com/solar-story/',
    source: 'official-rss',
  };
  const indirect = {
    title: 'Official solar article',
    link: 'https://www.example.com/solar-story/?utm_source=search',
    source: 'X account owner',
    _xSourceId: 'x-example',
    _xIndirect: true,
    _xAccountHandle: 'example',
  };

  const result = dedupeXArticleSignals([article, indirect]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'official-rss');
  assert.equal(result[0].xPostUrl || '', '');
  assert.equal(result[0].xSignalCount, 0);
  assert.equal(result[0].xIndirectSignalCount, 1);
  assert.deepEqual(result[0].xIndirectAccounts, ['example']);
});

test('post-enrichment freshness requires X articles to confirm the official publication date', () => {
  const now = new Date('2026-08-03T08:00:00Z');
  const today = '2026-08-03T03:00:00Z';
  const old = '2026-07-20T03:00:00Z';
  const common = {
    title: 'Solar module market update',
    summary: 'Solar module manufacturing and project news.',
    source: 'industry source',
  };
  const items = [
    { ...common, id: 'x-unconfirmed', pubDate: today, _xSourceId: 'x-one', _xArticleDateConfirmed: false },
    { ...common, id: 'x-confirmed', pubDate: today, _xSourceId: 'x-two', _xArticleDateConfirmed: true },
    { ...common, id: 'x-old', pubDate: old, _xSourceId: 'x-three', _xArticleDateConfirmed: true },
    { ...common, id: 'rss-today', pubDate: today },
  ];

  assert.deepEqual(
    filterPostEnrichmentFresh(items, now).map((item) => item.id),
    ['x-confirmed', 'rss-today']
  );
});

test('article detail extraction keeps an official publication date even without a long body', () => {
  const html = '<!doctype html><html><head>'
    + '<meta property="og:title" content="Solar project reaches operation">'
    + '<meta property="article:published_time" content="2026-08-03T03:00:00Z">'
    + '</head><body>' + ' '.repeat(600) + '</body></html>';
  const details = extractArticleDetails(html, 'https://example.com/story', 'Fallback solar title', '');

  assert.equal(details.headline, 'Solar project reaches operation');
  assert.equal(details.publishedAt, '2026-08-03T03:00:00.000Z');
});

test('article enrichment reserves capacity for X discoveries that need date confirmation', () => {
  const now = new Date().toISOString();
  const regular = Array.from({ length: 40 }, (_, index) => ({
    title: `Solar regular ${index}`,
    summary: '',
    pubDate: now,
    link: `https://regular.example/${index}`,
  }));
  const xItems = Array.from({ length: 12 }, (_, index) => ({
    title: `Solar X ${index}`,
    summary: '',
    pubDate: now,
    link: `https://x-source.example/${index}`,
    _xSourceId: `x-${index}`,
  }));

  const selected = selectArticleEnrichmentCandidates([...regular, ...xItems], 20);
  assert.equal(selected.length, 20);
  assert.ok(selected.filter((item) => item._xSourceId).length >= 5);
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

test('decodeHtmlText converts common named entities used by company news pages', () => {
  assert.equal(decodeHtmlText('&ldquo;PV&rdquo;&nbsp;&mdash;&nbsp;news'), '“PV” — news');
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

test('classification accumulates evidence instead of using the first keyword', () => {
  assert.equal(classify('Solar module price policy and battery storage update'), '价格');
  assert.equal(classify('BESS battery storage project expansion'), '储能');
});

test('Weibo discovery keeps PV news and rejects stock-only chatter', () => {
  assert.equal(isRelevantItem({
    source: '微博：光伏行业',
    title: '隆基发布新一代BC光伏组件',
    summary: '组件效率和量产计划公布。',
  }), true);
  assert.equal(isRelevantItem({
    source: '微博：阳光电源关键词',
    title: 'A股涨停牛股推荐',
    summary: '个股短线交易和选股观点。',
  }), false);
});

test('quality gate rejects recruitment, fund market, astronomy and event-promotion noise', () => {
  const cases = [
    { title: 'Solar installer jobs available: apply now', summary: 'Residential photovoltaic company vacancies.' },
    { title: 'Top solar ETF fund performance and holdings this week', summary: 'The photovoltaic index moved higher.' },
    { title: 'Where to watch the solar eclipse tonight', summary: 'Astronomy viewing guide.' },
    { title: 'Solar Energy Expo registration open: save the date', summary: 'Join us at the conference.' },
  ];
  for (const item of cases) {
    assert.equal(isRelevantItem({ ...item, source: 'Google News' }), false, item.title);
  }
});

test('quality gate rechecks translations and AI editorial relevance', () => {
  assert.equal(isRelevantItem({
    title: 'Solar industry weekly update',
    title_cn: '本周太阳能 ETF 基金行情与持仓排名',
    summary: 'Solar market summary.',
    source: 'Google News',
  }), false);
  assert.equal(isRelevantItem({
    title: 'Solar module factory expands TOPCon capacity',
    summary: 'The photovoltaic manufacturer added 5 GW of annual capacity.',
    summary_cn: '光伏组件企业新增 5GW TOPCon 年产能。',
    summaryMode: 'ai-editor',
    source: 'pv-magazine',
    ai: { relevant: false },
  }), false);
  assert.equal(isRelevantItem({
    title: 'Solar module factory expands TOPCon capacity',
    summary: 'The photovoltaic manufacturer added 5 GW of annual capacity.',
    source: 'pv-magazine',
    ai: { relevant: true },
  }), true);
  assert.equal(isRelevantItem({
    title: 'Solar industry update',
    summary: 'Registration open for the upcoming solar conference.',
    summaryMode: 'article',
    source: 'Google News',
    ai: { relevant: true, analyzed: true },
  }), false, 'AI 已分析但未改写摘要时仍应执行本地摘要门禁');
});

test('wind coverage can remain in the archive but cannot be automatically featured', () => {
  const mixedRenewables = {
    title: 'Solar and wind power projects win 2 GW renewable auction',
    summary: 'The auction awarded 1.2 GW of photovoltaic capacity and 800 MW of wind power.',
    source: 'Reuters',
  };
  assert.equal(isRelevantItem(mixedRenewables), true);
  assert.equal(isFeaturedEligibleItem(mixedRenewables), false);
  assert.equal(isFeaturedEligibleItem({
    title: 'Solar module prices fall after polysilicon supply expands',
    summary: 'Photovoltaic manufacturers adjusted quotations.',
    source: 'pv-magazine',
  }), true);
  assert.equal(isRelevantItem({
    title: '企业启动500MW风光储一体化项目',
    summary: '项目包括300MW光伏与100MWh电化学储能系统。',
    source: '企业官微',
  }), true, '非权威名单来源的明确风光储项目仍应进入行业动态');
  assert.equal(isRelevantItem({
    title: '海上风电场完成全部风机吊装',
    summary: '项目将增加区域风力发电装机。',
    source: '企业官微',
  }), false, '纯风电报道不进入光伏行业动态');
});

test('quality gate retains standalone electrochemical storage industry coverage', () => {
  const bessProject = {
    title: 'Grid-scale BESS project begins commercial operation',
    summary: 'The 400 MWh battery energy storage system will provide grid balancing services.',
    source: 'energy-storage.news',
  };
  assert.equal(isRelevantItem(bessProject), true);
  assert.equal(isFeaturedEligibleItem(bessProject), true);
});

test('article image gate rejects article pages while retaining image resources', () => {
  const article = 'https://example.com/news/solar-project.html?utm_source=rss';
  assert.equal(normalizeArticleImage(article, article), '');
  assert.equal(normalizeArticleImage(
    'https://example.com/news/solar-project.html?utm_medium=feed',
    article
  ), '');
  assert.equal(normalizeArticleImage(
    'https://example.com/news/solar-project.html?image=1',
    article
  ), '');
  assert.equal(normalizeArticleImage('https://cdn.example.com/story/solar-project.php', article), '');
  assert.equal(normalizeArticleImage('https://cdn.example.com/render?output=html', article), '');
  assert.equal(
    normalizeArticleImage('/images/solar-project.jpg?width=1200', article),
    'https://example.com/images/solar-project.jpg?width=1200'
  );
  assert.equal(
    normalizeArticleImage('https://images.example.com/photo?id=42&format=webp', article),
    'https://images.example.com/photo?id=42&format=webp'
  );
});

test('Weibo RSS keeps the account, uses a short title and preserves the post body as summary', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>南储能源: 发布了头条文章：《自建房装太阳能光伏公司售后不踩坑选购参考》 正文内容</title>
    <description>&lt;a href="https://weibo.com/1"&gt;南储能源&lt;/a&gt;: 发布了头条文章：《自建房装太阳能光伏公司售后不踩坑选购参考》，正文保留在摘要里。</description>
    <link>https://weibo.com/1/example</link><pubDate>Tue, 11 Aug 2026 07:00:00 GMT</pubDate><author>南储能源</author>
  </item></channel></rss>`;
  const [parsed] = parseGenericRSS(xml, '');
  const item = normalizeWeiboItem(parsed, { source: '微博：光伏行业' });

  assert.equal(parsed.author, '南储能源');
  assert.equal(item.source, '南储能源');
  assert.equal(item.title, '自建房装太阳能光伏公司售后不踩坑选购参考');
  assert.equal(item.summary, '发布了头条文章：《自建房装太阳能光伏公司售后不踩坑选购参考》，正文保留在摘要里。');
});

test('Weibo presentation removes repeated account prefixes and media placeholders', () => {
  const item = normalizeWeiboItem({
    title: '光伏观察员: 光伏组件最新价格 [图片]',
    summary: '光伏观察员 : 光伏组件最新价格 [图片]',
    author: '光伏观察员',
  });
  item.lang = 'zh';
  item.cat = '组件';
  item._sourceChannelType = 'weibo';
  item.summary_cn = '光伏观察员 : 光伏组件最新价格 [图片]';

  assert.equal(item.title, '光伏组件最新价格');
  assert.doesNotMatch(buildBody(item), /^光伏观察员/);
  assert.doesNotMatch(buildBody(item), /\[图片\]/);
  assert.equal(buildPublicSummaryCn(item), '光伏组件最新价格');
});

test('Weibo generated titles are bounded and do not repeat the account name', () => {
  const title = shortenWeiboTitle('某企业今日公布了一项很长很长的光伏储能项目进展，包含项目规模、并网时间、设备采购与后续执行安排');
  assert.ok(title.length <= 37);
  assert.match(title, /…$/);
});

test('Weibo discovery admits only curated high-influence accounts', () => {
  assert.equal(isHighInfluenceWeiboItem({
    author: '经济观察报',
    link: 'https://weibo.com/1641561812/example',
  }), true);
  assert.equal(isHighInfluenceWeiboItem({
    author: '新能源研究评论员-红炜',
    link: 'https://weibo.com/1293350964/example',
  }), true);
  assert.equal(isHighInfluenceWeiboItem({
    author: '经济观察报',
    link: 'https://weibo.com/9999999999/example',
  }), false);
  assert.equal(isHighInfluenceWeiboItem({
    author: '某光伏设备小店',
    link: 'https://weibo.com/8334648460/example',
  }), false);
});

test('topic extraction never fabricates four-character fragments', () => {
  assert.deepEqual(extractTopics('今天发布了一份行业公告'), []);
  const topics = extractTopics('光伏组件价格下跌');
  assert.ok(topics.includes('组件'));
  assert.ok(topics.every((topic) => topic.length !== 4));
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

test('company website scraper reads schema.org ItemList entries', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'ItemList',
    itemListElement: [{
      '@type': 'ListItem',
      name: '阳光电源发布新一代光伏逆变器',
      url: '/news/1737.html',
      datePublished: '2026.07.09',
    }],
  }) + '</script>';
  const items = parseJsonLdListItems(html, {
    url: 'https://dl.sungrowpower.com/news.html?class_id=1',
    source: '阳光电源',
    linkPattern: /sungrowpower\.com\/news\/\d+\.html$/i,
  }, new Set());

  assert.equal(items.length, 1);
  assert.equal(items[0].title, '阳光电源发布新一代光伏逆变器');
  assert.equal(items[0].pubDate, '2026-07-09T00:00:00Z');
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
