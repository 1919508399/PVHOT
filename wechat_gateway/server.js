#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { WechatGateway } = require('./gateway');
const { WeReadPlatformClient } = require('./platform_client');
const { createStorage } = require('./storage');

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.PVHOT_WECHAT_GATEWAY_HOST || '127.0.0.1';
const PORT = Math.max(1, Number(process.env.PVHOT_WECHAT_GATEWAY_PORT || 4399));
const DATA_DIR = process.env.PVHOT_WECHAT_GATEWAY_DATA_DIR
  || path.join(ROOT, '.wechat-gateway-data');
const OUTPUT_PATH = process.env.PVHOT_WECHAT_GATEWAY_OUTPUT
  || path.join(ROOT, 'wechat_gateway_items.json');

const storage = createStorage({
  root: DATA_DIR,
  adminToken: process.env.PVHOT_WECHAT_GATEWAY_ADMIN_TOKEN,
  sessionKey: process.env.PVHOT_WECHAT_GATEWAY_KEY,
});
const client = new WeReadPlatformClient({
  baseUrl: process.env.PVHOT_WECHAT_PLATFORM_URL,
});
const gateway = new WechatGateway({
  storage,
  client,
  outputPath: OUTPUT_PATH,
  refreshHours: process.env.PVHOT_WECHAT_GATEWAY_REFRESH_HOURS || 6,
});

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function authorized(request) {
  const header = String(request.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sameSecret(token, storage.adminToken);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16 * 1024) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function adminPage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PVHOT 微信登录态原型</title><style>
body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#173c38;background:#f6f3eb}
.card{background:#fff;border:1px solid #ddd5c7;border-radius:16px;padding:22px;margin:16px 0}input,button{font:inherit;padding:9px 12px;border-radius:8px;border:1px solid #cfc7b8}button{cursor:pointer;background:#126b5b;color:#fff}img{display:block;max-width:280px;margin:18px auto}.muted{color:#6d7773}pre{white-space:pre-wrap;word-break:break-word}</style></head>
<body><h1>PVHOT 微信登录态网关</h1><p class="muted">仅监听本机，直拉全部具有已验证内部 ID 的公众号；其余公众号继续使用搜狗微信公开检索。</p>
<div class="card"><label>管理令牌 <input id="token" type="password" autocomplete="off"></label>
<button id="save">保存到本标签页</button> <button id="login">生成登录二维码</button><div id="qr"></div></div>
<div class="card"><button id="refresh">刷新一个到期公众号</button><button id="state">查看状态</button><pre id="out">等待操作</pre></div>
<script>
const token=document.querySelector('#token'); token.value=sessionStorage.getItem('pvhotWechatToken')||'';
const out=document.querySelector('#out'); const headers=()=>({'authorization':'Bearer '+token.value,'content-type':'application/json'});
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:headers(),body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw new Error(v.error||r.statusText);return v}
document.querySelector('#save').onclick=()=>{sessionStorage.setItem('pvhotWechatToken',token.value);out.textContent='令牌只保存在当前标签页';};
document.querySelector('#login').onclick=async()=>{try{out.textContent='正在创建登录会话…';const v=await api('/api/login/start',{});document.querySelector('#qr').innerHTML='<img alt="微信读书登录二维码" src="'+v.qrcode+'"><p>请用微信扫码并在手机确认，网页最长等待约2分钟。</p>';out.textContent='等待扫码确认…';const done=await api('/api/login/complete',{id:v.id});out.textContent=JSON.stringify(done,null,2);}catch(e){out.textContent=e.message}};
document.querySelector('#refresh').onclick=async()=>{try{out.textContent='正在刷新…';out.textContent=JSON.stringify(await api('/api/refresh',{}),null,2)}catch(e){out.textContent=e.message}};
document.querySelector('#state').onclick=async()=>{try{out.textContent=JSON.stringify(await api('/api/state'),null,2)}catch(e){out.textContent=e.message}};
</script></body></html>`;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      const body = adminPage();
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
      });
      response.end(body);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, {
        ok: true,
        provider: gateway.publicState().provider,
        accountStatus: gateway.publicState().account?.status || 'not_logged_in',
        sources: gateway.publicState().sources.length,
        experimental: true,
      });
      return;
    }
    if (!url.pathname.startsWith('/api/') || !authorized(request)) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      json(response, 200, gateway.publicState());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/feed') {
      json(response, 200, { items: gateway.state.articles });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/login/start') {
      await readJson(request);
      json(response, 200, await gateway.startLogin());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/login/complete') {
      const body = await readJson(request);
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(body.id || ''))) {
        json(response, 400, { error: 'invalid login session id' });
        return;
      }
      json(response, 200, await gateway.completeLogin(body.id));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      const body = await readJson(request);
      const result = body.mpId
        ? await gateway.refreshSource(String(body.mpId))
        : await gateway.refreshNextDue();
      json(response, 200, { refreshed: result || null, state: gateway.publicState() });
      return;
    }
    json(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(`[wechat-gateway] ${request.method} ${url.pathname}: ${error.message}`);
    json(response, 500, { error: String(error.message || error).slice(0, 240) });
  }
});

gateway.startScheduler(Number(process.env.PVHOT_WECHAT_GATEWAY_SCHEDULER_MS || 60_000));
server.listen(PORT, HOST, () => {
  console.log(`[wechat-gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[wechat-gateway] data=${storage.root}`);
  console.log(`[wechat-gateway] output=${OUTPUT_PATH}`);
  if (!process.env.PVHOT_WECHAT_GATEWAY_ADMIN_TOKEN) {
    console.log(`[wechat-gateway] admin token is stored in ${path.join(storage.root, 'admin-token')}`);
  }
});

function shutdown() {
  gateway.stopScheduler();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { authorized, readJson, sameSecret };
