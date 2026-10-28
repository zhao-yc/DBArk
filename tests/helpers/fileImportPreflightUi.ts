import type { ElectronApplication, Locator } from '@playwright/test';
import type { FileImportPreflightReport } from '../../src/shared/fileImportPreflight';
import type { FileImportResult } from '../../src/shared/sqlFileImport';

export interface PreflightUiAudit {
  pending: number;
  choices: { token: string; name: string; purpose: string; format: string }[];
  checks: { taskId: string; token: string; report: FileImportPreflightReport }[];
  exports: { taskId: string; token: string; rows: number }[];
  imports: { taskId: string; token: string; result: FileImportResult }[];
}

/** 原Main处理器只包一层旁观；文件能力、元数据、SQL和写盘仍执行产品原路径。 */
export async function installPreflightUiAudit(application: ElectronApplication, target: { connectionId: string; database: string; table: string }) {
  await application.evaluate(({ ipcMain, BrowserWindow }, target) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__preflightUiAudit || typeof previous !== 'function' || windows.length !== 1 || !frame) throw Error('预检Main原归属未知');
    const attempts = { checks: 0, imports: 0, exports: 0 };
    const state = { pending: 0, choices: [] as PreflightUiAudit['choices'], checks: [] as PreflightUiAudit['checks'], exports: [] as PreflightUiAudit['exports'], imports: [] as PreflightUiAudit['imports'], check() {}, restore() {} };
    const check = () => { if (root.__preflightUiAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('预检Main原归属变化'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('预检Main来源变化');
      const command = payload.command, value = payload.input;
      const relevant = ['files.choose', 'files.preview', 'files.preflight', 'files.exportResult', 'files.import', 'files.importKeys'].includes(command);
      if (relevant) state.pending++;
      try {
        if (['files.preview', 'files.preflight', 'files.import'].includes(command)) {
          const selected = state.choices.filter(choice => choice.purpose === 'import').at(-1);
          if (!selected || value.fileToken !== selected.token || value.format !== 'csv' || value.encoding !== 'utf8' || Object.hasOwn(value, 'filePath')) throw Error('原输入能力或编码无效');
        }
        if (['files.preflight', 'files.import'].includes(command)) {
          if (value.connectionId !== target.connectionId || value.database !== target.database || value.table !== target.table || JSON.stringify(Object.entries(value.mapping).sort()) !== JSON.stringify(['n', 'amount', 'note', 'payload'].map(name => [name, name]).sort())) throw Error('预检来源或映射变化');
        }
        if (command === 'files.preflight' && (attempts.checks++ !== state.checks.length || state.checks.length >= 2 || state.imports.length)) throw Error('不得重放预检或导入后追加校验');
        if (command === 'files.exportResult') {
          const choice = state.choices.find(choice => choice.purpose === 'export');
          if (attempts.exports++ || !choice || value.fileToken !== choice.token || state.checks.length !== 1 || state.exports.length || state.imports.length || value.format !== 'json' || value.encoding !== 'utf8' || Object.hasOwn(value, 'filePath') || value.result?.rows?.length !== 201) throw Error('报告保存来源或范围无效');
        }
        if (command === 'files.import') {
          const report = state.checks.at(-1);
          if (attempts.imports++ || state.checks.length !== 2 || state.exports.length !== 1 || state.imports.length || !report || report.token !== value.fileToken || !report.report.complete || report.report.issueCount || value.transactionMode !== 'atomic' || value.conflict?.mode !== 'upsert' || value.conflict.key.name !== 'PRIMARY' || JSON.stringify(value.conflict.key.columns) !== '["n"]') throw Error('未完成新来源明确校验或原子策略确认');
        }
        if (command === 'query.cancel') throw Error('本例未授权取消另一个任务');
        const response = await previous(event, payload); check();
        if (relevant && !response?.ok) throw Error('原Main请求未成功，保留失败而不重放');
        if (command === 'files.choose') {
          const imports = state.choices.filter(choice => choice.purpose === 'import').length;
          if (!(value.purpose === 'import' && value.format === 'csv' && imports < 2 || value.purpose === 'export' && value.format === 'json' && imports === 1 && state.checks.length === 1 && !state.choices.some(choice => choice.purpose === 'export')) || typeof response.result?.token !== 'string' || state.choices.some(choice => choice.token === response.result.token)) throw Error('本例文件能力次数或用途异常');
          state.choices.push({ ...response.result, purpose: value.purpose, format: value.format });
        }
        if (command === 'files.preflight') { if (response.result?.taskId !== value.taskId) throw Error('预检回执非原任务'); state.checks.push({ taskId: value.taskId, token: value.fileToken, report: response.result }); }
        if (command === 'files.exportResult') state.exports.push({ taskId: value.taskId, token: value.fileToken, rows: response.result.rows });
        if (command === 'files.import') state.imports.push({ taskId: value.taskId, token: value.fileToken, result: response.result });
        return response;
      } finally { if (relevant) state.pending--; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('原预检请求尚在途'); handlers.set('dbark:request', previous); delete root.__preflightUiAudit; };
    root.__preflightUiAudit = state; handlers.set('dbark:request', wrapped);
  }, target);
}
/** 只读取原窗口的有界审计；不能借旧窗口或旧IPC归属继续动作。 */
export async function readPreflightUiAudit(application: ElectronApplication): Promise<PreflightUiAudit> {
  return application.evaluate(() => { const state = (globalThis as any).__preflightUiAudit; state.check(); return { pending: state.pending, choices: state.choices, checks: state.checks, exports: state.exports, imports: state.imports }; });
}
/** 原Main全结算之后才恢复处理器，失败不强行解除在途归属。 */
export async function removePreflightUiAudit(application: ElectronApplication) { await application.evaluate(() => (globalThis as any).__preflightUiAudit.restore()); }

/** 精确一次性回答本例JSON保存框；不伪称系统键鼠输入，令牌仍由原Main签发。 */
export async function installPreflightReportAnswer(application: ElectronApplication, input: { nonce: string; path: string; suggestedName: string }) {
  await application.evaluate(({ dialog, BrowserWindow }, input) => {
    const root = globalThis as any, windows = BrowserWindow.getAllWindows(), window = windows[0], original = dialog.showSaveDialog;
    if (root.__preflightReportAnswer || windows.length !== 1) throw Error('预检报告保存原归属未知');
    const state = { nonce: input.nonce, calls: 0, restored: false, original }; root.__preflightReportAnswer = state;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const expected = { title: '导出文件', defaultPath: input.suggestedName, filters: [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }] };
      if (root.__preflightReportAnswer !== state || state.calls || args.length !== 2 || args[0] !== window || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || JSON.stringify(args[1]) !== JSON.stringify(expected)) throw Error('不是本例JSON报告保存对话框');
      state.calls++; state.restored = true; dialog.showSaveDialog = original; return { canceled: false, filePath: input.path };
    }) as typeof dialog.showSaveDialog;
  }, input);
}
/** 不恢复不继续，失败保留原状态供统筹审计。 */
export async function finishPreflightReportAnswer(application: ElectronApplication, nonce: string) {
  return application.evaluate(({ dialog }, nonce) => {
    const root = globalThis as any, state = root.__preflightReportAnswer;
    if (!state || state.nonce !== nonce || state.calls !== 1 || !state.restored || dialog.showSaveDialog !== state.original) throw Error('报告原生保存未闭合');
    delete root.__preflightReportAnswer; return { calls: 1, originalRestored: true, nativeInputVerified: false };
  }, nonce);
}

