import { test } from '@playwright/test';

// list先于所有环境读取；缺双门只登记跳过，不加载helper、live、engine、mysql或桌面。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_TRANSACTION_UI_TEST === '1') {
  const { bindFileImportTransactionUiEnvironment } = require('../helpers/fileImportTransactionUi') as typeof import('../helpers/fileImportTransactionUi');
  const environment = bindFileImportTransactionUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./file-import-transaction-live').registerFileImportTransactionUiTests(environment);
} else test.skip('文件导入事务正式窗口专项默认关闭（未执行）', () => {});
