import { test } from '@playwright/test';

// 列表与默认关闭只登记，不读取凭据、目录或启动Electron。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_PRESETS_RESTART_UI === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const original = bindQueryResultColumnsUiTarget(() => process.env, helper);
  const keys = ['DBARK_QUERY_RESULT_PRESETS_RESTART_UI', 'DBARK_QUERY_PRESET_RESTART_MANIFEST', 'DBARK_QUERY_PRESET_RESTART_MANIFEST_SHA256', 'DBARK_EXECUTABLE_PATH'];
  const fixed = keys.map(key => ({ key, present: Object.hasOwn(process.env, key), value: process.env[key] })), args = [...process.argv]; let invalid = false;
  const binding = { target: original.target, assertCurrent() {
    try {
      original.assertCurrent();
      if (invalid || fixed.some(item => Object.hasOwn(process.env, item.key) !== item.present || process.env[item.key] !== item.value) || process.argv.length !== args.length || process.argv.some((value, index) => value !== args[index])) throw Error('结果方案重启验收授权已变化');
      if (!['win32', 'darwin'].includes(process.platform) || !process.env.DBARK_QUERY_PRESET_RESTART_MANIFEST || !/^[a-f0-9]{64}$/.test(process.env.DBARK_QUERY_PRESET_RESTART_MANIFEST_SHA256 ?? '')) throw Error('结果方案重启缺少原运行身份批准');
      if (Object.keys(process.env).some(key => (key.toUpperCase().startsWith('DBARK_') && key !== key.toUpperCase()) || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key.toUpperCase()))) throw Error('结果方案重启拒绝外部renderer、用户目录或预加载环境');
      if (args.some((value, index) => value === '--config' || value === '-c' || value.startsWith('--config=') || /^-c./.test(value) || ['--ui', '--debug'].includes(value) || value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off')) throw Error('结果方案重启拒绝替换配置、交互运行器或录制');
    } catch (reason) { invalid = true; throw reason; }
  } };
  binding.assertCurrent();
  require('./query-result-presets-restart-live').registerQueryResultPresetsRestart(binding, { manifestPath: process.env.DBARK_QUERY_PRESET_RESTART_MANIFEST!, approvedHash: process.env.DBARK_QUERY_PRESET_RESTART_MANIFEST_SHA256! });
} else test.skip('命名整理方案独立客户端重启验收默认关闭（未执行）', () => {});
