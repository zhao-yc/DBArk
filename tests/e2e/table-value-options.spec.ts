import { test } from '@playwright/test';

// 默认与列表先短路，不读取凭据/来源清单或启动正式桌面。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_VALUE_OPTIONS_UI === '1') {
  require('./table-value-options-live').registerTableValueOptionsUiTests();
} else test.skip('表页服务器不同值正式窗口专项默认关闭（未执行）', () => {});
