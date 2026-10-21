import { test } from '@playwright/test';

// 列表和默认关闭不读取凭据或加载实库；本例只接受本轮显式三门。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_PRESETS_UI === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const binding = bindQueryResultColumnsUiTarget(() => process.env, helper);
  let invalid = false;
  // 第三门也随每步owner检查复核，关闭后改回不能复活本例。
  const guarded = { ...binding, assertCurrent() { binding.assertCurrent(); if (invalid || process.env.DBARK_QUERY_RESULT_PRESETS_UI !== '1') { invalid = true; throw Error('命名方案验收授权已变化，永久停链'); } } };
  require('./query-result-organize-live').registerQueryResultOrganizeUi(guarded, { presets: true });
} else test.skip('命名整理方案真实客户端验收默认关闭（未执行）', () => {});
