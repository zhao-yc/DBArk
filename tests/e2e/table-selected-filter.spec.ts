import { test } from '@playwright/test';

// 列表先短路，默认关闭时不读认证／来源清单，也不加载桌面或数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_SELECTED_FILTER_UI === '1') {
  require('./table-selected-filter-live').registerTableSelectedFilterUiTests();
} else test.skip('表勾选值筛选正式窗口专项默认关闭（未执行）', () => {});
