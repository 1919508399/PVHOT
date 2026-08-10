'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HEALTH_STATUS,
  HEALTH_STATUSES,
  STATUS_NORMAL,
  STATUS_NO_NEW,
  STATUS_BLOCKED,
  STATUS_PARSE_ERROR,
  STATUS_STALE,
  STATUS_PENDING,
  advanceHealthEntry,
  buildHealthEntry,
  defaultStaleAfterHours,
  summarizeHealth,
} = require('../lib/source_health');

const HOUR = 3600 * 1000;
const NOW = new Date('2026-07-30T12:00:00.000Z');

function hoursBefore(hours) {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

test('exports the stable source-health statuses including pending', () => {
  assert.deepEqual(HEALTH_STATUS, {
    NORMAL: 'normal',
    NO_NEW: 'no_new',
    BLOCKED: 'blocked',
    PARSE_ERROR: 'parse_error',
    STALE: 'stale',
    PENDING: 'pending',
  });
  assert.deepEqual(HEALTH_STATUSES, [
    STATUS_NORMAL,
    STATUS_NO_NEW,
    STATUS_BLOCKED,
    STATUS_PARSE_ERROR,
    STATUS_STALE,
    STATUS_PENDING,
  ]);
});

test('a successful first check with a recent item is normal', () => {
  const entry = buildHealthEntry(
    { id: 'pv-magazine', source: 'PV Magazine', kind: 'rss', tier: 1 },
    [{ title: 'New module record', pubDate: hoursBefore(1) }],
    null,
    { httpStatus: 200, durationMs: 123.6 },
    NOW
  );

  assert.equal(entry.status, STATUS_NORMAL);
  assert.equal(entry.items, 1);
  assert.equal(entry.newItems, 1);
  assert.equal(entry.lastSuccessAt, NOW.toISOString());
  assert.equal(entry.lastNewAt, NOW.toISOString());
  assert.equal(entry.lastItemAt, hoursBefore(1));
  assert.equal(entry.durationMs, 124);
  assert.equal(entry.consecutiveFailures, 0);
  assert.equal(entry.consecutiveNoNew, 0);
});

test('a successful repeat with no newer publication becomes no_new and preserves new-item time', () => {
  const first = buildHealthEntry(
    { id: 'feed', name: 'Feed', kind: 'rss' },
    [{ pubDate: hoursBefore(2) }],
    null,
    { httpStatus: 200 },
    new Date(NOW.getTime() - HOUR)
  );
  const repeated = buildHealthEntry(
    { id: 'feed', name: 'Feed', kind: 'rss' },
    [{ pubDate: hoursBefore(2) }],
    first,
    { httpStatus: 200 },
    NOW
  );

  assert.equal(repeated.status, STATUS_NO_NEW);
  assert.equal(repeated.newItems, 0);
  assert.equal(repeated.lastSuccessAt, NOW.toISOString());
  assert.equal(repeated.lastNewAt, first.lastNewAt);
  assert.equal(repeated.lastItemAt, first.lastItemAt);
  assert.equal(repeated.consecutiveNoNew, 1);
});

test('blocked wins over parse_error and stale while preserving prior success timestamps', () => {
  const previous = {
    status: STATUS_NORMAL,
    checkedAt: hoursBefore(100),
    firstCheckedAt: hoursBefore(200),
    lastSuccessAt: hoursBefore(100),
    lastNewAt: hoursBefore(100),
    lastItemAt: hoursBefore(100),
    consecutiveFailures: 1,
  };
  const entry = buildHealthEntry(
    { id: 'blocked', name: 'Blocked', kind: 'rss' },
    [],
    previous,
    {
      httpStatus: 403,
      blocked: true,
      parseError: true,
      errorCode: 'cloudflare_challenge',
      detail: 'Access denied',
    },
    NOW
  );

  assert.equal(entry.status, STATUS_BLOCKED);
  assert.equal(entry.errorCode, 'cloudflare_challenge');
  assert.equal(entry.lastSuccessAt, previous.lastSuccessAt);
  assert.equal(entry.lastNewAt, previous.lastNewAt);
  assert.equal(entry.lastItemAt, previous.lastItemAt);
  assert.equal(entry.consecutiveFailures, 2);
});

test('parse_error wins over stale and records structured diagnostics', () => {
  const previous = {
    status: STATUS_NO_NEW,
    checkedAt: hoursBefore(80),
    firstCheckedAt: hoursBefore(100),
    lastSuccessAt: hoursBefore(80),
    lastItemAt: hoursBefore(80),
  };
  const entry = buildHealthEntry(
    { id: 'broken-rss', name: 'Broken RSS', kind: 'rss' },
    [],
    previous,
    {
      httpStatus: 200,
      parseError: true,
      errorCode: 'invalid_feed',
      detail: 'RSS root element was not found',
      durationMs: 88,
    },
    NOW
  );

  assert.equal(entry.status, STATUS_PARSE_ERROR);
  assert.equal(entry.errorCode, 'invalid_feed');
  assert.equal(entry.detail, 'RSS root element was not found');
  assert.equal(entry.lastSuccessAt, previous.lastSuccessAt);
  assert.equal(entry.consecutiveFailures, 1);
});

test('a successful source without newer items becomes stale after its kind threshold', () => {
  const previous = {
    status: STATUS_NO_NEW,
    checkedAt: hoursBefore(76),
    firstCheckedAt: hoursBefore(100),
    lastSuccessAt: hoursBefore(76),
    lastNewAt: hoursBefore(76),
    lastItemAt: hoursBefore(76),
    consecutiveNoNew: 3,
  };
  const entry = buildHealthEntry(
    { id: 'stale-feed', name: 'Stale feed', kind: 'rss' },
    [],
    previous,
    { httpStatus: 200 },
    NOW
  );

  assert.equal(defaultStaleAfterHours('rss'), 72);
  assert.equal(entry.status, STATUS_STALE);
  assert.equal(entry.lastSuccessAt, NOW.toISOString());
  assert.equal(entry.lastItemAt, previous.lastItemAt);
  assert.equal(entry.consecutiveNoNew, 4);
});

test('kind defaults avoid marking a slowly rotated WeChat source stale too early', () => {
  const previous = {
    status: STATUS_NO_NEW,
    checkedAt: hoursBefore(100),
    firstCheckedAt: hoursBefore(120),
    lastSuccessAt: hoursBefore(100),
    lastNewAt: hoursBefore(100),
    lastItemAt: hoursBefore(100),
  };
  const entry = buildHealthEntry(
    { id: 'wechat-account', name: '公众号', kind: 'wechat' },
    [],
    previous,
    { httpStatus: 200 },
    NOW
  );

  assert.equal(defaultStaleAfterHours('wechat'), 168);
  assert.equal(entry.status, STATUS_NO_NEW);
});

test('a recovered source resets failure counters and advances success/new-item times', () => {
  const previous = {
    status: STATUS_BLOCKED,
    checkedAt: hoursBefore(2),
    firstCheckedAt: hoursBefore(200),
    lastSuccessAt: hoursBefore(20),
    lastNewAt: hoursBefore(20),
    lastItemAt: hoursBefore(20),
    consecutiveFailures: 4,
    consecutiveNoNew: 2,
  };
  const entry = buildHealthEntry(
    { id: 'recovered', name: 'Recovered', kind: 'rss' },
    [{ pubDate: hoursBefore(1) }],
    previous,
    { httpStatus: 200 },
    NOW
  );

  assert.equal(entry.status, STATUS_NORMAL);
  assert.equal(entry.firstCheckedAt, previous.firstCheckedAt);
  assert.equal(entry.lastSuccessAt, NOW.toISOString());
  assert.equal(entry.lastNewAt, NOW.toISOString());
  assert.equal(entry.lastItemAt, hoursBefore(1));
  assert.equal(entry.consecutiveFailures, 0);
  assert.equal(entry.consecutiveNoNew, 0);
  assert.equal(entry.lastStatusChangeAt, NOW.toISOString());
});

test('explicit diagnostics newItems overrides publication-time comparison', () => {
  const previous = {
    status: STATUS_NORMAL,
    checkedAt: hoursBefore(1),
    lastSuccessAt: hoursBefore(1),
    lastNewAt: hoursBefore(1),
    lastItemAt: hoursBefore(1),
  };
  const entry = buildHealthEntry(
    { id: 'explicit', name: 'Explicit', kind: 'rss' },
    [{ pubDate: hoursBefore(1) }],
    previous,
    { httpStatus: 200, newItems: 2 },
    NOW
  );

  assert.equal(entry.status, STATUS_NORMAL);
  assert.equal(entry.newItems, 2);
  assert.equal(entry.lastNewAt, NOW.toISOString());
});

test('summarizeHealth counts every state and exposes compatibility totals', () => {
  const summary = summarizeHealth([
    { status: STATUS_NORMAL },
    { status: STATUS_NORMAL },
    { status: STATUS_NO_NEW },
    { status: STATUS_BLOCKED },
    { status: STATUS_PARSE_ERROR },
    { status: STATUS_STALE },
  ]);

  assert.deepEqual(summary.byStatus, {
    normal: 2,
    no_new: 1,
    blocked: 1,
    parse_error: 1,
    stale: 1,
    pending: 0,
  });
  assert.equal(summary.total, 6);
  assert.equal(summary.checked, 6);
  assert.equal(summary.healthy, 3);
  assert.equal(summary.issues, 3);
  assert.equal(summary.ok, 2);
  assert.equal(summary.empty, 2);
  assert.equal(summary.unknown, 0);
});

test('an unqueried source can age into stale without pretending it was checked again', () => {
  const previous = {
    id: 'wechat:test',
    name: 'Test account',
    kind: 'wechat',
    status: STATUS_NO_NEW,
    checkedAt: hoursBefore(200),
    firstCheckedAt: hoursBefore(220),
    lastItemAt: hoursBefore(200),
    lastStatusChangeAt: hoursBefore(200),
    staleAfterHours: 168,
  };
  const advanced = advanceHealthEntry(
    { id: previous.id, name: previous.name, kind: 'wechat' },
    previous,
    NOW
  );

  assert.equal(advanced.status, STATUS_STALE);
  assert.equal(advanced.checkedAt, previous.checkedAt);
  assert.equal(advanced.statusEvaluatedAt, NOW.toISOString());
});

test('disabled sources retain their previous result without aging into stale', () => {
  const previous = {
    id: 'custom-disabled',
    name: 'Disabled feed',
    kind: 'rss',
    status: STATUS_NORMAL,
    checkedAt: hoursBefore(200),
    lastItemAt: hoursBefore(200),
    staleAfterHours: 72,
  };
  const retained = advanceHealthEntry(
    { id: previous.id, name: previous.name, kind: 'rss' },
    previous,
    NOW,
    { allowStale: false, detail: '当前已停用' }
  );

  assert.equal(retained.status, STATUS_NORMAL);
  assert.equal(retained.lastItemAt, previous.lastItemAt);
  assert.equal(retained.detail, '当前已停用');
});
