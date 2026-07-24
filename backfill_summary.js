#!/usr/bin/env node
'use strict';
// backfill_summary.js v5 (v18.10) —— 参考 aihot 卡片：标题 + 多行正文 + 推荐理由
//   1) title_cn / summary_cn 跑 stripTrailingSource（去 "– ODISHA RAY" 等英文尾源）
//   2) 写 summary = buildBody（真实描述保留多句因果，最多 200 字）
//   3) 写 reason = buildReason（基于数字/机构/政策关键词模板化生成，不编造）
// 逻辑与 fetch_pv_news.js v18.10 的 stripTrailingSource / buildBody / buildReason 完全一致。
// 用法：node backfill_summary.js  （在 /var/www/pvhot 下，改 data_raw.json）

const fs = require('fs');
const path = require('path');

const ROOT = '/var/www/pvhot';
const RAW = path.join(ROOT, 'data_raw.json');

function stripTrailingSource(s) {
  if (!s) return s;
  let out = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out.replace(/[\s\-–—·|,，：:]+(?:Reuters|Bloomberg|Nikkei|Xinhua|AFP|AP|UPI|CNN|BBC|NYT|WaPo|WSJ|EUobserver|EuroNews|Engadget|TechCrunch|TheVerge|The\s?Verge)\s*\.?$/i, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z][A-Za-z]*\s?)+(?:News|Times|Asia|Report|Weekly|Daily|Journal|Post|Tribune|Herald|Standard|Gazette|Magazine|Blog)\s*\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:by|BY|By)\s+[A-Za-z0-9_\-\u4e00-\u9fff\s]{2,40}\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z]{2,}(?:\s+[A-Z]{2,}){1,3})\s*\.?$/, '').trim();
    out = out.replace(/[\s\-–—·|,，：:]+(?:[A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){1,3})\s*\.?$/, '').trim();
    const single = out.replace(/\s+[-–—|]\s*[A-Za-z][A-Za-z0-9.&\-]{1,14}\s*$/, '').trim();
    if (single !== out && single.length >= 8) out = single;
    out = out.replace(/[\s]*[\(（][^\(\)（）]{1,30}[\)）]\s*\.?$/, '').trim();
    if (out === before) break;
  }
  return out.replace(/[\s\-–—·|,，：:.]+$/, '').trim();
}

function buildBody(it) {
  let real = stripTrailingSource(((it && it.summary_cn) || '').replace(/\s+/g, ' ').trim());
  if (/^(「.+」方向|英文聚合自动译中|行业最新进展|.+ 方向 .+ 报道)/.test(real)) real = '';
  if (real.length >= 25) {
    if (real.length <= 200) return real;
    const sub = real.slice(0, 200);
    const endM = sub.search(/[。！？!?][^。！？!?]*$/);
    if (endM !== -1 && endM >= 60) return sub.slice(0, endM + 1);
    const commaM = sub.search(/[，,；;][^，,；;]*$/);
    if (commaM !== -1 && commaM >= 80) return sub.slice(0, commaM) + '…';
    return sub + '…';
  }
  const full = stripTrailingSource(((it && (it.title_cn || it.title)) || '').replace(/\s+/g, ' ').trim());
  if (!full) return '';
  const m = full.slice(8).search(/[；;：，、—–|·]/);
  if (m !== -1) {
    const rest = full.slice(8 + m + 1).trim();
    if (rest.length >= 8 && rest.length < full.length - 4) return rest;
  }
  return '';
}

