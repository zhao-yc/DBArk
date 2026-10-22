import { basename, dirname, isAbsolute, resolve } from 'node:path';

export const databaseDropUiUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
/** 双门仅绑定200的既定MySQL8.4实例；列表不调用本函数，不读取任何凭据文件。 */
export function bindDatabaseDropUi(read: () => { env: NodeJS.ProcessEnv; platform: string }) {
  const argumentsAtStart = JSON.stringify(process.argv);
  const allowed = ['DBARK_INTEGRATION_ENABLED', 'DBARK_DATABASE_DROP_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_DATABASE_DROP_OUTPUT'];
  const snapshot = () => {
    if (JSON.stringify(process.argv) !== argumentsAtStart || process.argv.some(value => /^(?:--(?:config|debug|ui)|-c)(?:=|$)/.test(value))) throw Error('删除数据库拒绝替代配置或交互运行器');
    for (const [index, argument] of process.argv.entries()) if (argument === '--trace' && process.argv[index + 1] !== 'off' || argument.startsWith('--trace=') && argument !== '--trace=off') throw Error('删除数据库原生验收禁止开启trace');
    const { env, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('删除数据库原生配置无效');
    const value = (key: string) => descriptors[key]?.value as string;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_DATABASE_DROP_UI') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || value('DBARK_TEST_EXPECTED_SERVER_UUID') !== databaseDropUiUuid) throw Error('删除数据库实库目标无效');
    const output = value('DBARK_DATABASE_DROP_OUTPUT');
    if (!isAbsolute(output) || resolve(output) !== output || dirname(output) === output || !/^dbark-database-drop-[a-f0-9]{32}$/.test(basename(output))) throw Error('删除数据库缺少本轮独占输出');
    return { signature: JSON.stringify([platform, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output } };
  };
  const captured = snapshot(); let failed = false;
  return { target: Object.freeze(captured.target), assertCurrent() { if (failed) throw Error('删除数据库原配置已停链'); try { if (snapshot().signature !== captured.signature) throw Error('删除数据库原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

export interface DatabaseDropUiAuditTarget { senderId: number; profileId: string; database: string; tableTabId: string; queryTabId: string; sql: string; }
/** 包装真实Main原handler并严格透传，只有本例固定库的一次DROP能力可以通过；不伪造产品成功。 */
export function installDatabaseDropUiAudit({ ipcMain, BrowserWindow }: { ipcMain: any; BrowserWindow: any }, target: DatabaseDropUiAuditTarget): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), signature = JSON.stringify(target);
  const window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame;
  const processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkDatabaseDropUiAudit || typeof original !== 'function' || !Number.isSafeInteger(target.senderId) || target.senderId <= 0 || !target.profileId || !/^dbark_dbdrop_ui_[a-f0-9]{32}$/.test(target.database) || !target.tableTabId || !target.queryTabId || target.tableTabId === target.queryTabId || !target.sql || !sender || !frame || frame.detached || !Number.isSafeInteger(processId) || processId <= 0 || typeof frameToken !== 'string' || !frameToken || typeof url !== 'string' || !url) throw Error('删除数据库审计归属无效');
  const state: any = { gets: 0, previews: 0, applies: 0, releases: 0, pending: 0, verified: false, failed: false, snapshots: new Map(), previewsByToken: new Map(), tasks: new Set(), released: new Set(), retiredResolves: 0, check: undefined };
  const reject = (): never => { state.failed = true; throw Error('删除数据库原生审计停链'); };
  const shape = (input: any, keys: string[]) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key));
  const own = (input: any) => input?.connectionId === target.profileId && input.database === target.database;
  const counts = (value: any) => value && ['tables', 'views', 'procedures', 'functions', 'triggers', 'events'].every(key => value[key] === 1) && Object.keys(value).length === 6;
  const acknowledgements = ['irreversible-database-drop', 'external-ddl-window', 'external-references-and-grants', 'sessions-and-partial-failure'];
  const acks = (value: unknown) => Array.isArray(value) && value.length === 4 && new Set(value).size === 4 && acknowledgements.every(id => value.includes(id));
  const task = (id: unknown) => { if (typeof id !== 'string' || !id || state.tasks.has(id)) reject(); state.tasks.add(id); };
  state.check = () => { if (state.failed || root.__dbarkDatabaseDropUiAudit !== state || handlers.get('dbark:request') !== wrapped || JSON.stringify(target) !== signature || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject();
    const command = payload?.command, input = payload?.input;
    if (command === 'schema.databaseDrop.get') {
      if (state.gets >= 2 || state.applies || !shape(input, ['connectionId', 'database', 'taskId']) || !own(input)) reject(); task(input.taskId); state.gets++;
    } else if (command === 'schema.databaseDrop.preview') {
      if (state.previews >= 3 || state.applies || !shape(input, ['snapshotId', 'taskId']) || !state.snapshots.has(input.snapshotId) || state.released.has('snapshotId:' + input.snapshotId)) reject(); task(input.taskId); state.previews++;
    } else if (command === 'schema.databaseDrop.apply') {
      if (state.gets !== 2 || state.previews !== 3 || state.applies || !shape(input, ['previewToken', 'confirmation', 'acknowledgements', 'taskId']) || !state.previewsByToken.has(input.previewToken) || state.released.has('previewToken:' + input.previewToken) || input.confirmation !== target.database || !acks(input.acknowledgements)) reject(); task(input.taskId); state.applies++;
    } else if (command === 'schema.databaseDrop.release') {
      if (!shape(input, ['snapshotId', 'previewToken']) || Object.keys(input).length !== 1) reject(); const key = Object.keys(input)[0], id = input[key];
      if (key === 'snapshotId' ? !state.snapshots.has(id) : !state.previewsByToken.has(id)) reject(); const release = key + ':' + id; if (state.released.has(release)) reject(); state.released.add(release); state.releases++;
    } else if (command === 'query.cancel') { if (!shape(input, ['taskId']) || !state.tasks.has(input.taskId)) reject(); }
    else if (command === 'connections.open') { if (!shape(input, ['id']) || input.id !== target.profileId) reject(); }
    else if (command === 'metadata.databases') { if (!shape(input, ['connectionId']) || input.connectionId !== target.profileId) reject(); }
    else if (command === 'metadata.objects') { if (!shape(input, ['connectionId', 'database']) || !own(input)) reject(); }
    else if (command === 'table.copySourceRelease') { if (!shape(input, ['connectionId', 'pageRef']) || input.connectionId !== target.profileId || typeof input.pageRef !== 'string' || !input.pageRef) reject(); }
    else if (command === 'app.setDirty') { if (!shape(input, ['dirty']) || typeof input.dirty !== 'boolean') reject(); }
    else if (command === 'settings.save') {
      if (!Array.isArray(input?.tabs) || input.tabs.length < 1 || input.tabs.length > 2) reject();
      const query = input.tabs.find((value: any) => value.id === target.queryTabId); if (!query || query.kind !== 'query' || query.connectionId !== target.profileId || query.database !== target.database || query.sql !== target.sql || !input.tabs.every((value: any) => value === query || value.id === target.tableTabId && value.kind === 'table' && value.connectionId === target.profileId && value.database === target.database && value.table === 'subject')) reject();
      if (state.verified && input.tabs.some((value: any) => value.kind === 'table')) reject();
    } else if (['connections.list', 'settings.get', 'history.list', 'tasks.list', 'workbench.get'].includes(command)) { if (!shape(input, [])) reject(); }
    // 旧链接必须在renderer退役守卫阻止，不能转发Main或调用任意SQL/其它DDL入口。
    else { if (command === 'workbench.resolve') state.retiredResolves++; reject(); }
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject(); const value = response.result;
      if (command === 'connections.open' && (value?.dialect !== 'mysql' || value.version !== '8.4.11')) reject();
      if (command === 'schema.databaseDrop.get') {
        if (!own(value?.target) || typeof value.snapshotId !== 'string' || !value.snapshotId || state.snapshots.has(value.snapshotId) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.writable !== true || !Array.isArray(value.reasons) || value.reasons.length || !counts(value.counts) || value.charset !== 'utf8mb4' || value.collation !== 'utf8mb4_bin' || !/^[a-f0-9]{64}$/.test(value.catalogDigest ?? '') || value.serverVersion !== '8.4.11') reject();
        state.snapshots.set(value.snapshotId, { digest: value.catalogDigest });
      }
      if (command === 'schema.databaseDrop.preview') {
        if (!own(value?.target) || value.catalogDigest !== state.snapshots.get(input.snapshotId)?.digest || !counts(value.counts) || typeof value.previewToken !== 'string' || !value.previewToken || state.previewsByToken.has(value.previewToken) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.sql !== 'DROP DATABASE `' + target.database + '`;' || !acks(value.requiredAcknowledgements)) reject(); state.previewsByToken.set(value.previewToken, { snapshotId: input.snapshotId });
      }
      if (command === 'schema.databaseDrop.apply') { if (!own(value?.target) || value.ddlSubmitted !== true || value.ddlCompleted !== true || value.definitionVerified !== true || value.after?.databaseAbsent !== true) reject(); state.verified = true; }
      if (command === 'history.list' && (!Array.isArray(value) || value.length)) reject();
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkDatabaseDropUiAudit = state; handlers.set('dbark:request', wrapped);
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(event, () => { state.failed = true; }); state.check();
}

/** 仅返回计数和事实，令牌、SQL、认证及测试数据不进入报告。 */
export function readDatabaseDropUiAudit(): { gets: number; previews: number; applies: number; releases: number; pending: number; verified: boolean; retiredResolves: number } {
  const state = (globalThis as any).__dbarkDatabaseDropUiAudit; if (!state || typeof state.check !== 'function') throw Error('删除数据库原生审计缺失'); state.check();
  return { gets: state.gets, previews: state.previews, applies: state.applies, releases: state.releases, pending: state.pending, verified: state.verified, retiredResolves: state.retiredResolves };
}
