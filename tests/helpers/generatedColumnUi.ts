import { win32 } from 'node:path';

export const generatedColumnUiUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
/** 原生门仅授权200的准确13384实例、独占目录和批准来源；配置漂移永久停链。 */
export function bindGeneratedColumnUi(read: () => { env: NodeJS.ProcessEnv; platform: string; args: readonly string[] }) {
  const allowed = ['DBARK_INTEGRATION_ENABLED', 'DBARK_GENERATED_COLUMN_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_GENERATED_COLUMN_OUTPUT', 'DBARK_GENERATED_COLUMN_MANIFEST', 'DBARK_GENERATED_COLUMN_MANIFEST_SHA256'];
  const snapshot = () => {
    const { env, platform, args } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^DBARK_|^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'string')) throw Error('生成列原生配置无效');
    const value = (key: string) => descriptors[key]?.value as string;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_GENERATED_COLUMN_UI') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || value('DBARK_TEST_EXPECTED_SERVER_UUID') !== generatedColumnUiUuid) throw Error('生成列实库目标无效');
    const output = value('DBARK_GENERATED_COLUMN_OUTPUT'), manifest = value('DBARK_GENERATED_COLUMN_MANIFEST'), sha = value('DBARK_GENERATED_COLUMN_MANIFEST_SHA256');
    if (!win32.isAbsolute(output) || win32.resolve(output) !== output || win32.dirname(output) === output || !/^dbark-generated-column-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('生成列缺少独占输出或批准来源');
    for (const [index, arg] of args.entries()) {
      if (arg === '--config' || arg === '-c' || arg.startsWith('--config=') || /^-c./.test(arg) || ['--ui', '--debug'].includes(arg) || arg === '--trace' && args[index + 1] !== 'off' || arg.startsWith('--trace=') && arg !== '--trace=off') throw Error('生成列拒绝替换原运行配置或录制');
    }
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output, manifest, sha } };
  };
  const captured = snapshot(); let failed = false;
  return { target: Object.freeze(captured.target), assertCurrent() { if (failed) throw Error('生成列原配置已停链'); try { if (snapshot().signature !== captured.signature) throw Error('生成列原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

/** Main原处理器外的只观察审计：输入不在本例精确能力内时先拒绝，不替换产品返回。 */
export function installGeneratedColumnUiAudit({ ipcMain, BrowserWindow }: { ipcMain: any; BrowserWindow: any }, target: { senderId: number; profileId: string; database: string; table: string }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), signature = JSON.stringify(target);
  const window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame, processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkGeneratedColumnUiAudit || typeof original !== 'function' || !Number.isSafeInteger(target.senderId) || target.senderId <= 0 || !target.profileId || !/^dbark_generated_ui_[a-f0-9]{32}$/.test(target.database) || target.table !== 'subject' || !sender || !frame || frame.detached || !Number.isSafeInteger(processId) || processId <= 0 || typeof frameToken !== 'string' || !frameToken || typeof url !== 'string' || !url) throw Error('生成列审计归属无效');
  const state: any = { gets: 0, previews: 0, applies: 0, releases: 0, pending: 0, verified: false, failed: false, tasks: new Set(), released: new Set(), check: undefined };
  const reject = (): never => { state.failed = true; throw Error('生成列原生审计停链'); };
  const shape = (input: any, keys: string[]) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join() === [...keys].sort().join();
  const ownTarget = (value: any) => value?.connectionId === target.profileId && value.database === target.database && value.table === target.table;
  const acks = ['ddl-implicit-commit', 'external-ddl-window', 'generated-column-computation'];
  const task = (id: unknown) => { if (typeof id !== 'string' || !id || state.tasks.has(id)) reject(); state.tasks.add(id); };
  state.check = () => { if (state.failed || root.__dbarkGeneratedColumnUiAudit !== state || handlers.get('dbark:request') !== wrapped || JSON.stringify(target) !== signature || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject(); const command = payload?.command, input = payload?.input;
    if (command === 'schema.columns.get') {
      if (state.gets || state.previews || state.applies || !shape(input, ['connectionId', 'database', 'table', 'taskId']) || !ownTarget(input)) reject(); task(input.taskId); state.gets++;
    } else if (command === 'schema.columns.preview') {
      if (state.gets !== 1 || !state.snapshotId || state.previews || state.applies || !shape(input, ['snapshotId', 'patches', 'taskId']) || input.snapshotId !== state.snapshotId || !Array.isArray(input.patches) || input.patches.length !== 1) reject();
      const patch = input.patches[0]; if (!shape(patch, ['kind', 'clientKey', 'name', 'type', 'nullable', 'default', 'comment', 'position', 'generated']) || patch.kind !== 'add' || typeof patch.clientKey !== 'string' || !patch.clientKey || patch.name !== 'line_total' || JSON.stringify(patch.type) !== JSON.stringify({ kind: 'decimal', precision: 30, scale: 6, unsigned: false }) || patch.nullable !== true || !shape(patch.default, ['kind']) || patch.default.kind !== 'none' || patch.comment !== '' || !shape(patch.position, ['kind']) || patch.position.kind !== 'last' || !shape(patch.generated, ['storage', 'expression']) || patch.generated.storage !== 'VIRTUAL' || patch.generated.expression !== '`qty` * `price`') reject(); task(input.taskId); state.previews++;
    } else if (command === 'schema.columns.apply') {
      if (state.previews !== 1 || !state.previewToken || state.applies || !shape(input, ['previewToken', 'acknowledgements', 'taskId']) || input.previewToken !== state.previewToken || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== 3 || new Set(input.acknowledgements).size !== 3 || acks.some(id => !input.acknowledgements.includes(id))) reject(); task(input.taskId); state.applies++;
    } else if (command === 'schema.columns.release') {
      const key = input && Object.keys(input)[0]; if (!['snapshotId', 'previewToken'].includes(key) || !shape(input, [key]) || !state[key] || input[key] !== state[key]) reject(); const release = key + ':' + input[key]; if (state.released.has(release)) reject(); state.released.add(release); state.releases++;
    } else if (command === 'query.cancel') { if (!shape(input, ['taskId']) || !state.tasks.has(input.taskId)) reject(); }
    else if (command === 'connections.open') { if (!shape(input, ['id']) || input.id !== target.profileId) reject(); }
    else if (command === 'metadata.databases') { if (!shape(input, ['connectionId']) || input.connectionId !== target.profileId) reject(); }
    else if (command === 'metadata.objects') { if (!shape(input, ['connectionId', 'database']) || input.connectionId !== target.profileId || input.database !== target.database) reject(); }
    else if (command === 'app.setDirty') { if (!shape(input, ['dirty']) || typeof input.dirty !== 'boolean') reject(); }
    else if (command === 'settings.save') { if (!Array.isArray(input?.tabs) || input.tabs.length || input.activeTabId != null) reject(); }
    else if (['connections.list', 'settings.get', 'history.list', 'tasks.list', 'workbench.get'].includes(command)) { if (!shape(input, [])) reject(); }
    else reject();
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject(); const value = response.result;
      if (command === 'connections.open' && (value?.dialect !== 'mysql' || value.version !== '8.4.11')) reject();
      if (command === 'schema.columns.get') {
        if (!ownTarget(value?.target) || typeof value.snapshotId !== 'string' || !value.snapshotId || typeof value.ddlHash !== 'string' || !value.ddlHash || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.generatedAccess?.editable !== true || value.capabilities?.dialect !== 'mysql' || value.capabilities.serverVersion !== '8.4.11' || !Array.isArray(value.columns) || !['qty', 'price'].every(name => value.columns.filter((column: any) => column.name === name && column.generatedReference === true).length === 1)) reject(); state.snapshotId = value.snapshotId; state.ddlHash = value.ddlHash;
      }
      if (command === 'schema.columns.preview') {
        const expected = 'ALTER TABLE `' + target.database + '`.`subject`\nADD COLUMN `line_total` DECIMAL(30,6) GENERATED ALWAYS AS ((`qty` * `price`)) VIRTUAL COMMENT \'\' AFTER `unicode_value`\n;';
        if (!ownTarget(value?.target) || value.ddlHash !== state.ddlHash || typeof value.previewToken !== 'string' || !value.previewToken || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.sql !== expected || !Array.isArray(value.requiredAcknowledgements) || value.requiredAcknowledgements.length !== 3 || new Set(value.requiredAcknowledgements).size !== 3 || acks.some(id => !value.requiredAcknowledgements.includes(id))) reject(); state.previewToken = value.previewToken;
      }
      if (command === 'schema.columns.apply') { if (value?.ddlSubmitted !== true || value.ddlCompleted !== true || value.definitionVerified !== true || !value.after?.columns?.some((column: any) => column.name === 'line_total')) reject(); state.verified = true; }
      if (command === 'history.list' && (!Array.isArray(value) || value.length)) reject(); return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkGeneratedColumnUiAudit = state; handlers.set('dbark:request', wrapped);
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(name, () => { state.failed = true; }); state.check();
}

/** 仅输出行为计数；不把认证、令牌、SQL正文或行值写入日志。 */
export function readGeneratedColumnUiAudit(): { gets: number; previews: number; applies: number; releases: number; pending: number; verified: boolean } {
  const state = (globalThis as any).__dbarkGeneratedColumnUiAudit; if (!state || typeof state.check !== 'function') throw Error('生成列原生审计缺失'); state.check();
  return { gets: state.gets, previews: state.previews, applies: state.applies, releases: state.releases, pending: state.pending, verified: state.verified };
}
