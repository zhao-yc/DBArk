import { test } from '@playwright/test';

// 默认关闭和列举先短路；不加载桌面、驱动、来源清单或凭据。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FK_JOIN_UI === '1') {
  require('./table-foreign-key-join-live').registerTableForeignKeyJoinUi();
} else test.skip('外键JOIN草稿正式窗口专项默认关闭（未执行）', () => {});
