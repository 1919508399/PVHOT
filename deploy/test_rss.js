const https = require('https');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function fetchRSS(q, hl) {
  const gl = (hl === 'zh-CN') ? 'CN' : 'US';
  const ceid = (hl === 'zh-CN') ? 'CN:zh-CN' : 'US:en';
  const url = 'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) + '&hl=' + hl + '&gl=' + gl + '&ceid=' + ceid;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        const items = (buf.match(/<item>[\s\S]*?<\/item>/g) || []);
        const dates = items.map(b => {
          const m = b.match(/<pubDate>(?:<!\[CDATA\[(.*?)\]\]>|([\s\S]*?))<\/pubDate>/);
          return m ? (m[1] || m[2] || '').trim() : '';
        });
        resolve({ count: items.length, dates });
      });
    });
    req.on('error', () => resolve({ count: 0, dates: [] }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ count: 0, dates: [] }); });
  });
}

const queries = [
  '光伏',
  '光伏 when:7d',
  'solar when:7d',
  'solar panel when:7d',
];

(async () => {
  for (const q of queries) {
    const r = await fetchRSS(q, 'zh-CN');
    // 统计最近 7 天内的条数
    const now = Date.now();
    const recent = r.dates.filter(d => {
      const t = new Date(d).getTime();
      return !isNaN(t) && (now - t) < 7 * 86400 * 1000;
    }).length;
    console.log(`\n=== q="${q}" ===`);
    console.log(`  总条数: ${r.count}, 近7天条数: ${recent}`);
    console.log(`  前5个pubDate: ${r.dates.slice(0,5).join(' | ')}`);
  }
})();
