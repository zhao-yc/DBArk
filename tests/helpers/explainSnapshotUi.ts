/** 真实 Main 审计只替换已绑定窗口的文件选择端口，文件读写仍交给正式处理器。 */
export function installExplainSnapshotAudit({ ipcMain, dialog, BrowserWindow }: { ipcMain: any; dialog: any; BrowserWindow: any }, target: { senderId: number; mode: 'live' | 'offline'; profileId?: string; tabId?: string; sql?: string; paths: { json: string; text: string; jsonResaved: string; textResaved: string } }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  const captured = JSON.stringify(target), window = BrowserWindow.getAllWindows().find((value: any) => value.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame;
  const processId = frame?.processId, frameToken = frame?.frameToken, url = frame?.url;
  if (root.__dbarkExplainSnapshotAudit || typeof original !== 'function' || !sender || !frame || frame.detached || !Number.isSafeInteger(processId) || processId <= 0 || typeof frameToken !== 'string' || !frameToken || typeof url !== 'string' || !url || !['live', 'offline'].includes(target.mode)) throw Error('计划快照审计归属无效');
  if (target.mode === 'live' && (!target.profileId || !target.tabId || target.sql !== 'SELECT dbark_plan_value FROM (SELECT 2 AS dbark_plan_value UNION ALL SELECT 1) AS dbark_plan_source WHERE dbark_plan_value>=1 ORDER BY dbark_plan_value')) throw Error('计划快照实库来源无效');
  const state: any = { explains: 0, sessions: 0, saves: 0, opens: 0, dialogs: 0, pending: 0, failed: false, sessionId: undefined, file: undefined, check: undefined };
  const reject = (): never => { state.failed = true; throw Error('计划快照原生审计停链'); };
  const same = (input: any, keys: string[]) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key));
  const sequences = target.mode === 'live' ? [['save', 'json', target.paths.json], ['save', 'text', target.paths.text]] : [['open', 'json', target.paths.json], ['save', 'json', target.paths.jsonResaved], ['open', 'text', target.paths.text], ['save', 'text', target.paths.textResaved]];
  let fileIndex = 0;
  /** 每一次原始异步返回后重新验证原 handler、文件端口、窗口及文档。 */
  state.check = () => { if (state.failed || root.__dbarkExplainSnapshotAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== open || dialog.showSaveDialog !== save || captured !== JSON.stringify(target) || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender || sender.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject(); };
  const choose = (mode: string, args: any[]) => {
    state.check(); const file = state.file;
    if (!file || file.mode !== mode || file.chosen || args[0] !== window || args.at(-1)?.title !== (mode === 'open' ? '选择计划快照文件' : '保存计划快照')) reject();
    file.chosen = true; state.dialogs++;
    return mode === 'open' ? { canceled: false, filePaths: [file.path] } : { canceled: false, filePath: file.path };
  };
  const open = async (...args: any[]) => choose('open', args), save = async (...args: any[]) => choose('save', args);
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== sender || event.senderFrame !== frame) reject();
    const command = payload?.command, input = payload?.input;
    if (command === 'explainFiles.open' || command === 'explainFiles.save') {
      const mode = command === 'explainFiles.open' ? 'open' : 'save', expected = sequences[fileIndex];
      if (state.file || !expected || expected[0] !== mode || !same(input, mode === 'save' ? ['snapshot'] : []) || (mode === 'save' && input.snapshot?.format !== expected[1])) reject();
      if (target.mode === 'live' && state.explains !== fileIndex + 1) reject();
      fileIndex++; state.file = { mode, format: expected[1], path: expected[2], chosen: false };
      if (mode === 'open') state.opens++; else state.saves++;
    } else if (command === 'settings.save') {
      const tabs = input?.tabs;
      if (!Array.isArray(tabs) || (target.mode === 'offline' ? tabs.length !== 0 : tabs.length !== 1 || input.activeTabId !== target.tabId || tabs[0]?.id !== target.tabId || tabs[0]?.connectionId !== target.profileId || tabs[0]?.sql !== target.sql)) reject();
    } else if (['connections.list', 'settings.get', 'history.list', 'tasks.list', 'workbench.get'].includes(command)) {
      if (!same(input, [])) reject();
    } else if (target.mode === 'offline') reject();
    else if (command === 'connections.open') { if (!same(input, ['id']) || input.id !== target.profileId) reject(); }
    else if (command === 'sessions.open') { if (!same(input, ['connectionId', 'database']) || input.connectionId !== target.profileId || input.database != null || state.sessions) reject(); state.sessions++; }
    else if (command === 'query.explain') {
      if (!same(input, ['sessionId', 'sql', 'taskId', 'maxRows', 'format']) || input.sessionId !== state.sessionId || !state.sessionId || input.sql !== target.sql || input.format !== (state.explains === 0 ? 'auto' : 'text') || state.explains >= 2 || state.file || state.saves !== state.explains || typeof input.taskId !== 'string' || !input.taskId || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000) reject();
      state.explains++;
    } else if (command === 'query.completionState' || command === 'sessions.close') { if (!same(input, ['sessionId']) || !state.sessionId || input.sessionId !== state.sessionId) reject(); }
    else if (command === 'metadata.completion') { if (!input || input.connectionId !== target.profileId) reject(); }
    else reject();
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject();
      if (command === 'connections.open' && (response.result?.dialect !== 'mysql' || response.result.version !== '8.4.11')) reject();
      if (command === 'sessions.open') { if (state.sessionId || typeof response.result?.sessionId !== 'string' || !response.result.sessionId) reject(); state.sessionId = response.result.sessionId; }
      if (command === 'query.explain') {
        const plan = response.result?.explain, result = response.result?.results?.[0];
        if (plan?.format !== (state.explains === 1 ? 'json' : 'text') || plan.dialect !== 'mysql' || plan.version !== '8.4.11' || response.result?.results?.length !== 1 || !Array.isArray(result?.rows) || !result.rows.length || (state.explains === 1 && (!Array.isArray(plan.nodes) || !plan.nodes.length || typeof plan.raw !== 'string' || !plan.raw))) reject();
      }
      if (command.startsWith('explainFiles.')) {
        const file = state.file;
        if (!file?.chosen || response.result?.name !== file.path.split(/[\\/]/).at(-1) || (file.mode === 'open' && response.result?.snapshot?.format !== file.format)) reject();
        state.file = undefined;
      }
      if (target.mode === 'offline' && ['connections.list', 'history.list', 'tasks.list'].includes(command) && (!Array.isArray(response.result) || response.result.length !== 0)) reject();
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkExplainSnapshotAudit = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = open; dialog.showSaveDialog = save;
  // 新文档不能借用旧文档已经安装的授权，即使网址相同也停链。
  sender.on('did-start-navigation', (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) sender.on(name, () => { state.failed = true; });
  state.check();
}

/** 只返回计数；从不公开连接、认证、路径、SQL 或计划原文。 */
export function readExplainSnapshotAudit(): { explains: number; sessions: number; saves: number; opens: number; dialogs: number; pending: number } {
  const state = (globalThis as any).__dbarkExplainSnapshotAudit;
  if (!state || typeof state.check !== 'function') throw Error('计划快照原生审计缺失'); state.check();
  return { explains: state.explains, sessions: state.sessions, saves: state.saves, opens: state.opens, dialogs: state.dialogs, pending: state.pending };
}
