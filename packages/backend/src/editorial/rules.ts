// The free mode: the same judgement as the model pipeline, made by keyword rules instead of calls.
// The admin switches to it in 设置 → 分析方式 when the model account runs out or costs too much; every
// step stays rule-based and nothing is billed. The output has the shape of AnalysisRun so the rest of
// the pipeline (publication, grouping, 精选, 日报) works unchanged — only the copy is plainer: the
// title stays as the source wrote it and the summary is the opening of the body, not a rewrite.
import type { AnalysisRun } from "./analyze.ts";
import { SELECTION } from "@aihot/industry/selection";
import { collapseWhitespace } from "../lib/text.ts";
import { ENTITIES, ENTITY_TAGS, TAG_SYNONYMS, TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { normalizeTags } from "./vocabulary.ts";

/**
 * The bars for rule scores. They are not the model's (industry/selection.ts): a keyword score is a
 * coarser instrument, and measured over a backfill its spread is narrower, so the model's numbers
 * would put nearly everything on one side. These are the same tiers, shifted to keep roughly the
 * share of items the model mode puts in 精选.
 */
const RULE_THRESHOLDS: Readonly<Record<string, number>> = { T1: 58, T1_5: 62, T2: 70 };

/** Tiers the model does not score (EXCLUDE_MP) are not scored here either. */
const tierThreshold = (tier: string): number | null =>
  SELECTION.thresholds[tier] === undefined ? null : (RULE_THRESHOLDS[tier] ?? SELECTION.thresholds[tier]!);

/** Stamped on every judgement this mode writes, so the admin can tell them apart from model output. */
export const RULES_MODEL = "rules";

/** The part of AnalyzeInputArticle the rules read. */
interface RuleInput {
  title: string;
  bodyText: string | null;
  excerpt: string | null;
  xPost: Record<string, any> | null;
  publishedAt: Date | null;
  source: { tier: string };
}

type TextInput = Pick<RuleInput, "title" | "bodyText" | "excerpt" | "xPost">;

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));
const hasEn = (text: string, words: readonly string[]) => words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

/** Anything here means the material belongs to this industry; a miss on all of them is a BLOCK. */
const INDUSTRY_ZH = [
  "光伏", "太阳能", "组件", "电池片", "硅片", "硅料", "多晶硅", "单晶硅", "颗粒硅", "工业硅",
  "逆变器", "支架", "胶膜", "光伏玻璃", "银浆", "焊带", "接线盒", "边框", "石英坩埚",
  "储能", "电芯", "大储", "工商储", "户储", "电站", "装机", "并网", "epc", "绿证", "消纳",
  "钙钛矿", "叠层", "topcon", "hjt", "xbc", "perc", "0bb", "薄片化",
  "新能源", "绿电", "双碳", "可再生能源",
];
const INDUSTRY_EN = [
  "solar", "photovoltaic", "pv", "polysilicon", "wafer", "ingot", "cell", "module", "inverter",
  "tracker", "bess", "battery", "storage", "perovskite", "topcon", "hjt", "renewable", "gigawatt",
  "megawatt", "clean energy", "green hydrogen", "electrolyzer", "offshore wind", "grid",
];

/**
 * Wider recall on purpose: a false BLOCK loses real news, a false PASS only costs a row in 全部动态.
 * A title matching nothing is blocked; anything with body text that mentions the industry passes.
 */
function prefilter(a: TextInput): { label: "PASS" | "BLOCK"; reason: string } {
  const title = buildText(a).title.toLowerCase();
  if (has(title, INDUSTRY_ZH) || hasEn(title, INDUSTRY_EN)) return { label: "PASS", reason: "标题命中行业词" };
  const body = buildText(a).body.toLowerCase().slice(0, 1500);
  if (has(body, INDUSTRY_ZH) || hasEn(body, INDUSTRY_EN)) return { label: "PASS", reason: "正文命中行业词" };
  return { label: "BLOCK", reason: "标题与正文都没有行业词" };
}

