import { test } from '@playwright/test';

// 列表必须先于gate读取；默认路径不导入桌面、SQLite或专项环境。
if (process.argv.some(value => value === '--list' || value.startsWith('--list=')) || process.env.DBARK_HISTORY_DELETE_UI !== '1') {
  test.skip('历史清理离线专项未启用', () => {});
} else {
  const { registerHistoryDeleteUi } = require('../helpers/historyDeleteUi') as typeof import('../helpers/historyDeleteUi');
  registerHistoryDeleteUi();
}
