import { test } from '@playwright/test';
// 真正--list先于一切专项环境读取；默认关闭不导入live、桌面、驱动或任何认证材料。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_S02_SERVER_MONITOR_UI_TEST === '1') {
  const { bindServerMonitorUiTarget, serverMonitorUiKeys } = require('../helpers/serverMonitorUi') as typeof import('../helpers/serverMonitorUi');
  const helper = Object.fromEntries(serverMonitorUiKeys.filter(key => Object.hasOwn(process.env,key)).map(key => [key,process.env[key]]));
  const binding = bindServerMonitorUiTarget(() => process.env,helper);
  const { registerServerMonitorUi } = require('./server-monitor-live'); registerServerMonitorUi(binding);
} else test.skip('S02准确13384只读监控概要、状态及有限会话，手动刷新一次并正常收尾（默认关闭）', () => {});
