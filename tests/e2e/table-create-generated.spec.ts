import { test } from '@playwright/test';

// 列举最先短路；默认关闭时不加载桌面、凭据、文件或数据库模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_GENERATED_UI === '1') {
  require('./table-create-generated-live').registerTableCreateGeneratedUiTests();
} else test.skip('新建表多生成列正式表单专项默认关闭（未执行）', () => {});
