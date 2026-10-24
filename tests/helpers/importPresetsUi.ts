export const importPresetsUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_IMPORT_PRESETS_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_IMPORT_PRESETS_UI_OWNER', 'DBARK_IMPORT_PRESETS_UI_MANIFEST', 'DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256', 'DBARK_IMPORT_PRESETS_UI_OUTPUT', 'DBARK_IMPORT_PRESETS_UI_CSV_A', 'DBARK_IMPORT_PRESETS_UI_CSV_A_SHA256', 'DBARK_IMPORT_PRESETS_UI_CSV_BAD', 'DBARK_IMPORT_PRESETS_UI_CSV_BAD_SHA256', 'DBARK_IMPORT_PRESETS_UI_CSV_B', 'DBARK_IMPORT_PRESETS_UI_CSV_B_SHA256'] as const;

/** 默认及列表先短路，只读两个开关；不加载live、桌面、mysql或认证配置。 */
export function importPresetsUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_IMPORT_PRESETS_UI_TEST === '1';
}

/** 只准消费Root预置唯一随机库；这里仅验证RAM，不探测磁盘或服务器。 */
export function assertImportPresetsUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !importPresetsUiActive(env, args)) throw Error('导入配置导入正式专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_importpresetsui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-import-presets-ui:[a-f0-9]{32}$/.test(env.DBARK_IMPORT_PRESETS_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('导入配置导入原200/13384/UUID、随机库或owner无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_IMPORT_PRESETS_UI_MANIFEST) || !absolute(env.DBARK_IMPORT_PRESETS_UI_OUTPUT) || !/^[a-f0-9]{64}$/.test(env.DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256 ?? '')) throw Error('导入配置缺少批准来源或独占输出目录');
  for (const name of ['A', 'BAD', 'B']) if (!absolute(env['DBARK_IMPORT_PRESETS_UI_CSV_' + name]) || !/\.csv$/i.test(env['DBARK_IMPORT_PRESETS_UI_CSV_' + name] ?? '') || !/^[a-f0-9]{64}$/.test(env['DBARK_IMPORT_PRESETS_UI_CSV_' + name + '_SHA256'] ?? '')) throw Error('导入配置缺少三份准确CSV路径及字节批准');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('导入配置导入拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('导入配置导入拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('导入配置导入拒绝替代配置和交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('导入配置导入拒绝CLI开启trace');
}

/** 捕获所有相关键存在性和argv；首次漂移永久停链，改回也不能复活。 */
export function bindImportPresetsUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => {
    const current = read(); assertImportPresetsUiEnvironment(current.env, current.args, current.platform);
    return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]);
  };
  const original = signature(), values = Object.freeze(Object.fromEntries(importPresetsUiKeys.map(key => [key, read().env[key]!])) as Record<typeof importPresetsUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('导入配置导入原环境已失效，保留现场'); try { if (signature() !== original) throw Error('导入配置导入原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

/** Root唯一资源合同；text均须以GB18030无BOM写入，不调用待验CSV导出器。 */
export function importPresetsUiFixture(database: string, marker: string) {
  if (!/^dbark_importpresetsui_[a-f0-9]{32}$/.test(database) || !/^dbark-import-presets-ui:[a-f0-9]{32}$/.test(marker)) throw Error('导入配置隔离资源身份无效');
  const qualified = '`' + database + '`.`target`', columns = ['第1列', '第2列', '第3列', '第4列', '第5列', '第6列'], targetColumns = ['第1列', 'amount', 'payload', 'note', 'nullable_note', 'literal_slash'];
  const decodedA = [['9007199254740993', '111.000000000001', 'base64:AQ==', '仅预览A首条', null, '\\A'], ['9007199254740994', '-111.000000000001', 'base64:', '仅预览A第二条', 'A原文', '\\A2']];
  const decodedBad = [['1', '1.000000000000', 'base64:', 'bad', 'note', 'literal', 'extra'], ['2', '2.000000000000', 'base64:', 'bad2', 'note2', 'literal2', 'extra2']];
  const decodedB = [['18446744073709551615', '9007199254740993.123456789012', 'base64:AP8=', '中文"B首条"\r\n下一行', null, '\\N'], ['18446744073709551614', '-9007199254740993.123456789011', 'base64:', 'B第二条', '原文', '\\path']];
  const files = {
    a: { fileName: 'source-a.csv', encoding: 'gb18030' as const, text: '9007199254740993;111.000000000001;base64:AQ==;仅预览A首条;\\N;\\\\A\r\n9007199254740994;-111.000000000001;base64:;仅预览A第二条;A原文;\\\\A2\r\n', decoded: decodedA },
    bad: { fileName: 'source-bad.csv', encoding: 'gb18030' as const, text: '1;1.000000000000;base64:;bad;note;literal;extra\r\n2;2.000000000000;base64:;bad2;note2;literal2;extra2\r\n', decoded: decodedBad },
    b: { fileName: 'source-b.csv', encoding: 'gb18030' as const, text: '18446744073709551615;9007199254740993.123456789012;base64:AP8=;"中文""B首条""\r\n下一行";\\N;\\\\N\r\n18446744073709551614;-9007199254740993.123456789011;base64:;B第二条;原文;\\\\path\r\n', decoded: decodedB },
  };
  return {
    database, marker, qualified, files, columns, targetColumns, presetName: '本例GB18030分号无标题配置', temporaryPresetName: '本例待删除临时导入配置', updatedPresetName: '本例已更新GB18030分号配置',
    configuration: { format: 'csv' as const, encoding: 'gb18030' as const, csvDelimiter: ';' as const, csvHasHeader: false, columns, mapping: Object.fromEntries(columns.map((column, index) => [column, targetColumns[index]])) },
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', 'CREATE TABLE ' + qualified + ' (`第1列` BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,payload BLOB NOT NULL,note TEXT NOT NULL,nullable_note VARCHAR(80) NULL,literal_slash VARCHAR(80) NOT NULL) ENGINE=InnoDB'],
    seedOwner: 'INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", drop: 'DROP DATABASE `' + database + '`',
  };
}

interface PickerDialog { showOpenDialog(...args: any[]): Promise<any>; }
interface PickerWindow { isDestroyed(): boolean; webContents: { id: number }; }
interface PickerState { owner: string; original: PickerDialog['showOpenDialog']; window: PickerWindow; paths: string[]; records: string[]; failed: boolean; active?: object; }

/** 三次独立一次性回答器严格顺序消费；原Main仍从真实选择结果签发不可伪造文件能力。 */
export function installImportPresetsUiChoice({ dialog, BrowserWindow }: { dialog: PickerDialog; BrowserWindow: { getAllWindows(): PickerWindow[] } }, input: { owner: string; senderId: number; paths: string[]; index: number }): void {
  const root = globalThis as typeof globalThis & { __importPresetsUiPicker?: PickerState }, previous = root.__importPresetsUiPicker;
  if (!/^dbark-import-presets-ui:[a-f0-9]{32}$/.test(input.owner) || input.paths.length !== 3 || new Set(input.paths).size !== 3 || input.paths.some(path => !/^(?:[a-z]:[\\/]|\\\\)/i.test(path) || !/\.csv$/i.test(path))) throw Error('导入配置文件选择身份无效');
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()); if (windows.length !== 1 || windows[0].webContents.id !== input.senderId) throw Error('导入配置原窗口不唯一');
  const state: PickerState = previous ?? { owner: input.owner, original: dialog.showOpenDialog, window: windows[0], paths: [...input.paths], records: [], failed: false };
  if (state.failed || state.active || state.owner !== input.owner || state.window !== windows[0] || dialog.showOpenDialog !== state.original || JSON.stringify(state.paths) !== JSON.stringify(input.paths) || input.index !== state.records.length || input.index < 0 || input.index >= 3) throw Error('导入配置文件选择前序未闭合或顺序变化');
  const ticket = {}; state.active = ticket; root.__importPresetsUiPicker = state;
  const wrapper: PickerDialog['showOpenDialog'] = async (...args: any[]) => {
    if (root.__importPresetsUiPicker !== state || state.active !== ticket || state.failed || dialog.showOpenDialog !== wrapper) { state.failed = true; throw Error('导入配置旧选择器不能接管新一次请求'); }
    dialog.showOpenDialog = state.original; state.active = undefined;
    try {
      const expected = { title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] };
      if (args.length !== 2 || args[0] !== state.window || state.window.isDestroyed() || JSON.stringify(args[1]) !== JSON.stringify(expected) || state.records.length !== input.index) throw Error('导入配置本次准确CSV选择选项变化');
      state.records.push(state.paths[input.index]); return { canceled: false, filePaths: [state.paths[input.index]] };
    } catch (error) { state.failed = true; throw error; }
  };
  dialog.showOpenDialog = wrapper;
}

/** 只读消费证据和原函数恢复，不把安装成功当作本次选择已发生。 */
export function readImportPresetsUiChoices({ dialog }: { dialog: PickerDialog }, input: { owner: string; count: number }) {
  const state = (globalThis as typeof globalThis & { __importPresetsUiPicker?: PickerState }).__importPresetsUiPicker;
  if (!state || state.failed || state.active || state.owner !== input.owner || state.records.length !== input.count || dialog.showOpenDialog !== state.original) throw Error('导入配置本次文件选择或原函数恢复未确认');
  return { paths: [...state.records], consumed: input.count, originalRestored: true, nativeInputVerified: false };
}
