import { test } from '@playwright/test';

// 列表先于环境读取；双门关闭时不加载桌面、驱动或认证配置。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_FOREIGN_KEYS_UI === '1') {
  const { registerTableCreateForeignKeysUiTests } = require('./table-create-foreign-keys-live'); registerTableCreateForeignKeysUiTests();
} else test.skip('新建表外键后核正式隔离UI准备入口默认关闭（实际0）', () => {});
