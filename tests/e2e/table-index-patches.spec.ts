import { test } from '@playwright/test';

// --list必须先于环境门短路，即使双门已开也不导入桌面、观察连接及私网配置。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_INDEX_PATCH_UI === '1') {
  const { registerTableIndexPatchUiTests } = require('./table-index-patches-live'); registerTableIndexPatchUiTests();
} else test.skip('索引差异正式UI默认关闭（含改名准备，实际0）', () => {});
