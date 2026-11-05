export interface TableWorkspaceLiveEnvironment {
  mode: 'lost-reply' | 'read-failure' | 'unknown' | 'rolled-back' | 'draft-restore';
  host: '192.168.31.200'; port: 13357 | 13380 | 13384 | 13310 | 13311; dialect: 'mysql' | 'mariadb'; user: string; password: string;
  database: string; owner: string; version: string; hostname: string; serverUuid?: string;
}

/** 实库门只消费外层已准备的准确随机库，不读取认证文件、不建库或扩大权限。 */
export function tableWorkspaceLiveEnvironment(env: Record<string, string | undefined>, args: readonly string[], platform: string): Readonly<TableWorkspaceLiveEnvironment> {
  const fail = (): never => { throw Error('跨页草稿实库门无效：需要200专用基线、准确随机库、owner和服务器身份；禁止覆盖原生资源门。'); };
  if (env.DBARK_TABLE_WORKSPACE_LIVE !== '1' || env.DBARK_INTEGRATION_ENABLED !== '1' || !['darwin', 'win32'].includes(platform)) return fail();
  if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'PWDEBUG', 'DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => env[key] !== undefined)
    || Object.keys(env).some(key => /^DBARK_(?:SSH_|MTLS_)/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGPASSWORD$|DATABASE_URL$)/.test(key))) return fail();
  const { DBARK_TEST_HOST: host, DBARK_TEST_PORT: rawPort, DBARK_TEST_USER: user, DBARK_TEST_PASSWORD: password, DBARK_TEST_DATABASE: database,
    DBARK_WORKSPACE_OWNER: owner, DBARK_WORKSPACE_VERSION: version, DBARK_WORKSPACE_HOSTNAME: hostname, DBARK_WORKSPACE_UUID: serverUuid, DBARK_WORKSPACE_DIALECT: dialect } = env;
  if (host !== '192.168.31.200' || !user || user.length > 200 || !password || password.length > 4096 || !database || !/^dbark_workspace_[a-f0-9]{12}$/.test(database) || !owner || !/^[a-f0-9]{32}$/.test(owner)
    || !version || !hostname || !/^[A-Za-z0-9_.-]{1,64}$/.test(hostname)) return fail();
  if (dialect !== 'mysql' && dialect !== 'mariadb') return fail();
  // 端口与版本必须来自同一原兼容基线，不能仅凭MySQL/MariaDB家族名接受任意实例。
  const versions: Record<string, { dialect: string; version: RegExp }> = { '13357': { dialect: 'mysql', version: /^5\.7\.[0-9]+(?:$|[-+])/ }, '13380': { dialect: 'mysql', version: /^8\.0\.[0-9]+(?:$|[-+])/ }, '13384': { dialect: 'mysql', version: /^8\.4\.[0-9]+(?:$|[-+])/ }, '13310': { dialect: 'mariadb', version: /^10\.11\.[0-9]+-MariaDB/ }, '13311': { dialect: 'mariadb', version: /^11\.4\.[0-9]+-MariaDB/ } };
  const baseline = rawPort ? versions[rawPort] : undefined;
  if (!baseline || baseline.dialect !== dialect || !baseline.version.test(version) || (dialect === 'mysql' ? !serverUuid || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(serverUuid) : serverUuid !== undefined)) return fail();
  const fixed = new Map([['--workers', '1'], ['--retries', '0'], ['--repeat-each', '1'], ['--timeout', '120000'], ['--trace', 'off']]);
  for (let index = 0; index < args.length; index++) {
    const value = args[index]; if (/^--(?:config|project|ui|debug)(?:=|$)|^-c/.test(value)) return fail();
    const at = value.indexOf('='), name = at < 0 ? value : value.slice(0, at);
    if (fixed.has(name) && (at < 0 ? args[++index] : value.slice(at + 1)) !== fixed.get(name)) return fail();
  }
  const mode = env.DBARK_WORKSPACE_MODE;
  if (!['lost-reply', 'read-failure', 'unknown', 'rolled-back', 'draft-restore'].includes(mode ?? '')) return fail();
  return Object.freeze({ mode: mode as TableWorkspaceLiveEnvironment['mode'], host, port: Number(rawPort) as TableWorkspaceLiveEnvironment['port'], dialect, user, password, database, owner, version, hostname, ...(serverUuid ? { serverUuid } : {}) });
}

/** 来源条件一旦漂移即永久撤权，禁止恢复旧环境后自动重试原数据库。 */
export function bindTableWorkspaceLiveEnvironment(read: () => { env: Record<string, string | undefined>; args: readonly string[]; platform: string }) {
  const initial = read(), target = tableWorkspaceLiveEnvironment(initial.env, initial.args, initial.platform), fingerprint = JSON.stringify(target); let valid = true;
  return { target, assertCurrent() {
    if (!valid) throw Error('跨页草稿原实库来源已失效');
    try { const now = read(); if (JSON.stringify(tableWorkspaceLiveEnvironment(now.env, now.args, now.platform)) !== fingerprint) throw Error('跨页草稿实库来源漂移'); }
    catch (reason) { valid = false; throw reason; }
  } };
}

