import { test } from '@playwright/test';

// 列表和默认关闭不读取凭据、不加载实库模块；只接受本轮显式三门配置。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_ORGANIZE_UI === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const binding = bindQueryResultColumnsUiTarget(() => process.env, helper);
  require('./query-result-organize-live').registerQueryResultOrganizeUi(binding);
} else test.skip('多列排序与条件筛选真实客户端验收默认关闭（未执行）', () => {});
