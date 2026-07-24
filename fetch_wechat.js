/**
 * fetch_wechat.js — Puppeteer 抓取微信搜狗搜索结果
 * 通过 weixin.sogou.com 搜索"光伏"等关键词，提取公众号文章
 * 需要 Puppeteer + Chromium（已安装在服务器上）
 * 
 * 用法: node fetch_wechat.js
 * 输出: 写入 /var/www/pvhot/wechat_items.json（供 fetch_pv_news.js 合并）
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const crypto = require('crypto');

const KEYWORDS = ['光伏', '太阳能', '储能'];
const MAX_PER_KEYWORD = 15;
const OUTPUT_PATH = '/var/www/pvhot/wechat_items.json';
const FRESH_DAYS = 14;

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/admin/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractItemId(link) {
  return 'pv' + crypto.createHash('sha1').update(link).digest('hex').slice(0, 14);
}

/** Parse sogou's messy date format into ISO date string */
function parseSogouDate(raw) {
  if (!raw) return null;
  const now = new Date();

  // Pattern 1: document.write(timeConvert('1234567890'))54分钟前
  let m = raw.match(/timeConvert\('(\d+)'\)/);
  if (m) {
    const ts = parseInt(m[1]);
    const d = new Date(ts * 1000);
    return d.toISOString();
  }

  // Pattern 2: relative time "N分钟前"
  m = raw.match(/(\d+)\s*分钟前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 60000).toISOString();
  }

  // Pattern 3: relative time "N小时前"
  m = raw.match(/(\d+)\s*小时前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 3600000).toISOString();
  }

  // Pattern 4: relative time "N天前"
  m = raw.match(/(\d+)\s*天前/);
  if (m) {
    return new Date(now.getTime() - parseInt(m[1]) * 86400000).toISOString();
  }

  // Pattern 5: "昨天"
  if (raw.includes('昨天')) {
    return new Date(now.getTime() - 86400000).toISOString();
  }

  // Pattern 6: "前天"
  if (raw.includes('前天')) {
    return new Date(now.getTime() - 2 * 86400000).toISOString();
  }

  // Pattern 7: absolute date "2026-7-24" or "2026/7/24"
  m = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T08:00:00Z`);
    return d.toISOString();
  }

  return null;
}

function isFresh(pubDateStr) {
  if (!pubDateStr) return false;
  const d = new Date(pubDateStr);
  if (isNaN(d.getTime())) return false;
  const ageDays = (Date.now() - d.getTime()) / 86400000;
  return ageDays <= FRESH_DAYS;
}

async function searchWechat(keyword, page) {
  const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(keyword)}&ie=utf8`;
  console.log(`[wechat] searching: ${keyword} -> ${url}`);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Check if we hit a verification/captcha page
  const pageTitle = await page.title();
  if (pageTitle.includes('验证') || pageTitle.includes('verify') || pageTitle.includes('captcha')) {
    console.log(`[wechat] captcha detected for "${keyword}", skipping`);
    return [];
  }

  // Extract article entries - evaluate in browser context
  const rawItems = await page.evaluate(() => {
    const results = [];
    // Sogou weixin search uses .news-list li as article containers
    const cards = document.querySelectorAll('.news-list li, .news-box .news-list li');
    
    cards.forEach((card) => {
      try {
        // Title + link
        const titleEl = card.querySelector('h3 a, h4 a, .tit a');
        const title = titleEl ? titleEl.textContent.trim().replace(/\s+/g, ' ') : '';
        const link = titleEl ? titleEl.href : '';

        // Summary (exclude .s-p which contains account name + date, not summary)
        const summaryEl = card.querySelector('.txt-info, p.txt-info');
        const summary = summaryEl ? summaryEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : '';

        // Account name — Sogou WeChat uses .all-time-y2 inside .s-p
        const accountEl = card.querySelector('.s-p .all-time-y2, .all-time-y2');
        let account = accountEl ? accountEl.textContent.trim().replace(/\s+/g, ' ') : '';
        // Fallback: parse from .s-p text (format: "AccountName2021-2-22" or "AccountName3小时前")
        if (!account) {
          const sp = card.querySelector('.s-p');
          if (sp) {
            const spText = sp.textContent.trim().replace(/\s+/g, ' ');
            // Account name is before the date/time portion
            const m = spText.match(/^(.+?)(?=\d{4}[-/]\d|\d+\s*(?:分钟|小时|天)前|昨天|前天)/);
            if (m && m[1].trim() && m[1].trim().length < 30) account = m[1].trim();
          }
        }
        
        // Avatar: try account-specific avatar first, then article thumbnail
        let avatar = '';
        const avatarImg = card.querySelector('.account-box img, .account img, img.account, img.avatar, .account-wrap img, .wx-news-box img:first-child, .img-box img');
        if (avatarImg && avatarImg.src) {
          avatar = avatarImg.src;
        }

        // Date: sogou uses script tags with timeConvert
        const allText = card.textContent;
        // Also try to get the raw HTML for date parsing
        const scriptMatch = allText.match(/timeConvert\('(\d+)'\)/);
        const relativeMatch = allText.match(/(\d+(?:分钟|小时|天)前|昨天|前天)/);
        const absDateMatch = allText.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);

        let rawDate = '';
        if (scriptMatch) rawDate = `timeConvert('${scriptMatch[1]}')`;
        else if (relativeMatch) rawDate = relativeMatch[1];
        else if (absDateMatch) rawDate = absDateMatch[1];

        if (title && link) {
          results.push({ title, link, summary, account, avatar, rawDate });
        }
      } catch (e) {}
    });

    return results;
  });

  // Parse dates and filter fresh
  const items = [];
  for (const raw of rawItems) {
    const pubDate = parseSogouDate(raw.rawDate);
    if (!isFresh(pubDate)) {
      console.log(`[wechat] skip old: ${raw.title.slice(0, 40)} (date: ${raw.rawDate})`);
      continue;
    }
    items.push({
      title: raw.title,
      link: raw.link,
      summary: raw.summary,
      account: raw.account || '微信公众号',
      avatar: raw.avatar || '',
      pubDate: pubDate
    });
  }

  console.log(`[wechat] "${keyword}": ${rawItems.length} raw -> ${items.length} fresh`);
  return items.slice(0, MAX_PER_KEYWORD);
}

async function main() {
  console.log('[wechat] START Puppeteer WeChat search');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=zh-CN',
      '--window-size=1280,800'
    ]
  });

  const allItems = [];
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

    for (const kw of KEYWORDS) {
      try {
        const items = await searchWechat(kw, page);
        for (const it of items) {
          allItems.push({
            id: extractItemId(it.link),
            title: it.title,
            title_cn: it.title,
            link: it.link,
            summary: it.summary,
            summary_cn: it.summary,
            reason: '',
            category: 'ALL',
            lang: 'zh',
            pubDate: it.pubDate,
            source: 'wechat',
            sources: [{ name: it.account, source: 'wechat', link: it.link, avatar: it.avatar || '' }],
            sourceCount: 1,
            heat: 45,
            tags: [],
            score: 45,
            avatar: it.avatar || ''
          });
        }
      } catch (e) {
        console.error(`[wechat] error for "${kw}": ${e.message}`);
      }
      await sleep(3000);
    }
  } finally {
    await browser.close();
  }

  // Deduplicate by id
  const seen = new Set();
  const deduped = allItems.filter(it => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });

  // Write output
  const output = {
    fetchedAt: new Date().toISOString(),
    count: deduped.length,
    items: deduped
  };
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[wechat] OK wrote ${deduped.length} items -> ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error('[wechat] FATAL:', e);
  process.exit(1);
});