/** Category keywords, most specific first. The first category reaching `min` hits wins. */
const CATEGORY_WORDS: ReadonlyArray<{ key: string; words: readonly string[] }> = [
  {
    key: "policy",
    words: ["政策", "通知", "办法", "规定", "意见", "方案", "补贴", "电价", "关税", "双反", "反倾销", "反补贴",
      "标准", "规范条件", "绿证", "配额", "消纳", "监管", "部委", "发改委", "能源局", "工信部", "商务部",
      "policy", "tariff", "subsidy", "regulation", "duty", "ita", "customs", "ministry"],
  },
  {
    key: "business",
    words: ["财报", "业绩", "营收", "净利", "亏损", "毛利", "预告", "融资", "ipo", "上市", "并购", "收购", "重组",
      "股权", "减持", "增持", "人事", "离职", "辞职", "任命", "诉讼", "专利纠纷", "破产", "重整", "分拆",
      "earnings", "revenue", "profit", "loss", "acquisition", "merger", "ipo", "bankruptcy", "appoints", "ceo"],
  },
  {
    key: "project",
    words: ["电站", "项目", "招标", "中标", "开标", "epc", "并网", "装机", "分布式", "户用", "集中式", "地面电站",
      "海上光伏", "光伏治沙", "农光互补", "开发权", "备案", "组件采购", "逆变器采购",
      "tender", "auction", "awarded", "epc", "grid connection", "plant", "commissioned", "ppa"],
  },
  {
    key: "storage",
    words: ["储能", "电芯", "电池组", "pcs", "bms", "ems", "大储", "工商储", "户储", "液流", "钠电", "构网型",
      "bess", "battery storage", "energy storage", "cell-to-pack", "lithium"],
  },
  {
    key: "polysilicon",
    words: ["多晶硅", "硅料", "工业硅", "颗粒硅", "致密料", "菜花料", "硅粉", "多晶硅价格",
      "polysilicon", "silicon metal", "ingot", "poly-si"],
  },
  {
    key: "wafer",
    words: ["硅片", "切片", "薄片化", "大尺寸硅片", "单晶硅片", "金刚线", "方棒", "拉晶",
      "wafer", "silicon wafer", "diamond wire"],
  },
  {
    key: "cell",
    words: ["电池片", "电池效率", "转换效率", "topcon", "hjt", "xbc", "perc", "钙钛矿", "叠层", "异质结",
      "背接触", "钝化接触", "0bb", "银耗", "实验室效率",
      "cell efficiency", "perovskite", "tandem", "heterojunction", "passivating contact"],
  },
  {
    key: "module",
    words: ["组件", "双面组件", "组件功率", "版型", "叠瓦", "无主栅", "组件价格", "组件出货", "质保", "认证",
      "module", "panel", "bifacial", "watt peak"],
  },
  {
    key: "bos",
    words: ["逆变器", "跟踪支架", "固定支架", "光伏玻璃", "胶膜", "eva", "poe", "银浆", "焊带", "接线盒",
      "边框", "石英坩埚", "层压机", "串焊机", "丝网印刷", "扩散炉", "pecvd", "激光设备", "微逆", "组串式",
      "inverter", "tracker", "solar glass", "encapsulant", "silver paste", "ribbon", "junction box"],
  },
];

/** Fallbacks for material that matched nothing specific. */
const CATEGORY_DEFAULT: ReadonlyArray<{ key: string; words: readonly string[] }> = [
  { key: "industry", words: ["行业", "市场", "统计", "出口", "进口", "展会", "论坛", "排产", "供需", "装机量",
    "market", "industry", "shipment", "outlook", "report"] },
  { key: "opinion", words: ["观点", "分析", "评论", "展望", "预测", "研报", "复盘", "访谈", "深度",
    "opinion", "analysis", "comment", "forecast", "interview"] },
];

/** Every category needs a first tag (normalizeTags keeps a category tag first). */
const CATEGORY_TAG: Record<string, string> = {
  polysilicon: "价格/行情", wafer: "价格/行情", cell: "技术突破", module: "新品发布", bos: "供应链/物流",
  storage: "项目/订单", project: "项目/订单", policy: "政策/监管", business: "财报/业绩",
  industry: "行业/市场", opinion: "观点/分析",
};

/** The synonym table read backwards: a word in the material becomes the pack's canonical tag. */
const TAG_WORDS: ReadonlyArray<{ tag: string; words: readonly string[] }> = (() => {
  const byTag = new Map<string, string[]>();
  for (const [word, tag] of Object.entries(TAG_SYNONYMS)) {
    const list = byTag.get(tag) ?? [];
    list.push(word);
    byTag.set(tag, list);
  }
  return [...byTag].map(([tag, words]) => ({ tag, words }));
})();

