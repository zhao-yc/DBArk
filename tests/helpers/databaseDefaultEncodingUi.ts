import { basename, dirname, isAbsolute, resolve } from 'node:path';

export const databaseDefaultEncodingUiUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
/** 本例独立门只接受200指定测试实例，禁止额外门或隐式认证；漂移后永久失效。 */
export function bindDatabaseDefaultEncodingUi(read: () => { env: NodeJS.ProcessEnv; platform: string }) {
  const allowed = ['DBARK_INTEGRATION_ENABLED', 'DBARK_DATABASE_DEFAULT_ENCODING_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_DATABASE_DEFAULT_ENCODING_OUTPUT'];
  const snapshot = () => {
    const { env, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^DBARK_|^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'string')) throw Error('数据库默认编码原生配置无效');
    const value = (key: string) => descriptors[key]?.value as string;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_DATABASE_DEFAULT_ENCODING_UI') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || value('DBARK_TEST_EXPECTED_SERVER_UUID') !== databaseDefaultEncodingUiUuid) throw Error('数据库默认编码实库目标无效');
    const output = value('DBARK_DATABASE_DEFAULT_ENCODING_OUTPUT');
    if (!isAbsolute(output) || resolve(output) !== output || dirname(output) === output || !/^dbark-database-encoding-[a-f0-9]{32}$/.test(basename(output))) throw Error('数据库默认编码缺少本轮独占输出');
    return { signature: JSON.stringify([platform, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output } };
  };
  const captured = snapshot(); let failed = false;
  return { target: Object.freeze(captured.target), assertCurrent() { if (failed) throw Error('数据库默认编码原配置已停链'); try { if (snapshot().signature !== captured.signature) throw Error('数据库默认编码原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

/** 真实Main单次属性变更审计，不替换产品响应；在原处理器前拒绝任意查询或其他写入。 */
export function installDatabaseDefaultEncodingUiAudit({ ipcMain, BrowserWindow }: { ipcMain: any; BrowserWindow: any }, target: { senderId: number; profileId: string; database: string }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), signature = JSON.stringify(target);
  const window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame, processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkDatabaseDefaultEncodingUiAudit || typeof original !== 'function' || !Number.isSafeInteger(target.senderId) || target.senderId <= 0 || !target.profileId || !/^dbark_dbencoding_ui_[a-f0-9]{32}$/.test(target.database) || !sender || !frame || frame.detached || !Number.isSafeInteger(processId) || processId <= 0 || typeof frameToken !== 'string' || !frameToken || typeof url !== 'string' || !url) throw Error('数据库默认编码审计归属无效');
  const state: any = { gets: 0, previews: 0, applies: 0, releases: 0, pending: 0, verified: false, failed: false, snapshotId: undefined, previewToken: undefined, definitionHash: undefined, catalogDigest: undefined, tasks: new Set(), released: new Set(), check: undefined };
  const reject = (): never => { state.failed = true; throw Error('数据库默认编码原生审计停链'); };
  const shape = (input: any, keys: string[]) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key));
  const pair = (value: any, collation: string) => value?.charset === 'utf8mb4' && value.collation === collation;
  const ownTarget = (value: any) => value?.connectionId === target.profileId && value.database === target.database;
  const acks = ['ddl-implicit-commit', 'database-default-only', 'external-ddl-window'];
  const task = (id: unknown) => { if (typeof id !== 'string' || !id || state.tasks.has(id)) reject(); state.tasks.add(id); };
  state.check = () => { if (state.failed || root.__dbarkDatabaseDefaultEncodingUiAudit !== state || handlers.get('dbark:request') !== wrapped || JSON.stringify(target) !== signature || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject();
    const command = payload?.command, input = payload?.input;
    if (command === 'schema.databaseDefaultEncoding.get') {
      if (state.gets || state.previews || state.applies || !shape(input, ['connectionId', 'database', 'taskId']) || !ownTarget(input)) reject(); task(input.taskId); state.gets++;
    } else if (command === 'schema.databaseDefaultEncoding.preview') {
      if (state.gets !== 1 || !state.snapshotId || state.previews || state.applies || !shape(input, ['snapshotId', 'charset', 'collation', 'taskId']) || input.snapshotId !== state.snapshotId || !pair(input, 'utf8mb4_general_ci')) reject(); task(input.taskId); state.previews++;
    } else if (command === 'schema.databaseDefaultEncoding.apply') {
      if (state.previews !== 1 || !state.previewToken || state.applies || !shape(input, ['previewToken', 'confirmation', 'acknowledgements', 'taskId']) || input.previewToken !== state.previewToken || input.confirmation !== target.database || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== 3 || new Set(input.acknowledgements).size !== 3 || acks.some(id => !input.acknowledgements.includes(id))) reject(); task(input.taskId); state.applies++;
    } else if (command === 'schema.databaseDefaultEncoding.release') {
      if (!shape(input, ['snapshotId', 'previewToken']) || Object.keys(input).length !== 1) reject(); const key = Object.keys(input)[0], id = input[key];
      if (key === 'snapshotId' ? id !== state.snapshotId || !state.snapshotId : id !== state.previewToken || !state.previewToken || state.applies) reject(); const release = key + ':' + id; if (state.released.has(release)) reject(); state.released.add(release); state.releases++;
    } else if (command === 'query.cancel') { if (!shape(input, ['taskId']) || !state.tasks.has(input.taskId)) reject(); }
    else if (command === 'connections.open') { if (!shape(input, ['id']) || input.id !== target.profileId) reject(); }
    else if (command === 'metadata.databases') { if (!shape(input, ['connectionId']) || input.connectionId !== target.profileId) reject(); }
    else if (command === 'metadata.objects') { if (!shape(input, ['connectionId', 'database']) || !ownTarget(input)) reject(); }
    else if (command === 'app.setDirty') { if (!shape(input, ['dirty']) || typeof input.dirty !== 'boolean') reject(); }
    else if (command === 'settings.save') { if (!Array.isArray(input?.tabs) || input.tabs.length || input.activeTabId != null) reject(); }
    else if (['connections.list', 'settings.get', 'history.list', 'tasks.list', 'workbench.get'].includes(command)) { if (!shape(input, [])) reject(); }
    else reject();
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject(); const value = response.result;
      if (command === 'connections.open' && (value?.dialect !== 'mysql' || value.version !== '8.4.11')) reject();
      if (command === 'schema.databaseDefaultEncoding.get') {
        if (!ownTarget(value?.target) || typeof value.snapshotId !== 'string' || !value.snapshotId || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || !value.writable || !pair(value.current, 'utf8mb4_bin') || !Array.isArray(value.candidates) || !value.candidates.some((entry: any) => pair(entry, 'utf8mb4_general_ci')) || typeof value.definitionHash !== 'string' || !value.definitionHash || typeof value.catalogDigest !== 'string' || !value.catalogDigest || value.serverVersion !== '8.4.11') reject();
        state.snapshotId = value.snapshotId; state.definitionHash = value.definitionHash; state.catalogDigest = value.catalogDigest;
      }
      if (command === 'schema.databaseDefaultEncoding.preview') {
        if (!ownTarget(value?.target) || !pair(value.before, 'utf8mb4_bin') || !pair(value.after, 'utf8mb4_general_ci') || value.definitionHash !== state.definitionHash || value.catalogDigest !== state.catalogDigest || typeof value.previewToken !== 'string' || !value.previewToken || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.sql !== 'ALTER DATABASE `' + target.database + '` DEFAULT CHARACTER SET `utf8mb4` COLLATE `utf8mb4_general_ci`;' || !Array.isArray(value.requiredAcknowledgements) || value.requiredAcknowledgements.length !== 3 || new Set(value.requiredAcknowledgements).size !== 3 || acks.some(id => !value.requiredAcknowledgements.includes(id))) reject(); state.previewToken = value.previewToken;
      }
      if (command === 'schema.databaseDefaultEncoding.apply') { if (!ownTarget(value?.target) || !pair(value.before, 'utf8mb4_bin') || !pair(value.after, 'utf8mb4_general_ci') || value.ddlSubmitted !== true || value.ddlCompleted !== true || value.definitionVerified !== true) reject(); state.verified = true; }
      if (command === 'history.list' && (!Array.isArray(value) || value.length)) reject();
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkDatabaseDefaultEncodingUiAudit = state; handlers.set('dbark:request', wrapped);
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(name, () => { state.failed = true; }); state.check();
}

/** 公开证据只带行为计数，令牌、SQL、连接与认证均不进入日志。 */
export function readDatabaseDefaultEncodingUiAudit(): { gets: number; previews: number; applies: number; releases: number; pending: number; verified: boolean } {
  const state = (globalThis as any).__dbarkDatabaseDefaultEncodingUiAudit; if (!state || typeof state.check !== 'function') throw Error('数据库默认编码原生审计缺失'); state.check();
  return { gets: state.gets, previews: state.previews, applies: state.applies, releases: state.releases, pending: state.pending, verified: state.verified };
}
