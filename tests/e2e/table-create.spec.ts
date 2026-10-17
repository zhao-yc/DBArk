import { test } from '@playwright/test';
// list先短路；即使双门打开也不加载桌面、观察连接或认证配置模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_TEST === '1') {
  const { registerTableCreateUiTests } = require('./table-create-live'); registerTableCreateUiTests();
} else test.skip('新建表准确目标正式UI定义默认关闭（实际0）', () => {});
