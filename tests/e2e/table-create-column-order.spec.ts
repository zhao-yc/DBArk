import { test } from '@playwright/test';
// 默认关闭，列举先短路；不开启时不加载桌面、认证或数据库模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_COLUMN_ORDER_UI === '1') {
  const { assertDefaultEncodingLiveTarget } = require('../helpers/tableDefaultEncodingTarget');
  assertDefaultEncodingLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
  if (process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS !== '0' || !process.env.DBARK_TEST_USER || !/^dbark_e2e_column_order_[a-f0-9]{32}$/.test(process.env.DBARK_TEST_DATABASE ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('字段顺序正式准备须Root本轮明确MySQL8.4.11、UUID、既有账号及专用库');
  require('./table-create-column-order-live').registerTableCreateColumnOrderTests();
} else test.skip('新建表字段顺序正式UI准备默认关闭（未执行）', () => {});
