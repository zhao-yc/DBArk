import { test } from '@playwright/test';
// 列表在读取实跑配置前短路；既有integration许可不能单独开启本专项。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_SELECTED_RESULTS_EXPORT_UI === '1') {
  const { registerSelectedResultsExport } = require('./query-selected-results-export-live'); registerSelectedResultsExport();
} else test.skip('查询结果勾选行按原顺序导出固定快照，切换和新执行清选择且不重执行SQL', () => {});
