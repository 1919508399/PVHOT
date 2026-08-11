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

const REGISTRY_VERSION = '2026.08.11-r1';

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
    id: 'global-research-markets', cat: 'ALL', locale: 'en',
    q: '(solar OR photovoltaic OR BESS) (site:woodmac.com OR site:spglobal.com OR site:pv-magazine.com OR site:pv-tech.org OR site:energy-storage.news)',
    label: '海外市场与储能研究', tier: 1,
  },
  {
    id: 'cn-research-price', cat: '价格', locale: 'zh',
    q: '(光伏 OR 储能 OR 硅料 OR 硅片) (site:pvinfolink.com OR site:solarzoom.com OR site:cnesa.org.cn OR site:trendforce.cn)',
    label: '中国价格与储能分析', tier: 1,
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
  { id: 'pv-magazine-usa', url: 'https://pv-magazine-usa.com/feed/', source: 'pv-magazine-usa', cat: 'ALL', tier: 1 },
  { id: 'pv-tech', url: 'https://www.pv-tech.org/feed', source: 'pv-tech', cat: 'ALL', tier: 1 },
  { id: 'solar-power-world', url: 'https://www.solarpowerworldonline.com/feed/', source: 'solar-power-world', cat: 'ALL', tier: 1 },
  { id: 'energy-storage-news', url: 'https://www.energy-storage.news/feed/', source: 'energy-storage.news', cat: '储能', tier: 1 },
  { id: 'cleantechnica', url: 'https://cleantechnica.com/feed/', source: 'cleantechnica', cat: 'ALL', tier: 2 },
  { id: 'solarquarter', url: 'https://solarquarter.com/feed/', source: 'solarquarter', cat: 'ALL', tier: 1 },
  { id: 'mercom-india', url: 'https://www.mercomindia.com/feed', source: 'mercom-india', cat: 'ALL', tier: 1 },
  { id: 'saur-energy', url: 'https://www.saurenergy.com/rss', source: 'saur-energy', cat: 'ALL', tier: 2 },
  { id: 'utility-dive-energy', url: 'https://www.utilitydive.com/feeds/news/', source: 'utility-dive-energy', cat: 'ALL', tier: 2 },
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
    fallbackQuery: 'site:bjx.com.cn',
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
    linkPattern: /chinapv\.org\.cn\/(?:StaticPage\/)?(?:Association|Meeting)\/content_\d+\.html/i,
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
  {
    id: 'huasun-official', url: 'https://www.huasunsolar.com/news.html', source: 'Huasun Solar 官方', cat: '组件', tier: 1,
    linkPattern: /huasunsolar\.com\/news\/[^"'<>\s]+\.html/i,
    dateFromUrl: null,
    dateFromContext(html, index) {
      const snippet = html.slice(Math.max(0, index - 500), index + 700);
      const match = snippet.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
      return match
        ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
        : null;
    },
    maxItems: 18,
  },
  {
    id: 'longi-official', url: 'https://www.longi.com/cn/news/', source: '隆基绿能', cat: 'ALL', tier: 1,
    linkPattern: /longi\.com\/cn\/news\/[^/?#]+\/?$/i,
    fallbackQuery: 'site:longi.com/cn/news (光伏 OR 储能 OR 硅片 OR 组件)',
    dateFromUrl: null,
    maxItems: 24,
  },
  {
    id: 'jinkosolar-official', url: 'https://www.jinkosolar.com/site/newscenter', source: '晶科能源', cat: 'ALL', tier: 1,
    linkPattern: /jinkosolar\.com\/site\/newsdetail\/\d+\/?$/i,
    fallbackQuery: 'site:jinkosolar.com/site/newsdetail (光伏 OR 储能 OR 组件)',
    dateFromUrl: null,
    titleFromAnchor(anchor) {
      const match = anchor.match(/<div[^>]+class=["'][^"']*news-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      return match ? match[1] : '';
    },
    maxItems: 24,
  },
  {
    id: 'tongwei-official', url: 'https://www.tongwei.com/news.html', source: '通威集团', cat: 'ALL', tier: 1,
    linkPattern: /tongwei\.com\/news\/detail\/\d+\.html$/i,
    fallbackQuery: 'site:tongwei.com/news/detail (光伏 OR 多晶硅 OR 电池 OR 组件)',
    dateFromUrl: null,
    titleFromAnchor(anchor) {
      const match = anchor.match(/<div[^>]+class=["'][^"']*\b(?:text|title)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      return match ? match[1] : '';
    },
    maxItems: 24,
  },
  {
    id: 'gcltech-official', url: 'https://www.gcltech.com/news', source: '协鑫科技', cat: '硅料', tier: 1,
    linkPattern: /gcltech\.com\/newsinfo\/\d+\.html$/i,
    fallbackQuery: 'site:gcltech.com/newsinfo (光伏 OR 颗粒硅 OR 多晶硅 OR 储能)',
    dateFromUrl: null,
    maxItems: 24,
  },
  {
    id: 'das-solar-official', url: 'https://www.das-solar.com/site/news', source: '一道新能', cat: 'ALL', tier: 1,
    linkPattern: /das-solar\.com\/site\/news_details\/\d+\/?$/i,
    fallbackQuery: 'site:das-solar.com/site/news_details (光伏 OR 组件 OR 电池 OR 支架)',
    dateFromUrl: null,
    dateFromContext(html, index) {
      const snippet = html.slice(Math.max(0, index - 1400), index + 200);
      const matches = [...snippet.matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)];
      const match = matches.length ? matches[matches.length - 1] : null;
      return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    },
    titleFromContext(html, index) {
      const snippet = html.slice(Math.max(0, index - 1400), index + 200);
      const matches = [...snippet.matchAll(/<div[^>]+class=["'][^"']*news-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
      return matches.length ? matches[matches.length - 1][1] : '';
    },
    maxItems: 24,
  },
  {
    id: 'sungrow-official', url: 'https://dl.sungrowpower.com/news.html?class_id=1', source: '阳光电源', cat: '逆变器', tier: 1,
    linkPattern: /(?:dl|cn|server-china)\.sungrowpower\.com\/news\/\d+\.html$/i,
    fallbackQuery: 'site:sungrowpower.com/news (光伏 OR 逆变器 OR 储能)',
    dateFromUrl: null,
    titleFromAnchor(anchor) {
      const match = anchor.match(/<div[^>]+class=["'][^"']*\bh\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      return match ? match[1] : '';
    },
    maxItems: 24,
  },
  {
    id: 'huawei-solar-official', url: 'https://solar.huawei.com/cn/news/', source: '华为智能光伏', cat: '逆变器', tier: 1,
    linkPattern: /solar\.huawei\.com\/cn\/news\/20\d{2}\/[^/?#]+\/?$/i,
    fallbackQuery: 'site:solar.huawei.com/cn/news (光伏 OR 逆变器 OR 储能)',
    dateFromUrl: null,
    maxItems: 24,
  },
  {
    id: 'goodwe-official', url: 'https://www.goodwe.com/news-exhibition/news', source: '固德威', cat: '逆变器', tier: 1,
    linkPattern: /goodwe\.com\/news-exhibition\/news\/\d+\.html$/i,
    fallbackQuery: 'site:goodwe.com/news-exhibition/news (光伏 OR 逆变器 OR 储能)',
    dateFromUrl: null,
    maxItems: 24,
  },
  {
    id: 'trinasolar-official', url: 'https://www.trinasolar.com/cn/press-releases', source: '天合光能', cat: 'ALL', tier: 1,
    linkPattern: /trinasolar\.com\/cn\/newsroom20\d{6}(?:\d{4})?\/?$/i,
    fallbackQuery: 'site:trinasolar.com/cn/newsroom (光伏 OR 储能 OR 组件 OR 支架)',
    dateFromUrl(url) {
      const match = url.match(/\/newsroom(20\d{2})(\d{2})(\d{2})(?:\d{4})?\/?$/i);
      return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
    },
    maxItems: 24,
  },
  {
    id: 'jasolar-official', url: 'https://www.jasolar.com/', source: '晶澳科技', cat: 'ALL', tier: 1,
    linkPattern: /jasolar\.com\/(?:index\.php\?(?=[^#]*\bcatid=5\b)(?=[^#]*\ba=show\b)[^#]+|[^?#]*\/news[^?#]*\/[^/?#]+)\/?$/i,
    fallbackQuery: 'site:jasolar.com (光伏 OR 储能 OR 组件) (新闻 OR news)',
    dateFromUrl: null,
    maxItems: 24,
  },
  {
    id: 'canadian-solar-official', url: 'https://cn.csisolar.com/news-releases/', source: '阿特斯', cat: 'ALL', tier: 1,
    linkPattern: /cn\.csisolar\.com\/press\/[^/?#]+\/?$/i,
    fallbackQuery: 'site:cn.csisolar.com/press (光伏 OR 储能 OR 组件)',
    dateFromUrl: null,
    maxItems: 24,
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

// 微博反爬严格，统一通过自建 RSSHub 的关键词路由做发现。企业关键词只表示
// “讨论该企业的微博”，不能据此认定为企业官方发布；展示层会明确标注为微博来源。
const WEIBO_QUERIES = [
  { id: 'weibo-topic-pv', query: '光伏', name: '光伏行业', cat: 'ALL' },
  { id: 'weibo-topic-polysilicon', query: '多晶硅', name: '多晶硅', cat: '硅料' },
  { id: 'weibo-topic-module', query: '光伏组件', name: '光伏组件', cat: '组件' },
  { id: 'weibo-topic-inverter', query: '光伏逆变器', name: '光伏逆变器', cat: '逆变器' },
  { id: 'weibo-topic-storage', query: '光伏储能', name: '光伏储能', cat: '储能' },
  { id: 'weibo-topic-project', query: '光伏电站', name: '光伏电站', cat: '电站' },
  { id: 'weibo-company-longi', query: '隆基绿能 光伏', name: '隆基绿能关键词', cat: 'ALL' },
  { id: 'weibo-company-jinko', query: '晶科能源 光伏', name: '晶科能源关键词', cat: 'ALL' },
  { id: 'weibo-company-trina', query: '天合光能 光伏', name: '天合光能关键词', cat: 'ALL' },
  { id: 'weibo-company-sungrow', query: '阳光电源 光伏', name: '阳光电源关键词', cat: '逆变器' },
];

const WEIBO_ROUTES = WEIBO_QUERIES.map((source) => ({
  ...source,
  route: `/weibo/keyword/${encodeURIComponent(source.query)}`,
  source: `微博：${source.name}`,
  kind: '社交',
  tier: 2,
  mode: 'rsshub-keyword',
}));

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
  'energy-storage.news', 'ess news', 'huasun', 'iea', 'irena', 'iea pvps', 'nrel',
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
  WEIBO_QUERIES,
  WEIBO_ROUTES,
  TRUSTED_SOURCE_TOKENS,
};
