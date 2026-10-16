import { test } from '@playwright/test';

// --list先短路：双门已开也不读配置、不导入桌面、私网或观察连接模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_CSV_EXPORT_FIELDS_UI === '1') {
  const { registerCsvExportFieldsUiTests } = require('./csv-export-fields-live'); registerCsvExportFieldsUiTests();
} else test.skip('CSV表导出字段正式UI默认关闭（员工5实际0）', () => {});
