'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  applyAiEditorial,
  normalizeEventKey,
  normalizeInsight,
  parseJsonContent,
} = require('../lib/ai_editor');

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pvhot-ai-editor-'));
  return {
    directory,
    cacheFile: path.join(directory, 'ai_cache.json'),
    usageFile: path.join(directory, 'ai_usage.json'),
  };
}

function config() {
  return {
    enabled: true,
    provider: 'openai',
    model: 'editor-model',
    apiKey: 'test-secret-value',
    dailyArticleLimit: 20,
    timeoutMs: 10000,
    maxInputChars: 5000,
    features: { classify:true, summarize:true, eventCluster:true, ranking:true },
  };
}

function article(id, title, source) {
  return {
    id,
    title,
    title_cn: title,
    summary: `${title}的详细公开信息。`,
    summary_cn: `${title}的详细公开信息。`,
    source,
    sources: [source],
    sourceCount: 1,
    category: '行情',
    pubDate: '2026-08-03T08:00:00.000Z',
    related: [],
  };
}

test('AI editor parses fenced JSON and normalizes event keys', () => {
  const parsed = parseJsonContent('```json\n{"items":[]}\n```');
  assert.deepEqual(parsed, { items: [] });
  assert.equal(normalizeEventKey('隆基：新组件发布！'), '隆基-新组件发布');
  const insight = normalizeInsight({
    relevant: true,
    category: '组件',
    summary: '一段摘要',
    eventTitle: '隆基发布新组件',
    eventKey: '隆基 新组件 发布',
    importance: 110,
    novelty: -2,
    confidence: .8,
    entities: { companies:['隆基','隆基'], countries:['中国'] },
  });
  assert.equal(insight.importance, 100);
  assert.equal(insight.novelty, 0);
  assert.deepEqual(insight.entities.companies, ['隆基']);
});

test('AI editor enriches and clusters articles, then reuses its cache', async () => {
  const files = workspace();
  let calls = 0;
  const fakeFetch = async (_url, request) => {
    calls += 1;
    assert.equal(request.headers.Authorization, 'Bearer test-secret-value');
    const body = JSON.parse(request.body);
    const input = JSON.parse(body.messages[1].content).items;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: input.map((item) => ({
          id: item.id,
          relevant: true,
          category: '组件',
          summary: `${item.title}。这是经过核验信息生成的完整摘要，用于测试事件聚类和缓存。`,
          impact: '可能影响组件市场竞争。',
          eventTitle: '同一组件发布事件',
          eventKey: '同一组件发布事件',
          importance: 82,
          novelty: 70,
          confidence: .9,
          reason: '来自多个公开信源，具有明确产业信息。',
          entities: { companies:['示例公司'], organizations:[], countries:['中国'], technologies:['光伏组件'] },
        })),
      }) } }],
      usage: { total_tokens: 321 },
    }), { status:200, headers:{ 'content-type':'application/json', 'x-request-id':'req-test' } });
  };
  try {
    const firstItems = [article('a','公司发布高效组件','来源甲'), article('b','高效组件正式上市','来源乙')];
    const first = await applyAiEditorial(firstItems, config(), { ...files, fetchImpl:fakeFetch, batchSize:4 });
    assert.equal(first.analyzed, 2);
    assert.equal(first.calls, 1);
    assert.equal(first.eventCount, 1);
    assert.equal(firstItems[0].summaryMode, 'ai-editor');
    assert.equal(firstItems[0].category, '组件');
    assert.equal(firstItems[0].eventArticleCount, 2);
    assert.equal(firstItems[0].related.length, 1);

    const secondItems = [article('a','公司发布高效组件','来源甲'), article('b','高效组件正式上市','来源乙')];
    const second = await applyAiEditorial(secondItems, config(), { ...files, fetchImpl:fakeFetch, batchSize:4 });
    assert.equal(second.analyzed, 0);
    assert.equal(second.cacheHits, 2);
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(files.directory, { recursive:true, force:true });
  }
});

test('AI editor falls back without modifying the article when the provider fails', async () => {
  const files = workspace();
  try {
    const items = [article('a','测试文章','来源甲')];
    const result = await applyAiEditorial(items, config(), {
      ...files,
      fetchImpl: async () => new Response('{"error":{"message":"余额不足"}}', { status:429 }),
    });
    assert.equal(result.failures, 1);
    assert.equal(items[0].ai, undefined);
    assert.match(result.lastError, /429/);
  } finally {
    fs.rmSync(files.directory, { recursive:true, force:true });
  }
});