export interface TableWorkspaceConfirmationRecord { method: 'sync' | 'async'; options: Record<string, unknown>; choice: 'reject' | 'accept'; cancelIndex: 0 | 1; acceptIndex: 0 | 1; response: 0 | 1; }
/** 测试适配器仅回答一次准确原生确认，先恢复两个Electron函数；不替换window.confirm或产品状态。 */
export function installTableWorkspaceConfirmation({ dialog }: { dialog: any }, input: { owner: string; expected: string; choice: 'reject' | 'accept' }): void {
  const root = globalThis as any, key = '__dbarkTableWorkspaceConfirmation';
  const { owner, expected, choice } = input;
  if (!/^dbark-table-workspace:[a-f0-9]{32}$/.test(owner) || !expected || !['reject', 'accept'].includes(choice)) throw Error('跨页草稿原生确认适配器缺少准确owner或回答');
  let state = root[key];
  if (!state) state = root[key] = { owner, sync: dialog.showMessageBoxSync, asynchronous: dialog.showMessageBox, records: [], failed: false, pending: undefined };
  if (state.owner !== owner || state.failed || state.pending || dialog.showMessageBoxSync !== state.sync || dialog.showMessageBox !== state.asynchronous) throw Error('跨页草稿原生确认适配器原归属或函数已变化');
  const ticket = {}; state.pending = ticket;
  let sync: (...args: unknown[]) => number, asynchronous: (...args: unknown[]) => Promise<{ response: number; checkboxChecked: boolean }>;
  /** 同一次实际调用消费唯一ticket；其他message也先恢复端口，然后拒绝且永久停链。 */
  const answer = (args: unknown[], method: 'sync' | 'async') => {
    if (state.pending !== ticket || state.failed || dialog.showMessageBoxSync !== sync || dialog.showMessageBox !== asynchronous) throw Error('跨页草稿原生确认适配器发生重入或端口漂移');
    dialog.showMessageBoxSync = state.sync; dialog.showMessageBox = state.asynchronous; state.pending = undefined;
    try {
      const options = args.at(-1) as Record<string, unknown>;
      if (!options || options.message !== expected || !Array.isArray(options.buttons) || options.buttons.length !== 2 || options.buttons.some(value => typeof value !== 'string')) throw Error('拒绝其它原生确认使用跨页草稿本例回答');
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
export function readTableWorkspaceConfirmations({ dialog }: { dialog: any }, owner: string): TableWorkspaceConfirmationRecord[] {
  const state = (globalThis as any).__dbarkTableWorkspaceConfirmation;
  if (!state || state.owner !== owner || state.failed || state.pending || dialog.showMessageBoxSync !== state.sync || dialog.showMessageBox !== state.asynchronous) throw Error('跨页草稿原生确认尚未消费或原端口未恢复');
  return structuredClone(state.records);
}

/** 仅为准确本例选择一次草稿路径，保留正式Main文件IO、文件解析及独立数据库核验。 */
export function installTableWorkspaceFileChoice({ dialog }: { dialog: any }, input: { owner: string; path: string; mode: 'save' | 'open' }): void {
  const root = globalThis as any, key = '__dbarkTableWorkspaceFileChoice';
  if (!/^dbark-table-workspace:[a-f0-9]{32}$/.test(input.owner) || !['save', 'open'].includes(input.mode) || !/^(?:\/|[A-Za-z]:[\\/])/.test(input.path) || input.path.length > 4096 || !input.path.replaceAll('\\', '/').endsWith('/workspace-' + input.owner.slice(-32) + '.dbark-draft')) throw Error('草稿选择器缺少准确本例归属或路径');
  let state = root[key];
  if (!state) state = root[key] = { owner: input.owner, path: input.path, save: dialog.showSaveDialog, open: dialog.showOpenDialog, records: [], pending: false, failed: false };
  if (state.owner !== input.owner || state.path !== input.path || state.failed || state.pending || dialog.showSaveDialog !== state.save || dialog.showOpenDialog !== state.open) throw Error('原草稿选择器归属或函数已变化');
  state.pending = true;
  const method = input.mode === 'save' ? 'showSaveDialog' : 'showOpenDialog', original = dialog[method];
  const selected = async (...args: unknown[]) => {
    if (!state.pending || dialog[method] !== selected) throw Error('原草稿选择器已失效');
    dialog[method] = original; state.pending = false;
    try {
      const options = args.at(-1) as any;
      if (!options || options.title !== (input.mode === 'save' ? '保存表格草稿' : '打开表格草稿') || options.filters?.length !== 1 || JSON.stringify(options.filters[0].extensions) !== '["dbark-draft"]') throw Error('拒绝其它文件选择器使用草稿本例路径');
      state.records.push({ mode: input.mode, options: structuredClone(options) });
      return input.mode === 'save' ? { canceled: false, filePath: input.path } : { canceled: false, filePaths: [input.path] };
    } catch (reason) { state.failed = true; throw reason; }
  };
  dialog[method] = selected;
}
/** 只有实际消费路径且两个原生函数恢复，才记录文件选择终态。 */
export function readTableWorkspaceFileChoices({ dialog }: { dialog: any }, owner: string): { mode: 'save' | 'open'; options: Record<string, unknown> }[] {
  const state = (globalThis as any).__dbarkTableWorkspaceFileChoice;
  if (!state || state.owner !== owner || state.pending || state.failed || dialog.showSaveDialog !== state.save || dialog.showOpenDialog !== state.open) throw Error('原草稿选择尚未闭合');
  return structuredClone(state.records);
}
