'use strict';

/**
 * Five deliberately mixed sources for the isolated login-session prototype.
 * mpId is the internal identifier returned by WeWe RSS /wxs2mp. The current
 * service represents these verified accounts as MP_WXS_<decoded __biz>.
 */
const PROTOTYPE_SOURCES = Object.freeze([
  { mpId: 'MP_WXS_3016566024', name: '光伏們', kind: '媒体', tier: 1 },
  { mpId: 'MP_WXS_2393822661', name: '索比光伏网', kind: '媒体', tier: 1 },
  { mpId: 'MP_WXS_2393507962', name: '中关村储能产业技术联盟', kind: '机构', tier: 1 },
  { mpId: 'MP_WXS_3865843012', name: '天合光能', kind: '企业', tier: 1 },
  { mpId: 'MP_WXS_3509014347', name: '阳光电源', kind: '企业', tier: 1 },
]);

module.exports = { PROTOTYPE_SOURCES };
