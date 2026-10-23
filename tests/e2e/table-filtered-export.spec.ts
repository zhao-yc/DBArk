import { test } from '@playwright/test';

// 列表与默认运行先短路，不读取凭据、批准来源或启动Electron。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_FILTERED_EXPORT_UI === '1') {
  require('./table-filtered-export-live').registerTableFilteredExportUiTests();
} else test.skip('全部筛选行正式窗口专项默认关闭（未执行）', () => {});
