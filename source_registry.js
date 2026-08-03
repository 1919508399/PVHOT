'use strict';

/**
 * PV HOT 信源注册表
 *
 * 规则：
 * 1. 新闻生产代码只负责抓取、清洗与聚合，信源名单统一在这里维护。
 * 2. tier=1 为官方机构/头部垂直媒体，tier=2 为重点企业/专业媒体。
 * 3. 被 Cloudflare 保护的站点通过 Google News 定向检索降级监控，避免拖慢主链路。
 * 4. 微信账号按小时轮询，fetch_wechat.js 会保留 7 天历史，不会因轮换丢失文章。
 */

const REGISTRY_VERSION = '2026.08.03-r3';

const TOPIC_QUERIES = [
  { id: 'topic-all', cat: 'ALL', q: 'solar OR photovoltaic OR solar panel', locale: 'en' },
  { id: 'topic-policy', cat: '政策', q: 'solar policy OR photovoltaic policy OR solar subsidy OR solar tariff OR "Inflation Reduction Act" OR "anti-dumping" solar', locale: 'en' },
  { id: 'topic-price', cat: '价格', q: 'solar price OR polysilicon price OR wafer price OR cell price OR module price OR "solar price trend"', locale: 'en' },
  { id: 'topic-polysilicon', cat: '硅料', q: 'polysilicon OR "poly silicon" OR 多晶硅', locale: 'en' },
  { id: 'topic-wafer', cat: '硅片', q: 'solar wafer OR photovoltaic wafer OR ingot', locale: 'en' },
  { id: 'topic-cell', cat: '电池片', q: 'solar cell OR perovskite OR HJT OR TOPCon OR back contact solar', locale: 'en' },
  { id: 'topic-module', cat: '组件', q: 'solar module OR solar panel OR PV module', locale: 'en' },
  { id: 'topic-inverter', cat: '逆变器', q: 'solar inverter OR PV inverter', locale: 'en' },
  { id: 'topic-bos', cat: '支架BOS', q: 'solar tracker OR solar mounting OR photovoltaic BOS', locale: 'en' },
  { id: 'topic-storage', cat: '储能', q: 'solar battery storage OR BESS OR energy storage', locale: 'en' },
  { id: 'topic-project', cat: '电站', q: 'solar plant OR solar project OR solar farm OR photovoltaic EPC', locale: 'en' },
  { id: 'topic-market', cat: '行情', q: 'solar capacity OR solar market OR PV market OR solar manufacturing', locale: 'en' },
];

// 对知名媒体、机构和企业做定向监控；每组一个请求，避免逐站点请求造成更新变慢。
const CURATED_SEARCH_QUERIES = [
  {
    id: 'cn-official', cat: '政策', locale: 'zh',
    q: '(光伏 OR 太阳能) (site:nea.gov.cn OR site:ndrc.gov.cn OR site:miit.gov.cn OR site:chinapv.org.cn)',
    label: '国内官方机构', tier: 1,
  },
  {
    id: 'cn-media', cat: 'ALL', locale: 'zh',
    q: '光伏 (site:solarbe.com OR site:bjx.com.cn OR site:ne21.com OR site:ofweek.com OR site:in-en.com)',
    label: '国内头部光伏媒体', tier: 1,
  },
  {
    id: 'cn-companies', cat: '行情', locale: 'zh',
    q: '光伏 (隆基 OR 晶科 OR 天合 OR 晶澳 OR 通威 OR 协鑫 OR TCL中环 OR 阿特斯 OR 爱旭 OR 东方日升 OR 正泰新能 OR 一道新能)',
    label: '国内光伏制造企业', tier: 2,
  },
  {
    id: 'cn-inverters', cat: '逆变器', locale: 'zh',
    q: '光伏 (阳光电源 OR 华为智能光伏 OR 上能电气 OR 固德威 OR 锦浪 OR 德业 OR 禾迈 OR 昱能)',
    label: '国内逆变器与系统企业', tier: 2,
  },
  {
    id: 'global-media-core', cat: 'ALL', locale: 'en',
    q: 'solar (site:pv-magazine.com OR site:pv-tech.org OR site:solarpowerworldonline.com OR site:energy-storage.news)',
    label: '海外头部光伏媒体', tier: 1,
  },
  {
    id: 'global-media-extended', cat: 'ALL', locale: 'en',
    q: 'solar (site:ess-news.com OR site:taiyangnews.info OR site:solarquarter.com OR site:mercomindia.com OR site:saurenergy.com OR site:canarymedia.com)',
    label: '海外专业能源媒体', tier: 1,
  },
  {
    id: 'global-institutions', cat: '政策', locale: 'en',
    q: '"solar PV" (site:iea.org OR site:irena.org OR site:iea-pvps.org OR site:nrel.gov OR site:seia.org OR site:solarpowereurope.org)',
    label: '海外官方机构与协会', tier: 1,
  },
  {
    id: 'global-companies', cat: '行情', locale: 'en',
    q: 'solar (LONGi OR JinkoSolar OR Trina Solar OR JA Solar OR Canadian Solar OR First Solar OR Enphase OR SolarEdge OR SMA Solar OR Nextracker)',
    label: '全球重点光伏企业', tier: 2,
  },
];

