const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountSearchTerms,
  expandAccountAliases,
  selectCustomAccountsForRun,
} = require('../fetch_wechat');

test('custom WeChat search terms split mixed Chinese and English account names', () => {
  const account = {
    name: '华晟新能源 Huasun',
    aliases: ['华晟新能源 Huasun'],
  };

  assert.deepEqual(accountSearchTerms(account), [
    '华晟新能源',
    '华晟新能源 Huasun',
    'Huasun',
  ]);
  assert.deepEqual(expandAccountAliases(account), [
    '华晟新能源 Huasun',
    '华晟新能源',
    'Huasun',
  ]);
});

test('recent custom WeChat accounts are prioritized before normal rotation', () => {
  const now = Date.now();
  const accounts = [
    { id: 'old-1', name: '旧账号1', createdAt: new Date(now - 10 * 86400_000).toISOString() },
    { id: 'old-2', name: '旧账号2', createdAt: new Date(now - 10 * 86400_000).toISOString() },
    { id: 'new-1', name: '华晟新能源 Huasun', createdAt: new Date(now - 2 * 3600_000).toISOString() },
  ];

  const selected = selectCustomAccountsForRun(accounts, 0).map((account) => account.id);
  assert.equal(selected[0], 'new-1');
  assert.ok(selected.includes('old-1'));
});
