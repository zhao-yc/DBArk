export const binaryCellFilesUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_BINARY_CELL_FILES_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_BINARY_CELL_FILES_UI_OWNER', 'DBARK_BINARY_CELL_FILES_UI_MANIFEST', 'DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256', 'DBARK_BINARY_CELL_FILES_UI_OUTPUT', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL_SHA256', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY_SHA256'] as const;

/** 列表先于全部环境读取；缺双门只跳过，不分配桌面、文件或数据库资源。 */
export function binaryCellFilesUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_BINARY_CELL_FILES_UI_TEST === '1';
}

/** 仅校验Root预置的Windows源码专项身份，不连接服务器，也不读取当前认证。 */
export function assertBinaryCellFilesUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !binaryCellFilesUiActive(env, args)) throw Error('二进制单元格文件专项须Windows和两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_binarycellfilesui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-binary-cell-files-ui:[a-f0-9]{32}$/.test(env.DBARK_BINARY_CELL_FILES_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('二进制单元格原200目标、UUID或随机资源无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  for (const key of ['DBARK_BINARY_CELL_FILES_UI_MANIFEST', 'DBARK_BINARY_CELL_FILES_UI_OUTPUT', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY'] as const) if (!absolute(env[key])) throw Error('二进制单元格资源路径须准确绝对路径');
  for (const key of ['DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL_SHA256', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY_SHA256'] as const) if (!/^[a-f0-9]{64}$/.test(env[key] ?? '')) throw Error('二进制单元格缺少完整原字节摘要');
  if (env.DBARK_BINARY_CELL_FILES_UI_INPUT_FULL === env.DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY) throw Error('完整文件与空文件必须独立');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('二进制单元格拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('二进制单元格拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('二进制单元格拒绝替代配置或交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('二进制单元格拒绝CLI开启trace');
}

/** 捕获相关键存在性及argv；漂移后永久保留现场，恢复原值不能复活旧运行。 */
export function bindBinaryCellFilesUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const current = read(); assertBinaryCellFilesUiEnvironment(current.env, current.args, current.platform); return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]); };
  const original = signature(), values = Object.freeze(Object.fromEntries(binaryCellFilesUiKeys.map(key => [key, read().env[key]!])) as Record<typeof binaryCellFilesUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('二进制单元格原环境已失效，保留现场'); try { if (signature() !== original) throw Error('二进制单元格原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

/** Root独立创建与清理资源；合成期望为手写原字节，不调用任何产品编码器。 */
export function binaryCellFilesUiFixture(database: string, marker: string) {
  if (!/^dbark_binarycellfilesui_[a-f0-9]{32}$/.test(database) || !/^dbark-binary-cell-files-ui:[a-f0-9]{32}$/.test(marker)) throw Error('二进制单元格隔离资源身份无效');
  const table = '`' + database + '`.`subject`', fullHex = 'EFBBBF00FF22275C0D0AE4B8AD';
  const before = [{ id: '1', payloadHex: null, note: '原NULL行' }, { id: '2', payloadHex: '7F01', note: '原非空行' }, { id: '3', payloadHex: '', note: '原空行' }];
  const afterFirst = [{ ...before[0], payloadHex: fullHex }, before[1], before[2]], after = [afterFirst[0], { ...before[1], payloadHex: '' }, before[2]];
  return {
    database, marker, table, fullHex, before, afterFirst, after,
    inputs: { full: { fileName: 'full.bin', bytes: Buffer.from(fullHex, 'hex') }, empty: { fileName: 'empty.bin', bytes: Buffer.alloc(0) } },
    outputs: { table: { fileName: 'table-original.bin', hex: '7F01' }, query: { fileName: 'query-loaded.bin', hex: fullHex } },
    rowSql: 'SELECT CAST(id AS CHAR) AS id,HEX(payload) AS payloadHex,note FROM ' + table + ' ORDER BY ' + table + '.`id` ASC',
    resultSql: 'SELECT payload FROM ' + table + ' WHERE id = 1',
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', 'CREATE TABLE ' + table + ' (id INT NOT NULL PRIMARY KEY,payload BLOB NULL,note VARCHAR(80) NOT NULL) ENGINE=InnoDB'],
    seeds: ['INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", 'INSERT INTO ' + table + " VALUES (1,NULL,_utf8mb4 X'e58e9f4e554c4ce8a18c'),(2,X'7f01',_utf8mb4 X'e58e9fe99d9ee7a9bae8a18c'),(3,X'',_utf8mb4 X'e58e9fe7a9bae8a18c')"],
    drop: 'DROP DATABASE `' + database + '`',
  };
}

interface PickerDialog { showOpenDialog(...args: any[]): Promise<any>; showSaveDialog(...args: any[]): Promise<any>; }
interface PickerWindow { isDestroyed(): boolean; webContents: { id: number }; }
export interface BinaryCellFilesUiChoice { kind: 'open' | 'save'; path?: string; }
interface PickerState { owner: string; originalOpen: PickerDialog['showOpenDialog']; originalSave: PickerDialog['showSaveDialog']; window: PickerWindow; choices: BinaryCellFilesUiChoice[]; records: BinaryCellFilesUiChoice[]; failed: boolean; active?: object; }

/** 每次真实click前只安装本次Electron API回答；绝不伪造binaryCellFiles回执或改React状态。 */
export function installBinaryCellFilesUiChoice({ dialog, BrowserWindow }: { dialog: PickerDialog; BrowserWindow: { getAllWindows(): PickerWindow[] } }, input: { owner: string; senderId: number; choices: BinaryCellFilesUiChoice[]; index: number }): void {
  const root = globalThis as typeof globalThis & { __binaryCellFilesUiPicker?: PickerState }, previous = root.__binaryCellFilesUiPicker;
  if (!/^dbark-binary-cell-files-ui:[a-f0-9]{32}$/.test(input.owner) || input.choices.length !== 5 || input.choices.map(item => item.kind).join() !== 'save,open,open,open,save' || input.choices[2].path !== undefined || input.choices.some((item, index) => index !== 2 && (!item.path || !/^(?:[a-z]:[\\/]|\\\\)/i.test(item.path)))) throw Error('二进制单元格本次准确选择计划无效');
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()); if (windows.length !== 1 || windows[0].webContents.id !== input.senderId) throw Error('二进制单元格原窗口不唯一');
  const state: PickerState = previous ?? { owner: input.owner, originalOpen: dialog.showOpenDialog, originalSave: dialog.showSaveDialog, window: windows[0], choices: input.choices.map(item => ({ ...item })), records: [], failed: false };
  if (state.failed || state.active || state.owner !== input.owner || state.window !== windows[0] || dialog.showOpenDialog !== state.originalOpen || dialog.showSaveDialog !== state.originalSave || JSON.stringify(state.choices) !== JSON.stringify(input.choices) || input.index !== state.records.length || input.index < 0 || input.index >= 5) throw Error('二进制单元格前序选择未闭合或顺序变化');
  const ticket = {}, choice = state.choices[input.index], method = choice.kind === 'open' ? 'showOpenDialog' : 'showSaveDialog'; state.active = ticket; root.__binaryCellFilesUiPicker = state;
  const wrapper = async (...args: any[]) => {
    if (root.__binaryCellFilesUiPicker !== state || state.active !== ticket || state.failed || dialog[method] !== wrapper) { state.failed = true; throw Error('二进制单元格旧选择器不能接管后继请求'); }
    dialog[method] = choice.kind === 'open' ? state.originalOpen : state.originalSave; state.active = undefined;
    try {
      if (args.length !== 2 || args[0] !== state.window || state.window.isDestroyed() || state.records.length !== input.index) throw Error('二进制单元格原选择归属变化');
      const expected = choice.kind === 'open' ? { title: '载入二进制单元格文件', properties: ['openFile'], filters: [{ name: '所有文件', extensions: ['*'] }] } : { title: '另存二进制单元格原字节', defaultPath: 'binary-cell.bin', filters: [{ name: '所有文件', extensions: ['*'] }] };
      if (JSON.stringify(args[1]) !== JSON.stringify(expected)) throw Error('二进制单元格专用文件对话框精确选项变化');
      state.records.push({ ...choice });
      return choice.kind === 'open' ? { canceled: choice.path === undefined, filePaths: choice.path ? [choice.path] : [] } : { canceled: false, filePath: choice.path };
    } catch (error) { state.failed = true; throw error; }
  };
  dialog[method] = wrapper;
}

/** 原API函数及每次实际消费均闭合；安装本身不作为成功选择证据。 */
export function readBinaryCellFilesUiChoices({ dialog }: { dialog: PickerDialog }, input: { owner: string; count: number }) {
  const state = (globalThis as typeof globalThis & { __binaryCellFilesUiPicker?: PickerState }).__binaryCellFilesUiPicker;
  if (!state || state.failed || state.active || state.owner !== input.owner || state.records.length !== input.count || dialog.showOpenDialog !== state.originalOpen || dialog.showSaveDialog !== state.originalSave) throw Error('二进制单元格原文件选择或API恢复未确认');
  return { records: state.records.map(item => ({ ...item })), consumed: input.count, originalRestored: true, nativeInputVerified: false };
}
