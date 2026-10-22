import { test } from '@playwright/test';

// 列表优先短路；默认关闭时不读认证、来源清单，也不加载桌面或数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TEMPLATE_COLUMNS_UI === '1') {
  require('./table-query-template-columns-live').registerTableQueryTemplateColumnsUiTests();
} else test.skip('SQL模板选列正式窗口专项默认关闭（未执行）', () => {});
