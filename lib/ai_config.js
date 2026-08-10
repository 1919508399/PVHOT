'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJsonSync } = require('./safe_io');

const AI_CONFIG_SCHEMA_VERSION = 1;
const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    help: '使用 OpenAI 兼容的聊天模型进行内容分析',
  }),
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    help: '使用 DeepSeek 官方 OpenAI 兼容接口',
  }),
  qwen: Object.freeze({
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    help: '使用阿里云百炼 OpenAI 兼容接口',
  }),
});

const FEATURE_DEFAULTS = Object.freeze({
  classify: true,
  summarize: true,
  eventCluster: true,
  ranking: true,
  featuredReason: true,
});

const DEFAULT_AI_CONFIG = Object.freeze({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  enabled: false,
  provider: 'openai',
  model: '',
  apiKey: '',
  dailyArticleLimit: 120,
  timeoutMs: 25_000,
  maxInputChars: 8_000,
  features: FEATURE_DEFAULTS,
  updatedAt: null,
});

class AiConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiConfigError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AiConfigError(code, message);
}

function resolveAiConfigPath(root, sharedRoot, options = {}) {
  if (options.filePath) return path.resolve(options.filePath);
  const resolvedRoot = path.resolve(root || process.cwd());
  const resolvedShared = path.resolve(sharedRoot || resolvedRoot);
  const isShared = resolvedShared !== resolvedRoot || path.basename(resolvedRoot) === 'current';
  return isShared
    ? path.join(resolvedShared, 'config', 'ai_config.json')
    : path.join(resolvedRoot, '.runtime', 'config', 'ai_config.json');
}

function cleanModel(value) {
  const model = String(value || '').normalize('NFKC').trim();
  if (model.length > 120 || /[\u0000-\u001f\u007f]/.test(model)) {
    fail('INVALID_MODEL', '模型名称格式不正确');
  }
  return model;
}

function cleanApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (key.length < 8 || key.length > 512 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    fail('INVALID_API_KEY', 'API Key 格式不正确');
  }
  return key;
}

function normalizeFeatures(value, fallback = FEATURE_DEFAULTS) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const key of Object.keys(FEATURE_DEFAULTS)) {
    const candidate = input[key];
    output[key] = candidate == null ? fallback[key] !== false : candidate === true;
  }
  return output;
}

function normalizeAiConfig(input = {}, current = DEFAULT_AI_CONFIG) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_CONFIG', 'AI 配置格式不正确');
  }
  const allowed = new Set([
    'enabled', 'provider', 'model', 'apiKey', 'clearApiKey',
    'dailyArticleLimit', 'timeoutMs', 'maxInputChars', 'features',
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) fail('UNSUPPORTED_FIELD', `不支持的配置项：${unexpected.join('、')}`);

  const provider = String(input.provider == null ? current.provider : input.provider).trim().toLowerCase();
  if (!PROVIDERS[provider]) fail('INVALID_PROVIDER', '请选择受支持的 AI 服务商');
  const enabled = input.enabled == null ? current.enabled === true : input.enabled === true;
  const model = cleanModel(input.model == null ? current.model : input.model);
  let apiKey = current.apiKey || '';
  if (input.clearApiKey === true) apiKey = '';
  else if (input.apiKey != null && String(input.apiKey).trim()) apiKey = cleanApiKey(input.apiKey);

  const dailyArticleLimit = Number(input.dailyArticleLimit == null
    ? current.dailyArticleLimit
    : input.dailyArticleLimit);
  if (!Number.isInteger(dailyArticleLimit) || dailyArticleLimit < 10 || dailyArticleLimit > 1000) {
    fail('INVALID_DAILY_LIMIT', '每日 AI 处理上限应为 10～1000 篇');
  }
  const timeoutMs = Number(input.timeoutMs == null ? current.timeoutMs : input.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    fail('INVALID_TIMEOUT', '单次调用超时应为 5～120 秒');
  }
  const maxInputChars = Number(input.maxInputChars == null ? current.maxInputChars : input.maxInputChars);
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1_000 || maxInputChars > 30_000) {
    fail('INVALID_INPUT_LIMIT', '单篇输入长度应为 1000～30000 字符');
  }
  if (enabled && (!apiKey || !model)) {
    fail('INCOMPLETE_CONFIG', '启用 AI 前请填写模型名称和 API Key');
  }

  return {
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    enabled,
    provider,
    model,
    apiKey,
    dailyArticleLimit,
    timeoutMs,
    maxInputChars,
    features: normalizeFeatures(input.features, current.features || FEATURE_DEFAULTS),
    updatedAt: new Date().toISOString(),
  };
}

function loadAiConfig(filePath, options = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const normalized = normalizeAiConfig({
      enabled: parsed.enabled,
      provider: parsed.provider,
      model: parsed.model,
      apiKey: parsed.apiKey,
      dailyArticleLimit: parsed.dailyArticleLimit,
      timeoutMs: parsed.timeoutMs,
      maxInputChars: parsed.maxInputChars,
      features: parsed.features,
    }, DEFAULT_AI_CONFIG);
    return { ...normalized, updatedAt: parsed.updatedAt || normalized.updatedAt };
  } catch (error) {
    if (error && error.code === 'ENOENT' && options.allowMissing !== false) {
      return { ...DEFAULT_AI_CONFIG, features: { ...FEATURE_DEFAULTS } };
    }
    if (error instanceof AiConfigError) throw error;
    fail('CONFIG_READ_FAILED', '无法读取 AI 配置');
  }
}

function saveAiConfig(filePath, input) {
  const current = loadAiConfig(filePath);
  const config = normalizeAiConfig(input, current);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJsonSync(filePath, config, { space: 2, trailingNewline: true });
  try { fs.chmodSync(filePath, 0o640); } catch (error) { /* Windows/local development */ }
  return config;
}

function publicAiConfig(config) {
  const provider = PROVIDERS[config.provider] || PROVIDERS.openai;
  const key = config.apiKey || '';
  return {
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    enabled: config.enabled === true,
    provider: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model: config.model || '',
    apiKeyConfigured: Boolean(key),
    apiKeyHint: key ? `${key.slice(0, 3)}••••${key.slice(-4)}` : '',
    dailyArticleLimit: config.dailyArticleLimit,
    timeoutMs: config.timeoutMs,
    maxInputChars: config.maxInputChars,
    features: normalizeFeatures(config.features),
    updatedAt: config.updatedAt || null,
    providers: Object.values(PROVIDERS).map(({ id, name, baseUrl, help }) => ({ id, name, baseUrl, help })),
  };
}

module.exports = {
  AI_CONFIG_SCHEMA_VERSION,
  AiConfigError,
  DEFAULT_AI_CONFIG,
  FEATURE_DEFAULTS,
  PROVIDERS,
  cleanApiKey,
  loadAiConfig,
  normalizeAiConfig,
  publicAiConfig,
  resolveAiConfigPath,
  saveAiConfig,
};
