import { test } from '@playwright/test';

// 列表与默认关闭不读取凭据、不加载实库；本例必须显式开启三门。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_STATISTICS_LIVE === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const binding = bindQueryResultColumnsUiTarget(() => process.env, helper);
  let invalid = false;
  // 第三门随每步owner复核；关闭再恢复不能复活原验收授权。
  const guarded = { ...binding, assertCurrent() { binding.assertCurrent(); if (invalid || process.env.DBARK_QUERY_RESULT_STATISTICS_LIVE !== '1') { invalid = true; throw Error('列统计验收授权已变化，永久停链'); } } };
  require('./query-result-organize-live').registerQueryResultOrganizeUi(guarded, { statistics: true });
} else test.skip('列统计真实客户端验收默认关闭（未执行）', () => {});
