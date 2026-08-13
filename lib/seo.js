'use strict';

const SITE_ORIGIN = 'https://pvhot.bbroot.com';
const SITE_NAME = 'PVHOT 光伏 HOT';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function itemTitle(item) {
  return String(item?.title_cn || item?.title_short || item?.title || '光伏行业动态').trim();
}

function itemSummary(item) {
  return String(
    item?.summary_cn
    || item?.summary
    || item?.recommendationReason
    || item?.reason
    || `${itemTitle(item)}。查看 PVHOT 整理的光伏行业动态与原始信源。`
  ).trim();
}

function itemSource(item) {
  return String(item?.sourceDisplayName || item?.source || '行业信源').trim();
}

function itemOriginalUrl(item) {
  const candidates = [item?.links?.original, item?.link, item?.links?.discovery];
  for (const value of candidates) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue;
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      if (!host || !host.includes('.') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) continue;
      if (['localhost', 'localhost.localdomain'].includes(host)
          || ['.localhost', '.local', '.internal', '.lan', '.home', '.test', '.invalid', '.onion', '.arpa']
            .some((suffix) => host.endsWith(suffix))) continue;
      return url.href;
    } catch {}
  }
  return '';
}

function articleToken(id) {
  const value = String(id == null ? '' : id).trim();
  if (!value) return '';
  return Buffer.from(value, 'utf8').toString('base64url');
}

function articleIdFromToken(token) {
  const value = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (!decoded || articleToken(decoded) !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

function articleUrl(id) {
  const token = articleToken(id);
  return token ? `${SITE_ORIGIN}/api/v1/articles/${token}/` : `${SITE_ORIGIN}/api/v1/archive/`;
}

function validDate(value) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value) {
  const parsed = validDate(value);
  return parsed ? parsed.toISOString() : '';
}

function displayDate(value) {
  const parsed = validDate(value);
  if (!parsed) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function jsonLd(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function pageShell({ title, description, canonical, body, structuredData, robots = 'index, follow' }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description.slice(0, 300));
  const safeCanonical = escapeHtml(canonical);
  const ld = structuredData ? `<script type="application/ld+json">${jsonLd(structuredData)}</script>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image-v4.jpg">
  <meta name="twitter:card" content="summary_large_image">
  ${ld}
  <style>
    :root{color-scheme:light;--ink:#142018;--muted:#647067;--line:#dce3dd;--brand:#12654a;--paper:#f7f8f4}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.75 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
    a{color:var(--brand)}header,main,footer{width:min(860px,calc(100% - 32px));margin:auto}header{padding:28px 0 16px;border-bottom:1px solid var(--line)}
    .brand{font-size:20px;font-weight:900;text-decoration:none;color:var(--ink)}.brand span{color:var(--brand)}nav{float:right}main{padding:34px 0 54px}
    article,.archive-intro{background:#fff;border:1px solid var(--line);border-radius:18px;padding:clamp(22px,5vw,44px);box-shadow:0 12px 35px rgba(20,32,24,.05)}
    h1{font-size:clamp(28px,5vw,44px);line-height:1.25;margin:.3em 0}.eyebrow,.meta{color:var(--muted);font-size:14px}.summary{font-size:18px;line-height:1.9}
    .source{margin-top:28px;padding-top:22px;border-top:1px solid var(--line)}.list{list-style:none;padding:0;margin:26px 0}.list li{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:12px 0}
    .list a{font-size:18px;font-weight:700;text-decoration:none}.list p{color:var(--muted);margin:6px 0 0}.pager{display:flex;gap:16px;justify-content:space-between}
    footer{padding:24px 0 40px;color:var(--muted);font-size:14px}@media(max-width:600px){nav{float:none;margin-top:8px}header{padding-top:18px}}
  </style>
</head>
<body>
  <header><a class="brand" href="/">PVHOT <span>光伏 HOT</span></a><nav><a href="/api/v1/archive/">新闻归档</a> · <a href="/api/v1/rss.xml">RSS</a></nav></header>
  <main>${body}</main>
  <footer>PVHOT 聚合公开光伏行业信息，重要数据与结论请以原始信源为准。</footer>
</body>
</html>`;
}

function renderArticlePage(item, allItems = []) {
  const title = itemTitle(item);
  const summary = itemSummary(item);
  const canonical = articleUrl(item.id);
  const published = isoDate(item.pubDate || item.dateKey);
  const modified = isoDate(item.updatedAt || item.pubDate || item.dateKey) || published;
  const originalUrl = itemOriginalUrl(item);
  const category = String(item.category || '光伏').trim();
  const source = itemSource(item);
  const related = allItems
    .filter((candidate) => candidate && candidate.id && candidate.id !== item.id)
    .slice(0, 5)
    .map((candidate) => `<li><a href="${escapeHtml(articleUrl(candidate.id))}">${escapeHtml(itemTitle(candidate))}</a></li>`)
    .join('');
  const body = `<article>
    <div class="eyebrow">PVHOT · ${escapeHtml(category)}</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta"><time datetime="${escapeHtml(published)}">${escapeHtml(displayDate(item.pubDate || item.dateKey))}</time> · 来源：${escapeHtml(source)}</p>
    <p class="summary">${escapeHtml(summary)}</p>
    ${item.recommendationReason ? `<p><strong>PVHOT 关注理由：</strong>${escapeHtml(item.recommendationReason)}</p>` : ''}
    <p class="source">${originalUrl ? `<a href="${escapeHtml(originalUrl)}" rel="nofollow noopener noreferrer">查看原始信源</a> · ` : ''}<a href="/api/v1/archive/">返回 PVHOT 新闻归档</a></p>
    ${related ? `<h2>最新光伏动态</h2><ul>${related}</ul>` : ''}
  </article>`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: summary,
    datePublished: published || undefined,
    dateModified: modified || undefined,
    inLanguage: 'zh-CN',
    mainEntityOfPage: canonical,
    url: canonical,
    image: `${SITE_ORIGIN}/og-image-v4.jpg`,
    articleSection: category,
    author: { '@type': 'Organization', name: source },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    isBasedOn: originalUrl || undefined,
  };
  return pageShell({
    title: `${title} | PVHOT 光伏新闻`,
    description: summary,
    canonical,
    body,
    structuredData,
  });
}

function renderArchivePage(data, pageValue = 1, pageSize = 100) {
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item?.id) : [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(pageValue, 10) || 1));
  const start = (page - 1) * pageSize;
  const rows = items.slice(start, start + pageSize).map((item) => `
    <li><a href="${escapeHtml(articleUrl(item.id))}">${escapeHtml(itemTitle(item))}</a>
    <div class="meta">${escapeHtml(displayDate(item.pubDate || item.dateKey))} · ${escapeHtml(itemSource(item))} · ${escapeHtml(item.category || '光伏')}</div>
    <p>${escapeHtml(itemSummary(item).slice(0, 180))}</p></li>`).join('');
  const pageUrl = page === 1 ? `${SITE_ORIGIN}/api/v1/archive/` : `${SITE_ORIGIN}/api/v1/archive/?page=${page}`;
  const body = `<section class="archive-intro"><div class="eyebrow">PVHOT SEARCHABLE ARCHIVE</div><h1>PVHOT 光伏新闻归档</h1>
    <p>浏览 PVHOT（光伏 HOT）聚合整理的光伏产业链新闻、价格、政策、企业与储能动态。当前共 ${items.length} 条。</p></section>
    <ol class="list">${rows || '<li>新闻数据正在更新，请稍后再来。</li>'}</ol>
    <div class="pager">${page > 1 ? `<a href="${page === 2 ? '/api/v1/archive/' : `/api/v1/archive/?page=${page - 1}`}">上一页</a>` : '<span></span>'}${page < totalPages ? `<a href="/api/v1/archive/?page=${page + 1}">下一页</a>` : '<span></span>'}</div>`;
  return pageShell({
    title: `PVHOT 光伏新闻归档${page > 1 ? `（第 ${page} 页）` : ''}`,
    description: 'PVHOT 光伏行业新闻归档，覆盖硅料、硅片、电池片、组件、逆变器、储能、电站、价格与政策动态。',
    canonical: pageUrl,
    body,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'PVHOT 光伏新闻归档',
      url: pageUrl,
      inLanguage: 'zh-CN',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
    },
  });
}

