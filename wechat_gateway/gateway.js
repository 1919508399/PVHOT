'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const QRCode = require('qrcode');
const { atomicWriteJsonSync } = require('../lib/safe_io');
const { PROTOTYPE_SOURCES } = require('./prototype_sources');
const { decryptText, encryptText } = require('./storage');

function isoFromSeconds(value) {
  const date = new Date(Number(value || 0) * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function articleLink(id) {
  return `https://mp.weixin.qq.com/s/${encodeURIComponent(String(id || ''))}`;
}

function normalizeArticle(raw, source) {
  const link = articleLink(raw.id);
  return {
    id: `pv${crypto.createHash('sha1').update(link).digest('hex').slice(0, 14)}`,
    title: String(raw.title || '').trim(),
    title_cn: String(raw.title || '').trim(),
    link,
    summary: '',
    summary_cn: '',
    reason: '',
    category: 'ALL',
    lang: 'zh',
    pubDate: isoFromSeconds(raw.publishTime),
    source: 'wechat',
    account: source.name,
    sources: [{ name: source.name, source: 'wechat', link, avatar: String(raw.picUrl || '') }],
    sourceCount: 1,
    heat: source.tier === 1 ? 55 : 48,
    tags: [],
    score: source.tier === 1 ? 55 : 48,
    avatar: String(raw.picUrl || ''),
    _sourceChannelId: `wechat:${source.name}`,
    _sourceChannelType: 'wechat',
    _sourceMode: 'weread-session-prototype',
  };
}

function initialState() {
  return {
    version: 1,
    provider: 'weread-bridge-experimental',
    account: null,
    sources: PROTOTYPE_SOURCES.map((source) => ({
      ...source,
      status: 'waiting_for_login',
      lastPolledAt: '',
      lastSuccessAt: '',
      nextRefreshAt: '',
      error: '',
    })),
    articles: [],
    updatedAt: new Date(0).toISOString(),
  };
}

class WechatGateway {
  constructor(options) {
    this.storage = options.storage;
    this.client = options.client;
    this.outputPath = path.resolve(options.outputPath);
    this.refreshHours = Math.max(1, Number(options.refreshHours || 6));
    this.state = this.storage.loadState(initialState());
    this.refreshing = false;
    this.scheduler = null;
    this.persist();
  }

  persist() {
    this.state.updatedAt = new Date().toISOString();
    this.storage.saveState(this.state);
    this.writeOutput();
  }

  publicState() {
    return {
      provider: this.state.provider,
      account: this.state.account ? {
        id: this.state.account.id,
        name: this.state.account.name,
        status: this.state.account.status,
        lastLoginAt: this.state.account.lastLoginAt,
      } : null,
      sources: this.state.sources,
      articleCount: this.state.articles.length,
      updatedAt: this.state.updatedAt,
    };
  }

  activeAccount() {
    if (!this.state.account?.tokenEncrypted || this.state.account.status !== 'active') return null;
    return {
      id: this.state.account.id,
      name: this.state.account.name,
      token: decryptText(this.state.account.tokenEncrypted, this.storage.sessionKey),
    };
  }

  async startLogin() {
    const session = await this.client.createLoginSession();
    if (!session?.uuid || !session?.scanUrl) throw new Error('login bridge returned an incomplete session');
    return {
      id: session.uuid,
      scanUrl: session.scanUrl,
      qrcode: await QRCode.toDataURL(session.scanUrl, { errorCorrectionLevel: 'M', margin: 1, width: 280 }),
    };
  }

  async completeLogin(id) {
    const result = await this.client.waitForLogin(id);
    if (!result?.vid || !result?.token) return { complete: false, message: result?.message || '等待扫码确认' };
    this.state.account = {
      id: String(result.vid),
      name: String(result.username || '微信读书账号'),
      tokenEncrypted: encryptText(result.token, this.storage.sessionKey),
      status: 'active',
      lastLoginAt: new Date().toISOString(),
    };
    this.state.sources = this.state.sources.map((source) => ({
      ...source,
      status: 'pending',
      nextRefreshAt: new Date(0).toISOString(),
      error: '',
    }));
    this.persist();
    return { complete: true, account: this.publicState().account };
  }

  classifyError(error) {
    const text = `${error.code || ''} ${error.message || ''}`;
    if (/401/.test(text)) return { status: 'session_invalid', delayHours: 24 };
    if (/429/.test(text)) return { status: 'rate_limited', delayHours: 6 };
    if (/400/.test(text)) return { status: 'risk_control', delayHours: 6 };
    return { status: 'error', delayHours: 2 };
  }

  async refreshSource(mpId) {
    const account = this.activeAccount();
    if (!account) throw new Error('微信读书账号尚未登录或会话已失效');
    const index = this.state.sources.findIndex((source) => source.mpId === String(mpId));
    if (index < 0) throw new Error('unknown prototype source');
    const source = this.state.sources[index];
    const now = new Date();
    source.lastPolledAt = now.toISOString();
    try {
      const rows = await this.client.getArticles(source.mpId, account, 1);
      if (!Array.isArray(rows)) throw new Error('article response is not an array');
      const incoming = rows.filter((row) => row?.id && row?.title).map((row) => normalizeArticle(row, source));
      const byId = new Map(this.state.articles.map((item) => [item.id, item]));
      for (const item of incoming) byId.set(item.id, item);
      this.state.articles = [...byId.values()]
        .sort((left, right) => Date.parse(right.pubDate) - Date.parse(left.pubDate))
        .slice(0, 250);
      source.status = incoming.length ? 'ok' : 'no_new_items';
      source.lastSuccessAt = now.toISOString();
      source.nextRefreshAt = new Date(now.getTime() + this.refreshHours * 3600_000).toISOString();
      source.error = '';
    } catch (error) {
      const classified = this.classifyError(error);
      source.status = classified.status;
      source.nextRefreshAt = new Date(now.getTime() + classified.delayHours * 3600_000).toISOString();
      source.error = String(error.message || error).slice(0, 240);
      if (classified.status === 'session_invalid') this.state.account.status = 'invalid';
      throw error;
    } finally {
      this.state.sources[index] = source;
      this.persist();
    }
    return source;
  }

  async refreshNextDue() {
    if (this.refreshing || !this.activeAccount()) return null;
    const now = Date.now();
    const source = this.state.sources.find((candidate) => !candidate.nextRefreshAt || Date.parse(candidate.nextRefreshAt) <= now);
    if (!source) return null;
    this.refreshing = true;
    try { return await this.refreshSource(source.mpId); }
    finally { this.refreshing = false; }
  }

  startScheduler(intervalMs = 60_000) {
    if (this.scheduler) return;
    const tick = () => this.refreshNextDue().catch((error) => {
      console.error(`[wechat-gateway] refresh failed: ${error.message}`);
    });
    this.scheduler = setInterval(tick, Math.max(30_000, intervalMs));
    this.scheduler.unref();
    setTimeout(tick, 1_000).unref();
  }

  stopScheduler() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  writeOutput() {
    const health = this.state.sources.map((source) => ({
      id: `account:${source.name}`,
      name: source.name,
      kind: source.kind,
      tier: source.tier,
      status: source.status,
      lastPolledAt: source.lastPolledAt,
      lastSuccessAt: source.lastSuccessAt,
      nextRefreshAt: source.nextRefreshAt,
      error: source.error,
      mode: 'weread-session-prototype',
    }));
    const output = {
      fetchedAt: this.state.updatedAt,
      provider: this.state.provider,
      experimental: true,
      monitoredAccounts: this.state.sources.length,
      health,
      count: this.state.articles.length,
      items: this.state.articles,
    };
    atomicWriteJsonSync(this.outputPath, output, {
      space: 2,
      validate: (value) => value && Array.isArray(value.items) && value.count === value.items.length,
    });
  }
}

module.exports = { WechatGateway, initialState, normalizeArticle };
