#!/usr/bin/env node
'use strict';
// 合并层：data_raw.json（抓取原始库）+ admin_edits.json（后台改动） -> data.json + data_fallback.js
// 后台改动包含：deleted[] 删除、overrides{id->{字段}} 覆盖、added[] 手动添加
// 这样 hourly 自动抓取只刷新 data_raw.json，后台编辑持久保留、不被覆盖。
const fs = require('fs');
const path = require('path');
const { atomicWriteJsonSync, atomicWriteUtf8Sync } = require('./lib/safe_io');
const { withProcessLockSync } = require('./lib/process_lock');

const ROOT = process.env.PVHOT_ROOT || '/var/www/pvhot';
const RAW = path.join(ROOT, 'data_raw.json');
const EDITS = path.join(ROOT, 'admin_edits.json');
const OUT = path.join(ROOT, 'data.json');
const FALLBACK = path.join(ROOT, 'data_fallback.js');
const BOOTSTRAP = path.join(ROOT, 'data_bootstrap.json');
const DATA_LOCK_OPTIONS = {
  root: ROOT,
  name: 'pvhot-data-write',
  timeoutMs: Number(process.env.PVHOT_DATA_LOCK_TIMEOUT_MS || 60_000),
  staleMs: Number(process.env.PVHOT_DATA_LOCK_STALE_MS || 15 * 60_000),
};

function load(jp, def) {
  try { return JSON.parse(fs.readFileSync(jp, 'utf8')); } catch (e) { return def; }
}

function isMojibake(value) {
  const text = String(value || '');
  if (!text) return false;
  const replacements = (text.match(/\uFFFD/g) || []).length;
  return replacements >= 2
    || replacements / text.length > 0.015
    || /(?:锟斤拷|烫烫烫|屯屯屯|Ã.|Â.|â€|ï¿½){2,}/.test(text);
}

function sanitizeItem(item) {
  const out = { ...(item || {}) };
  const titleCandidates = [out.title_cn, out.title_short, out.title].filter((value) => value && !isMojibake(value));
  const title = String(titleCandidates[0] || '光伏行业动态').trim();
  const source = isMojibake(out.source) ? '行业信源' : String(out.source || '行业信源').trim();
  const category = String(out.category || out.cat || '光伏行业').trim();
  const summaryBroken = isMojibake(out.summary) || isMojibake(out.summary_cn);

  ['title', 'title_cn', 'title_short', 'author', 'source'].forEach((key) => {
    if (isMojibake(out[key])) out[key] = '';
  });

  if (summaryBroken) {
    const summary = `据${source}报道，${title.replace(/[。！？!?]+$/, '')}。现有公开信息显示，该事件涉及${category}领域，建议继续关注企业后续安排与官方披露。`;
    out.summary = summary;
    out.summary_cn = summary;
    out.summaryMode = 'headline';
  }
  if (isMojibake(out.reason)) {
    out.reason = `该事件涉及${category}方向的经营与产能变化，建议关注后续企业动作及产业链影响。`;
  }
  return out;
}

function buildBootstrap(out, targetCount = 36) {
  const allItems = Array.isArray(out.items) ? out.items : [];
  const newestDate = allItems
    .map((item) => item.dateKey || String(item.pubDate || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop();
  const today = out.meta?.date || newestDate || '';
  const picked = [];
  const ids = new Set();
  const add = (item) => {
    if (!item || ids.has(item.id)) return;
    ids.add(item.id);
    picked.push(item);
  };

  // 首屏完整保留当天新闻；极端高产日优先精选与高分事件，避免轻量包失控。
  const todayItems = allItems.filter((item) =>
    (item.dateKey || String(item.pubDate || '').slice(0, 10)) === today
  );
  todayItems
    .slice()
    .sort((a, b) =>
      Number(Boolean(b.featured)) - Number(Boolean(a.featured))
      || (Number(b.score) || 0) - (Number(a.score) || 0)
      || String(b.pubDate || '').localeCompare(String(a.pubDate || ''))
    )
    .slice(0, Math.max(targetCount, 48))
    .forEach(add);

  // 当天不足时补入最近动态，使“全部动态”切换后也不会出现空白。
  allItems.slice(0, targetCount).forEach(add);

  const sourceNames = new Set();
  allItems.forEach((item) => {
    const sources = Array.isArray(item.sources) && item.sources.length ? item.sources : [item.source];
    sources.forEach((source) => {
      const name = String(source?.name || source || '').trim();
      if (name) sourceNames.add(name);
    });
  });

  return {
    meta: {
      ...(out.meta || {}),
      bootstrap: true,
      totalItems: allItems.length,
      totalSources: sourceNames.size,
      bootstrapItems: picked.length,
    },
    categories: out.categories || [],
    items: picked,
    prices: out.prices || null,
  };
}

function isDataset(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray(value.items)
    && Array.isArray(value.categories);
}

function mergeUnlocked() {
  const raw = load(RAW, null);
  if (!raw || !Array.isArray(raw.items)) {
    console.error('[merge] no data_raw.json, abort');
    return false;
  }
  const edits = load(EDITS, { deleted: [], overrides: {}, added: [] });
  const deleted = new Set(edits.deleted || []);
  const overrides = edits.overrides || {};

  // 1) 原始条目：过滤已删 + 应用 override 覆盖
  let items = raw.items
    .filter(it => it && !deleted.has(it.id))
    .map(it => {
      const ov = overrides[it.id];
      return sanitizeItem(ov ? Object.assign({}, it, ov) : it);
    });

  // 2) 追加手动添加（id 在添加时已生成，这里原样并入；同样按 deleted 过滤
  const added = (Array.isArray(edits.added) ? edits.added : [])
    .filter((it) => it && !deleted.has(it.id))
    .map(sanitizeItem);
  items = items.concat(added);

  // 3) 按时间倒序
  items.sort((a, b) => {
    const ta = new Date(a.pubDate).getTime() || 0;
    const tb = new Date(b.pubDate).getTime() || 0;
    return tb - ta;
  });

  const out = { meta: raw.meta, categories: raw.categories, items, prices: raw.prices || null };
  const bootstrap = buildBootstrap(out);
  // 生产数据使用紧凑 JSON，减少手机端下载体积和 JSON 解析时间。
  atomicWriteJsonSync(OUT, out, { validate: isDataset });
  atomicWriteJsonSync(BOOTSTRAP, bootstrap, { validate: isDataset });
  atomicWriteUtf8Sync(
    FALLBACK,
    '/* auto-generated by merge.js · file:// 兜底数据 */\n' +
    'window.__PV_FALLBACK_DATA = ' + JSON.stringify(out) + ';\n'
  );
  console.log(
    '[merge] wrote ' + items.length + ' items -> data.json; '
    + bootstrap.items.length + ' items -> data_bootstrap.json (+data_fallback.js)'
  );
  return true;
}

function merge() {
  return withProcessLockSync(DATA_LOCK_OPTIONS, mergeUnlocked);
}

if (require.main === module) {
  try {
    if (!merge()) process.exit(1);
  } catch (e) {
    console.error('[merge] FATAL', e && e.stack || e);
    process.exit(1);
  }
}

module.exports = { merge, buildBootstrap, sanitizeItem, isMojibake };