const HEADLINE_WORDS = [
  "涨价", "降价", "上涨", "下跌", "跌至", "涨至", "报价", "成交价", "减产", "停产", "复产", "检修", "扩产",
  "开工率", "库存", "政策", "通知", "补贴", "关税", "双反", "反倾销", "中标", "招标", "并网", "装机",
  "签约", "投产", "开工", "纪录", "突破", "效率", "出货", "财报", "亏损", "盈利", "收购", "破产", "欠款",
  "price", "prices", "rise", "fall", "drop", "surge", "cuts", "capacity", "policy", "tariff", "awarded",
  "record", "efficiency", "shipment", "earnings", "acquisition", "bankruptcy", "gw", "mw", "gwh",
];

const unitRe = /\d+(?:\.\d+)?\s*(?:gw|mw|gwh|mwh|元|美元|万元|亿元|%|吨|片|瓦|w\/p)/gi;

/**
 * Feeds (Bing especially) hand back their own page furniture as the description — "新闻 搜索", a
 * "来源：… 发布时间：…" line. It is not the article, so it is cut before the copy is written.
 */
function cleanBody(raw: string): string {
  return raw
    .replace(/^\s*(?:新闻|搜索|网页|资讯)\s*(?:搜索)?\s*/g, "")
    .replace(/来源[:：]\s*[^\s，,。|]{1,24}/g, "")
    .replace(/发布时间[:：]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g, "")
    .replace(/\s*\|\s*(?:新浪|腾讯|网易|搜狐|凤凰|东方财富)[^\s]{0,10}\s*/g, " ")
    .trim();
}

function buildText(a: TextInput) {
  const raw = a.xPost ? String(a.xPost.text ?? "") : (a.bodyText ?? a.excerpt ?? "");
  return { title: collapseWhitespace(a.title ?? ""), body: collapseWhitespace(cleanBody(raw)) };
}

type CategoryKey = NonNullable<AnalysisRun["structure"]>["category"];

function pickCategory(text: string): { key: CategoryKey; hits: number } {
  let best: { key: CategoryKey; hits: number } = { key: "industry", hits: 0 };
  for (const row of CATEGORY_WORDS) {
    const hits = row.words.filter((w) => text.includes(w)).length;
    if (hits > best.hits) best = { key: row.key as CategoryKey, hits };
  }
  if (best.hits > 0) return best;
  for (const row of CATEGORY_DEFAULT) {
    const hits = row.words.filter((w) => text.includes(w)).length;
    if (hits > best.hits) best = { key: row.key as CategoryKey, hits };
  }
  return best;
}

function pickSubjects(text: string): string[] {
  const found: string[] = [];
  for (const [id, e] of Object.entries(ENTITIES)) {
    const names = [e.name, ...e.aliases, ...(e.orgNames ?? []), ...(e.otherNames ?? [])].filter(Boolean);
    if (names.some((n) => text.includes(n))) found.push(id);
  }
  return found.slice(0, 6);
}

function pickTags(text: string, category: CategoryKey, subjects: string[]): string[] {
  const tags: string[] = [CATEGORY_TAG[category ?? "industry"] ?? "行业/市场"];
  for (const row of TAG_WORDS) {
    if (row.words.some((w) => text.includes(w)) && !tags.includes(row.tag)) tags.push(row.tag);
  }
  for (const t of TOPIC_TAGS) if (text.includes(t) && !tags.includes(t)) tags.push(t);
  for (const id of subjects) {
    const display = ENTITIES[id]?.displayTag;
    if (display && !tags.includes(display)) tags.push(display);
  }
  // Entity tags the subject list missed but the text names.
  for (const t of ENTITY_TAGS) if (text.includes(t) && !tags.includes(t)) tags.push(t);
  return normalizeTags(tags);
}

/**
 * A rule score on the same 0–100 scale the model uses, so the tier thresholds keep working: the source
 * tier sets the floor, and price moves, policy, tenders, records and numbers push it up.
 */
