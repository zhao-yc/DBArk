import { test } from '@playwright/test';

// --list 优先短路：即使外部环境误开许可，也不导入私有配置、桌面 fixture 或数据库工具。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_COPY_INSERT_SQL_UI === '1' && process.env.DBARK_COPY_INSERT_SQL_NATIVE_CLIPBOARD === '1') {
  const { registerCopyInsertSqlNativeTest } = require('./copy-insert-sql-live'); registerCopyInsertSqlNativeTest();
} else test.skip('真实表页当前及选中行复制 INSERT、草稿与生成列拒绝（默认关闭，实际剪贴板操作为零）', () => {});
