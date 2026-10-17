import { test } from '@playwright/test';

// list优先短路；即使双门打开也只有准备占位，绝不导入旧live、桌面、驱动或认证helper。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_MYSQL80_UI === '1') {
  const { tableCreatePreparationProfile } = require('../../src/shared/tableCreateProfiles');
  const profile = tableCreatePreparationProfile('mysql', '8.0.46');
  // 修改状态不能意外触发旧8.4回调；Root授权激活时须另接准确版本的正式执行链。
  if (profile.state !== 'prepared' || profile.canWrite !== false) throw Error('8.0.46正式新建表执行链尚未激活，拒绝借旧入口写入');
  test.skip('MySQL8.0.46新建表正式UI仅兼容准备，等待Root另行激活（实际0）', () => {});
} else test.skip('MySQL8.0.46新建表正式UI准备入口默认关闭（实际0）', () => {});
