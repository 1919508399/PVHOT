#!/usr/bin/env node
'use strict';
// InfoLink 现货价格独立抓取脚本
// 每天 7am 由 cron 触发，抓取 InfoLink 光伏+储能现货价格
// 读取现有 data_raw.json → 更新 prices 字段 → 写回 data_raw.json → 运行 merge.js
//
// 用法: node fetch_prices.js
// cron: 0 7 * * * /usr/bin/node /var/www/pvhot/fetch_prices.js

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/var/www/pvhot';
const RAW = path.join(ROOT, 'data_raw.json');
const LOG = path.join(ROOT, 'fetch.log');
const INFOLINK_PV_URL = 'https://www.infolink-group.com/spot-price/cn/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

/* ---------- 通用 URL 抓取 ---------- */
function fetchURL(url, timeout) {
  const reqTimeout = timeout || 30000;
  function tryGet(u, redirects) {
    return new Promise((resolve) => {
      if (redirects > 5) return resolve('');
      const mod = u.startsWith('https://') ? https : http;
      const req = mod.get(u, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xml,*/*',
          'Accept-Encoding': 'identity',
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          return resolve(tryGet(next, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(''); }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(buf));
      });
      req.on('error', (e) => { console.error('fetchURL error: ' + u.slice(0,60) + ' -> ' + (e.message||e)); resolve(''); });
      req.setTimeout(reqTimeout, () => { req.destroy(); resolve(''); });
    });
  }
  return tryGet(url, 0);
}

/* ---------- 去 HTML 标签 ---------- */
function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- PV 价格表 HTML 解析 ---------- */
function parsePVPricing(html) {
  const h = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const groups = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(h)) !== null) {
    const tableHtml = tm[0];
    const strongM = tableHtml.match(/<strong[^>]*class="h2"[^>]*>([\s\S]*?)<\/strong>/i);
    const smallM = tableHtml.match(/<small[^>]*>([\s\S]*?)<\/small>/i);
    const group = strongM ? stripHtml(strongM[1]).trim() : '其他';
    const unit = smallM ? stripHtml(smallM[1]).trim().replace(/[（）()]/g, '') : '';
    const items = [];
    const trRe = /<tr[\s\S]*?(?=<tr|<\/table)/gi;
    let rm;
    while ((rm = trRe.exec(tableHtml)) !== null) {
      const row = rm[0];
      if (/<th[\s>]/i.test(row) && !/<td[\s>]/i.test(row)) continue;
      const cells = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = tdRe.exec(row)) !== null) {
        cells.push(stripHtml(cm[1]).trim());
      }
      if (cells.length < 4) continue;
      const name = cells[0];
      if (!name || name.length < 3) continue;
      if (cells.some(c => c.includes('🔒'))) continue;
      if (!cells.slice(1, 4).some(c => /\d/.test(c))) continue;
      items.push({
        name: name,
        high: cells[1] || '-',
        low: cells[2] || '-',
        avg: cells[3] || '-',
        changePct: cells[4] || '-',
        changeUsd: cells[5] || '-',
      });
    }
    if (items.length > 0) {
      groups.push({ group, unit, items });
    }
  }
  return groups;
}

/* ---------- 储能价格文章解析 ---------- */
function parseESSPricing(html) {
  const h = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const text = stripHtml(h).replace(/\s+/g, ' ').trim();
  const groups = [];

  // 1. 锂矿/锂盐
  const liGroup = { group: '锂矿/锂盐', items: [] };
  const liCarbM = text.match(/碳酸锂现货价格区间为每公吨\s*([\d.]+)-([\d.]+)\s*万元，均价约\s*([\d.]+)\s*万元，环比(下跌|上涨|持平)\s*([\d.]+%|)/);
  if (liCarbM) {
    liGroup.items.push({
      name: '电池级碳酸锂（现货）',
      priceRange: liCarbM[1] + '-' + liCarbM[2] + ' 万元/吨',
      avg: liCarbM[3] + ' 万元/吨',
      change: liCarbM[4] + (liCarbM[5] || ''),
    });
  }
  const spoM = text.match(/锂辉石精矿[（(]SC6[，,]\s*CIF[)）]价格区间为每公吨\s*([\d,]+)-([\d,]+)\s*美元，均价\s*([\d,]+)\s*美元，环比(下跌|上涨|持平)\s*([\d.]+%|)/);
  if (spoM) {
    liGroup.items.push({
      name: '锂辉石精矿（SC6, CIF）',
      priceRange: spoM[1] + '-' + spoM[2] + ' 美元/吨',
      avg: spoM[3] + ' 美元/吨',
      change: spoM[4] + (spoM[5] || ''),
    });
  }
  if (liGroup.items.length > 0) groups.push(liGroup);

  // 2. 储能电芯
  const cellGroup = { group: '储能电芯', items: [] };
  const cellRe = /(\d+)\s*Ah\s*产品价格区间为每瓦时\s*([\d.]+)-([\d.]+)\s*元，均价每瓦时\s*([\d.]+)\s*元，环比(下跌|上涨|持平)\s*([\d.]+%|)/g;
  let cm;
  while ((cm = cellRe.exec(text)) !== null) {
    cellGroup.items.push({
      name: cm[1] + ' Ah LFP储能电芯',
      priceRange: cm[2] + '-' + cm[3] + ' 元/Wh',
      avg: cm[4] + ' 元/Wh',
      change: cm[5] + (cm[6] || ''),
    });
  }
  if (cellGroup.items.length > 0) groups.push(cellGroup);

  // 3. 储能系统
  const sysGroup = { group: '储能系统', items: [] };
  const sysRe = /(直流侧|交流侧)\s*(\d+h)\s*液冷集装箱价格区间为每瓦时\s*([\d.]+)-([\d.]+)\s*元，均价每瓦时\s*([\d.]+)\s*元，环比(下跌|上涨|持平)\s*([\d.]+%|)/g;
  let sm;
  while ((sm = sysRe.exec(text)) !== null) {
    sysGroup.items.push({
      name: sm[1] + sm[2] + ' 液冷集装箱',
      priceRange: sm[3] + '-' + sm[4] + ' 元/Wh',
      avg: sm[5] + ' 元/Wh',
      change: sm[6] + (sm[7] || ''),
    });
  }
  if (sysGroup.items.length > 0) groups.push(sysGroup);

  return groups;
}

/* ---------- InfoLink 现货价格抓取（光伏 + 储能） ---------- */
async function fetchInfolinkPrices() {
  const prices = { updated: new Date().toISOString(), pv: [], storage: [], source: 'InfoLink Consulting' };

  // 1. 光伏现货价格表
  try {
    const html = await fetchURL(INFOLINK_PV_URL, 30000);
    if (html) {
      prices.pv = parsePVPricing(html);
      const dateM = html.match(/<div class="date[^"]*">([^<]+)<\/div>/i);
      if (dateM) prices.pvDate = dateM[1].trim();
    }
  } catch (e) { log('ERR [infolink] PV price: ' + e.message); }

  // 2. 储能现货价格（中文文章）
  try {
    const homeHtml = await fetchURL('https://www.infolink-group.com/', 20000);
    if (homeHtml) {
      const essLinks = [];
      const linkRe = /href="[^"]*energy-article\/(?:cn\/)?ess-spot-price-(\d{8})"/g;
      let lm;
      while ((lm = linkRe.exec(homeHtml)) !== null) {
        essLinks.push(lm[1]);
      }
      if (essLinks.length > 0) {
        essLinks.sort((a, b) => b.localeCompare(a));
        const latestDate = essLinks[0];
        const essUrl = 'https://www.infolink-group.com/energy-article/cn/ess-spot-price-' + latestDate;
        const essHtml = await fetchURL(essUrl, 20000);
        if (essHtml) {
          prices.storage = parseESSPricing(essHtml);
          prices.essDate = latestDate.slice(0, 4) + '-' + latestDate.slice(4, 6) + '-' + latestDate.slice(6, 8);
        }
      }
    }
  } catch (e) { log('ERR [infolink] ESS price: ' + e.message); }

  return prices;
}

