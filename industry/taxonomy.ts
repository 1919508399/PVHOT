// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * tagColor 是飞书推送卡片里跟在标题后面的这一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  {
    key: "polysilicon",
    tagColor: "orange",
    label: "硅料",
    feedLabel: "硅料与工业硅",
    section: "价格与供给",
    guide:
      "多晶硅、颗粒硅、工业硅的价格与成交、产量与开工率、检修停产复产、库存、扩产与能耗指标、长单签订。硅料企业的财报和资本动作归“企业与资本”，硅料价格对下游的影响归这里。",
  },
  {
    key: "wafer",
    tagColor: "amber",
    label: "硅片",
    feedLabel: "硅片",
    section: "价格与供给",
    guide: "硅片报价与成交、尺寸与厚度（薄片化）、开工率、库存、切片产能与代工、硅片企业的减产涨价。硅片设备（切片机、金刚线）归“辅材设备”。",
  },
  {
    key: "cell",
    tagColor: "violet",
    label: "电池片",
    feedLabel: "电池片与技术",
    section: "技术与产品",
    guide:
      "电池片环节的报价、开工率、产能，以及 TOPCon、HJT、xBC、钙钛矿与叠层的效率、量产进度、良率、银耗与设备选型。实验室纪录与论文也放这里；组件封装后的产品发布归“组件”。",
  },
  {
    key: "module",
    tagColor: "turquoise",
    label: "组件",
    feedLabel: "组件与产品",
    section: "技术与产品",
    guide: "组件的报价、出货、功率与版型、认证与质保、品牌与渠道、库存与海外仓、组件新品发布与技改。组件企业的财报与并购归“企业与资本”。",
  },
  {
    key: "bos",
    tagColor: "green",
    label: "辅材设备",
    feedLabel: "辅材与设备",
    section: "技术与产品",
    guide:
      "逆变器、跟踪支架、光伏玻璃、胶膜（EVA/POE）、焊带、银浆、接线盒、边框、石英坩埚等辅材，以及硅片电池组件产线上的设备（扩散炉、PECVD、丝网印刷、串焊机、激光设备、层压机）。逆变器与储能系统的联合方案归“储能”，只讲逆变器本身归这里。",
  },
  {
    key: "storage",
    tagColor: "indigo",
    label: "储能",
    feedLabel: "储能",
    section: "储能与电站",
    guide: "电化学储能系统、电芯与 PCS、大储与工商储与户储的招标中标、装机、价格、安全与标准、容量电价与调用收益。纯电池材料研究不在此列。",
  },
  {
    key: "project",
    tagColor: "blue",
    label: "电站",
    feedLabel: "电站与EPC",
    section: "储能与电站",
    guide: "地面电站、分布式与户用、海上光伏的开发、招标、中标、EPC、并网、装机数据、电站交易与运维、电价与收益测算、限电与消纳。",
  },
  {
    key: "policy",
    tagColor: "purple",
    label: "政策",
    feedLabel: "政策与市场",
    section: "政策与市场",
    guide:
      "国内外政策与监管：电价与消纳机制、补贴与绿证、产能与能耗调控、行业标准与规范条件、关税与双反调查、本土化要求。协会的行业运行数据与市场预测也算市场，不算政策。",
  },
  {
    key: "business",
    tagColor: "red",
    label: "企业",
    feedLabel: "企业与资本",
    section: "企业与资本",
    guide: "公司层面的经营动作：财报与业绩预告、融资与 IPO、并购重组、股权与减持、人事变动、诉讼与专利纠纷、破产与重整、扩产投资与海外建厂。产品技术本身不归这里。",
  },
  {
    key: "industry",
    tagColor: "neutral",
    label: "行业",
    feedLabel: "行业动态",
    section: "行业与观点",
    guide: "不属于上面任何单一环节的行业整体动态：装机与出口统计、产业链整体排产、展会与行业会议、市场研究机构的价格与供需综述。",
  },
  {
    key: "opinion",
    tagColor: "magenta",
    label: "观点",
    section: "行业与观点",
    guide: "重点是作者的解释、判断、预测、复盘或访谈观点，而不是新发生的价格、政策或订单。券商研报的观点部分、行业评论、深度分析放这里；带新数据的研究报告归“行业”。",
    commentary: true,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  tagColor: string;
  label: string;
  feedLabel?: string;
  section: string;
  guide: string;
  commentary?: true;
}>;

