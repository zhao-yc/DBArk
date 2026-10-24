export const fileImportTransactionUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_FILE_IMPORT_TRANSACTION_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER', 'DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST', 'DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256', 'DBARK_FILE_IMPORT_TRANSACTION_UI_OUTPUT', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_ATOMIC_BAD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_ATOMIC_BAD_SHA256', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_BATCH_BAD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_BATCH_BAD_SHA256', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_GOOD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_GOOD_SHA256'] as const;

/** 默认及列表先短路，只读两个开关；不加载live、桌面、mysql或认证配置。 */
export function fileImportTransactionUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_FILE_IMPORT_TRANSACTION_UI_TEST === '1';
}

/** 只准消费Root预置唯一随机库；这里仅验证RAM，不探测磁盘或服务器。 */
export function assertFileImportTransactionUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !fileImportTransactionUiActive(env, args)) throw Error('文件导入事务导入正式专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_importtransactionui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-file-import-transaction-ui:[a-f0-9]{32}$/.test(env.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('文件导入事务导入原200/13384/UUID、随机库或owner无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST) || !absolute(env.DBARK_FILE_IMPORT_TRANSACTION_UI_OUTPUT) || !/^[a-f0-9]{64}$/.test(env.DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256 ?? '')) throw Error('文件导入事务缺少批准来源或独占输出目录');
  for (const name of ['ATOMIC_BAD', 'BATCH_BAD', 'GOOD']) if (!absolute(env['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name]) || !/\.csv$/i.test(env['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name] ?? '') || !/^[a-f0-9]{64}$/.test(env['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name + '_SHA256'] ?? '')) throw Error('文件导入事务缺少三份准确CSV路径及字节批准');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('文件导入事务导入拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('文件导入事务导入拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('文件导入事务导入拒绝替代配置和交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('文件导入事务导入拒绝CLI开启trace');
}

/** 捕获所有相关键存在性和argv；首次漂移永久停链，改回也不能复活。 */
export function bindFileImportTransactionUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => {
    const current = read(); assertFileImportTransactionUiEnvironment(current.env, current.args, current.platform);
    return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]);
  };
  const original = signature(), values = Object.freeze(Object.fromEntries(fileImportTransactionUiKeys.map(key => [key, read().env[key]!])) as Record<typeof fileImportTransactionUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('文件导入事务导入原环境已失效，保留现场'); try { if (signature() !== original) throw Error('文件导入事务导入原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

/** Root预置资源及独立数学期待；两份坏文件同字节但不同路径/目标，每份只明确执行一次。 */
export function fileImportTransactionUiFixture(database: string, marker: string) {
  if (!/^dbark_importtransactionui_[a-f0-9]{32}$/.test(database) || !/^dbark-file-import-transaction-ui:[a-f0-9]{32}$/.test(marker)) throw Error('文件导入事务隔离资源身份无效');
  const columns = ['id', 'amount', 'payload', 'note', 'nullable_note', 'literal_slash'], tables = ['atomic_target', 'batch_target'] as const;
  const qualified = (table: typeof tables[number]) => '`' + database + '`.`' + table + '`';
  const goodPrefix = Array.from({ length: 501 }, (_, index) => { const i = index + 1; return [String(10000 + i), '123456789012345678.' + String(i).padStart(12, '0'), i % 2 ? 'base64:AP8=' : 'base64:', i === 1 ? '合成"首条"\r\n下一行' : '合成-' + i, i % 2 ? null : '非空-' + i, '\\row-' + i]; });
  const header = 'id,amount,payload,note,nullable_note,literal_slash\r\n';
  // 合成文本手写协议，不调用产品CSV导出器或SQL生成器计算期望。
  const badText = header + Array.from({ length: 501 }, (_, index) => { const i = index + 1; return String(10000 + i) + ',123456789012345678.' + String(i).padStart(12, '0') + ',' + (i % 2 ? 'base64:AP8=' : 'base64:') + ',' + (i === 1 ? '"合成""首条""\r\n下一行"' : '合成-' + i) + ',' + (i % 2 ? '\\N' : '非空-' + i) + ',\\\\row-' + i + '\r\n'; }).join('') + '10502,not-a-decimal,base64:,尾部坏记录,\\N,\\\\bad\r\n';
  const goodDecoded = [['18446744073709551615', '9007199254740993.123456789012', 'base64:AP8=', '成功"首条"\r\n下一行', null, '\\N'], ['18446744073709551614', '-9007199254740993.123456789011', 'base64:', '成功第二条', '原文', '\\path']];
  const goodText = header + '18446744073709551615,9007199254740993.123456789012,base64:AP8=,"成功""首条""\r\n下一行",\\N,\\\\N\r\n18446744073709551614,-9007199254740993.123456789011,base64:,成功第二条,原文,\\\\path\r\n';
  const baseline = ['42', '7.000000000000', 'base64:fw==', '原有记录', null, '\\baseline'];
  const hex = (value: string) => Buffer.from(value, 'utf8').toString('hex').toUpperCase();
  const observed = (row: (string | null)[]) => ({ id: row[0], amount: row[1], payloadHex: row[2] === 'base64:AP8=' ? '00FF' : row[2] === 'base64:fw==' ? '7F' : '', noteHex: hex(row[3]!), nullableHex: row[4] === null ? null : hex(row[4]), slashHex: hex(row[5]!) });
  const literal = (value: string) => "_utf8mb4 X'" + hex(value).toLowerCase() + "'";
  return {
    database, marker, columns, tables, qualified, mapping: Object.fromEntries(columns.map(column => [column, column])),
    files: { atomicBad: { fileName: 'atomic-bad.csv', encoding: 'utf8' as const, text: badText, preview: goodPrefix.slice(0, 20) }, batchBad: { fileName: 'batch-bad.csv', encoding: 'utf8' as const, text: badText, preview: goodPrefix.slice(0, 20) }, good: { fileName: 'atomic-good.csv', encoding: 'utf8' as const, text: goodText, preview: goodDecoded } },
    baseline: observed(baseline), expectedBatch: [observed(baseline), ...goodPrefix.slice(0, 500).map(observed)], expectedAtomic: [observed(baseline), ...[...goodDecoded].reverse().map(observed)],
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', ...tables.map(table => 'CREATE TABLE ' + qualified(table) + ' (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,payload BLOB NOT NULL,note TEXT NOT NULL,nullable_note VARCHAR(80) NULL,literal_slash VARCHAR(80) NOT NULL) ENGINE=InnoDB')],
    seeds: ['INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", ...tables.map(table => 'INSERT INTO ' + qualified(table) + " VALUES (42,CAST('7.000000000000' AS DECIMAL(30,12)),X'7f'," + literal('原有记录') + ',NULL,' + literal('\\baseline') + ')')], drop: 'DROP DATABASE `' + database + '`',
  };
}

interface PickerDialog { showOpenDialog(...args: any[]): Promise<any>; }
interface PickerWindow { isDestroyed(): boolean; webContents: { id: number }; }
interface PickerState { owner: string; original: PickerDialog['showOpenDialog']; window: PickerWindow; paths: string[]; records: string[]; failed: boolean; active?: object; }

/** 三次独立一次性回答器严格顺序消费；原Main仍从真实选择结果签发不可伪造文件能力。 */
export function installFileImportTransactionUiChoice({ dialog, BrowserWindow }: { dialog: PickerDialog; BrowserWindow: { getAllWindows(): PickerWindow[] } }, input: { owner: string; senderId: number; paths: string[]; index: number }): void {
  const root = globalThis as typeof globalThis & { __fileImportTransactionUiPicker?: PickerState }, previous = root.__fileImportTransactionUiPicker;
  if (!/^dbark-file-import-transaction-ui:[a-f0-9]{32}$/.test(input.owner) || input.paths.length !== 3 || new Set(input.paths).size !== 3 || input.paths.some(path => !/^(?:[a-z]:[\\/]|\\\\)/i.test(path) || !/\.csv$/i.test(path))) throw Error('文件导入事务文件选择身份无效');
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()); if (windows.length !== 1 || windows[0].webContents.id !== input.senderId) throw Error('文件导入事务原窗口不唯一');
  const state: PickerState = previous ?? { owner: input.owner, original: dialog.showOpenDialog, window: windows[0], paths: [...input.paths], records: [], failed: false };
  if (state.failed || state.active || state.owner !== input.owner || state.window !== windows[0] || dialog.showOpenDialog !== state.original || JSON.stringify(state.paths) !== JSON.stringify(input.paths) || input.index !== state.records.length || input.index < 0 || input.index >= 3) throw Error('文件导入事务文件选择前序未闭合或顺序变化');
  const ticket = {}; state.active = ticket; root.__fileImportTransactionUiPicker = state;
  const wrapper: PickerDialog['showOpenDialog'] = async (...args: any[]) => {
    if (root.__fileImportTransactionUiPicker !== state || state.active !== ticket || state.failed || dialog.showOpenDialog !== wrapper) { state.failed = true; throw Error('文件导入事务旧选择器不能接管新一次请求'); }
    dialog.showOpenDialog = state.original; state.active = undefined;
    try {
      const expected = { title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] };
      if (args.length !== 2 || args[0] !== state.window || state.window.isDestroyed() || JSON.stringify(args[1]) !== JSON.stringify(expected) || state.records.length !== input.index) throw Error('文件导入事务本次准确CSV选择选项变化');
      state.records.push(state.paths[input.index]); return { canceled: false, filePaths: [state.paths[input.index]] };
    } catch (error) { state.failed = true; throw error; }
  };
  dialog.showOpenDialog = wrapper;
}

/** 只读消费证据和原函数恢复，不把安装成功当作本次选择已发生。 */
export function readFileImportTransactionUiChoices({ dialog }: { dialog: PickerDialog }, input: { owner: string; count: number }) {
  const state = (globalThis as typeof globalThis & { __fileImportTransactionUiPicker?: PickerState }).__fileImportTransactionUiPicker;
  if (!state || state.failed || state.active || state.owner !== input.owner || state.records.length !== input.count || dialog.showOpenDialog !== state.original) throw Error('文件导入事务本次文件选择或原函数恢复未确认');
  return { paths: [...state.records], consumed: input.count, originalRestored: true, nativeInputVerified: false };
}
