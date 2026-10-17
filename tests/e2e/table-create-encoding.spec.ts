import { test } from '@playwright/test';
// list必须先短路；认证环境、认证文件和桌面均不应因双门开启而被收集过程读取。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_ENCODING_UI === '1') {
  const { bindTableCreateEncodingTarget } = require('../helpers/tableCreateEncodingTarget'); bindTableCreateEncodingTarget(() => process.env, process.env);
  if (require('node:fs').existsSync('.cache/dbark-test.env')) throw Error('新表编码正式定义拒绝认证文件回填');
  const { registerTableCreateEncodingUiTests } = require('./table-create-encoding-live'); registerTableCreateEncodingUiTests();
} else test.skip('新表字符集排序规则正式定义默认关闭（实际0）', () => {});