/* ---------- 主流程 ---------- */
async function main() {
  log('START fetch_prices.js (InfoLink spot prices, daily 7am)');

  // 1. 抓取 InfoLink 价格
  const prices = await fetchInfolinkPrices();
  log('OK prices: PV groups=' + (prices.pv ? prices.pv.length : 0) +
      ', storage groups=' + (prices.storage ? prices.storage.length : 0));

  if ((!prices.pv || prices.pv.length === 0) && (!prices.storage || prices.storage.length === 0)) {
    log('WARN no prices fetched, keeping existing data');
    return;
  }

  // 2. 读取现有 data_raw.json，更新 prices 字段
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  } catch (e) {
    log('WARN cannot read data_raw.json: ' + e.message + ' (will create minimal structure)');
    raw = { meta: {}, categories: [], items: [] };
  }

  raw.prices = prices;

  // 3. 写回 data_raw.json
  fs.writeFileSync(RAW, JSON.stringify(raw, null, 2), 'utf8');
  log('OK updated prices in data_raw.json');

  // 4. 运行 merge.js 重新生成 data.json + data_fallback.js
  try {
    execSync('node ' + path.join(ROOT, 'merge.js'), { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
    log('OK merge.js completed (data.json + data_fallback.js updated with prices)');
  } catch (e) {
    log('ERR merge.js: ' + e.message);
  }
}

main().catch((e) => {
  log('FATAL fetch_prices.js: ' + (e && e.stack || e));
  process.exit(1);
});
