import { test } from '@playwright/test';

// 默认及列举先短路，不能导入桌面、驱动、资源清单或认证；实际运行由Root另行授权。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_CHECKS_NATIVE === '1') {
  require('./table-create-checks-live').registerTableCreateChecksNative();
} else test.skip('新建表CHECK正式隔离实库界面专项默认关闭（未执行）', () => {});
