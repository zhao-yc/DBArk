import { test } from '@playwright/test';

// 默认及列表只注册跳过身份；绝不加载桌面、驱动、凭据文件或实库帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_D02_BATCH_FILL_UI === '1') {
  const { bindBatchFillTarget } = require('../helpers/tableBatchFillLive') as typeof import('../helpers/tableBatchFillLive');
  const binding = bindBatchFillTarget(() => process.env);
  const { registerTableBatchFill } = require('./table-batch-fill-live') as typeof import('./table-batch-fill-live');
  registerTableBatchFill(binding);
} else {
  test.skip('批量填充：两条已有行暂存不写库，一步撤销重做后集中提交且精确旁列保持', () => {});
  test.skip('批量填充：预览后第二行外改导致整批冲突回滚，草稿保留且不自动重放', () => {});
  test.skip('批量填充：四字段统一值一步暂存撤销重做，精确集中提交且控制行保持', () => {});
  test.skip('批量填充：四字段预览后旁列外改，整组事务回滚且草稿保留', () => {});
}
