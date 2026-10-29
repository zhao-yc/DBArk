import { test } from '@playwright/test';

// 新独立门先于认证、文件、数据库及桌面模块；list永远只登记默认声明。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST === '1') {
  const { bindTableFilteredUpdateMultiUiEnvironment } = require('../helpers/tableFilteredUpdateUi') as typeof import('../helpers/tableFilteredUpdateUi');
  const environment = bindTableFilteredUpdateMultiUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./table-filtered-update-live').registerTableFilteredUpdateUiTests(environment);
} else test.skip('多字段全部筛选行正式窗口专项默认关闭（未执行）', () => {});
