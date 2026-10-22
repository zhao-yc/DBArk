import { win32 } from 'node:path';

export const generatedExpressionUiUuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
/** 原生门仅授权200的准确13384实例、独占目录和批准来源；配置漂移永久停链。 */
export function bindGeneratedExpressionUi(read: () => { env: NodeJS.ProcessEnv; platform: string; args: readonly string[] }) {
  const allowed = ['DBARK_INTEGRATION_ENABLED', 'DBARK_GENERATED_EXPRESSION_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_GENERATED_EXPRESSION_OUTPUT', 'DBARK_GENERATED_EXPRESSION_MANIFEST', 'DBARK_GENERATED_EXPRESSION_MANIFEST_SHA256'];
  const snapshot = () => {
    const { env, platform, args } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^DBARK_|^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'string')) throw Error('生成表达式原生配置无效');
    const value = (key: string) => descriptors[key]?.value as string;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_GENERATED_EXPRESSION_UI') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || value('DBARK_TEST_EXPECTED_SERVER_UUID') !== generatedExpressionUiUuid) throw Error('生成表达式实库目标无效');
    const output = value('DBARK_GENERATED_EXPRESSION_OUTPUT'), manifest = value('DBARK_GENERATED_EXPRESSION_MANIFEST'), sha = value('DBARK_GENERATED_EXPRESSION_MANIFEST_SHA256');
    if (!win32.isAbsolute(output) || win32.resolve(output) !== output || win32.dirname(output) === output || !/^dbark-generated-expression-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('生成表达式缺少独占输出或批准来源');
    for (const [index, arg] of args.entries()) {
      if (arg === '--config' || arg === '-c' || arg.startsWith('--config=') || /^-c./.test(arg) || ['--ui', '--debug'].includes(arg) || arg === '--trace' && args[index + 1] !== 'off' || arg.startsWith('--trace=') && arg !== '--trace=off') throw Error('生成表达式拒绝替换原运行配置或录制');
    }
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output, manifest, sha } };
  };
  const captured = snapshot(); let failed = false;
  return { target: Object.freeze(captured.target), assertCurrent() { if (failed) throw Error('生成表达式原配置已停链'); try { if (snapshot().signature !== captured.signature) throw Error('生成表达式原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

/** Main原处理器外的只观察审计：输入不在本例精确能力内时先拒绝，不替换产品返回。 */
export function installGeneratedExpressionUiAudit({ ipcMain, BrowserWindow }: { ipcMain: any; BrowserWindow: any }, target: { senderId: number; profileId: string; database: string; table: string }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), signature = JSON.stringify(target);
  const window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame, processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkGeneratedExpressionUiAudit || typeof original !== 'function' || !Number.isSafeInteger(target.senderId) || target.senderId <= 0 || !target.profileId || !/^dbark_genexpr_ui_[a-f0-9]{32}$/.test(target.database) || target.table !== 'subject' || !sender || !frame || frame.detached || !Number.isSafeInteger(processId) || processId <= 0 || typeof frameToken !== 'string' || !frameToken || typeof url !== 'string' || !url) throw Error('生成表达式审计归属无效');
  const state: any = { gets: 0, previews: 0, applies: 0, releases: 0, pending: 0, verified: false, failed: false, tasks: new Set(), released: new Set(), check: undefined };
  const reject = (): never => { state.failed = true; throw Error('生成表达式原生审计停链'); };
  const shape = (input: any, keys: string[]) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join() === [...keys].sort().join();
  const ownTarget = (value: any) => value?.connectionId === target.profileId && value.database === target.database && value.table === target.table;
  const acks = ['ddl-implicit-commit', 'external-ddl-window', 'generated-column-computation', 'generated-expression-recalculation'];
  const task = (id: unknown) => { if (typeof id !== 'string' || !id || state.tasks.has(id)) reject(); state.tasks.add(id); };
  state.check = () => { if (state.failed || root.__dbarkGeneratedExpressionUiAudit !== state || handlers.get('dbark:request') !== wrapped || JSON.stringify(target) !== signature || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject(); const command = payload?.command, input = payload?.input;
    if (command === 'schema.columns.get') {
      if (state.gets || state.previews || state.applies || !shape(input, ['connectionId', 'database', 'table', 'taskId']) || !ownTarget(input)) reject(); task(input.taskId); state.gets++;
    } else if (command === 'schema.columns.preview') {
      if (state.gets !== 1 || !state.snapshotId || state.previews || state.applies || !shape(input, ['snapshotId', 'patches', 'taskId']) || input.snapshotId !== state.snapshotId || !Array.isArray(input.patches) || input.patches.length !== 1) reject();
      const patch = input.patches[0]; if (!shape(patch, ['kind', 'columnRef', 'changes']) || patch.kind !== 'alter' || patch.columnRef !== state.columnRef || !shape(patch.changes, ['generation']) || !shape(patch.changes.generation, ['expression']) || patch.changes.generation.expression !== '`qty` * `price` + 2.000000') reject(); task(input.taskId); state.previews++;
    } else if (command === 'schema.columns.apply') {
      if (state.previews !== 1 || !state.previewToken || state.applies || !shape(input, ['previewToken', 'acknowledgements', 'taskId']) || input.previewToken !== state.previewToken || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== 4 || new Set(input.acknowledgements).size !== 4 || acks.some(id => !input.acknowledgements.includes(id))) reject(); task(input.taskId); state.applies++;
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
        if (!ownTarget(value?.target) || typeof value.snapshotId !== 'string' || !value.snapshotId || typeof value.ddlHash !== 'string' || !value.ddlHash || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.capabilities?.dialect !== 'mysql' || value.capabilities.serverVersion !== '8.4.11' || !Array.isArray(value.columns) || value.columns.length !== 7 || !['qty', 'price'].every(name => value.columns.filter((column: any) => column.name === name && column.generatedReference === true).length === 1)) reject();
        const columns = value.columns.filter((column: any) => column.name === 'line_total'); if (columns.length !== 1) reject(); const column = columns[0];
        if (typeof column.columnRef !== 'string' || !column.columnRef || column.typeSql !== 'decimal(30,6)' || column.ordinal !== 6 || column.comment !== '原生成备注' || column.generation?.storage !== 'VIRTUAL' || column.generation.expression !== '(`qty` * `price`)' || column.generation.access?.editable !== true || column.generatedReference === true || Object.values(column.access).some((access: any) => access.editable !== false)) reject();
        // 审计只替换本例实际SHOW的唯一已核算术表达式；保留原字段完整前后字节，不调用产品SQL计划器。
        const match = /^(\s*`line_total` decimal\(30,6\) GENERATED ALWAYS AS \()(\(`qty` \* `price`\))(\) VIRTUAL COMMENT '原生成备注'\s*)$/.exec(column.rawDefinition); if (!match) { state.failed = true; throw Error('生成表达式原字段片段不属于本例精确范围'); }
        state.expectedDefinition = match[1] + '((`qty` * `price`) + 2.000000)' + match[3]; state.columnRef = column.columnRef; state.snapshotId = value.snapshotId; state.ddlHash = value.ddlHash;
      }
      if (command === 'schema.columns.preview') {
        const expected = 'ALTER TABLE `' + target.database + '`.`subject`\nMODIFY COLUMN ' + state.expectedDefinition + '\n,\nALGORITHM=COPY\n,\nWITH VALIDATION\n;';
        if (!ownTarget(value?.target) || value.ddlHash !== state.ddlHash || typeof value.previewToken !== 'string' || !value.previewToken || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || value.sql !== expected || !Array.isArray(value.requiredAcknowledgements) || value.requiredAcknowledgements.length !== 4 || new Set(value.requiredAcknowledgements).size !== 4 || acks.some(id => !value.requiredAcknowledgements.includes(id))) reject(); state.previewToken = value.previewToken;
      }
      if (command === 'schema.columns.apply') {
        const tableIdWarning = '修改生成表达式后物理表编号已变化；定义核验不据此判断执行算法。';
        // COPY后的真实TABLE_ID变化可作为唯一提示；任意转换警告、未知结果或核验失败仍拒绝。
        if (value?.ddlSubmitted !== true || value.ddlCompleted !== true || value.definitionVerified !== true || !Array.isArray(value.warnings) || value.warnings.length > 1 || value.warnings.length === 1 && value.warnings[0] !== tableIdWarning || value.after?.columns?.length !== 7 || !value.after.columns.some((column: any) => column.name === 'line_total' && column.columnRef === state.columnRef && column.typeSql === 'decimal(30,6)' && column.generation?.storage === 'VIRTUAL')) reject(); state.verified = true;
      }
      if (command === 'history.list' && (!Array.isArray(value) || value.length)) reject(); return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkGeneratedExpressionUiAudit = state; handlers.set('dbark:request', wrapped);
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(name, () => { state.failed = true; }); state.check();
}

/** 仅输出行为计数；不把认证、令牌、SQL正文或行值写入日志。 */
export function readGeneratedExpressionUiAudit(): { gets: number; previews: number; applies: number; releases: number; pending: number; verified: boolean } {
  const state = (globalThis as any).__dbarkGeneratedExpressionUiAudit; if (!state || typeof state.check !== 'function') throw Error('生成表达式原生审计缺失'); state.check();
  return { gets: state.gets, previews: state.previews, applies: state.applies, releases: state.releases, pending: state.pending, verified: state.verified };
}
