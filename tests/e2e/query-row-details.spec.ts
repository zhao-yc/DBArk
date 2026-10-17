import { test } from '@playwright/test';

// 列表先短路；默认关闭不读取凭据，也不加载桌面、实库或清理帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_ROW_DETAILS_UI === '1') {
  const { bindQueryRowDetailsUiTarget } = require('../helpers/queryRowDetailsUi') as typeof import('../helpers/queryRowDetailsUi');
  const binding = bindQueryRowDetailsUiTarget(() => process.env, process.argv);
  require('./query-row-details-ui').registerQueryRowDetailsUi(binding);
} else test.skip('查询结果整行详情实库UI默认关闭（未执行）', () => {});
