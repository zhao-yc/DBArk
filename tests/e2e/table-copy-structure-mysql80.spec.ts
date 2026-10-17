import { test } from '@playwright/test';

// 列表先短路；只有本版本双门显式开启才加载桌面、目标配置和观察连接。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_COPY_STRUCTURE_MYSQL80_UI === '1') {
  const { registerTableCopyStructureUiTests } = require('./table-copy-structure-live'); registerTableCopyStructureUiTests('mysql80');
} else test.skip('MySQL8.0.46复制空表结构正式UI定义默认关闭（员工5实际0）', () => {});
