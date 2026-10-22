import { test } from '@playwright/test';

// 默认及--list仅登记一条未执行定义，不能加载SQLite、桌面或读取认证。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_HISTORY_DURATION_NATIVE_TEST === '1') {
  const { registerHistoryDurationNative } = require('../helpers/historyDurationUi') as typeof import('../helpers/historyDurationUi');
  registerHistoryDurationNative();
} else test.skip('历史耗时筛选原生专项默认关闭（未执行）', () => {});
