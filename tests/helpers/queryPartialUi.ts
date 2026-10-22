import { win32 } from 'node:path';

export const queryPartialUiKeys = ['DBARK_QUERY_PARTIAL_UI', 'DBARK_INTEGRATION_ENABLED', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_QUERY_PARTIAL_OUTPUT', 'DBARK_QUERY_PARTIAL_MANIFEST', 'DBARK_QUERY_PARTIAL_MANIFEST_SHA256'] as const;
/** 独立11键门；不推断认证，不加载额外专项，原配置变化后不能复活。 */
export function bindQueryPartialUi(read: () => { env: NodeJS.ProcessEnv; platform: string; args: readonly string[] }) {
  const capture = () => {
    const { env, platform, args } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== queryPartialUiKeys.length || keys.some(key => !queryPartialUiKeys.includes(key as any) || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'string')) throw Error('脚本部分失败原生配置无效');
    const value = (key: string) => descriptors[key].value as string, output = value('DBARK_QUERY_PARTIAL_OUTPUT'), manifest = value('DBARK_QUERY_PARTIAL_MANIFEST'), sha = value('DBARK_QUERY_PARTIAL_MANIFEST_SHA256');
    if (value('DBARK_QUERY_PARTIAL_UI') !== '1' || value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || value('DBARK_TEST_EXPECTED_SERVER_UUID') !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !win32.isAbsolute(output) || win32.resolve(output) !== output || !/^dbark-query-partial-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('脚本部分失败固定目标或批准身份不符');
    for (const [index, arg] of args.entries()) if (arg === '--config' || arg === '-c' || arg.startsWith('--config=') || /^-c./.test(arg) || ['--ui', '--debug', '--repeat-each', '--retries', '--workers'].includes(arg) || /^--(?:repeat-each|retries|workers)=/.test(arg) || arg === '--trace' && args[index + 1] !== 'off' || arg.startsWith('--trace=') && arg !== '--trace=off') throw Error('脚本部分失败拒绝运行器覆盖');
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output, manifest, sha } };
  };
  const original = capture(); let retained = false;
  return { target: Object.freeze(original.target), assertCurrent() { if (retained) throw Error('脚本部分失败原配置已停链'); try { if (capture().signature !== original.signature) throw Error('脚本部分失败原配置已变化'); } catch (error) { retained = true; throw error; } } };
}

export const queryPartialFirstSql = "SELECT CAST('1' AS CHAR) AS id,CAST('18446744073709551615' AS UNSIGNED) AS repeated,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS repeated,NULL AS null_value,X'00ff' AS bytes UNION ALL SELECT CAST('2' AS CHAR),CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),NULL,X'' ORDER BY id";
export const queryPartialColumns = ['id', 'repeated', 'repeated', 'null_value', 'bytes'];
export const queryPartialRows = [{ c0: '1', c1: '18446744073709551615', c2: '0.12345678901234567890', c3: null, c4: { type: 'binary', base64: 'AP8=' } }, { c0: '2', c1: '9007199254740993', c2: '1.00000000000000000001', c3: null, c4: { type: 'binary', base64: '' } }];
/** 只构造原随机测试库脚本；后续UPDATE是检测不得继续的自带哨兵。 */
export function queryPartialScript(database: string): string { if (!/^dbark_qpartial_ui_[a-f0-9]{32}$/.test(database)) throw Error('脚本部分失败库名无效'); return queryPartialFirstSql + ';\nSELECT * FROM `' + database + '`.`missing_owned`;\nUPDATE `' + database + '`.`sentinel` SET marker=\'SHOULD_NOT_RUN\' WHERE id=1;'; }

