import { test } from '@playwright/test';

// 默认及 --list 均不导入桌面和回环协议模块；只有统筹显式打开两个开关才注册真实 UI 用例。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_E2E === '1' && process.env.DBARK_SCHEMA_COMPARE_RESULTS_UI === '1') {
  const { registerSchemaCompareResultsUiTests } = require('./schemaCompareResults.ui'); registerSchemaCompareResultsUiTests();
} else test.skip('M02结构差异组合筛选与隐藏选择正式UI默认关闭（员工3实际0）', () => {});
