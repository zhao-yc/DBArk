import { test } from '@playwright/test';

// 默认关闭及--list先短路，禁止列举加载桌面、凭据、清单和数据库驱动。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_CHILD_REFERENCE_UI === '1') {
  require('./child-reference-live').registerChildReferenceUiTests();
} else test.skip('父子记录关联正式窗口专项默认关闭（未执行）', () => {});
