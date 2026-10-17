import { test } from '@playwright/test';

// list先于任何env读取；双门及原始配置明确后才加载本版本正式定义，不复用旧8.4入口。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_MYSQL80_UI === '1') {
  const { tableCreateMysql80Target } = require('../helpers/tableCreateMysql80Preparation');
  tableCreateMysql80Target(process.env, process.env);
  if (require('node:fs').existsSync('.cache/dbark-test.env')) throw Error('新建表8.0.46只接受本轮显式原始凭据，拒绝加载helper回填文件');
  const { registerTableCreateMysql80UiTests } = require('./table-create-mysql80-live'); registerTableCreateMysql80UiTests();
} else test.skip('MySQL8.0.46新建表正式UI准备入口默认关闭（实际0）', () => {});
