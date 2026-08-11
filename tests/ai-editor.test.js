'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  applyAiEditorial,
  isSpecificRecommendationReason,
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

test('recommendation reason quality gate rejects filler and requires a fact-to-decision link', () => {
  const item = {
    title_cn: '阳光电源发布 PowerStack 255CS 工商业储能系统',
    summary_cn: '系统采用 125 kW/255 kWh 配置，面向工商业两小时储能需求。',
  };
  const insight = { entities: { companies: ['阳光电源'], technologies: ['PowerStack 255CS'] } };
  assert.equal(isSpecificRecommendationReason('产品发布信息具体，但市场影响有限，属于企业动态。', item, insight), false);
  assert.equal(isSpecificRecommendationReason(
    'PowerStack 255CS 采用 125 kW/255 kWh 两小时配置，可供工商业业主比较系统选型、采购报价与可用容量。',
    item,
    insight
  ), true);
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
          reason: '示例公司披露 182mm 高效组件上市计划，这将影响同类组件的产品选型、采购报价与市场竞争。',
          entities: { companies:['示例公司'], organizations:[], countries:['中国'], technologies:['光伏组件'] },
        })),
      }) } }],
      usage: { total_tokens: 321 },
    }), { status:200, headers:{ 'content-type':'application/json', 'x-request-id':'req-test' } });
  };
  try {
    const firstItems = [article('a','示例公司发布 182mm 高效组件','来源甲'), article('b','示例公司 182mm 高效组件正式上市','来源乙')];
    const first = await applyAiEditorial(firstItems, config(), { ...files, fetchImpl:fakeFetch, batchSize:4 });
    assert.equal(first.analyzed, 2);
    assert.equal(first.calls, 1);
    assert.equal(first.eventCount, 1);
    assert.equal(firstItems[0].summaryMode, 'ai-editor');
    assert.equal(firstItems[0].category, '组件');
    assert.equal(firstItems[0].eventArticleCount, 2);
    assert.equal(firstItems[0].related.length, 1);
    assert.equal(firstItems[0].reason.length > 0, true);

    const secondItems = [article('a','示例公司发布 182mm 高效组件','来源甲'), article('b','示例公司 182mm 高效组件正式上市','来源乙')];
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

test('DeepSeek calls disable thinking for predictable JSON editing', async () => {
  const files = workspace();
  try {
    const deepseekConfig = {
      ...config(),
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    };
    let requestBody = null;
    const items = [article('a','DeepSeek 结构化测试','来源甲')];
    const result = await applyAiEditorial(items, deepseekConfig, {
      ...files,
      fetchImpl: async (_url, request) => {
        requestBody = JSON.parse(request.body);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            items: [{
              id: 'a',
              relevant: true,
              category: '行情',
              summary: 'DeepSeek 连接正常，已返回结构化 JSON。',
              impact: '用于验证稳定输出。',
              eventTitle: 'DeepSeek 结构化测试',
              eventKey: 'DeepSeek 结构化测试',
              importance: 60,
              novelty: 50,
              confidence: .8,
              reason: '测试通过。',
              entities: { companies:[], organizations:[], countries:['中国'], technologies:['光伏'] },
            }],
          }) } }],
          usage: { total_tokens: 100 },
        }), { status:200, headers:{ 'content-type':'application/json' } });
      },
    });
    assert.equal(result.failures, 0);
    assert.equal(result.analyzed, 1);
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
    assert.equal(requestBody.max_tokens, 3000);
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
  } finally {
    fs.rmSync(files.directory, { recursive:true, force:true });
  }
});
