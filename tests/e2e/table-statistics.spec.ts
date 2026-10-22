import { test } from '@playwright/test';

// 列举先短路，默认关闭不读取凭据/来源清单、不启动桌面或数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_STATISTICS_UI === '1') {
  require('./table-statistics-live').registerTableStatisticsUiTests();
} else test.skip('表数据统计正式窗口专项默认关闭（未执行）', () => {});
