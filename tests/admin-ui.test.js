'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('admin server did not start')), 5000);
    const onData = (chunk) => {
      if (!String(chunk).includes('Pvhot admin')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.once('error', reject);
    child.stdout.on('data', onData);
  });
}

function panelMarkup(html, id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf(`id="${nextId}"`, start + 1);
  assert.ok(start >= 0 && end > start, `missing ${id} panel`);
  return html.slice(start, end);
}

test('three core admin views use friendly labels and hide raw technical details', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const stats = panelMarkup(html, 'panelStats', 'panelContent');
  const content = panelMarkup(html, 'panelContent', 'panelFeedback');
  const feedback = panelMarkup(html, 'panelFeedback', 'editMask');
  const ai = panelMarkup(html, 'panelAi', 'panelStats');

  assert.doesNotMatch(html, /<span class="nav-icon">[DCF]<\/span>/);
  assert.match(html, /data-tab="stats"[\s\S]*?<svg[\s\S]*?<span>运行概览<\/span>/);
  assert.match(html, /data-tab="content"[\s\S]*?<span>页面内容<\/span>/);
  assert.match(html, /data-tab="feedback"[\s\S]*?<span>反馈收件箱<\/span>/);
  assert.match(html, /data-tab="ai"[\s\S]*?<span>AI 编辑<\/span>/);

  assert.match(ai, /AI 编辑与事件聚类/);
  assert.match(ai, /测试连接/);
  assert.match(ai, /每日最多处理/);
  assert.match(ai, /id="aiApiKey"[^>]*type="password"/);
  assert.match(ai, /API Key 只保存在服务器/);

  assert.match(stats, /今日浏览次数/);
  assert.match(stats, /总访问用户数/);
  assert.match(stats, /id="sTotalUV"/);
  assert.doesNotMatch(stats, /站内资讯|id="sContentTotal"/);
  assert.match(stats, /访客从哪里来/);
  assert.doesNotMatch(stats, /\(PV\)|\(UV\)|data_raw\.json|data\.json|fetch\.log|RSSHub|Heap/);

  assert.match(content, /无需接触代码/);
  assert.match(content, /接入配置由系统安全维护/);
  assert.match(content, /data-content-tab="about"/);
  assert.doesNotMatch(content, /SKILL\.md|&lt;span|eyebrow 小字|title_html 标题|sub_html 副标题|fineprint_html 底部/);

  assert.match(feedback, /反馈收件箱/);
  assert.match(feedback, /搜索反馈内容或联系邮箱/);
  assert.doesNotMatch(feedback, /UA：|IP：|用户代理|原始编号/);

  assert.match(html, /function cleanDisplayText/);
  assert.match(html, /if \(bad >= 1/);
  assert.match(html, /标题编码异常，已隐藏/);
  assert.match(html, /信源名称编码异常/);
  assert.match(html, /X 无 Token 间接监控已启用/);
  assert.match(html, /X 间接监控/);
  assert.match(html, /skill_md:\s*\(TEXTS_DATA/);
  assert.doesNotMatch(html, /\$\{esc\(it\.id\)\}<\/span>/);
  assert.doesNotMatch(html, /UA：\$\{esc\(it\.ua/);

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /const looksLikeBrokenEncoding =/);
  assert.match(app, /sanitizePublicPayload\(data\)/);
  assert.match(app, /TEXTS = sanitizePublicPayload/);
  assert.match(app, /const safeRichText =/);
  assert.match(app, /const safePublicHttpsUrl =/);
  assert.match(app, /const safeHref = value =>/);
  assert.doesNotMatch(app, /href="\$\{esc\((?:it|item)\.link/);
  assert.match(app, /safeRichText\(a\.title_html\)/);
  assert.match(app, /<pre id="agtVerify">\$\{esc\(verifyQ\)\}<\/pre>/);
  assert.match(app, /const editorialReason = state\.view === "featured" && featured \? reasonHTML\(it\) : '';/);
  assert.match(app, /document\.body\.dataset\.view = state\.view/);
  assert.match(app, /if \(sum\.length > 440\)/);
  assert.match(app, /sourceInfo && it\.sourceInfo\.displayName/);
  assert.match(app, /另有 \$\{additionalSources\} 家信源报道/);
  assert.doesNotMatch(app, /\$\{impactHTML\(it\)\}/);
  assert.doesNotMatch(app, /\$\{relatedHTML\}/);

  assert.match(html, /return \{ ok: r\.ok, status: r\.status, data, headers:r\.headers \}/);
  assert.match(html, /headers\['X-CSRF-Token'\] = csrfToken/);
  assert.match(html, /csrfToken = String\(r\.data\.csrfToken \|\| r\.headers\.get/);

  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /body\[data-view="featured"\][\s\S]*--content-w: min\(1600px, 100%\)/);
  assert.match(css, /body\[data-view="all"\] \.tl-body[\s\S]*max-width: none/);
});

test('admin request body keeps Chinese text intact when UTF-8 bytes arrive in separate chunks', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-admin-utf8-'));
  const port = await reservePort();
  const password = '管理密码甲';
  fs.writeFileSync(path.join(sandbox, 'data.json'), JSON.stringify({ categories:[], items:[
    {
      id:'featured-news', title:'Featured news', summary:'Summary', featured:true,
      source:'PV Tech', sourceDisplayName:'PV Tech（RSS）', reason:'Featured-only reason',
      recommendationReason:'Featured-only reason', pubDate:'2026-08-11T08:00:00+08:00',
    },
    {
      id:'regular-news', title:'Regular news', summary:'Summary', featured:false,
      source:'Solar Power World', sourceDisplayName:'Solar Power World（RSS）', reason:'Must stay hidden',
      pubDate:'2026-08-11T07:00:00+08:00',
    },
  ] }));
  fs.writeFileSync(path.join(sandbox, 'admin.html'), '<!doctype html><title>admin</title>');
  fs.writeFileSync(path.join(sandbox, 'site_texts.json'), JSON.stringify({ about:{}, agent:{}, changelog:{ items:[] } }));
  fs.mkdirSync(path.join(sandbox, 'pvhot-skill'), { recursive:true });
  fs.writeFileSync(path.join(sandbox, 'pvhot-skill', 'SKILL.md'), '# test skill\n');

  const child = spawn(process.execPath, [path.join(ROOT, 'admin_server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PVHOT_ROOT: sandbox,
      PVHOT_ADMIN_HOST: '127.0.0.1',
      PVHOT_ADMIN_PORT: String(port),
      PVHOT_ADMIN_PASSWORD_HASH: crypto.createHash('sha256').update(password).digest('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(sandbox, { recursive:true, force:true });
  });
  await waitForReady(child);

  const allNews = await fetch(`http://127.0.0.1:${port}/api/v1/news`).then((response) => response.json());
  assert.equal(allNews.items.every((item) => item.reason === ''), true);
  assert.equal(allNews.items[0].sourceDisplayName, 'PV Tech（RSS）');
  const featuredNews = await fetch(`http://127.0.0.1:${port}/api/v1/news?featured=true`).then((response) => response.json());
  assert.equal(featuredNews.items.length, 1);
  assert.equal(featuredNews.items[0].reason, 'Featured-only reason');

  const payload = Buffer.from(JSON.stringify({ pass:password }), 'utf8');
  const chineseStart = payload.indexOf(Buffer.from('管', 'utf8'));
  assert.ok(chineseStart >= 0);
  const splitAt = chineseStart + 1;

  const result = await new Promise((resolve, reject) => {
    const request = http.request({
      host:'127.0.0.1', port, path:'/admin/api/login', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':payload.length },
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status:response.statusCode, headers:response.headers, body:Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.write(payload.subarray(0, splitAt));
    setTimeout(() => request.end(payload.subarray(splitAt)), 15);
  });

  assert.equal(result.status, 200);
  const loginBody = JSON.parse(result.body);
  assert.equal(loginBody.ok, true);
  assert.match(loginBody.csrfToken, /^[A-Za-z0-9_-]{40,}$/);
  const cookie = String(result.headers['set-cookie']).split(';')[0];
  const baseUrl = `http://127.0.0.1:${port}`;
  const mutationHeaders = {
    'Content-Type':'application/json', Cookie:cookie, Origin:baseUrl,
    'Sec-Fetch-Site':'same-origin', 'X-CSRF-Token':loginBody.csrfToken,
  };

  const missingCsrf = await fetch(`${baseUrl}/admin/api/texts/about`, {
    method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookie, Origin:baseUrl, 'Sec-Fetch-Site':'same-origin' },
    body:JSON.stringify({ value:{} }),
  });
  assert.equal(missingCsrf.status, 403);
  const crossOrigin = await fetch(`${baseUrl}/admin/api/texts/about`, {
    method:'PUT', headers:{ ...mutationHeaders, Origin:'https://attacker.example' },
    body:JSON.stringify({ value:{} }),
  });
  assert.equal(crossOrigin.status, 403);
  const crossSiteMetadata = await fetch(`${baseUrl}/admin/api/texts/about`, {
    method:'PUT', headers:{ ...mutationHeaders, 'Sec-Fetch-Site':'cross-site' },
    body:JSON.stringify({ value:{} }),
  });
  assert.equal(crossSiteMetadata.status, 403);

  for (const link of ['javascript:alert(1)', 'http://example.com/story', 'https://127.0.0.1/private']) {
    const unsafeLink = await fetch(`${baseUrl}/admin/api/items`, {
      method:'POST', headers:mutationHeaders,
      body:JSON.stringify({ title_cn:'unsafe link', link }),
    });
    assert.equal(unsafeLink.status, 400);
  }
  const safeManualItem = await fetch(`${baseUrl}/admin/api/items`, {
    method:'POST', headers:mutationHeaders,
    body:JSON.stringify({ title_cn:'safe link', link:'https://Example.com:443/story#section' }),
  });
  assert.equal(safeManualItem.status, 200);
  const safeManualBody = await safeManualItem.json();
  assert.equal(safeManualBody.item.link, 'https://example.com/story');
  const unsafeManualUpdate = await fetch(`${baseUrl}/admin/api/items/featured-news`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ link:'javascript:alert(2)' }),
  });
  assert.equal(unsafeManualUpdate.status, 400);

  const unsafeSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/about`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ value:{
      eyebrow:'关于', title_html:'<script>alert(1)</script>', sub:'简介', poem:['第一行'], fineprint_html:'说明',
    } }),
  });
  assert.equal(unsafeSave.status, 400);

  const brokenEncodingSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/about`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ value:{
      eyebrow:'关于', title_html:'异常' + String.fromCharCode(0xFFFD) + '标题', sub:'简介', poem:['第一行'], fineprint_html:'说明',
    } }),
  });
  assert.equal(brokenEncodingSave.status, 400);

  const brokenFeedback = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ msg:'页面出现异常' + String.fromCharCode(0xFFFD) + '字符' }),
  });
  assert.equal(brokenFeedback.status, 400);

  const safeValue = {
    eyebrow:'关于这个站', title_html:'专业的 <span class="abt-emerald">光伏情报</span>',
    sub:'让行业信息更清楚。', poem:['每天整理重要动态。'], fineprint_html:'内容来自公开信源。',
  };
  const safeSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/about`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ value:safeValue }),
  });
  assert.equal(safeSave.status, 200);
  const savedTexts = JSON.parse(fs.readFileSync(path.join(sandbox, 'site_texts.json'), 'utf8'));
  assert.deepEqual(savedTexts.about, safeValue);

  const announcementValue = {
    title:'本周行业公告',
    body:'精选页会优先展示这条重要提醒。',
  };
  const announcementSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/announcement`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ value:announcementValue }),
  });
  assert.equal(announcementSave.status, 200);
  const withAnnouncement = JSON.parse(fs.readFileSync(path.join(sandbox, 'site_texts.json'), 'utf8'));
  assert.deepEqual(withAnnouncement.announcement, announcementValue);

  const announcementClear = await fetch(`http://127.0.0.1:${port}/admin/api/texts/announcement`, {
    method:'PUT', headers:mutationHeaders,
    body:JSON.stringify({ value:{ title:'', body:'' } }),
  });
  assert.equal(announcementClear.status, 200);
  const clearedTexts = JSON.parse(fs.readFileSync(path.join(sandbox, 'site_texts.json'), 'utf8'));
  assert.deepEqual(clearedTexts.announcement, { title:'', body:'' });
});