const RSS_FEEDS = [
  { id: 'pv-magazine', url: 'https://www.pv-magazine.com/feed/', source: 'pv-magazine', cat: 'ALL', tier: 1 },
  { id: 'pv-tech', url: 'https://www.pv-tech.org/feed', source: 'pv-tech', cat: 'ALL', tier: 1 },
  { id: 'cleantechnica', url: 'https://cleantechnica.com/feed/', source: 'cleantechnica', cat: 'ALL', tier: 2 },
  { id: 'solarquarter', url: 'https://solarquarter.com/feed/', source: 'solarquarter', cat: 'ALL', tier: 1 },
];

const SCRAPE_SOURCES = [
  {
    id: 'solarbe', url: 'https://news.solarbe.com/', source: 'solarbe', cat: 'ALL', tier: 1,
    linkPattern: /news\.solarbe\.com\/\d{6}\/\d+\/\d+\.html/,
    dateFromUrl(url) {
      const m = url.match(/\/(\d{4})(\d{2})\/(\d{2})\//);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    },
    maxItems: 24,
  },
  {
    id: 'bjx-guangfu', url: 'https://guangfu.bjx.com.cn/', source: 'bjx-guangfu', cat: 'ALL', tier: 1,
    linkPattern: /guangfu\.bjx\.com\.cn\/news\/\d{8}\/\d+\.shtml/,
    dateFromUrl(url) {
      const m = url.match(/\/news\/(\d{4})(\d{2})(\d{2})\//);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    },
    maxItems: 24,
  },
  {
    id: 'ne21', url: 'https://www.ne21.com/', source: 'ne21', cat: 'ALL', tier: 1,
    linkPattern: /ne21\.com\/news\/show-\d+\.html/,
    dateFromUrl: null,
    maxItems: 20,
  },
  {
    id: 'nea-renewable', url: 'https://www.nea.gov.cn/sjzz/xny/', source: '国家能源局', cat: '政策', tier: 1,
    linkPattern: /nea\.gov\.cn\/20\d{6}\/[a-f0-9]+\/c\.html/i,
    dateFromUrl(url) {
      const m = url.match(/\/(20\d{2})(\d{2})(\d{2})\//);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    },
    maxItems: 20,
  },
  {
    id: 'cpia', url: 'https://www.chinapv.org.cn/index.html', source: '中国光伏行业协会', cat: '政策', tier: 1,
    linkPattern: /chinapv\.org\.cn\/(?:Association|Meeting)\/content_\d+\.html/i,
    dateFromUrl: null,
    dateFromContext(html, index) {
      const snippet = html.slice(Math.max(0, index - 260), index + 600);
      const full = snippet.match(/(?:uploads\/images\/)?(20\d{2})(\d{2})(\d{2})/i);
      if (full) return `${full[1]}-${full[2]}-${full[3]}`;
      const md = snippet.match(/<span[^>]*>\s*(\d{2})-(\d{2})\s*<\/span>/i);
      return md ? `${new Date().getFullYear()}-${md[1]}-${md[2]}` : null;
    },
    maxItems: 18,
  },
];

// 已核验的 X（Twitter）权威光伏媒体与机构账号。
// X 仅作为新闻发现信号：有官方凭证时读取账号时间线；无凭证时通过搜索引擎
// 定向发现账号所属官网的文章。两种模式都必须回到登记官网核验原文与发布日期。
const X_ACCOUNTS = [
  {
    id: 'x-pvmagazine', name: 'PV Magazine Global', handle: 'pvmagazine',
    domains: ['pv-magazine.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-pv-tech', name: 'PV Tech', handle: 'pv_tech',
    domains: ['pv-tech.org'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-solarpowerworld', name: 'Solar Power World', handle: 'SolarPowerWorld',
    domains: ['solarpowerworldonline.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-pvmagazineusa', name: 'pv magazine USA', handle: 'pvmagazineusa',
    domains: ['pv-magazine-usa.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-mercomindia', name: 'Mercom India', handle: 'MercomIndia',
    domains: ['mercomindia.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-saur-energy', name: 'Saur Energy', handle: 'Saur_energy',
    domains: ['saurenergy.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-canarymedia', name: 'Canary Media', handle: 'CanaryMediaInc',
    domains: ['canarymedia.com'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-renew-economy', name: 'RenewEconomy', handle: 'renew_economy',
    domains: ['reneweconomy.com.au'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-solarpowerport', name: 'Solar Power Portal', handle: 'SolarPowerPort',
    domains: ['solarpowerportal.co.uk'], tier: 1, kind: '媒体', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-seia', name: 'SEIA', handle: 'SEIA',
    domains: ['seia.org'], tier: 1, kind: '机构', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-irena', name: 'IRENA', handle: 'IRENA',
    domains: ['irena.org'], tier: 1, kind: '机构', cat: 'ALL', staleAfterHours: 168,
  },
  {
    id: 'x-ember-energy', name: 'Ember', handle: 'ember_energy',
    domains: ['ember-energy.org'], tier: 1, kind: '机构', cat: 'ALL', staleAfterHours: 168,
  },
];

// freewechat profile ID 已验证的账号可走 RSSHub；其余账号由搜狗微信按小时轮询。
const WECHAT_ACCOUNTS = [
  { name: '中国光伏行业协会CPIA', aliases: ['中国光伏行业协会', 'CPIA'], kind: '机构', tier: 1 },
  { name: '硅业分会', aliases: ['硅业分会'], kind: '机构', tier: 1 },
  { name: '光伏們', aliases: ['光伏們', '光伏们'], kind: '媒体', tier: 1, profileId: 'MzAxNjU2NjAyNA==' },
  { name: '光伏头条', aliases: ['光伏头条'], kind: '媒体', tier: 1, profileId: 'MzI2NzIwMDg4NQ==' },
  { name: '索比光伏网', aliases: ['索比光伏网'], kind: '媒体', tier: 1, profileId: 'MjM5MzgyMjY2MQ==' },
  { name: '北极星太阳能光伏网', aliases: ['北极星太阳能光伏', '北极星分布式光伏'], kind: '媒体', tier: 1, profileId: 'MzA5MDMwMDc1MQ==' },
  { name: '世纪新能源网', aliases: ['世纪新能源网'], kind: '媒体', tier: 1 },
  { name: '维科网光伏', aliases: ['维科网光伏'], kind: '媒体', tier: 1, profileId: 'MzA3MTQ2MzQxMg==' },
  { name: '国际能源网', aliases: ['国际能源网'], kind: '媒体', tier: 1, profileId: 'MjM5NTAyMTI1NQ==' },
  { name: 'PV-Tech', aliases: ['PV-Tech', 'PV Tech'], kind: '媒体', tier: 1, profileId: 'MjM5MzI1NzEyMA==' },
  { name: '光伏资讯', aliases: ['光伏资讯'], kind: '媒体', tier: 1, profileId: 'MzA3NjQxMjkxOA==' },
  { name: '光伏见闻', aliases: ['光伏见闻'], kind: '媒体', tier: 1, profileId: 'MzAwNTM2NzYxNA==' },
  { name: '风芒能源', aliases: ['风芒能源'], kind: '媒体', tier: 1, profileId: 'MzU1NDY3OTAyNw==' },
  { name: '能源一号', aliases: ['能源一号'], kind: '媒体', tier: 1 },
  { name: '黑鹰光伏', aliases: ['黑鹰光伏'], kind: '媒体', tier: 1 },
  { name: '赶碳号科技', aliases: ['赶碳号科技', '赶碳号'], kind: '媒体', tier: 1 },
  { name: '草根光伏', aliases: ['草根光伏'], kind: '媒体', tier: 2 },
  { name: '智汇光伏', aliases: ['智汇光伏'], kind: '媒体', tier: 2 },
  { name: '摩尔光伏', aliases: ['摩尔光伏'], kind: '媒体', tier: 2 },
  { name: '储能与电力市场', aliases: ['储能与电力市场'], kind: '储能', tier: 1, profileId: 'Mzg2Mjc2MzQ4Mg==' },
  { name: '中关村储能产业技术联盟', aliases: ['中关村储能产业技术联盟', 'CNESA'], kind: '机构', tier: 1, profileId: 'MjM5MzUwNzk2Mg==' },
  { name: '东吴光伏圈', aliases: ['东吴光伏圈'], kind: '研究', tier: 2, profileId: 'MzkzMjY4MjE5Mg==' },
  { name: 'ACMI硅基新材料', aliases: ['ACMI硅基新材料'], kind: '研究', tier: 2, profileId: 'MzkwNzM4NDI2Mg==' },
  { name: '隆基绿能', aliases: ['隆基绿能', 'LONGi Solar'], kind: '企业', tier: 1 },
  { name: '晶科能源', aliases: ['晶科能源', 'JinkoSolar'], kind: '企业', tier: 1 },
  { name: '天合光能', aliases: ['天合光能', '天合光能系统解决方案'], kind: '企业', tier: 1, profileId: 'Mzg2NTg0MzAxMg==' },
  { name: '晶澳科技', aliases: ['晶澳科技', 'JA Solar'], kind: '企业', tier: 1 },
  { name: '通威集团', aliases: ['通威集团', '通威股份'], kind: '企业', tier: 1 },
  { name: '协鑫集团', aliases: ['协鑫集团', '协鑫科技'], kind: '企业', tier: 1 },
  { name: 'TCL中环', aliases: ['TCL中环', '中环股份'], kind: '企业', tier: 1 },
  { name: '阿特斯阳光电力集团', aliases: ['阿特斯阳光电力集团', '阿特斯'], kind: '企业', tier: 1 },
  { name: '东方日升新能源', aliases: ['东方日升新能源', '东方日升'], kind: '企业', tier: 1 },
  { name: '爱旭股份', aliases: ['爱旭股份', '爱旭ABC'], kind: '企业', tier: 1 },
  { name: '正泰新能Astronergy', aliases: ['正泰新能', 'Astronergy'], kind: '企业', tier: 1 },
  { name: '一道新能', aliases: ['一道新能', 'DAS Solar'], kind: '企业', tier: 2 },
  { name: '阳光电源', aliases: ['阳光电源', 'Sungrow'], kind: '企业', tier: 1, profileId: 'MzUwOTAxNDM0Nw==' },
  { name: '华为智能光伏', aliases: ['华为智能光伏', '华为数字能源'], kind: '企业', tier: 1 },
  { name: '上能电气', aliases: ['上能电气', 'Sineng Electric'], kind: '企业', tier: 1 },
  { name: '固德威', aliases: ['固德威', 'GoodWe'], kind: '企业', tier: 1 },
  { name: '锦浪科技', aliases: ['锦浪科技', 'Solis'], kind: '企业', tier: 1 },
  { name: '德业新能源', aliases: ['德业新能源', '德业股份'], kind: '企业', tier: 2 },
  { name: '禾迈股份', aliases: ['禾迈股份', 'Hoymiles'], kind: '企业', tier: 2 },
  { name: '昱能科技', aliases: ['昱能科技', 'APsystems'], kind: '企业', tier: 2, profileId: 'MjM5MzY2NDE2NA==' },
];

const WECHAT_TOPIC_QUERIES = ['光伏', '太阳能', '多晶硅', '光伏组件', '逆变器', '储能'];

const RSSHUB_ROUTES = WECHAT_ACCOUNTS
  .filter((account) => account.profileId)
  .map((account) => ({
    id: `wechat-${account.profileId}`,
    route: `/freewechat/profile/${account.profileId}`,
    source: 'wechat',
    name: account.name,
    cat: 'ALL',
    tier: account.tier,
  }));

const TRUSTED_SOURCE_TOKENS = [
  'pv-magazine', 'pv magazine', 'pv-tech', 'pv tech', 'solarbe', '索比',
  'bjx', '北极星', 'ne21', '世纪新能源', '维科网光伏', '国际能源网',
  '国家能源局', '中国光伏行业协会', 'cpia', 'reuters', 'cleantechnica',
  'solar power world', 'taiyangnews', 'solarquarter', 'mercom',
  'saur energy', 'canary media', 'reneweconomy', 'solar power portal', 'ember',
  'energy-storage.news', 'ess news', 'iea', 'irena', 'iea pvps', 'nrel',
  'seia', 'solarpower europe', '公众号',
];

module.exports = {
  REGISTRY_VERSION,
  TOPIC_QUERIES,
  CURATED_SEARCH_QUERIES,
  RSS_FEEDS,
  SCRAPE_SOURCES,
  X_ACCOUNTS,
  RSSHUB_ROUTES,
  WECHAT_ACCOUNTS,
  WECHAT_TOPIC_QUERIES,
  TRUSTED_SOURCE_TOKENS,
};
