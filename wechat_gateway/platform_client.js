'use strict';

class PlatformError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PlatformError';
    this.status = Number(options.status || 0);
    this.code = options.code || '';
  }
}

class WeReadPlatformClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://weread.111965.xyz').replace(/\/$/, '');
    this.agentUrl = String(options.agentUrl || 'https://i.weread.qq.com/api/agent/gateway');
    this.skillVersion = String(options.skillVersion || '1.0.4');
    this.timeoutMs = Number(options.timeoutMs || 20_000);
  }

  async request(pathname, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || this.timeoutMs));
    try {
      const response = await fetch(`${this.baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        const message = data?.message || data?.error || `platform returned HTTP ${response.status}`;
        const code = /WeReadError\d+/.exec(message)?.[0] || '';
        throw new PlatformError(message, { status: response.status, code });
      }
      if (data === null) throw new PlatformError('platform returned invalid JSON', { status: response.status });
      return data;
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      if (error.name === 'AbortError') throw new PlatformError('platform request timed out', { code: 'TIMEOUT' });
      throw new PlatformError(`platform request failed: ${error.message}`, { code: 'NETWORK' });
    } finally {
      clearTimeout(timeout);
    }
  }

  createLoginSession() {
    return this.request('/api/v2/login/platform');
  }

  waitForLogin(uuid) {
    return this.request(`/api/v2/login/platform/${encodeURIComponent(uuid)}`, { timeoutMs: 125_000 });
  }

  getMpInfo(url, account) {
    return this.request('/api/v2/platform/wxs2mp', {
      method: 'POST',
      headers: {
        xid: String(account.id),
        authorization: `Bearer ${account.token}`,
      },
      body: { url: String(url) },
    });
  }

  getArticles(mpId, account, page = 1) {
    return this.request(`/api/v2/platform/mps/${encodeURIComponent(mpId)}/articles?page=${page}`, {
      headers: {
        xid: String(account.id),
        authorization: `Bearer ${account.token}`,
      },
    });
  }

  async agentRequest(apiName, apiKey, params = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.agentUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          api_name: apiName,
          ...params,
          skill_version: this.skillVersion,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok || !data || Number(data.errcode || 0) !== 0) {
        const message = data?.errmsg || data?.message || `official API returned HTTP ${response.status}`;
        const code = String(data?.errcode || response.status || 'OFFICIAL_API_ERROR');
        throw new PlatformError(message, { status: response.status, code });
      }
      if (data.upgrade_info) {
        throw new PlatformError(data.upgrade_info.message || '微信读书官方接口要求升级客户端', {
          code: 'SKILL_UPGRADE_REQUIRED',
        });
      }
      return data.data && typeof data.data === 'object' ? data.data : data;
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      if (error.name === 'AbortError') throw new PlatformError('official API request timed out', { code: 'TIMEOUT' });
      throw new PlatformError(`official API request failed: ${error.message}`, { code: 'NETWORK' });
    } finally {
      clearTimeout(timeout);
    }
  }

  searchOfficialAccounts(keyword, apiKey, count = 10) {
    return this.agentRequest('/store/search', apiKey, {
      keyword: String(keyword || ''),
      scope: 2,
      count: Math.max(1, Math.min(Number(count) || 10, 30)),
    });
  }

  searchOfficialArticles(keyword, apiKey, count = 20) {
    return this.agentRequest('/store/search', apiKey, {
      keyword: String(keyword || ''),
      scope: 4,
      count: Math.max(1, Math.min(Number(count) || 20, 30)),
    });
  }
}

module.exports = { PlatformError, WeReadPlatformClient };
