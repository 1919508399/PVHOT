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

  assert.doesNotMatch(html, /<span class="nav-icon">[DCF]<\/span>/);
  assert.match(html, /data-tab="stats"[\s\S]*?<svg[\s\S]*?<span>运行概览<\/span>/);
  assert.match(html, /data-tab="content"[\s\S]*?<span>页面内容<\/span>/);
  assert.match(html, /data-tab="feedback"[\s\S]*?<span>反馈收件箱<\/span>/);

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
  assert.match(app, /safeRichText\(a\.title_html\)/);
  assert.match(app, /<pre id="agtVerify">\$\{esc\(verifyQ\)\}<\/pre>/);
});

test('admin request body keeps Chinese text intact when UTF-8 bytes arrive in separate chunks', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-admin-utf8-'));
  const port = await reservePort();
  const password = '管理密码甲';
  fs.writeFileSync(path.join(sandbox, 'data.json'), JSON.stringify({ categories:[], items:[] }));
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
  assert.deepEqual(JSON.parse(result.body), { ok:true });
  const cookie = String(result.headers['set-cookie']).split(';')[0];

  const unsafeSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/about`, {
    method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookie },
    body:JSON.stringify({ value:{
      eyebrow:'关于', title_html:'<script>alert(1)</script>', sub:'简介', poem:['第一行'], fineprint_html:'说明',
    } }),
  });
  assert.equal(unsafeSave.status, 400);

  const brokenEncodingSave = await fetch(`http://127.0.0.1:${port}/admin/api/texts/about`, {
    method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookie },
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
    method:'PUT', headers:{ 'Content-Type':'application/json', Cookie:cookie },
    body:JSON.stringify({ value:safeValue }),
  });
  assert.equal(safeSave.status, 200);
  const savedTexts = JSON.parse(fs.readFileSync(path.join(sandbox, 'site_texts.json'), 'utf8'));
  assert.deepEqual(savedTexts.about, safeValue);
});
