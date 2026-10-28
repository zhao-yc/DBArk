import { test } from '@playwright/test';

// 默认/列举先短路，不导入桌面、驱动、清单或凭据；资源准备和实际运行均由Root另行授权。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CHECKS_NATIVE === '1') {
  require('./table-checks-live').registerTableChecksNative();
} else test.skip('表CHECK管理原生隔离实库专项默认关闭（未执行）', () => {});
