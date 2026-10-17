import { test } from '@playwright/test';
// list先短路，不读取认证、helper或桌面；准确Maria用途独立双门默认关闭。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_MARIADB1011_UI === '1') {
  const { bindTableCreateMariaTarget } = require('../helpers/tableCreateMariaTarget'); bindTableCreateMariaTarget('10.11.19', () => process.env, process.env);
  if (require('node:fs').existsSync('.cache/dbark-test.env')) throw Error('Maria新建表正式入口拒绝认证回填文件');
  const { registerTableCreateMariaUiTests } = require('./table-create-mariadb-live'); registerTableCreateMariaUiTests('10.11.19');
} else test.skip('MariaDB10.11.19普通新建表正式UI定义默认关闭（实际0）', () => {});
