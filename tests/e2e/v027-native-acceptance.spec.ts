import { test } from '@playwright/test';

// 必须先识别list；此路径不读凭据、env文件，不加载桌面、驱动或live实现。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_V027_NATIVE_ACCEPTANCE === '1' && process.env.DBARK_INTEGRATION_ENABLED === '1') {
  const { registerV027Acceptance } = require('./v027-native-acceptance-live') as typeof import('./v027-native-acceptance-live');
  registerV027Acceptance();
} else {
  test.skip('0.27 CSV分隔符与映射真实验收：Root未开启，实际执行0', () => {});
  test.skip('0.27 新表时间属性与前缀真实验收：Root未开启，实际执行0', () => {});
}
