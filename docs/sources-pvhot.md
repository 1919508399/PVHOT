# PVHOT 信源清单与接入方式

线上站点：https://pvhot.bbroot.com/ 。信源清单在 `industry/sources.json`（首次启动由 `scripts/seed.ts` 导入，
已存在的不会被覆盖，之后在后台「信源」页改），当前 24 条，启用 20 条。

## 一条重要的现实约束

部署机（阿里云 47.250.92.231）的出口 IP 被 Cloudflare 挡了。pv magazine、PV Tech、ESS News、
Energy-Storage.News、CleanTechnica、国际能源网这些站点，**带不带浏览器 UA 都返回 403**——这不是 UA 问题，
是 IP 段的封禁，改请求头救不回来。

因此英文主力源改走**必应新闻的站内检索**：`https://www.bing.com/news/search?q=site%3Apv-magazine.com&format=RSS`。
必应自己抓得到这些站，我们的服务器只访问必应，就不受封。中文源同理，用关键词而不是站点限定。

两个配套的采集配置（都在 `config-keys.ts` 白名单里，后台新建信源也能填）：

| 配置 | 作用 |
|---|---|
| `urlParam` | 必应的条目链接是 `apiclick.aspx?...&url=<真实地址>`。填 `"url"` 后采集器把真实地址取出来，入库和正文抓取都用文章自己的地址，不留跳转链。 |
| `userAgent` | 单源覆盖默认 UA。对某些挑剔但没封 IP 的站点有用（例：`rss`、`web_list` 都支持）。配 `acceptLanguage` 一起用。 |

## 当前启用的信源

中文（必应关键词，T2，免费）：

| 信源 | 关键词 |
|---|---|
| 必应新闻 光伏 | 光伏 |
| 必应新闻 储能 | 储能 |
| 必应新闻 光伏组件价格 | 光伏组件价格 |
| 必应新闻 多晶硅 | 多晶硅 |
| 必应新闻 光伏政策 | 光伏政策 |
| 必应新闻 光伏招标 | 光伏招标 |

中文直抓：

| 信源 | 类型 | 说明 |
|---|---|---|
| 索比光伏网 | web_list | `news.solarbe.com`，列表选择器 `.home-content-boxgeneral-list > a` |
| 国家能源局 新能源司 | web_list | 政策口，T1 |
| 必应中转的 pv magazine 中文版 | rss | `site:pv-magazine-china.com`，必应无索引，已停用 |

海外（全部经必应站内检索，T1/T2）：pv magazine、PV Tech、ESS News、Energy-Storage.News、CleanTechnica、
reNEWS（这条直连可用，地址要带 `www.`，不带会 403）、Mercom India、TaiyangNews、Utility Dive、Saur Energy、
Balkan Green、Clean Energy Wire。

## 抓不到、已停用的

| 站点 | 原因 |
|---|---|
| 国际能源网 solar.in-en.com | 服务器 IP 被拒 403（浏览器 UA 也无效） |
| pv magazine 印度版 / 澳洲版 / 中文版 | 必应新闻里没有这三个子站的索引 |
| 北极星 bjx.com.cn | 阿里云 WAF，网页直抓不稳；但**必应新闻能检索到它的文章**，所以中文关键词源里会混入北极星的内容 |
| 发改委 / 工信部 | 列表页 JS 渲染，选择器抓下来是空壳 |
| CPIA、中国能源新闻网 | 服务器连不上 |

## 想再加中文源时的顺序

1. **先试必应关键词**：`https://www.bing.com/news/search?q=<url编码的关键词>&format=RSS`，配 `urlParam: "url"`。
   一条能给 11–12 条，覆盖腾讯新闻、北极星、新浪财经、凤凰等转载源。改关键词零成本，这是性价比最高的一档。
2. 再试直抓列表页：写 `itemSelector` / `linkSelector` / `publishedAtSelector`，中文站大量 JS 渲染，先 curl 看静态 HTML 里有没有日期。
3. 公众号仍是最全的中文源，但要么买极致了（列表 ¥0.14/次、正文 ¥0.03/篇），要么用服务器上的 we-mp-rss（容器 `pvhot-werrs`，
   8001 端口）扫码登录后拿 `/rss` 输出。

## 微信公众号（需要极致了 Dajiala 的 key）

在后台「设置 → 采集通道」填 key，然后到「信源」页新建 `mp_account` 类型信源。旧站按小时轮询过下面这些账号：

机构：中国光伏行业协会CPIA、硅业分会、中关村储能产业技术联盟（CNESA）

媒体（T1）：光伏們、光伏头条、索比光伏网、北极星太阳能光伏网、世纪新能源网、维科网光伏、国际能源网、PV-Tech、
光伏资讯、光伏见闻、风芒能源、能源一号、黑鹰光伏、赶碳号科技、储能与电力市场

媒体（T2）：草根光伏、智汇光伏、摩尔光伏、东吴光伏圈、ACMI硅基新材料

企业（T1）：隆基绿能、晶科能源、天合光能、晶澳科技、通威集团、协鑫集团、TCL中环、阿特斯阳光电力集团、
东方日升新能源、爱旭股份、正泰新能、阳光电源、华为智能光伏、上能电气、固德威、锦浪科技

企业（T2）：一道新能、德业新能源、禾迈股份、昱能科技

## X 账号（需要 SocialData 的 key）

在后台填 key，然后新建 `x_search` 类型信源：

