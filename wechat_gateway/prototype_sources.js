'use strict';

const { WECHAT_ACCOUNTS } = require('../source_registry');

/**
 * Every built-in account with a verified WeChat profile id uses the persistent
 * server session. Accounts without a verified id remain monitored by the
 * public Sogou discovery channel and are never attributed as direct pulls.
 */
function profileMpId(profileId) {
  const decoded = Buffer.from(String(profileId || ''), 'base64').toString('utf8').trim();
  if (!/^\d{6,20}$/.test(decoded)) throw new Error('invalid verified WeChat profile id');
  return `MP_WXS_${decoded}`;
}

const PROTOTYPE_SOURCES = Object.freeze(WECHAT_ACCOUNTS
  .filter((account) => account.profileId)
  .map((account) => Object.freeze({
    mpId: profileMpId(account.profileId),
    name: account.name,
    kind: account.kind,
    tier: account.tier,
  })));

module.exports = { PROTOTYPE_SOURCES, profileMpId };