/**
 * 这个行业最受关注的一类发布：政策落地是光伏读者最盯的一类。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "policy", tag: "政策/监管", unit: "项新政策" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = [
  "pv",
  "gw",
  "mw",
  "gwh",
  "mwh",
  "epc",
  "ipp",
  "bess",
  "pcs",
  "lcoe",
  "ppa",
  "perc",
  "topcon",
  "hjt",
  "ibc",
  "硅料",
  "硅片",
  "电池片",
  "组件",
  "逆变器",
  "储能",
  "电价",
  "装机",
];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = [
  "price_move",
  "capacity_supply",
  "product_launch",
  "tech_breakthrough",
  "policy_trade",
  "project_order",
  "finance_earnings",
  "market_analysis",
  "explainer",
] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "价格/行情",
  "产能/开工",
  "新品发布",
  "技术突破",
  "政策/监管",
  "项目/订单",
  "财报/业绩",
  "资本/并购",
  "人事/组织",
  "研究/论文",
  "供应链/物流",
  "安全/事故",
  "行业/市场",
  "观点/分析",
  "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "TOPCon",
  "HJT",
  "xBC",
  "钙钛矿",
  "叠层电池",
  "颗粒硅",
  "工业硅",
  "薄片化",
  "大尺寸",
  "0BB",
  "银浆",
  "胶膜",
  "光伏玻璃",
  "跟踪支架",
  "组串式",
  "集中式",
  "微逆",
  "户用",
  "工商业",
  "大储",
  "海上光伏",
  "光储一体",
  "绿证/绿电",
  "消纳/限电",
  "反倾销/关税",
  "出海建厂",
  "美国市场",
  "印度市场",
  "中东市场",
  "欧洲市场",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = [
  "隆基绿能",
  "晶科能源",
  "天合光能",
  "晶澳科技",
  "通威股份",
  "协鑫科技",
  "协鑫集成",
  "TCL中环",
  "爱旭股份",
  "阿特斯",
  "东方日升",
  "正泰新能",
  "一道新能",
  "华晟新能源",
  "阳光电源",
  "华为数字能源",
  "锦浪科技",
  "固德威",
  "上能电气",
  "福斯特",
  "福莱特",
  "信义光能",
  "迈为股份",
  "捷佳伟创",
  "奥特维",
  "中信博",
  "宁德时代",
  "海辰储能",
  "First Solar",
  "韩华Qcells",
  "SolarEdge",
  "Enphase",
  "Nextracker",
  "Wacker",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  价格: "价格/行情",
  涨价: "价格/行情",
  降价: "价格/行情",
  报价: "价格/行情",
  成交价: "价格/行情",
  行情: "价格/行情",
  减产: "产能/开工",
  停产: "产能/开工",
  检修: "产能/开工",
  扩产: "产能/开工",
  开工率: "产能/开工",
  产能: "产能/开工",
  出货: "供应链/物流",
  库存: "供应链/物流",
  物流: "供应链/物流",
  发布: "新品发布",
  新品: "新品发布",
  量产: "新品发布",
  技术: "技术突破",
  效率: "技术突破",
  纪录: "技术突破",
  政策: "政策/监管",
  监管: "政策/监管",
  补贴: "政策/监管",
  电价: "政策/监管",
  关税: "政策/监管",
  双反: "政策/监管",
  招标: "项目/订单",
  中标: "项目/订单",
  订单: "项目/订单",
  并网: "项目/订单",
  电站: "项目/订单",
  财报: "财报/业绩",
  业绩: "财报/业绩",
  预告: "财报/业绩",
  融资: "资本/并购",
  ipo: "资本/并购",
  并购: "资本/并购",
  收购: "资本/并购",
  重组: "资本/并购",
  破产: "资本/并购",
  人事: "人事/组织",
  离职: "人事/组织",
  任命: "人事/组织",
  论文: "研究/论文",
  研究: "研究/论文",
  事故: "安全/事故",
  火灾: "安全/事故",
  召回: "安全/事故",
  市场: "行业/市场",
  装机: "行业/市场",
  出口: "行业/市场",
  观点: "观点/分析",
  分析: "观点/分析",
  预测: "观点/分析",
  研报: "观点/分析",
  储能: "大储",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是这家公司发消息时开头用的组织名（公司、实验室、团队），
 * 在它自己的主题页上读者知道说的是谁，可以省去；otherNames 是公司的其他称呼（官方账号名、子品牌）。
 * 所有这些名字都用来认出说的是哪家公司，比如把事实的主体对到发布方。
 */
