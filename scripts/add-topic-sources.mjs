// 一次性脚本：为 industry/topics.json 里的每个主题生成一条必应新闻关键词信源，
// 追加到 industry/sources.json。已有关键词覆盖的主题跳过。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const topicsPath = join(ROOT, "industry/topics.json");
const sourcesPath = join(ROOT, "industry/sources.json");

const topics = JSON.parse(readFileSync(topicsPath, "utf8"));
const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));

// 主题 slug → 必应新闻查询词。null = 已有信源覆盖，跳过。
const QUERIES = {
  // ── 公司与机构 ──
  longi: "隆基绿能",
  jinko: "晶科能源",
  trina: "天合光能",
  "ja-solar": "晶澳科技",
  tongwei: "通威股份",
  gcl: "协鑫科技",
  gclsi: "协鑫集成",
  "tcl-zhonghuan": "TCL中环",
  aiko: "爱旭股份",
  "canadian-solar": "阿特斯 光伏",
  risen: "东方日升",
  astronergy: "正泰新能",
  "das-solar": "一道新能",
  huasun: "华晟新能源",
  sungrow: "阳光电源",
  "huawei-fusionsolar": "华为 数字能源",
  solis: "锦浪科技",
  goodwe: "固德威",
  sineng: "上能电气",
  "first-applied": "福斯特 胶膜",
  "flat-glass": "福莱特 光伏玻璃",
  maxwell: "迈为股份",
  autowell: "奥特维",
  arctech: "中信博",
  "catl-storage": "宁德时代 储能",
  hithium: "海辰储能",
  "first-solar": "First Solar",
  qcells: "Qcells",
  // ── 产业链与方向 ──
  topcon: "TOPCon",
  hjt: "异质结",
  xbc: "BC电池",
  perovskite: "钙钛矿",
  "polysilicon-price": null, // 已有「必应新闻 多晶硅」
  storage: null, // 已有「必应新闻 储能」
  distributed: "分布式光伏",
  "bos-materials": "光伏设备",
  "trade-barrier": "光伏 关税",
  "going-global": "光伏 出海",
  "grid-consumption": "光伏 消纳",
  // ── 内容类型 ──
  prices: "硅片价格",
  capacity: "光伏 产能",
  policy: null, // 已有「必应新闻 光伏政策」
  orders: null, // 已有「必应新闻 光伏招标」
  earnings: "光伏 财报",
  "tech-breakthrough": "光伏 技术突破",
  capital: "光伏 并购",
  safety: "储能 事故",
};

// 重点跟踪的公司采得勤一些（分钟）。
const FAST = new Set(["maxwell", "longi", "jinko", "trina", "sungrow", "catl-storage"]);

const existing = new Set(sources.sources.map((s) => s.id));
let added = 0;
for (const t of topics.topics) {
  const q = QUERIES[t.slug];
  if (!q) continue;
  const id = `rss-bing-tp-${t.slug}`;
  if (existing.has(id)) continue;
  const english = !/[\u4e00-\u9fff]/.test(q);
  sources.sources.push({
    id,
    name: `必应新闻 ${t.name}`,
    kind: "rss",
    config: {
      feedUrl: `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`,
      _aihot: { initialBackfillLimit: 5 },
      urlParam: "url",
    },
    tier: "T2",
    participation_mode: "editorial",
    interval_minutes: FAST.has(t.slug) ? 60 : english ? 180 : 120,
    tags: english ? ["海外", "主题", "聚合"] : ["中文", "主题", "聚合"],
    site_fulltext: false,
    syndicate_fulltext: false,
    enabled: true,
  });
  added++;
}

writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
console.log(`added ${added} topic sources, total ${sources.sources.length}`);
