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
}

module.exports = { PlatformError, WeReadPlatformClient };