const REASON_CAT_MAP = {
  '硅料': '硅料价格与产能', '硅片': '硅片供应格局', '电池片': '电池技术路线',
  '组件': '组件出货与认证', '逆变器': '逆变器产品迭代', '支架BOS': '支架与 BOS',
  '储能': '光储耦合', '电站': '电站 EPC 与招标', '行情': '市场行情与政策',
};
function buildReason(it) {
  const sum = ((it && it.summary_cn) || '').replace(/\s+/g, ' ').trim();
  const title = ((it && (it.title_cn || it.title)) || '').replace(/\s+/g, ' ').trim();
  const cat = (it && (it.cat || it.category)) || '行情';
  const text = title + ' ' + sum;
  const catCn = REASON_CAT_MAP[cat] || cat;

  const numM = text.match(/\d+(?:\.\d+)?\s*(?:%|％|GW|MW|kWh|亿|万|元|美元|\/W|美元\/W|元\/W|美元\/kWh|元\/kWh)/);
  const orgM = title.match(/[A-Z][A-Za-z&]{2,18}(?:\s[A-Z][A-Za-z&]{2,18}){0,2}/);
  const firstSent = sum ? (sum.split(/[。！？!?]/)[0] || sum).trim() : '';
  const fact = firstSent.length > 45 ? firstSent.slice(0, 45) + '…' : firstSent;

  if (numM && orgM) {
    if (fact && fact.includes(numM[0])) {
      return `数据信号明确：${fact}。${orgM[0]} 在${catCn}方向的这一量级变化，做产能规划、价格跟踪与对标分析时值得纳入参考。`;
    }
    return `数据信号明确${fact ? '：' + fact : ''}。${orgM[0]} 在${catCn}方向出现 ${numM[0]} 量级变化，做产能规划、价格跟踪与对标分析时值得纳入参考。`;
  }
  if (numM) {
    if (fact && fact.includes(numM[0])) {
      return `数据信号：${fact}。这一量级变化对${catCn}的供需节奏与价格走势有直接参考意义。`;
    }
    return `数据信号${fact ? '：' + fact : ''}。出现 ${numM[0]} 量级变化，对${catCn}的供需节奏与价格走势有直接参考意义。`;
  }
  if (orgM) {
    return `${orgM[0]} 在${catCn}方向的最新动向${fact ? '——' + fact : ''}。同环节企业可作对标，下游采购可关注其产品节奏与定价。`;
  }
  if (/政策|关税|补贴|标准|法规|监管|制裁|豁免|配额/.test(text)) {
    return `政策信号${fact ? '：' + fact : ''}。影响${catCn}的准入门槛与成本结构，建议跟踪后续细则与落地节奏。`;
  }
  if (/发布|推出|上市|量产|投产|并网|签约|中标|收购|合作/.test(text)) {
    return `${fact || '企业动作'}。属于${catCn}方向值得持续跟踪的新进展，建议关注后续产能释放与市场反应。`;
  }
  return `${fact ? fact + '。' : ''}属于${catCn}方向的新进展，建议关注后续企业动作与产业链联动效应。`;
}

/* v3b 推荐分（与 fetch_pv_news.js 完全同步） */
function computeScore(it) {
  let score = it.heat || 50;
  score += ((it._sourceCount || it.sourceCount || 1) - 1) * 12;
  const body = it.summary || it.summary_cn || '';
  if (body.length >= 25) score += 8;
  const reason = it.reason || '';
  if (/数据信号/.test(reason)) score += 6;
  if (/政策信号/.test(reason)) score += 5;
  if (/对标|跟踪|关注|参考|纳入/.test(reason)) score += 3;
  return Math.round(score);
}

function main() {
  const d = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  let strippedTitle = 0, withBody = 0, emptyBody = 0, withReason = 0, withScore = 0;
  d.items.forEach(it => {
    if (it.title_cn) {
      const t2 = stripTrailingSource(it.title_cn);
      if (t2 && t2 !== it.title_cn) { it.title_cn = t2; strippedTitle++; }
    }
    if (it.summary_cn) {
      const s2 = stripTrailingSource(it.summary_cn);
      if (s2 !== it.summary_cn) it.summary_cn = s2;
    }
    it.summary = buildBody(it);
    it.reason = buildReason(it);
    it.score = computeScore(it);
    if (it.summary) withBody++; else emptyBody++;
    if (it.reason) withReason++;
    if (it.score) withScore++;
  });
  fs.writeFileSync(RAW, JSON.stringify(d, null, 2), 'utf8');
  console.log('[backfill-v6] total=' + d.items.length + ' titleStripped=' + strippedTitle
    + ' body=' + withBody + ' emptyBody=' + emptyBody
    + ' reason=' + withReason + ' score=' + withScore);
}

main();