pvmagazine、pv_tech、SolarPowerWorld、pvmagazineusa、MercomIndia、Saur_energy、CanaryMediaInc、renew_economy、SolarPowerPort，
以及各公司官方账号（@LONGi_Solar、@JinkoSolar、@trinasolar、@JASolarOfficial、@firstsolar、@SungrowPower 等）。

## 官网新闻页（web_list，无 key）

旧站抓过这些企业官网新闻页，接入时在后台新建 `web_list` 信源并配选择器：
隆基（longi.com/cn/news）、晶科（jinkosolar.com/site/newscenter）、天合（trinasolar.com/cn/press-releases）、
晶澳（jasolar.com）、通威（tongwei.com/news.html）、协鑫科技（gcltech.com/news）、一道新能（das-solar.com/site/news）、
华晟（huasunsolar.com/news.html）、阳光电源（dl.sungrowpower.com/news.html）、华为智能光伏（solar.huawei.com/cn/news）、
固德威（goodwe.com/news-exhibition/news）、协鑫集成（cn.csisolar.com/news-releases）、
中国光伏行业协会（chinapv.org.cn）、世纪新能源网（ne21.com）。

## 价格数据

旧站的 `fetch_prices.js` 抓取硅料/硅片/电池/组件价格并生成面板。AIHOT 引擎没有价格面板，价格信息会作为新闻条目
（分类“价格/行情”）进入精选和日报。如果要恢复价格面板，可以作为 modules/ 下的自定义模块开发（见 docs/architecture.md）。

## 改信源后的生效方式

`industry/sources.json` 只在**首次启动**导入，改完不会自动覆盖线上（避免冲掉后台编辑）。线上改法二选一：

1. 后台「信源」页直接改（推荐，走校验、立刻生效）。
2. 改库：`docker compose exec -T db psql -U pvhot -d pvhot`，然后
   `UPDATE sources SET config = config || jsonb_build_object(...) WHERE id='...';`

删除某源的历史文章再抓一次，会让它当作「首次导入」重新回填（受 `_aihot.initialBackfillLimit` 限制条数）——
上面清理必应跳转链接的旧文章就是这么做的。

---

# 微信公众号（免费，本机自建桥接）

公众号没有公开 RSS，付费走极致了（Dajiala，列表 ¥0.14/次、正文 ¥0.03/篇）。这套改走自建的
`we-mp-rss`（容器 `pvhot-werrs`，端口 8001，仅内网），成本为零。

## 链路

```
微信读书 cover 接口 ──► we-mp-rss（每号只取最新 1 篇）
                          ├── /rss/MP_WXS_xxx   ← PVHOT 从这里取（content:encoded 带正文）
                          └── sqlite /app/data/db.db
微信读书 /web/mp/content ─► ops/werr-patch-content.py（cron 10/40 分补正文）
```

## 两个关键限制（都不是配置问题）

1. **只能拿最新一篇。** 新版微信读书网页版把 `/web/mp/articles` 列表接口废了（恒返 -2041），
   只剩 `/api/mp/cover`（最新一篇）+ `/web/mp/content`（正文）。所以**无法回补历史文章**，
   每个号每轮最多 1 篇，靠时间积累。
2. **正文必须单独补。** 采集时正文为空，RSS 的 `content:encoded` 也是空。`ops/werr-patch-content.py`
   遍历库里 `has_content=0` 的文章，用 `/web/mp/content` 补 `content` / `content_html`。
   cron 里排在 `:10` 和 `:40`（采集在 `:00`/`:30` 之后）。PVHOT 源间隔因此设 45 分钟，等正文落库再读。

## 登录（扫码，会过期）

两个码都要扫，缺一个采集就是 0 篇：

- 公众号平台：`GET /api/v1/wx/auth/qr/code` → `GET /static/wx_qrcode.png`，登录态存 `data/wx.lic` 的 `token_data`
- 微信读书：`GET /api/v1/wx/weread/qr/code` → `GET /static/weread_qrcode.png`，登录态存 `weread_data`

后台账号 `pvhot` / `PvhotbYT3hXvP`（重置过，仅 8001 内网）。改库后要 `docker restart pvhot-werrs`
（应用有用户缓存）。二维码 122px 太小，扫码前用容器内 PIL 放大 4 倍。

微信读书扫码成功后接口只回 `wr_vid/wr_ql/wr_skey`，`wr_skey` 是 8 字符短值；需连同
`wr_rt`（刷新令牌）一起 `POST /api/v1/wx/weread/cookie` 才算配置完（`configured:true`）。

## PVHOT 侧配置

compose 里给 api/worker 加了：

```yaml
extra_hosts: ["host.docker.internal:host-gateway"]
environment:
  PRIVATE_FEED_HOSTS: host.docker.internal   # 否则 SSRF 校验报 "Blocked host"
```

信源（`rss` 类型，`feedUrl: http://host.docker.internal:8001/rss/MP_WXS_xxx`）：
光伏們、索比光伏网、北极星太阳能光伏网、中国光伏行业协会CPIA、智汇光伏（T1_5），
光伏资讯、光伏头条、赶碳号科技（T2）。`site_fulltext`/`syndicate_fulltext` 都设 false——
微信内容站内只给摘要和原文链接，不给全文（`publication/rules.ts` 的既定规则）。

## 已关掉的坑

we-mp-rss 自带一个 `*/30` 的「文章推送」任务，默认 webhook 指向某个钉钉群。已把 `web_hook_url`
清空（任务保留，只用来触发采集），否则每 30 分钟会往陌生群里推一次。
