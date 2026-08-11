'use strict';

/**
 * Five deliberately mixed sources for the isolated login-session prototype.
 * mpId is the original Base64 __biz value used by WeWe RSS. It must not be
 * decoded to a decimal string before calling /api/v2/platform/mps/:mpId.
 */
const PROTOTYPE_SOURCES = Object.freeze([
  { mpId: 'MzAxNjU2NjAyNA==', name: '光伏們', kind: '媒体', tier: 1 },
  { mpId: 'MjM5MzgyMjY2MQ==', name: '索比光伏网', kind: '媒体', tier: 1 },
  { mpId: 'MjM5MzUwNzk2Mg==', name: '中关村储能产业技术联盟', kind: '机构', tier: 1 },
  { mpId: 'Mzg2NTg0MzAxMg==', name: '天合光能', kind: '企业', tier: 1 },
  { mpId: 'MzUwOTAxNDM0Nw==', name: '阳光电源', kind: '企业', tier: 1 },
]);

module.exports = { PROTOTYPE_SOURCES };
