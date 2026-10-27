import { test } from '@playwright/test';

// 列举与默认关闭先短路，不加载桌面、mysql2、资源清单或任何凭据。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_ROUTINE_INVOCATION_UI === '1') {
  require('./routine-invocation-live').registerRoutineInvocationUi();
} else test.skip('例程调用草稿与明确执行的真实窗口专项默认关闭（未执行）', () => {});