function scoreOf(a: RuleInput, text: { title: string; body: string }, category: CategoryKey, tier: string): number {
  // Tuned on a 120-article backfill: the point is spread, not level. A plain item lands in the
  // forties; a price move, a policy or a tender with numbers and a named company reaches the high
  // eighties. Anything that spreads less makes the threshold meaningless.
  const base = tier === "T1" ? 44 : tier === "T1_5" ? 40 : 34;
  let score = base;
  const title = text.title.toLowerCase();
  const headline = HEADLINE_WORDS.filter((w) => title.includes(w)).length;
  score += Math.min(headline * 6, 24);
  const bodyLen = text.body.length;
  if (bodyLen > 2000) score += 6;
  else if (bodyLen > 600) score += 4;
  if (category === "policy" || category === "business") score += 8;
  if (category === "project" || category === "polysilicon") score += 4;
  const units = new Set(text.title.match(unitRe) ?? []).size + Math.min((text.body.match(unitRe) ?? []).length, 6);
  score += Math.min(units * 2, 8);
  if (pickSubjects(text.title).length > 0) score += 5;
  const published = a.publishedAt ? new Date(a.publishedAt).getTime() : null;
  if (published && !Number.isNaN(published)) {
    const hours = (Date.now() - published) / 3_600_000;
    if (hours <= 24) score += 8;
    else if (hours <= 72) score += 4;
    else if (hours > 24 * 30) score -= 25;
    else if (hours > 24 * 7) score -= 12;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Keeps the source's own title; a very long one is cut at a readable length. */
function titleOf(title: string): string {
  const t = collapseWhitespace(title);
  if (t.length <= 100) return t;
  const cut = t.slice(0, 100);
  const stop = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("。"), cut.lastIndexOf(" "));
  return stop > 60 ? cut.slice(0, stop) : cut;
}

/** The opening of the body as the summary — no rewriting, so the original voice stays intact. */
function summaryOf(text: { title: string; body: string }): string {
  const body = text.body || text.title;
  const sentences = body.split(/(?<=[。！？!?])\s*/).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    if (out && out.length + s.length > 160) break;
    out += s;
    if (out.length >= 80) break;
  }
  if (!out) out = body;
  return out.length > 200 ? `${out.slice(0, 200)}…` : out;
}

/**
 * The rule pipeline: prefilter, structure, scores and copy, in one pass, with no network call.
 * `receiptId` is 0 here — the caller drops zero ids, so nothing is billed or completed.
 */
export function ruleAnalysis(a: RuleInput): AnalysisRun {
  const text = buildText(a);
  const gate = prefilter(a);
  const prefilterStep = { label: gate.label, reason: gate.reason, model: RULES_MODEL, receiptId: 0, reused: true };
  if (gate.label === "BLOCK") return { prefilter: prefilterStep, scores: null, writing: null, structure: null };

  // The headline decides the category; the body only breaks a tie when the title says nothing.
  const titleKey = pickCategory(text.title.toLowerCase());
  const category = titleKey.hits > 0 ? titleKey.key : pickCategory(text.body.toLowerCase().slice(0, 600)).key;
  const whole = `${text.title} ${text.body}`.toLowerCase();
  const subjects = pickSubjects(`${text.title} ${text.body}`);
  const tags = pickTags(whole, category, subjects);
  const structure = { category, tags, subjects, scope: "single" as const, fact: null, model: RULES_MODEL, receiptId: 0, reused: true };

  const threshold = tierThreshold(a.source.tier);
  const score = scoreOf(a, text, category, a.source.tier);
  const scores = threshold === null ? null : { model: RULES_MODEL, threshold, values: [score, score], receiptIds: [], reused: true };

  const summaryZh = summaryOf(text);
  const reason = [
    `${a.source.tier} 信源`,
    `归入「${CATEGORY_TAG[category ?? "industry"] ?? category}」`,
    threshold === null ? "不参与精选评分" : `规则评分 ${score}（门槛 ${threshold}）`,
  ].join(" · ");
  const writing = {
    kind: "summarize" as const,
    model: RULES_MODEL,
    titleZh: titleOf(text.title),
    summaryZh,
    reasonZh: reason,
    receiptIds: [],
    reused: true,
  };
  return { prefilter: prefilterStep, scores, writing, structure };
}
