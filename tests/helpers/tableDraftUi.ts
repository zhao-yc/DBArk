import type { ElectronApplication } from '@playwright/test';
import type { RowChange, TablePage } from '../../src/shared/contracts';
import type { TableDraftDocument, TableDraftPayload } from '../../src/shared/tableDraft';

export interface TableDraftUiAudit {
  pending: number;
  saves: { payload: TableDraftPayload; ok: boolean }[];
  opens: { ok: boolean; document?: TableDraftDocument }[];
  verifies: { taskId: string; ok: boolean; count?: number }[];
  previews: { changes: RowChange[]; ok: boolean }[];
  applies: { taskId: string; changes: RowChange[]; ok: boolean }[];
  pages: { page: number; pageSize: number; count?: number; hasMore?: boolean; ids?: unknown[] }[];
  connectionThreads: number[];
}

/** 只旁观原请求与原回包；不替换产品数据、恢复方法、状态或数据库操作。 */
export async function installTableDraftAudit(application: ElectronApplication, target: { connectionId: string; database: string; table: string }): Promise<void> {
  await application.evaluate(({ ipcMain, BrowserWindow }, target) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__tableDraftUiAudit || typeof previous !== 'function' || windows.length !== 1 || !frame) throw Error('草稿Main旁观原归属未知');
    const state: TableDraftUiAudit & { check(): void; restore(): void } = { pending: 0, saves: [], opens: [], verifies: [], previews: [], applies: [], pages: [], connectionThreads: [], check() {}, restore() {} };
    const check = () => { if (root.__tableDraftUiAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('草稿Main原窗口归属变化'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('草稿Main请求来源变化');
      const command = payload.command, input = payload.input, selected = ['tableDraftFiles.save', 'tableDraftFiles.open', 'table.draftVerify', 'table.preview', 'table.apply', 'table.page', 'connections.open'].includes(command);
      if (selected) state.pending++;
      try {
        if (selected && command !== 'connections.open') {
          const actual = command === 'tableDraftFiles.save' ? input.payload.target : command === 'tableDraftFiles.open' ? input.target : input;
          if (actual.connectionId !== target.connectionId || actual.database !== target.database || actual.table !== target.table || Object.hasOwn(input, 'filePath')) throw Error('草稿请求离开本例准确目标');
        }
        const pageIndex = command === 'table.page' ? state.pages.length : -1;
        if (pageIndex >= 0) state.pages.push({ page: input.page, pageSize: input.pageSize });
        const response = await previous(event, payload); check();
        if (command === 'tableDraftFiles.save') state.saves.push({ payload: input.payload, ok: response?.ok === true });
        if (command === 'tableDraftFiles.open') state.opens.push({ ok: response?.ok === true, ...(response?.ok && response.result ? { document: response.result.document } : {}) });
        if (command === 'table.draftVerify') state.verifies.push({ taskId: input.taskId, ok: response?.ok === true, ...(response?.ok ? { count: response.result.verifiedChanges } : {}) });
        if (command === 'table.preview') state.previews.push({ changes: input.changes, ok: response?.ok === true });
        if (command === 'table.apply') state.applies.push({ taskId: input.taskId, changes: input.changes, ok: response?.ok === true });
        if (pageIndex >= 0 && response?.ok) { const result = response.result as TablePage; Object.assign(state.pages[pageIndex], { count: result.rows.length, hasMore: result.hasMore, ids: result.rows.map(row => row.id) }); }
        if (command === 'connections.open' && input.id === target.connectionId && response?.ok && Number.isSafeInteger(response.result?.connectionId)) state.connectionThreads.push(response.result.connectionId);
        return response;
      } finally { if (selected) state.pending--; }
    };
    state.check = check;
    state.restore = () => { check(); if (state.pending) throw Error('草稿原Main请求仍在途'); handlers.set('dbark:request', previous); delete root.__tableDraftUiAudit; };
    root.__tableDraftUiAudit = state; handlers.set('dbark:request', wrapped);
  }, target);
}

/** 复制有限审计数据；不读取连接表单、凭据或任何生产私有状态。 */
export async function readTableDraftAudit(application: ElectronApplication): Promise<TableDraftUiAudit> {
  return application.evaluate(() => { const state = (globalThis as any).__tableDraftUiAudit; state.check(); return { pending: state.pending, saves: state.saves, opens: state.opens, verifies: state.verifies, previews: state.previews, applies: state.applies, pages: state.pages, connectionThreads: state.connectionThreads }; });
}

/** 真实请求终态后才恢复原Main入口，旧旁观不能覆盖新所有者。 */
export async function removeTableDraftAudit(application: ElectronApplication): Promise<void> { await application.evaluate(() => (globalThis as any).__tableDraftUiAudit.restore()); }

/** 仅一次性回答本例原生草稿文件对话框；磁盘读取、原子写入仍为原产品逻辑。 */
export async function installTableDraftFileAnswer(application: ElectronApplication, input: { nonce: string; path: string; mode: 'open' | 'save' }): Promise<void> {
  await application.evaluate(({ dialog, BrowserWindow }, input) => {
    const root = globalThis as any, windows = BrowserWindow.getAllWindows(), window = windows[0], original = input.mode === 'open' ? dialog.showOpenDialog : dialog.showSaveDialog;
    if (root.__tableDraftFileAnswer || windows.length !== 1) throw Error('草稿文件选择原归属未知');
    const state = { nonce: input.nonce, mode: input.mode, calls: 0, restored: false, original }; root.__tableDraftFileAnswer = state;
    const answer = async (...args: unknown[]) => {
      const filters = [{ name: 'DBArk 表格草稿（包含原始数据）', extensions: ['dbark-draft'] }];
      const expected = input.mode === 'open' ? { title: '打开表格草稿', properties: ['openFile'], filters } : { title: '保存表格草稿', defaultPath: '表格草稿.dbark-draft', filters };
      if (root.__tableDraftFileAnswer !== state || state.calls || args.length !== 2 || args[0] !== window || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || JSON.stringify(args[1]) !== JSON.stringify(expected)) throw Error('不是本例原生草稿文件选择');
      state.calls++; state.restored = true;
      if (input.mode === 'open') { dialog.showOpenDialog = original as typeof dialog.showOpenDialog; return { canceled: false, filePaths: [input.path] }; }
      dialog.showSaveDialog = original as typeof dialog.showSaveDialog; return { canceled: false, filePath: input.path };
    };
    if (input.mode === 'open') dialog.showOpenDialog = answer as typeof dialog.showOpenDialog;
    else dialog.showSaveDialog = answer as typeof dialog.showSaveDialog;
  }, input);
}

/** 不以API适配冒充系统文件窗口输入，原函数必须已恢复且恰好消费一次。 */
export async function finishTableDraftFileAnswer(application: ElectronApplication, nonce: string) {
  return application.evaluate(({ dialog }, nonce) => {
    const root = globalThis as any, state = root.__tableDraftFileAnswer;
    if (!state || state.nonce !== nonce || state.calls !== 1 || !state.restored || (state.mode === 'open' ? dialog.showOpenDialog : dialog.showSaveDialog) !== state.original) throw Error('草稿原生文件选择未闭合');
    delete root.__tableDraftFileAnswer; return { calls: 1, originalRestored: true, nativeInputVerified: false };
  }, nonce);
}
