import { test } from '@playwright/test';

// 列表先于环境读取；新门仅保留未来隔离例位置，不导入旧live、桌面、驱动或认证配置。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CREATE_FOREIGN_KEYS_UI === '1') {
  test.skip('新建表复合外键正式隔离UI仅准备，待Root绑定UUID和建库前预检及独立退出清理接线（实际0）', () => {});
} else test.skip('新建表外键后核正式隔离UI准备入口默认关闭（实际0）', () => {});
