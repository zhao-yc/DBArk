import { test } from '@playwright/test';

// 收集先短路；即使双门打开，--list也不读环境、不导入桌面、数据库或私料模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_DATABASE_CREATE_UI === '1') {
  const { registerDatabaseCreateUiTests } = require('./database-create-live'); registerDatabaseCreateUiTests();
} else test.skip('新建库编码正式UI默认关闭（员工5实际0）', () => {});
