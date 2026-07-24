// 本地单测 buildTitleParts（复制 backfill_summary.js 逻辑）
const src = require('fs').readFileSync('C:/Users/HUASUN/Desktop/新闻/backfill_summary.js', 'utf8');
const body = src.split('function main()')[0].replace(/^#!.*\n/, '').replace(/const fs = require.*\n/, '').replace(/const path = require.*\n/, '').replace(/const ROOT.*\n/, '').replace(/const RAW.*\n/, '');
eval(body);

const cases = [
  { title_cn: 'Genus Innovation 加强印度东部的分销网络；在布巴内斯瓦尔经销商大会上展示 Hi-FLO H 混合太阳能逆变器 – ODISHA RAY' },
  { title_cn: '三星 Galaxy Z Fold 8 硅碳电池：已确认的内容' },
  { title_cn: 'CATL签署2GWh钠离子电池存储协议' },
  { title_cn: '巴基斯坦的太阳能革命依赖于在酷热中辛勤工作的工人 - Eco' },
  { title_cn: '印第安纳波利斯国际机场安装了 10,000 多块太阳能电池板' },
  { title_cn: '免费太阳能电池板计划可以帮助您节省电费 - WBAL' },
  { title_cn: '库存小幅回落，EVA树脂价格涨势持续【SMM硅基光伏早会纪要】' },
  { title_cn: 'Elux 签署 5 GW 协议，在印度生产钙钛矿硅太阳能组件，同时扩大产能并计划 2027 年投产更多产线以满足需求' },
  { title_cn: '太阳能电池板覆盖运河' },
  { title_cn: 'SEIA 呼吁制定更严格的太阳能、存储网络安全标准', summary_cn: '美国太阳能行业协会周二发布新框架，要求太阳能与储能设备制造商在 2027 年前满足更严格的网络安全认证标准。' },
];
cases.forEach((c, i) => {
  const p = buildTitleParts(c);
  console.log('---- case', i);
  console.log('  in :', (c.title_cn || '').slice(0, 70));
  console.log('  短标题:', p.title_short);
  console.log('  总结  :', p.summary || '(空→前端不渲染)');
});
