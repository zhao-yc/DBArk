import { test } from '@playwright/test';
// 列举先于环境读取；默认关闭时不加载桌面、数据库或认证文件。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_W03_DEFINITION_NAVIGATION_TEST === '1') {
  const { assertDefaultEncodingLiveTarget } = require('../helpers/tableDefaultEncodingTarget');
  assertDefaultEncodingLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
  if (!process.env.DBARK_TEST_USER) throw Error('W03定义导航须显式提供本轮既有测试账号');
  require('./definition-navigation-cases');
} else test.skip('W03定义正文导航正式入口默认关闭（实际0）', () => {});
