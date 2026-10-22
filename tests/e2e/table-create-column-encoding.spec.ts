import { test } from '@playwright/test';

// 列举在所有环境读取之前短路；默认关闭不加载桌面、认证、清单或数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_COLUMN_ENCODING_UI === '1') {
  require('./table-create-column-encoding-live').registerTableCreateColumnEncodingUiTests();
} else test.skip('新建表列级编码正式表单专项默认关闭（未执行）', () => {});
