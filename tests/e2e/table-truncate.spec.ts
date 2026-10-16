import { test } from '@playwright/test';

// 默认关闭时只登记跳过项，不能加载实际桌面、观察连接或凭据读取模块。
if (process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_TRUNCATE_TEST === '1') {
  const { registerTableTruncateUiTests } = require('./table-truncate-live'); registerTableTruncateUiTests();
} else test.skip('单表清空正式UI定义默认关闭（员工3实际0）', () => {});