/** 只旁听原DOM禁用属性变更，不延迟原IPC或扫描；短任务也保留运行中按钮事实。 */
export async function armPreflightBusyObservation(run: Locator, startName: string) {
  await run.evaluate((element, startName) => {
    const button = element as HTMLButtonElement, dialog = button.closest('[role="dialog"]');
    const candidates = dialog ? Array.from(dialog.querySelectorAll('button')).filter(node => node.textContent?.trim() === startName) : [];
    if (!dialog || candidates.length !== 1 || (button as any).__preflightBusyObservation) throw Error('预检运行按钮观察归属未知');
    const start = candidates[0], snapshots: { runDisabled: boolean; startDisabled: boolean }[] = [];
    let clicked = false;
    const click = () => { clicked = true; };
    const observer = new MutationObserver(() => { if (clicked && button.isConnected && start.isConnected) { if (snapshots.length >= 64) throw Error('预检按钮属性观察超预算'); snapshots.push({ runDisabled: button.disabled, startDisabled: start.disabled }); } });
    observer.observe(dialog, { attributes: true, attributeFilter: ['disabled'], subtree: true }); button.addEventListener('click', click, { once: true });
    (button as any).__preflightBusyObservation = { dialog, start, snapshots, observer, click };
  }, startName);
}
/** 原DOM仍相同才回读并解绑；观察失败不能改成睡眠或暂停产品Promise。 */
export async function finishPreflightBusyObservation(run: Locator) {
  return run.evaluate(element => {
    const button = element as HTMLButtonElement, state = (button as any).__preflightBusyObservation;
    if (!state || !button.isConnected || !state.start.isConnected || button.closest('[role="dialog"]') !== state.dialog) throw Error('预检运行按钮观察已失效');
    state.observer.disconnect(); button.removeEventListener('click', state.click); delete (button as any).__preflightBusyObservation;
    return state.snapshots as { runDisabled: boolean; startDisabled: boolean }[];
  });
}