function renderNotFoundPage() {
  return pageShell({
    title: '新闻不存在 | PVHOT',
    description: '没有找到这条 PVHOT 光伏新闻。',
    canonical: `${SITE_ORIGIN}/api/v1/archive/`,
    robots: 'noindex, follow',
    body: '<article><h1>没有找到这条新闻</h1><p>内容可能已更新或移除。</p><p><a href="/api/v1/archive/">浏览 PVHOT 新闻归档</a></p></article>',
  });
}

function renderSitemap(data, limit = 5000) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const urls = [];
  const seen = new Set();
  const add = (loc, lastmod) => {
    if (!loc || seen.has(loc)) return;
    seen.add(loc);
    urls.push({ loc, lastmod: isoDate(lastmod).slice(0, 10) });
  };
  add(`${SITE_ORIGIN}/`, data?.meta?.updated || data?.updated);
  add(`${SITE_ORIGIN}/api/v1/archive/`, data?.meta?.updated || data?.updated);
  for (const item of items) {
    if (urls.length >= limit || !item?.id) break;
    add(articleUrl(item.id), item.updatedAt || item.pubDate || item.dateKey);
  }
  const body = urls.map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = {
  SITE_ORIGIN,
  articleIdFromToken,
  articleToken,
  articleUrl,
  renderArchivePage,
  renderArticlePage,
  renderNotFoundPage,
  renderSitemap,
};
