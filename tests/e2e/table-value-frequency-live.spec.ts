import { test } from '@playwright/test';

// 列表及默认关闭先短路，不加载桌面、读取凭据或连接真实数据库。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_VALUE_OPTIONS_UI === '1' && process.env.DBARK_VALUE_FREQUENCY_LIVE === '1') {
  require('./table-value-frequency-live').registerTableValueFrequencyLiveTests();
} else test.skip('服务器不同值次数排序真实物理表专项默认关闭（未执行）', () => {});
