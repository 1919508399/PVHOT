'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AiConfigError,
  loadAiConfig,
  publicAiConfig,
  saveAiConfig,
} = require('../lib/ai_config');

function temporaryConfig() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-ai-config-'));
  return { directory, file: path.join(directory, 'config', 'ai_config.json') };
}

test('AI config is disabled and secret-free by default', () => {
  const { directory, file } = temporaryConfig();
  try {
    const config = loadAiConfig(file);
    const publicConfig = publicAiConfig(config);
    assert.equal(config.enabled, false);
    assert.equal(publicConfig.apiKeyConfigured, false);
    assert.equal('apiKey' in publicConfig, false);
    assert.equal(publicConfig.providers.length, 6);
    assert.deepEqual(publicConfig.providers.find((item) => item.id === 'zhipu').plans, ['standard', 'coding']);
    assert.deepEqual(publicConfig.providers.find((item) => item.id === 'xiaomi').plans, ['standard', 'coding']);
    assert.deepEqual(publicConfig.providers.find((item) => item.id === 'kimi').plans, ['standard', 'coding']);
    assert.equal(publicConfig.features.featuredReason, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AI config preserves an existing key when the form leaves it blank', () => {
  const { directory, file } = temporaryConfig();
  try {
    const first = saveAiConfig(file, {
      enabled: true,
      provider: 'deepseek',
      model: 'editor-model',
      apiKey: 'test-secret-value',
      dailyArticleLimit: 80,
      timeoutMs: 20000,
      maxInputChars: 6000,
      features: { classify:true, summarize:true, eventCluster:true, ranking:true },
    });
    const second = saveAiConfig(file, {
      enabled: true,
      provider: 'deepseek',
      model: 'editor-model-v2',
      dailyArticleLimit: 90,
      timeoutMs: 25000,
      maxInputChars: 7000,
      features: { classify:true, summarize:false, eventCluster:true, ranking:false },
    });
    assert.equal(first.apiKey, 'test-secret-value');
    assert.equal(second.apiKey, 'test-secret-value');
    assert.equal(second.model, 'editor-model-v2');
    assert.equal(second.features.summarize, false);
    const publicConfig = publicAiConfig(second);
    assert.equal(publicConfig.apiKeyConfigured, true);
    assert.match(publicConfig.apiKeyHint, /^tes/);
    assert.equal(JSON.stringify(publicConfig).includes('test-secret-value'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AI config refuses enabling an incomplete connection and supports key removal', () => {
  const { directory, file } = temporaryConfig();
  try {
    assert.throws(() => saveAiConfig(file, {
      enabled: true,
      provider: 'openai',
      model: '',
      apiKey: '',
      dailyArticleLimit: 120,
      timeoutMs: 25000,
      maxInputChars: 8000,
    }), (error) => error instanceof AiConfigError && error.code === 'INCOMPLETE_CONFIG');

    saveAiConfig(file, {
      enabled: true,
      provider: 'qwen',
      model: 'editor-model',
      apiKey: 'test-placeholder-credential',
      dailyArticleLimit: 120,
      timeoutMs: 25000,
      maxInputChars: 8000,
    });
    const cleared = saveAiConfig(file, {
      enabled: false,
      provider: 'qwen',
      model: 'editor-model',
      clearApiKey: true,
      dailyArticleLimit: 120,
      timeoutMs: 25000,
      maxInputChars: 8000,
    });
    assert.equal(cleared.apiKey, '');
    assert.equal(cleared.enabled, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
