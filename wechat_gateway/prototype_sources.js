'use strict';

/**
 * Five deliberately mixed sources for the isolated login-session prototype.
 * mpId is the decoded WeChat biz id already present in source_registry.js.
 */
const PROTOTYPE_SOURCES = Object.freeze([
  { mpId: '3016566024', name: '光伏們', kind: '媒体', tier: 1 },
  { mpId: '2393822661', name: '索比光伏网', kind: '媒体', tier: 1 },
  { mpId: '2393507962', name: '中关村储能产业技术联盟', kind: '机构', tier: 1 },
  { mpId: '3865843012', name: '天合光能', kind: '企业', tier: 1 },
  { mpId: '3509014347', name: '阳光电源', kind: '企业', tier: 1 },
]);

module.exports = { PROTOTYPE_SOURCES };
