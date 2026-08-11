'use strict';

const {
  TOPIC_QUERIES,
  CURATED_SEARCH_QUERIES,
  RSS_FEEDS,
  SCRAPE_SOURCES,
  X_ACCOUNTS,
  WECHAT_ACCOUNTS,
  WECHAT_TOPIC_QUERIES,
  WEIBO_ROUTES,
} = require('../source_registry');

const PUBLISHER_ALIASES = Object.freeze({
  'pv-magazine': 'pv-magazine.com',
  'pv-magazine-global': 'pv-magazine.com',
  'pv magazine global': 'pv-magazine.com',
  'pv-magazine-usa': 'pv-magazine-usa.com',
  'pv-tech': 'pv-tech.org',
  'pv tech': 'pv-tech.org',
  'solar-power-world': 'solarpowerworldonline.com',
  'solar power world': 'solarpowerworldonline.com',
  'energy-storage-news': 'energy-storage.news',
  'energy-storage.news': 'energy-storage.news',
  cleantechnica: 'cleantechnica.com',
  solarquarter: 'solarquarter.com',
  'mercom-india': 'mercomindia.com',
  'mercom india': 'mercomindia.com',
  'saur-energy': 'saurenergy.com',
  'saur energy': 'saurenergy.com',
  'utility-dive-energy': 'utilitydive.com',
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
  'ofweek太阳能光伏网': 'ofweek.com',
  '维科网光伏': 'ofweek.com',
  '国际太阳能光伏网': 'in-en.com',
  '国际能源网': 'in-en.com',
  'latitude-media': 'latitudemedia.com',
});

const PUBLISHER_DISPLAY_NAMES = Object.freeze({
  'pv-magazine.com': 'PV Magazine Global',
  'pv-magazine-usa.com': 'PV Magazine USA',
  'pv-tech.org': 'PV Tech',
  'solarpowerworldonline.com': 'Solar Power World',
  'energy-storage.news': 'Energy-Storage.news',
  'ess-news.com': 'ESS News',
  'cleantechnica.com': 'CleanTechnica',
  'solarquarter.com': 'SolarQuarter',
  'mercomindia.com': 'Mercom India',
  'saurenergy.com': 'Saur Energy',
  'utilitydive.com': 'Utility Dive Energy',
  'solarbe.com': '索比光伏网',
  'bjx.com.cn': '北极星太阳能光伏网',
  'ne21.com': '世纪新能源网',
  'nea.gov.cn': '国家能源局',
  'chinapv.org.cn': '中国光伏行业协会',
  'huasunsolar.com': '华晟新能源',
  'ofweek.com': 'OFweek太阳能光伏网',
  'in-en.com': '国际能源网',
  'latitudemedia.com': 'Latitude Media',
  'taiyangnews.info': 'TaiyangNews',
  'canarymedia.com': 'Canary Media',
  'reneweconomy.com.au': 'RenewEconomy',
  'solarpowerportal.co.uk': 'Solar Power Portal',
  'seia.org': 'SEIA',
  'irena.org': 'IRENA',
  'ember-energy.org': 'Ember',
});

const ENTERPRISE_DOMAINS = new Set([
  'huasunsolar.com', 'longi.com', 'jinkosolar.com', 'trinasolar.com', 'jasolar.com',
  'tongwei.com', 'gcltech.com', 'tclzhonghuan.com', 'canadiansolar.com',
  'risenenergy.com', 'aikosolar.com', 'astronergy.com', 'das-solar.com',
  'sungrowpower.com', 'solar.huawei.com', 'sineng-electric.com', 'goodwe.com',
  'ginlong.com', 'deyeinverter.com', 'hoymiles.com', 'apsystems.com',
]);

const INSTITUTION_DOMAINS = new Set([
  'nea.gov.cn', 'ndrc.gov.cn', 'miit.gov.cn', 'chinapv.org.cn', 'iea.org',
  'irena.org', 'iea-pvps.org', 'nrel.gov', 'seia.org', 'solarpowereurope.org',
  'ember-energy.org', 'cnesa.org.cn',
]);

