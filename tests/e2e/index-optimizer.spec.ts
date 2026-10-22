import { test } from '@playwright/test';

// 默认和列表只登记定义，不加载桌面、认证、来源清单或数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_INDEX_OPTIMIZER_UI === '1') {
  require('./index-optimizer-live').registerIndexOptimizerUiTests();
} else test.skip('索引参与优化器正式窗口专项默认关闭（未执行）', () => {});