/** 序列化至真实Main，只允许原脚本一次、前缀结果两个文件及明确一次ROLLBACK。 */
export function installQueryPartialUiAudit({ ipcMain, BrowserWindow, dialog }: { ipcMain: any; BrowserWindow: any; dialog: any }, target: { senderId: number; profileId: string; tabId: string; database: string; sql: string; first: string; columns: string[]; rows: unknown[]; paths: { csv: string; json: string } }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame, signature = JSON.stringify(target), processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkQueryPartialUiAudit || typeof original !== 'function' || !sender || !frame || frame.detached || !/^dbark_qpartial_ui_[a-f0-9]{32}$/.test(target.database) || !target.profileId || !target.tabId || !Number.isSafeInteger(processId) || processId <= 0 || !frameToken || !url) throw Error('脚本部分失败Main归属无效');
  const state: any = { queries: 0, exports: [], chosen: [], rollbacks: 0, pending: 0, failed: false, session: '', sessionClaim: false, queryTask: '', failure: undefined, terminal: '', tokens: {}, file: undefined, check: undefined };
  const reject = (): never => { state.failed = true; throw Error('脚本部分失败Main审计停链'); };
  const shape = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  const sameRows = (value: any) => JSON.stringify(value) === JSON.stringify(target.rows);
  const sameColumns = (value: any) => Array.isArray(value) && value.length === target.columns.length && value.every((column: any, index: number) => column.key === 'c' + index && column.name === target.columns[index]);
  state.check = () => { if (state.failed || root.__dbarkQueryPartialUiAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showSaveDialog !== save || sender.send !== send || signature !== JSON.stringify(target) || window.isDestroyed() || sender.isDestroyed() || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const originalSend = sender.send;
  const send = function(this: any, channel: string, ...args: any[]) { state.check(); const event = args[0]; if (channel === 'dbark:task' && state.queryTask && event?.taskId === state.queryTask && event.status !== 'running') { if (event.status !== 'failed') reject(); state.terminal = event.status; } return originalSend.call(this, channel, ...args); };
  const save = async (...args: any[]) => { state.check(); if (!state.file || state.file.chosen || args[0] !== window) reject(); state.file.chosen = true; return { canceled: false, filePath: target.paths[state.file.format as 'csv' | 'json'] }; };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject(); const command = payload?.command, input = payload?.input;
    if (command === 'connections.open') { if (!shape(input, ['id']) || input.id !== target.profileId) reject(); }
    else if (command === 'sessions.open') { if (state.sessionClaim || !shape(input, ['connectionId', 'database']) || input.connectionId !== target.profileId || input.database !== target.database) reject(); state.sessionClaim = true; }
    else if (command === 'query.execute') { if (state.queries || !state.session || !shape(input, ['sessionId', 'sql', 'taskId', 'maxRows']) || input.sessionId !== state.session || input.sql !== target.sql || typeof input.taskId !== 'string' || !input.taskId || !Number.isSafeInteger(input.maxRows) || input.maxRows < 2 || input.maxRows > 100000) reject(); state.queries++; state.queryTask = input.taskId; }
    else if (['query.sessionState', 'query.completionState', 'sessions.close'].includes(command)) { if (!shape(input, ['sessionId']) || !state.session || input.sessionId !== state.session) reject(); }
    else if (command === 'metadata.completion') { if (!input || input.connectionId !== target.profileId || input.database != null && input.database !== target.database) reject(); }
    else if (command === 'query.transaction') { if (!shape(input, ['sessionId', 'action']) || input.sessionId !== state.session || !state.failure || state.rollbacks || input.action !== 'rollback') reject(); state.rollbacks++; }
    else if (command === 'files.choose') { const format = ['csv', 'json'][state.chosen.length]; if (!state.failure || state.file || !shape(input, ['purpose', 'format', 'suggestedName']) || input.purpose !== 'export' || input.format !== format) reject(); state.chosen.push(format); state.file = { format, chosen: false }; }
    else if (command === 'files.exportResult') { const format = ['csv', 'json'][state.exports.length]; if (!state.failure || !shape(input, ['fileToken', 'format', 'encoding', 'taskId', 'result', 'csvDelimiter']) || input.format !== format || input.encoding !== 'utf8' || input.fileToken !== state.tokens[format] || !sameColumns(input.result?.columns) || !sameRows(input.result?.rows) || input.result?.truncated !== false || input.csvDelimiter !== undefined && input.csvDelimiter !== ',') reject(); state.exports.push(format); }
    else if (command === 'app.setDirty') { if (!shape(input, ['dirty']) || typeof input.dirty !== 'boolean') reject(); }
    else if (command === 'settings.save') { const tabs = input?.tabs; if (!Array.isArray(tabs) || tabs.length !== 1 || tabs[0].id !== target.tabId || tabs[0].connectionId !== target.profileId || tabs[0].sql !== target.sql || input.activeTabId !== target.tabId) reject(); }
    else if (['connections.list', 'settings.get', 'history.list', 'tasks.list', 'workbench.get'].includes(command)) { if (!shape(input, [])) reject(); }
    else reject();
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject(); const value = response.result;
      if (command === 'connections.open' && (value?.dialect !== 'mysql' || value.version !== '8.4.11')) reject();
      if (command === 'sessions.open') { if (!value?.sessionId || typeof value.sessionId !== 'string') reject(); state.session = value.sessionId; }
      if (command === 'query.execute') { if (value?.failure?.statementOrdinal !== 2 || value.failure.statementsCompleted !== 1 || typeof value.failure.message !== 'string' || !value.failure.message || value.transactionOpen !== undefined || value.results?.length !== 1 || !sameColumns(value.results[0].columns) || !sameRows(value.results[0].rows) || value.results[0].truncated !== false || value.results[0].statement !== target.first || state.terminal !== 'failed') reject(); state.failure = { statementOrdinal: 2, statementsCompleted: 1, completeResults: 1, rows: 2 }; }
      if (command === 'files.choose') { if (!state.file?.chosen || !value?.token || value.name !== target.paths[state.file.format as 'csv' | 'json'].split(/[\\/]/).at(-1)) reject(); state.tokens[state.file.format] = value.token; state.file = undefined; }
      if (command === 'files.exportResult' && value?.rows !== 2) reject();
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkQueryPartialUiAudit = state; handlers.set('dbark:request', wrapped); sender.send = send; dialog.showSaveDialog = save;
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; }); for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(name, () => { state.failed = true; }); state.check();
}

/** 只公开失败范围和行为计数，不返回原SQL、参数、路径或认证。 */
export function readQueryPartialUiAudit() { const state = (globalThis as any).__dbarkQueryPartialUiAudit; if (!state || typeof state.check !== 'function') throw Error('脚本部分失败审计缺失'); state.check(); return { queries: state.queries, exports: [...state.exports], rollbacks: state.rollbacks, pending: state.pending, terminal: state.terminal, failure: state.failure }; }