const KIND_KEYS = Object.freeze({
  媒体: 'media', 企业: 'company', 机构: 'institution', 研究: 'research', 储能: 'media',
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

function normalizeAlias(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function aliasDomain(value) {
  const normalized = normalizeAlias(value);
  if (!normalized) return '';
  return PUBLISHER_ALIASES[normalized]
    || PUBLISHER_ALIASES[normalized.replace(/\s+/g, '')]
    || '';
}

function registeredDomain(hostname) {
  const host = cleanDomain(hostname);
  if (!host) return '';
  const known = [
    ...Object.keys(PUBLISHER_DISPLAY_NAMES),
    ...ENTERPRISE_DOMAINS,
    ...INSTITUTION_DOMAINS,
  ].sort((a, b) => b.length - a.length);
  return known.find((domain) => host === domain || host.endsWith(`.${domain}`)) || host;
}

function titleCaseSource(value) {
  const acronyms = new Map([
    ['pv', 'PV'], ['rss', 'RSS'], ['ess', 'ESS'], ['seia', 'SEIA'], ['iea', 'IEA'],
    ['irena', 'IRENA'], ['ofweek', 'OFweek'], ['ne21', 'NE21'], ['bbc', 'BBC'],
    ['reuters', 'Reuters'], ['bloomberg', 'Bloomberg'], ['taiyangnews', 'TaiyangNews'],
  ]);
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => acronyms.get(part.toLowerCase())
      || (/^[A-Z0-9.&]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function publisherDisplayName(rawName, domain = '') {
  const raw = String(rawName || '').trim().replace(/^(?:公众号|微信公众号|微博|X)[：:]\s*/i, '');
  const normalizedDomain = registeredDomain(domain || aliasDomain(raw));
  if (PUBLISHER_DISPLAY_NAMES[normalizedDomain]) return PUBLISHER_DISPLAY_NAMES[normalizedDomain];
  if (!raw) return normalizedDomain || '行业信源';
  if (/[\u3400-\u9fff]/.test(raw)) return raw;
  return titleCaseSource(raw);
}

const CHANNELS_BY_ID = new Map([
  ...RSS_FEEDS.map((source) => [source.id, { ...source, type: 'rss', mode: 'direct-rss' }]),
  ...SCRAPE_SOURCES.map((source) => [source.id, { ...source, type: 'website', mode: 'direct-website' }]),
  ...X_ACCOUNTS.map((source) => [source.id, { ...source, type: 'x', mode: 'official-or-indirect' }]),
  ...WECHAT_ACCOUNTS.map((source) => [`wechat:${source.name}`, {
    ...source,
    id: `wechat:${source.name}`,
    type: 'wechat',
    mode: source.profileId ? 'rsshub-profile' : 'wechat-search',
  }]),
  ...WEIBO_ROUTES.map((source) => [source.id, {
    ...source,
    type: 'weibo',
    mode: source.mode || 'rsshub-keyword',
  }]),
]);

function wechatAccount(name) {
  const key = normalizeAlias(name);
  return WECHAT_ACCOUNTS.find((account) => [account.name, ...(account.aliases || [])]
    .some((alias) => normalizeAlias(alias) === key));
}

function publisherKind(rawName, domain, channel) {
  if (channel.type === 'wechat') {
    const account = wechatAccount(rawName);
    if (account && account.kind) return account.kind;
  }
  if (channel.kind) return channel.kind;
  const normalizedDomain = registeredDomain(domain);
  if ([...ENTERPRISE_DOMAINS].some((item) => normalizedDomain === item || normalizedDomain.endsWith(`.${item}`))) return '企业';
  if ([...INSTITUTION_DOMAINS].some((item) => normalizedDomain === item || normalizedDomain.endsWith(`.${item}`))) return '机构';
  if (/国家能源局|发改委|工信部|行业协会|CPIA|SEIA|IRENA|IEA|NREL/i.test(rawName || '')) return '机构';
  if (/官方|隆基|晶科|天合|晶澳|通威|协鑫|中环|阿特斯|东方日升|爱旭|正泰|一道新能|阳光电源|华为|上能|固德威|锦浪|德业|禾迈|昱能/i.test(rawName || '')) return '企业';
  return '媒体';
}

function inferChannel(item) {
  const channelId = String(item?._sourceChannelId || '');
  const registered = CHANNELS_BY_ID.get(channelId) || {};
  let type = String(item?._sourceChannelType || registered.type || '');
  const raw = String(item?.source || '');
  const linkHost = domainFromUrl(item?.link);
  if (!type && (raw === '公众号' || /公众号|wechat/i.test(raw) || /weixin\.sogou\.com|mp\.weixin\.qq\.com/.test(linkHost))) type = 'wechat';
  if (!type && (/微博|weibo/i.test(raw) || /(^|\.)weibo\.com$/.test(linkHost))) type = 'weibo';
  if (!type && (item?.googleNewsUrl || linkHost === 'news.google.com')) type = 'google-news';
  if (!type && item?._xSourceId) type = 'x';
  if (!type && item?._customSourceType) type = item._customSourceType;
  if (!type) type = 'website';
  return {
    ...registered,
    id: channelId || registered.id || '',
    type,
    mode: String(item?._sourceMode || registered.mode || type),
  };
}

function channelLabel(type, kind) {
  if (type === 'wechat') return '公众号';
  if (type === 'weibo') return '微博';
  if (type === 'rss') return 'RSS';
  if (type === 'google-news') return 'Google News';
  if (type === 'x') return 'X';
  if (type === 'website' && kind === '企业') return '企业官网';
  if (type === 'website' && kind === '机构') return '机构官网';
  if (type === 'website') return '网页';
  return '自定义';
}

function formatSourceDisplayName(name, channel, kind, handle = '') {
  const label = channelLabel(channel.type, kind);
  if (channel.type === 'wechat') return `公众号：${name}`;
  if (channel.type === 'weibo') return `微博：${name}`;
  if (channel.type === 'x' && handle) return `X：${name} (@${String(handle).replace(/^@/, '')})`;
  if (channel.type === 'x') return `X：${name}`;
  if (channel.type === 'website' && kind === '企业') return `${name}：新闻中心（企业官网）`;
  if (channel.type === 'website' && kind === '机构') return `${name}（机构官网）`;
  return `${name}（${label}）`;
}

function resolveItemSource(item = {}) {
  const channel = inferChannel(item);
  const rawName = channel.type === 'wechat'
    ? (item.author || item.account || item.source || channel.name)
    : (item.source || channel.name || channel.source || item.author);
  const linkDomain = registeredDomain(domainFromUrl(item.link));
  const discoveryOnlyDomain = ['news.google.com', 'weixin.sogou.com'].includes(linkDomain);
  const publisherNeutralDomain = discoveryOnlyDomain
    || linkDomain === 'mp.weixin.qq.com'
    || linkDomain === 'weibo.com';
  const configuredDomain = registeredDomain((channel.domains || [])[0] || domainFromUrl(channel.url));
  const channelOwnsConfiguredDomain = ['rss', 'website', 'x'].includes(channel.type);
  const domain = registeredDomain(aliasDomain(rawName)
    || (channelOwnsConfiguredDomain ? configuredDomain : '')
    || (!publisherNeutralDomain ? linkDomain : '')
    || configuredDomain);
  const name = publisherDisplayName(rawName, domain);
  const kindLabel = publisherKind(rawName, domain, channel);
  const handle = item.xHandle || channel.handle || '';
  const originalUrl = discoveryOnlyDomain ? '' : String(item.link || '');
  const discoveryUrl = String(item.googleNewsUrl || (discoveryOnlyDomain ? item.link : '') || item.xPostUrl || '');
  const label = channelLabel(channel.type, kindLabel);
  return {
    id: `publisher:${slug(domain || name)}`,
    name,
    displayName: formatSourceDisplayName(name, channel, kindLabel, handle),
    kind: KIND_KEYS[kindLabel] || 'media',
    kindLabel,
    channelId: channel.id || '',
    channelType: channel.type,
    channelLabel: label,
    method: channel.mode || channel.type,
    official: kindLabel === '企业' || kindLabel === '机构',
    domain,
    homepageUrl: domain ? `https://${domain}/` : '',
    originalUrl,
    discoveryUrl,
    originalResolved: Boolean(originalUrl),
    handle: handle ? String(handle).replace(/^@/, '') : '',
  };
}

function publisherKey(source) {
  const candidates = [source.name, source.source, source.id].filter(Boolean);
  for (const candidate of candidates) {
    const domain = aliasDomain(candidate);
    if (domain) return domain;
  }
  const configuredDomain = cleanDomain((source.domains || [])[0]);
  const urlDomain = ['x', 'wechat'].includes(source.type) ? '' : domainFromUrl(source.url);
  const domain = registeredDomain(configuredDomain || urlDomain);
  if (domain) return domain;
  return `name:${slug(source.name || source.source || source.id)}`;
}

function buildSourceCatalog() {
  const publishers = new Map();
  const channels = [];
  const add = (input) => {
    const key = publisherKey(input);
    const publisherId = `publisher:${slug(key.replace(/^name:/, ''))}`;
    const configuredDomains = (input.domains || []).map(registeredDomain).filter(Boolean);
    const channelDomain = ['x', 'wechat'].includes(input.type) ? '' : registeredDomain(domainFromUrl(input.url));
    const domain = registeredDomain(key.startsWith('name:') ? (configuredDomains[0] || channelDomain) : key);
    const canonicalName = publisherDisplayName(input.name || input.source || input.id, domain);
    const kindLabel = publisherKind(input.name || input.source || input.id, domain, input);
    const current = publishers.get(publisherId) || {
      id: publisherId,
      name: canonicalName,
      tier: input.tier || 2,
      kind: KIND_KEYS[kindLabel] || 'media',
      kindLabel,
      domains: [],
      channelIds: [],
    };
    current.tier = Math.min(current.tier, input.tier || 2);
    current.domains = [...new Set([...current.domains, ...configuredDomains, channelDomain, domain].filter(Boolean))];
    current.channelIds.push(input.id);
    publishers.set(publisherId, current);
    const channel = { ...input, type: input.type };
    channels.push({
      id: input.id,
      publisherId,
      name: canonicalName,
      displayName: formatSourceDisplayName(canonicalName, channel, kindLabel, input.handle || ''),
      type: input.type,
      label: channelLabel(input.type, kindLabel),
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
  WEIBO_ROUTES.forEach((source) => add({
    ...source,
    name: source.source,
    type: 'weibo',
    mode: source.mode || 'rsshub-keyword',
    publisherKind: source.kind,
  }));

  const discoveryRules = [
    ...TOPIC_QUERIES.map((rule) => ({ id: rule.id, name: rule.cat === 'ALL' ? '全行业主题发现' : `${rule.cat}主题发现`, type: 'news-search', category: rule.cat || 'ALL' })),
    ...CURATED_SEARCH_QUERIES.map((rule) => ({ id: rule.id, name: rule.label || rule.id, type: 'site-search', category: rule.cat || 'ALL' })),
    ...WECHAT_TOPIC_QUERIES.map((query, index) => ({ id: `wechat-topic-${index + 1}`, name: `${query}公众号发现`, type: 'wechat-search', category: 'ALL' })),
  ];

  return {
    schemaVersion: 2,
    publishers: [...publishers.values()].map((publisher) => ({ ...publisher, channelCount: publisher.channelIds.length })),
    channels,
    discoveryRules,
  };
}

module.exports = {
  buildSourceCatalog,
  channelLabel,
  cleanDomain,
  domainFromUrl,
  formatSourceDisplayName,
  publisherDisplayName,
  publisherKey,
  registeredDomain,
  resolveItemSource,
  slug,
};
