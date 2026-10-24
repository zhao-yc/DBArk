import { test } from '@playwright/test';

export const resultInsertUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_RESULT_INSERT_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_RESULT_INSERT_UI_OWNER', 'DBARK_RESULT_INSERT_UI_MANIFEST', 'DBARK_RESULT_INSERT_UI_MANIFEST_SHA256', 'DBARK_RESULT_INSERT_UI_OUTPUT'] as const;

/** 默认及列表先短路，只读两个开关；不加载live、桌面、mysql或认证配置。 */
export function resultInsertUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_RESULT_INSERT_UI_TEST === '1';
}

/** 只准消费Root预置唯一随机库；这里仅验证RAM，不探测磁盘或服务器。 */
export function assertResultInsertUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !resultInsertUiActive(env, args)) throw Error('结果写入已有表正式专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_resultinsertui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-result-insert-ui:[a-f0-9]{32}$/.test(env.DBARK_RESULT_INSERT_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('结果写入已有表原200/13384/UUID、随机库或owner无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_RESULT_INSERT_UI_MANIFEST) || !absolute(env.DBARK_RESULT_INSERT_UI_OUTPUT) || !/^[a-f0-9]{64}$/.test(env.DBARK_RESULT_INSERT_UI_MANIFEST_SHA256 ?? '')) throw Error('结果写入已有表缺少批准绝对来源、SHA256或独占输出目录');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('结果写入已有表拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('结果写入已有表拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('结果写入已有表拒绝替代配置和交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('结果写入已有表拒绝CLI开启trace');
}

/** 捕获所有相关键存在性和argv；首次漂移永久停链，改回也不能复活。 */
export function bindResultInsertUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => {
    const current = read(); assertResultInsertUiEnvironment(current.env, current.args, current.platform);
    return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]);
  };
  const original = signature(), values = Object.freeze(Object.fromEntries(resultInsertUiKeys.map(key => [key, read().env[key]!])) as Record<typeof resultInsertUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('结果写入已有表原环境已失效，保留现场'); try { if (signature() !== original) throw Error('结果写入已有表原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

if (resultInsertUiActive(process.env, process.argv)) {
  const environment = bindResultInsertUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  require('./result-insert-live').registerResultInsertUiTests(environment);
} else test.skip('结果写入已有表正式窗口专项默认关闭（未执行）', () => {});
