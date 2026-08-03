'use strict';

const {
  TOPIC_QUERIES,
  CURATED_SEARCH_QUERIES,
  RSS_FEEDS,
  SCRAPE_SOURCES,
  X_ACCOUNTS,
  WECHAT_ACCOUNTS,
  WECHAT_TOPIC_QUERIES,
} = require('../source_registry');

const PUBLISHER_ALIASES = Object.freeze({
  'pv-magazine': 'pv-magazine.com',
  'pv magazine global': 'pv-magazine.com',
  'pv-tech': 'pv-tech.org',
  'pv tech': 'pv-tech.org',
  solarbe: 'solarbe.com',
  '索比光伏网': 'solarbe.com',
  'bjx-guangfu': 'bjx.com.cn',
  '北极星太阳能光伏网': 'bjx.com.cn',
  ne21: 'ne21.com',
  '世纪新能源网': 'ne21.com',
  'nea-renewable': 'nea.gov.cn',
  '国家能源局': 'nea.gov.cn',
  cpia: 'chinapv.org.cn',
  '中国光伏行业协会': 'chinapv.org.cn',
  '中国光伏行业协会cpia': 'chinapv.org.cn',
});

function cleanDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function domainFromUrl(value) {
  try { return cleanDomain(new URL(value).hostname); } catch (error) { return ''; }
}

function slug(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'unknown';
}

function publisherKey(source) {
  const candidates = [source.name, source.source, source.id]
    .filter(Boolean)
    .map((value) => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ''));
  for (const candidate of candidates) {
    if (PUBLISHER_ALIASES[candidate]) return PUBLISHER_ALIASES[candidate];
  }
  const domain = cleanDomain((source.domains || [])[0]) || domainFromUrl(source.url);
  if (domain) return domain;
  return `name:${slug(source.name || source.source || source.id)}`;
}

function buildSourceCatalog() {
  const publishers = new Map();
  const channels = [];
  const add = (input) => {
    const key = publisherKey(input);
    const publisherId = `publisher:${slug(key.replace(/^name:/, ''))}`;
    const current = publishers.get(publisherId) || {
      id: publisherId,
      name: input.name || input.source || input.id,
      tier: input.tier || 2,
      kind: input.publisherKind || input.kind || '媒体',
      domains: [],
      channelIds: [],
    };
    current.tier = Math.min(current.tier, input.tier || 2);
    current.domains = [...new Set([...current.domains, ...(input.domains || []), domainFromUrl(input.url)].map(cleanDomain).filter(Boolean))];
    current.channelIds.push(input.id);
    publishers.set(publisherId, current);
    channels.push({
      id: input.id,
      publisherId,
      name: input.name || input.source || input.id,
      type: input.type,
      mode: input.mode || input.type,
      tier: input.tier || 2,
      category: input.cat || 'ALL',
      url: input.url || '',
      handle: input.handle || '',
    });
  };

  RSS_FEEDS.forEach((source) => add({ ...source, name: source.source, type: 'rss', mode: 'direct-rss' }));
  SCRAPE_SOURCES.forEach((source) => add({ ...source, name: source.source, type: 'website', mode: 'direct-website' }));
  X_ACCOUNTS.forEach((source) => add({
    ...source,
    type: 'x',
    mode: 'official-or-indirect',
    url: `https://x.com/${source.handle}`,
    publisherKind: source.kind,
  }));
  WECHAT_ACCOUNTS.forEach((source) => add({
    ...source,
    id: `wechat:${source.name}`,
    type: 'wechat',
    mode: source.profileId ? 'rsshub-profile' : 'wechat-search',
    publisherKind: source.kind,
  }));

  const discoveryRules = [
    ...TOPIC_QUERIES.map((rule) => ({ id: rule.id, name: rule.cat === 'ALL' ? '全行业主题发现' : `${rule.cat}主题发现`, type: 'news-search', category: rule.cat || 'ALL' })),
    ...CURATED_SEARCH_QUERIES.map((rule) => ({ id: rule.id, name: rule.label || rule.id, type: 'site-search', category: rule.cat || 'ALL' })),
    ...WECHAT_TOPIC_QUERIES.map((query, index) => ({ id: `wechat-topic-${index + 1}`, name: `${query}公众号发现`, type: 'wechat-search', category: 'ALL' })),
  ];

  return {
    schemaVersion: 1,
    publishers: [...publishers.values()].map((publisher) => ({ ...publisher, channelCount: publisher.channelIds.length })),
    channels,
    discoveryRules,
  };
}

module.exports = { buildSourceCatalog, cleanDomain, domainFromUrl, publisherKey, slug };
