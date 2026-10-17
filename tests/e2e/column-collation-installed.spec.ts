import { test } from '@playwright/test';

// 列表先短路；默认或单门关闭不读认证，也不加载桌面owner、driver或实库模块。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_COLUMN_COLLATION_UI === '1') {
  const { bindColumnCollationInstalledTarget } = require('../helpers/columnCollationInstalledUi') as typeof import('../helpers/columnCollationInstalledUi');
  const binding = bindColumnCollationInstalledTarget(() => process.env, process.argv, process.platform);
  require('./column-collation-installed-ui').registerColumnCollationInstalledUi(binding);
} else test.skip('Windows安装产物列排序规则实库UI默认关闭（未执行）', () => {});
