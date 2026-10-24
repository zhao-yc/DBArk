export const csvHeaderUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_CSV_HEADER_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_CSV_HEADER_UI_OWNER', 'DBARK_CSV_HEADER_UI_MANIFEST', 'DBARK_CSV_HEADER_UI_MANIFEST_SHA256', 'DBARK_CSV_HEADER_UI_OUTPUT', 'DBARK_CSV_HEADER_UI_CSV', 'DBARK_CSV_HEADER_UI_CSV_SHA256'] as const;

/** 默认及列表先短路，只读两个开关；不加载live、桌面、mysql或认证配置。 */
export function csvHeaderUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_CSV_HEADER_UI_TEST === '1';
}

/** 只准消费Root预置唯一随机库；这里仅验证RAM，不探测磁盘或服务器。 */
export function assertCsvHeaderUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !csvHeaderUiActive(env, args)) throw Error('无标题CSV导入正式专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_csvheaderui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-csv-header-ui:[a-f0-9]{32}$/.test(env.DBARK_CSV_HEADER_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('无标题CSV导入原200/13384/UUID、随机库或owner无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_CSV_HEADER_UI_MANIFEST) || !absolute(env.DBARK_CSV_HEADER_UI_OUTPUT) || !absolute(env.DBARK_CSV_HEADER_UI_CSV) || !/\.csv$/i.test(env.DBARK_CSV_HEADER_UI_CSV ?? '') || !/^[a-f0-9]{64}$/.test(env.DBARK_CSV_HEADER_UI_MANIFEST_SHA256 ?? '') || !/^[a-f0-9]{64}$/.test(env.DBARK_CSV_HEADER_UI_CSV_SHA256 ?? '')) throw Error('无标题CSV导入缺少批准绝对来源、CSV、SHA256或独占输出目录');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('无标题CSV导入拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('无标题CSV导入拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('无标题CSV导入拒绝替代配置和交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('无标题CSV导入拒绝CLI开启trace');
}

/** 捕获所有相关键存在性和argv；首次漂移永久停链，改回也不能复活。 */
export function bindCsvHeaderUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => {
    const current = read(); assertCsvHeaderUiEnvironment(current.env, current.args, current.platform);
    return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]);
  };
  const original = signature(), values = Object.freeze(Object.fromEntries(csvHeaderUiKeys.map(key => [key, read().env[key]!])) as Record<typeof csvHeaderUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('无标题CSV导入原环境已失效，保留现场'); try { if (signature() !== original) throw Error('无标题CSV导入原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

/** 由Root显式预置的合成资源计划；不执行文件、数据库、授权或清理动作。 */
export function csvHeaderUiFixture(database: string, marker: string) {
  if (!/^dbark_csvheaderui_[a-f0-9]{32}$/.test(database) || !/^dbark-csv-header-ui:[a-f0-9]{32}$/.test(marker)) throw Error('无标题CSV隔离资源身份无效');
  const qualified = '`' + database + '`.`target`';
  // 手写CSV独立于待验导出器：CRLF存在于第一条引号字段内，反斜线协议的两种值刻意不同。
  const first = ['18446744073709551615', '9007199254740993.123456789012', 'base64:AP8=', '中文"首条"\r\n下一行', null, '\\N'] as const;
  const second = ['18446744073709551614', '-9007199254740993.123456789011', 'base64:', '第二条', '原文', '\\path'] as const;
  const csvText = '18446744073709551615,9007199254740993.123456789012,base64:AP8=,"中文""首条""\r\n下一行",\\N,\\\\N\r\n18446744073709551614,-9007199254740993.123456789011,base64:,第二条,原文,\\\\path\r\n';
  const headerColumns = ['18446744073709551615', '9007199254740993.123456789012', 'base64:AP8=', first[3], '\\N', '\\\\N'];
  const positionalColumns = ['第1列', '第2列', '第3列', '第4列', '第5列', '第6列'];
  const targetColumns = ['第1列', 'amount', 'payload', 'note', 'nullable_note', 'literal_slash'];
  return {
    database, marker, qualified, csvText, headerColumns, positionalColumns, targetColumns, decoded: [first, second],
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', 'CREATE TABLE ' + qualified + ' (`第1列` BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,payload BLOB NOT NULL,note TEXT NOT NULL,nullable_note VARCHAR(80) NULL,literal_slash VARCHAR(80) NOT NULL) ENGINE=InnoDB'],
    seedOwner: 'INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", drop: 'DROP DATABASE `' + database + '`',
  };
}

interface PickerDialog { showOpenDialog(...args: any[]): Promise<any>; }
interface PickerWindow { isDestroyed(): boolean; webContents: { id: number }; }
interface PickerState { owner: string; consumed: boolean; failed: boolean; original: PickerDialog['showOpenDialog']; wrapper: PickerDialog['showOpenDialog']; path: string; }

/** 仅回答原窗口本次准确CSV打开请求一次；真实files.choose仍自行签发和保存文件令牌。 */
export function installCsvHeaderUiFileChoice({ dialog, BrowserWindow }: { dialog: PickerDialog; BrowserWindow: { getAllWindows(): PickerWindow[] } }, input: { owner: string; senderId: number; path: string }): void {
  const root = globalThis as typeof globalThis & { __csvHeaderUiPicker?: PickerState };
  if (root.__csvHeaderUiPicker || !/^dbark-csv-header-ui:[a-f0-9]{32}$/.test(input.owner) || !/^(?:[a-z]:[\\/]|\\\\)/i.test(input.path) || !/\.csv$/i.test(input.path)) throw Error('无标题CSV文件选择适配器身份无效');
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
  if (windows.length !== 1 || windows[0].webContents.id !== input.senderId) throw Error('无标题CSV文件选择原窗口不唯一');
  const window = windows[0], original = dialog.showOpenDialog;
  const state: PickerState = { owner: input.owner, consumed: false, failed: false, original, path: input.path, wrapper: undefined! };
  const wrapper: PickerDialog['showOpenDialog'] = async (...args: any[]) => {
    if (root.__csvHeaderUiPicker !== state || state.consumed || state.failed || dialog.showOpenDialog !== wrapper) { state.failed = true; throw Error('无标题CSV旧文件选择回调不能接管'); }
    state.consumed = true; dialog.showOpenDialog = original;
    try {
      const options = args[1], expected = { title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] };
      if (args.length !== 2 || args[0] !== window || window.isDestroyed() || JSON.stringify(options) !== JSON.stringify(expected)) throw Error('无标题CSV文件选择用途或选项越界');
      return { canceled: false, filePaths: [input.path] };
    } catch (error) { state.failed = true; throw error; }
  };
  state.wrapper = wrapper; root.__csvHeaderUiPicker = state; dialog.showOpenDialog = wrapper;
}

/** 消费与恢复必须同时核对，安装适配器本身不构成文件选择完成证据。 */
export function readCsvHeaderUiFileChoice({ dialog }: { dialog: PickerDialog }, owner: string) {
  const state = (globalThis as typeof globalThis & { __csvHeaderUiPicker?: PickerState }).__csvHeaderUiPicker;
  if (!state || state.owner !== owner || !state.consumed || state.failed || dialog.showOpenDialog !== state.original) throw Error('无标题CSV原文件选择未确认终态');
  return { owner, consumed: true, originalRestored: true, path: state.path, nativeInputVerified: false };
}
