import { test } from '@playwright/test';

// JSON使用独立门；默认及list不读取认证、文件、桌面或数据库模块。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_IMPORT_NEW_TABLE_JSON_UI_TEST === '1') {
  const { bindImportNewTableJsonUiEnvironment } = require('../helpers/importNewTableUi') as typeof import('../helpers/importNewTableUi');
  const environment = bindImportNewTableJsonUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./import-new-table-live').registerImportNewTableUiTests(environment);
} else test.skip('JSON新表导入正式窗口专项默认关闭（未执行）', () => {});
