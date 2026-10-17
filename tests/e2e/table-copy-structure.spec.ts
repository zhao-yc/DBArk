import { test } from '@playwright/test';

// 列表优先短路，双门已开也不读实跑配置、不加载桌面和观察连接。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_COPY_STRUCTURE_UI === '1') {
  const { registerTableCopyStructureUiTests } = require('./table-copy-structure-live'); registerTableCopyStructureUiTests();
} else test.skip('复制空表结构正式UI定义默认关闭（员工5实际0）', () => {});
