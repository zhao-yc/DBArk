import { test } from '@playwright/test';

// 收集先短路；即使双门已开，--list也不读取实跑门或加载桌面、观察连接与私网配置模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_DROP_TEST === '1') {
  const { registerTableDropUiTests } = require('./table-drop-live'); registerTableDropUiTests();
} else test.skip('单表删除正式UI定义默认关闭（员工3实际0）', () => {});
