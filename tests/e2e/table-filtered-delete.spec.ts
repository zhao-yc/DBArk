import { test } from '@playwright/test';

// list先于全部env读取；缺双门不加载live、helper、认证、Electron或数据库驱动。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_FILTERED_DELETE_UI_TEST === '1') {
  const { bindTableFilteredDeleteUiEnvironment } = require('../helpers/tableFilteredDeleteUi') as typeof import('../helpers/tableFilteredDeleteUi');
  const environment = bindTableFilteredDeleteUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./table-filtered-delete-live').registerTableFilteredDeleteUiTests(environment);
} else test.skip('全部筛选行批量删除正式窗口专项默认关闭（未执行）', () => {});
