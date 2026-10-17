import { test } from '@playwright/test';
// list先于认证环境读取；本用途默认关闭，不加载桌面/helper或回填文件。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_MYSQL57_UI === '1') {
  const { bindTableCreateMysql57Target } = require('../helpers/tableCreateMysql57Target'); bindTableCreateMysql57Target(() => process.env, process.env);
  if (require('node:fs').existsSync('.cache/dbark-test.env')) throw Error('新建表5.7.44正式入口拒绝认证回填文件');
  const { registerTableCreateMysql57UiTests } = require('./table-create-mysql57-live'); registerTableCreateMysql57UiTests();
} else test.skip('MySQL5.7.44普通新建表正式UI定义默认关闭（实际0）', () => {});
