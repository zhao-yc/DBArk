import { test } from '@playwright/test';

// 默认和列表只登记，不读取凭据或加载桌面；新专项不能误启原勾选筛选用例。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_VALUE_OPTIONS_UI === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const original = bindQueryResultColumnsUiTarget(() => process.env, helper); let revoked = false;
  const binding = { target: original.target, assertCurrent() { original.assertCurrent(); if (process.env.DBARK_QUERY_RESULT_VALUE_OPTIONS_UI !== '1') revoked = true; if (revoked) throw Error('不同值筛选验收授权已变化，永久停链'); } };
  require('./query-result-value-options-live').registerQueryResultValueOptionsUi(binding);
} else test.skip('从结果不同值勾选正式窗口专项默认关闭（未执行）', () => {});
