import { test } from '@playwright/test';
// 列举先短路；未显式开启本用途时不读取目标、桌面或认证模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_PREFIX_UI === '1') {
  const { assertDefaultEncodingLiveTarget } = require('../helpers/tableDefaultEncodingTarget');
  assertDefaultEncodingLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
  if (process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS !== '0' || !process.env.DBARK_TEST_USER || !/^dbark_e2e_prefix_[a-f0-9]{32}$/.test(process.env.DBARK_TEST_DATABASE ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('新表前缀正式准备须Root本轮明确13384明文目标、UUID、账号及专用隔离库；不创建或清理数据库');
  require('./table-create-prefix-live').registerTableCreatePrefixTests();
} else test.skip('新表前缀正式UI准备默认关闭（实际0）', () => {});