export const ENTITIES: Record<
  string,
  { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }
> = {
  longi: {
    name: "隆基绿能",
    displayTag: "隆基绿能",
    aliases: ["隆基", "LONGi", "隆基股份", "隆基乐叶"],
    orgNames: ["隆基绿能", "隆基", "LONGi"],
    otherNames: ["LONGi Solar", "隆基乐叶"],
  },
  jinko: {
    name: "晶科能源",
    displayTag: "晶科能源",
    aliases: ["晶科", "JinkoSolar", "晶科能源控股"],
    orgNames: ["晶科能源", "晶科", "JinkoSolar"],
    otherNames: ["Jinko Solar"],
  },
  trina: {
    name: "天合光能",
    displayTag: "天合光能",
    aliases: ["天合", "Trina Solar", "天合富家"],
    orgNames: ["天合光能", "天合", "Trina Solar"],
    otherNames: ["Trina"],
  },
  ja: {
    name: "晶澳科技",
    displayTag: "晶澳科技",
    aliases: ["晶澳", "JA Solar", "JA Solar Technology"],
    orgNames: ["晶澳科技", "晶澳", "JA Solar"],
  },
  tongwei: {
    name: "通威股份",
    displayTag: "通威股份",
    aliases: ["通威", "通威太阳能", "永祥股份", "Tongwei"],
    orgNames: ["通威股份", "通威集团", "通威", "永祥股份", "Tongwei"],
    otherNames: ["通威太阳能"],
  },
  gcl: {
    name: "协鑫科技",
    displayTag: "协鑫科技",
    aliases: ["协鑫", "GCL", "保利协鑫", "协鑫科技控股"],
    orgNames: ["协鑫科技", "协鑫集团", "协鑫", "GCL"],
    otherNames: ["GCL Technology", "GCL Tech"],
  },
  gclsi: {
    name: "协鑫集成",
    displayTag: "协鑫集成",
    aliases: ["协鑫集成", "GCL System Integration", "GCLSI"],
    orgNames: ["协鑫集成", "GCLSI"],
    otherNames: ["GCL System Integration"],
  },
  tclzh: {
    name: "TCL中环",
    displayTag: "TCL中环",
    aliases: ["中环股份", "TCL中环", "天津中环"],
    orgNames: ["TCL中环", "中环股份"],
    otherNames: ["TCL Zhonghuan"],
  },
  aiko: {
    name: "爱旭股份",
    displayTag: "爱旭股份",
    aliases: ["爱旭", "Aiko Solar", "爱旭科技"],
    orgNames: ["爱旭股份", "爱旭", "Aiko Solar"],
    otherNames: ["爱旭 ABC"],
  },
  canadian: {
    name: "阿特斯",
    displayTag: "阿特斯",
    aliases: ["阿特斯", "Canadian Solar", "CSI Solar", "阿特斯阳光电力"],
    orgNames: ["阿特斯", "Canadian Solar", "CSI Solar"],
    otherNames: ["Recurrent Energy"],
  },
  risen: {
    name: "东方日升",
    displayTag: "东方日升",
    aliases: ["东方日升", "Risen Energy", "Risen"],
    orgNames: ["东方日升", "Risen Energy"],
  },
  astronergy: {
    name: "正泰新能",
    displayTag: "正泰新能",
    aliases: ["正泰新能", "Astronergy", "正泰"],
    orgNames: ["正泰新能", "Astronergy"],
  },
  das: {
    name: "一道新能",
    displayTag: "一道新能",
    aliases: ["一道新能", "DAS Solar", "一道新能源"],
    orgNames: ["一道新能", "DAS Solar"],
  },
  huasun: {
    name: "华晟新能源",
    displayTag: "华晟新能源",
    aliases: ["华晟", "Huasun", "安徽华晟"],
    orgNames: ["华晟新能源", "Huasun"],
  },
  sungrow: {
    name: "阳光电源",
    displayTag: "阳光电源",
    aliases: ["阳光电源", "Sungrow", "阳光新能源"],
    orgNames: ["阳光电源", "Sungrow"],
    otherNames: ["阳光新能源"],
  },
  huawei: {
    name: "华为数字能源",
    displayTag: "华为数字能源",
    aliases: ["华为", "Huawei", "华为智能光伏", "华为数字能源"],
    orgNames: ["华为数字能源", "华为智能光伏", "华为"],
    otherNames: ["FusionSolar"],
  },
  solis: {
    name: "锦浪科技",
    displayTag: "锦浪科技",
    aliases: ["锦浪", "Solis", "锦浪科技"],
    orgNames: ["锦浪科技", "锦浪", "Solis"],
  },
  goodwe: {
    name: "固德威",
    displayTag: "固德威",
    aliases: ["固德威", "GoodWe"],
    orgNames: ["固德威", "GoodWe"],
  },
  sineng: {
    name: "上能电气",
    displayTag: "上能电气",
    aliases: ["上能电气", "Sineng", "上能"],
    orgNames: ["上能电气", "Sineng Electric"],
  },
  deye: {
    name: "德业股份",
    displayTag: "德业股份",
    aliases: ["德业", "Deye", "德业新能源"],
    orgNames: ["德业股份", "德业", "Deye"],
  },
  first: {
    name: "福斯特",
    displayTag: "福斯特",
    aliases: ["福斯特", "First Applied", "杭州福斯特"],
    orgNames: ["福斯特", "First Applied Material"],
  },
  flat: {
    name: "福莱特",
    displayTag: "福莱特",
    aliases: ["福莱特", "Flat Glass", "福莱特玻璃"],
    orgNames: ["福莱特", "福莱特玻璃", "Flat Glass"],
  },
  xinyi: {
    name: "信义光能",
    displayTag: "信义光能",
    aliases: ["信义光能", "Xinyi Solar", "信义玻璃"],
    orgNames: ["信义光能", "Xinyi Solar"],
  },
  maxwell: {
    name: "迈为股份",
    displayTag: "迈为股份",
    aliases: ["迈为", "Maxwell", "迈为科技"],
    orgNames: ["迈为股份", "迈为", "Maxwell Technologies"],
  },
  jeka: {
    name: "捷佳伟创",
    displayTag: "捷佳伟创",
    aliases: ["捷佳伟创", "SC New Energy", "捷佳"],
    orgNames: ["捷佳伟创", "SC New Energy Technology"],
  },
  autowell: {
    name: "奥特维",
    displayTag: "奥特维",
    aliases: ["奥特维", "Autowell", "无锡奥特维"],
    orgNames: ["奥特维", "Autowell"],
  },
  arctech: {
    name: "中信博",
    displayTag: "中信博",
    aliases: ["中信博", "Arctech", "中信博新能源"],
    orgNames: ["中信博", "Arctech Solar"],
  },
  catl: {
    name: "宁德时代",
    displayTag: "宁德时代",
    aliases: ["宁德时代", "CATL", "宁德"],
    orgNames: ["宁德时代", "CATL"],
    otherNames: ["EnerC", "EnerD"],
  },
  hithium: {
    name: "海辰储能",
    displayTag: "海辰储能",
    aliases: ["海辰储能", "HiTHium", "海辰新能源"],
    orgNames: ["海辰储能", "HiTHium"],
  },
  firstsolar: {
    name: "First Solar",
    displayTag: "First Solar",
    aliases: ["First Solar", "第一太阳能"],
    orgNames: ["First Solar"],
  },
  qcells: {
    name: "韩华Qcells",
    displayTag: "韩华Qcells",
    aliases: ["Qcells", "Hanwha Qcells", "韩华", "Hanwha"],
    orgNames: ["Qcells", "Hanwha Qcells", "Hanwha"],
  },
  maxeon: {
    name: "Maxeon",
    displayTag: null,
    aliases: ["Maxeon", "SunPower"],
    orgNames: ["Maxeon", "SunPower"],
  },
  solaredge: {
    name: "SolarEdge",
    displayTag: "SolarEdge",
    aliases: ["SolarEdge"],
    orgNames: ["SolarEdge"],
  },
  enphase: {
    name: "Enphase",
    displayTag: "Enphase",
    aliases: ["Enphase", "Enphase Energy"],
    orgNames: ["Enphase Energy", "Enphase"],
  },
  nextracker: {
    name: "Nextracker",
    displayTag: "Nextracker",
    aliases: ["Nextracker"],
    orgNames: ["Nextracker"],
  },
  wacker: {
    name: "Wacker",
    displayTag: "Wacker",
    aliases: ["Wacker", "瓦克", "Wacker Chemie"],
    orgNames: ["Wacker", "Wacker Chemie"],
  },
  oci: {
    name: "OCI",
    displayTag: null,
    aliases: ["OCI", "OCIM", "OCI Holdings"],
    orgNames: ["OCI", "OCI Holdings"],
  },
  daqo: {
    name: "大全能源",
    displayTag: null,
    aliases: ["大全能源", "大全新能源", "Daqo", "Daqo New Energy"],
    orgNames: ["大全能源", "Daqo New Energy"],
  },
  xinte: {
    name: "新特能源",
    displayTag: null,
    aliases: ["新特能源", "特变电工", "Xinte"],
    orgNames: ["新特能源", "特变电工", "Xinte Energy"],
  },
  hoshine: {
    name: "合盛硅业",
    displayTag: null,
    aliases: ["合盛硅业", "Hoshine", "合盛"],
    orgNames: ["合盛硅业", "Hoshine Silicon"],
  },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "longi", name: "隆基绿能", patterns: [/隆基|\bLONGi\b/i] },
  { id: "jinko", name: "晶科能源", patterns: [/晶科|\bJinko/i] },
  { id: "trina", name: "天合光能", patterns: [/天合|\bTrina\b/i] },
  { id: "ja", name: "晶澳科技", patterns: [/晶澳|\bJA\s?Solar\b/i] },
  { id: "tongwei", name: "通威股份", patterns: [/通威|永祥|\bTongwei\b/i] },
  { id: "gcl", name: "协鑫科技", patterns: [/协鑫|\bGCL\b/i] },
  { id: "tclzh", name: "TCL中环", patterns: [/中环|\bTCL\s?中环|TCL Zhonghuan/i] },
  { id: "aiko", name: "爱旭股份", patterns: [/爱旭|\bAiko\b/i] },
  { id: "canadian", name: "阿特斯", patterns: [/阿特斯|\bCanadian\s?Solar\b|\bCSI\s?Solar\b/i] },
  { id: "risen", name: "东方日升", patterns: [/东方日升|\bRisen\b/i] },
  { id: "astronergy", name: "正泰新能", patterns: [/正泰|\bAstronergy\b/i] },
  { id: "das", name: "一道新能", patterns: [/一道新能|一道新能源|\bDAS\s?Solar\b/i] },
  { id: "huasun", name: "华晟新能源", patterns: [/华晟|\bHuasun\b/i] },
  { id: "sungrow", name: "阳光电源", patterns: [/阳光电源|\bSungrow\b/i] },
  { id: "huawei", name: "华为数字能源", patterns: [/华为|\bHuawei\b|FusionSolar/i] },
  { id: "solis", name: "锦浪科技", patterns: [/锦浪|\bSolis\b/i] },
  { id: "goodwe", name: "固德威", patterns: [/固德威|\bGoodWe\b/i] },
  { id: "sineng", name: "上能电气", patterns: [/上能|\bSineng\b/i] },
  { id: "deye", name: "德业股份", patterns: [/德业|\bDeye\b/i] },
  { id: "first", name: "福斯特", patterns: [/福斯特|First\s?Applied/i] },
  { id: "flat", name: "福莱特", patterns: [/福莱特|Flat\s?Glass/i] },
  { id: "xinyi", name: "信义光能", patterns: [/信义光能|Xinyi\s?Solar/i] },
  { id: "maxwell", name: "迈为股份", patterns: [/迈为|\bMaxwell\b/i] },
  { id: "jeka", name: "捷佳伟创", patterns: [/捷佳伟创|捷佳/i] },
  { id: "autowell", name: "奥特维", patterns: [/奥特维|\bAutowell\b/i] },
  { id: "arctech", name: "中信博", patterns: [/中信博|\bArctech\b/i] },
  { id: "catl", name: "宁德时代", patterns: [/宁德时代|\bCATL\b/i] },
  { id: "hithium", name: "海辰储能", patterns: [/海辰|\bHiTHium\b/i] },
  { id: "firstsolar", name: "First Solar", patterns: [/First\s?Solar/i] },
  { id: "qcells", name: "韩华Qcells", patterns: [/Qcells|Hanwha|韩华/i] },
  { id: "maxeon", name: "Maxeon", patterns: [/Maxeon|SunPower/i] },
  { id: "solaredge", name: "SolarEdge", patterns: [/SolarEdge/i] },
  { id: "enphase", name: "Enphase", patterns: [/Enphase/i] },
  { id: "nextracker", name: "Nextracker", patterns: [/Nextracker/i] },
  { id: "wacker", name: "Wacker", patterns: [/Wacker|瓦克/i] },
  { id: "daqo", name: "大全能源", patterns: [/大全能源|大全新能源|\bDaqo\b/i] },
  { id: "xinte", name: "新特能源", patterns: [/新特能源|特变电工|\bXinte\b/i] },
  { id: "hoshine", name: "合盛硅业", patterns: [/合盛硅业|合盛|\bHoshine\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "longi", domains: ["longi.com"] },
  { entityId: "jinko", domains: ["jinkosolar.com"] },
  { entityId: "trina", domains: ["trinasolar.com"] },
  { entityId: "ja", domains: ["jasolar.com"] },
  { entityId: "tongwei", domains: ["tongwei.com"] },
  { entityId: "gcl", domains: ["gcltech.com"] },
  { entityId: "gclsi", domains: ["gclsi.com"] },
  { entityId: "aiko", domains: ["aikosolar.com"] },
  { entityId: "canadian", domains: ["canadiansolar.com"] },
  { entityId: "risen", domains: ["risenenergy.com"] },
  { entityId: "astronergy", domains: ["astronergy.com"] },
  { entityId: "das", domains: ["das-solar.com"] },
  { entityId: "huasun", domains: ["huasunsolar.com"] },
  { entityId: "sungrow", domains: ["sungrowpower.com"] },
  { entityId: "huawei", domains: ["huawei.com", "solar.huawei.com"] },
  { entityId: "goodwe", domains: ["goodwe.com"] },
  { entityId: "deye", domains: ["deye.com"] },
  { entityId: "arctech", domains: ["arctechsolar.com"] },
  { entityId: "catl", domains: ["catl.com"] },
  { entityId: "hithium", domains: ["hithium.com"] },
  { entityId: "firstsolar", domains: ["firstsolar.com"] },
  { entityId: "qcells", domains: ["q-cells.com"] },
  { entityId: "maxeon", domains: ["maxeon.com"] },
  { entityId: "solaredge", domains: ["solaredge.com"] },
  { entityId: "enphase", domains: ["enphase.com"] },
  { entityId: "nextracker", domains: ["nextracker.com"] },
  { entityId: "wacker", domains: ["wacker.com"] },
  { entityId: "xinyi", domains: ["xinyisolar.com"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "gcl", pattern: /GCL\s?(?:Technology|Tech|System|New\s?Energy)/i },
  { entityId: "tclzh", pattern: /TCL\s?中环|TCL\s?Zhonghuan/i },
  { entityId: "huawei", pattern: /华为智能光伏|华为数字能源|FusionSolar/i },
  { entityId: "tongwei", pattern: /永祥(?:股份|新能源)?/ },
];
