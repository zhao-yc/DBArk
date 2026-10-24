import { test } from '@playwright/test';

// list先于所有环境读取；缺双门只跳过，不加载helper、live、mysql、engine或桌面。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_BINARY_CELL_FILES_UI_TEST === '1') {
  const { bindBinaryCellFilesUiEnvironment } = require('../helpers/binaryCellFilesUi') as typeof import('../helpers/binaryCellFilesUi');
  const environment = bindBinaryCellFilesUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./binary-cell-files-live').registerBinaryCellFilesUiTests(environment);
} else test.skip('二进制单元格文件正式窗口专项默认关闭（未执行）', () => {});
