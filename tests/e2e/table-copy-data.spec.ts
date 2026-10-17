import { test } from '@playwright/test';
// list先短路；只有本用途双门开启且原始目标准确才加载桌面与认证helper。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_COPY_DATA_UI === '1') {
  const { tableCopyStructureTarget } = require('../helpers/tableCopyStructureTarget');
  tableCopyStructureTarget('mysql84', process.env, process.env);
  if (process.env.DBARK_TEST_TLS !== '0' || require('node:fs').existsSync('.cache/dbark-test.env')) throw Error('结构及数据复制正式例须本轮显式明文13384凭据，不能加载回填文件');
  const { registerTableCopyDataUiTests } = require('./table-copy-data-live'); registerTableCopyDataUiTests();
} else test.skip('结构及数据复制正式UI定义默认关闭（实际0）', () => {});
