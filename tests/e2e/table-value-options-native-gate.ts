import { win32 } from 'node:path';

export const tableValueOptionsUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_VALUE_OPTIONS_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_VALUE_OPTIONS_OWNER', 'DBARK_TABLE_VALUE_OPTIONS_MANIFEST', 'DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256'] as const;
/** 默认及列表只登记测试，不读取凭据文件、不加载桌面或探测数据库。 */
export function tableValueOptionsUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_VALUE_OPTIONS_UI === '1';
}
/** 正式专项只读Root预置的准确随机库，不接受任意数据库、端口或替代运行器。 */
export function assertTableValueOptionsUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !tableValueOptionsUiActive(env, args)) throw Error('表页不同值源码专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || env.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_tablevalues_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '')) throw Error('表页不同值专项须准确200/13384/UUID及Root预置唯一随机库');
  if (!/^dbark-table-value-options:[a-f0-9]{32}$/.test(env.DBARK_TABLE_VALUE_OPTIONS_OWNER ?? '')) throw Error('表页不同值专项缺少Root预置资源原owner');
  if (!env.DBARK_TABLE_VALUE_OPTIONS_MANIFEST || !win32.isAbsolute(env.DBARK_TABLE_VALUE_OPTIONS_MANIFEST) || !/^[a-f0-9]{64}$/.test(env.DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256 ?? '')) throw Error('表页不同值专项缺少Root批准的绝对来源清单及SHA256');
  for (const key of Object.keys(env)) {
    if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('表页不同值专项拒绝环境大小写别名');
    if (['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) throw Error('表页不同值源码专项拒绝替代运行环境');
  }
  for (const [index, value] of args.entries()) {
    if (/^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value) || /^-c./.test(value)) throw Error('表页不同值专项拒绝替代配置或交互运行器');
    if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('表页不同值专项禁止开启trace');
  }
}
/** 源环境、argv一旦漂移即永久停链，改回原值不能复活本例授权。 */
export function bindTableValueOptionsUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const value = read(); assertTableValueOptionsUiEnvironment(value.env, value.args, value.platform); return JSON.stringify([value.platform, value.args, Object.keys(value.env).filter(key => /^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, value.env[key]])]); };
  const original = signature(); const values = Object.fromEntries(tableValueOptionsUiKeys.map(key => [key, read().env[key]])) as Record<typeof tableValueOptionsUiKeys[number], string | undefined>; let invalid = false;
  return { values, assertCurrent() { if (invalid) throw Error('表页不同值原环境已失效，保留现场'); try { if (signature() !== original) throw Error('表页不同值原环境已变化'); } catch (reason) { invalid = true; throw reason; } } };
}

export interface TableValueOptionsConfirmationRecord { method: 'sync' | 'async'; options: Record<string, unknown>; choice: 'reject' | 'accept'; cancelIndex: 0 | 1; acceptIndex: 0 | 1; response: 0 | 1; }
/** 测试适配器仅回答一次准确原生确认，先恢复两个Electron函数；不替换window.confirm或产品状态。 */
export function installTableValueOptionsConfirmation({ dialog }: { dialog: any }, input: { owner: string; expected: string; choice: 'reject' | 'accept' }): void {
  const root = globalThis as any, key = '__dbarkTableValueOptionsConfirmation';
  const { owner, expected, choice } = input;
  if (!/^dbark-table-value-options:[a-f0-9]{32}$/.test(owner) || !expected || !['reject', 'accept'].includes(choice)) throw Error('不同值原生确认适配器缺少准确owner或回答');
  let state = root[key];
  if (!state) state = root[key] = { owner, sync: dialog.showMessageBoxSync, asynchronous: dialog.showMessageBox, records: [], failed: false, pending: undefined };
  if (state.owner !== owner || state.failed || state.pending || dialog.showMessageBoxSync !== state.sync || dialog.showMessageBox !== state.asynchronous) throw Error('不同值原生确认适配器原归属或函数已变化');
  const ticket = {}; state.pending = ticket;
  let sync: (...args: unknown[]) => number, asynchronous: (...args: unknown[]) => Promise<{ response: number; checkboxChecked: boolean }>;
  /** 同一次实际调用消费唯一ticket；其他message也先恢复端口，然后拒绝且永久停链。 */
  const answer = (args: unknown[], method: 'sync' | 'async') => {
    if (state.pending !== ticket || state.failed || dialog.showMessageBoxSync !== sync || dialog.showMessageBox !== asynchronous) throw Error('不同值原生确认适配器发生重入或端口漂移');
    dialog.showMessageBoxSync = state.sync; dialog.showMessageBox = state.asynchronous; state.pending = undefined;
    try {
      const options = args.at(-1) as Record<string, unknown>;
      if (!options || options.message !== expected || !Array.isArray(options.buttons) || options.buttons.length !== 2 || options.buttons.some(value => typeof value !== 'string')) throw Error('拒绝其它原生确认使用不同值本例回答');
      const buttons = options.buttons as string[], namedCancel = buttons.map((label, index) => ['Cancel', '取消'].includes(label) ? index : -1).filter(index => index >= 0);
      const explicitCancel = options.cancelId;
      let cancelIndex: 0 | 1;
      if (explicitCancel === 0 || explicitCancel === 1) {
        cancelIndex = explicitCancel;
        if (namedCancel.length && (namedCancel.length !== 1 || namedCancel[0] !== cancelIndex)) throw Error('原生确认cancelId与明确取消按钮冲突');
      } else {
        if (explicitCancel !== undefined || namedCancel.length !== 1) throw Error('原生确认没有唯一明确取消索引');
        cancelIndex = namedCancel[0] as 0 | 1;
      }
      const acceptIndex = (1 - cancelIndex) as 0 | 1;
      if (!['OK', 'Ok', '确定', '确认', 'Yes', '是'].includes(buttons[acceptIndex])) throw Error('原生确认另一按钮不是明确接受按钮');
      const response = choice === 'reject' ? cancelIndex : acceptIndex;
      state.records.push({ method, options: structuredClone(options), choice, cancelIndex, acceptIndex, response });
      return { response, checkboxChecked: false };
    } catch (reason) { state.failed = true; throw reason; }
  };
  sync = (...args) => answer(args, 'sync').response; asynchronous = async (...args) => answer(args, 'async');
  dialog.showMessageBoxSync = sync; dialog.showMessageBox = asynchronous;
}
/** 回读要求准确原owner、一次性回答已消费且两个原函数均恢复，不以安装适配器当实际调用。 */
export function readTableValueOptionsConfirmations({ dialog }: { dialog: any }, owner: string): TableValueOptionsConfirmationRecord[] {
  const state = (globalThis as any).__dbarkTableValueOptionsConfirmation;
  if (!state || state.owner !== owner || state.failed || state.pending || dialog.showMessageBoxSync !== state.sync || dialog.showMessageBox !== state.asynchronous) throw Error('不同值原生确认尚未消费或原端口未恢复');
  return structuredClone(state.records);
}
