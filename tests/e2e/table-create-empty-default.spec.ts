import { test } from '@playwright/test';

// --list先于任何环境读取；默认关闭时不加载认证、桌面、驱动或实际live模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI === '1') {
  const { registerTableCreateEmptyDefaultUiTests } = require('./table-create-empty-default-live');
  registerTableCreateEmptyDefaultUiTests();
} else test.skip('新建表显式空串默认值正式Windows隔离UI入口默认关闭（实际0）', () => {});
