import { test } from '@playwright/test';

// list先于所有环境读取；缺双门只登记跳过，不加载helper、live、engine、mysql或桌面。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_CSV_HEADER_UI_TEST === '1') {
  const { bindCsvHeaderUiEnvironment } = require('../helpers/csvHeaderUi') as typeof import('../helpers/csvHeaderUi');
  const environment = bindCsvHeaderUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./csv-header-live').registerCsvHeaderUiTests(environment);
} else test.skip('无标题CSV正式窗口专项默认关闭（未执行）', () => {});
