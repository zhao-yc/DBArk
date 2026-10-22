import { test } from '@playwright/test';

// 默认关闭和列表只登记用例；不读取清单、认证、桌面或数据库资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_RENAME_COMPAT_UI === '1') {
  require('./table-rename-compat-live').registerTableRenameCompatUiTests();
} else test.skip('表重命名旧基线兼容正式窗口专项默认关闭（未执行）', () => {});
