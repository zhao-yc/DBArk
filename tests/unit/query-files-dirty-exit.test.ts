import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { ElectronApplication } from '@playwright/test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { installSqlFilesDirtyExitAnswer, consumeSqlFilesDirtyExitAnswer, draftSql } from '../helpers/queryFilesNative';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
/** 原Main回调只在RAM执行；全部app/window/dialog/PID/时钟/计时器均是替身，未加载Electron。 */
function fixture() {
  const realm: Record<string, any> = {}, events: string[] = [], original = vi.fn(() => new Promise<never>(() => {})), app = { quit: vi.fn() }, contents = { id: 41, isDestroyed: () => false }, owner = { id: 31, webContents: contents, isDestroyed: () => false }, windows = [owner], dialog = { showMessageBox: original as (...args: unknown[]) => Promise<unknown> }, choice = { nonce: '本例原owner', deadline: 120000, window: 31, contents: 41 };
  const context = { app, dialog, BrowserWindow: { getAllWindows: () => windows } };
  const application = { evaluate: async (callback: Function, input: unknown) => runInNewContext('(' + callback.toString() + ')(context,input)', { context, input, globalThis: realm, process: { pid: 101 }, Date, setTimeout, console: { log: (message: string) => events.push(message) } }) } as unknown as ElectronApplication;
  const options = { type: 'warning', title: '仍有待完成的工作', message: '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。', buttons: ['继续工作', '退出客户端'], defaultId: 0, cancelId: 0 };
  return { realm, events, original, app, owner, contents, windows, dialog, choice, context, application, options };
}
it('原Main before-quit先被真实dirty提示阻塞，确认后仅沿原收尾推进，草稿和dirty事实不改', async () => {
  const f = fixture(), source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'app.on' && node.expression.arguments[0]?.getText(tree) === "'before-quit'") as ts.ExpressionStatement;
  const shutdownOrder: string[] = [];
  // 未打开结果写入用途时的真实初始空协调器，退出没有待等待的写入任务或预览。
  const resultInserts = { async drain() {} };
  const callback = (statement.expression as ts.CallExpression).arguments[1], main: any = { resultInserts, shutdownComplete: false, shuttingDown: false, hasPendingEdits: true, tasks: new Map(), window: f.owner, dialog: f.dialog, rendererHasSettings: false, stateFlushed: undefined, savedQuerySearches: undefined, savedQueryPages: undefined, historyPages: undefined, historyDelete: { close: vi.fn(async () => { await Promise.resolve(); shutdownOrder.push('history-delete'); }) }, localSearchOperations: [], queryFileOperations: [], broker: { close: vi.fn(async () => {}) }, tableApplyReceipts: undefined, store: { close: vi.fn(() => { shutdownOrder.push('store'); }) }, app: f.app, event: { preventDefault: vi.fn() }, setTimeout };
  const document = { sql: draftSql, dirty: true }, before = { ...document }; await installSqlFilesDirtyExitAnswer(f.application, f.choice);
  runInNewContext(ts.transpileModule('(' + callback.getText(tree) + ')(event)', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, main);
  expect(main.event.preventDefault).toHaveBeenCalledOnce(); expect(f.events).toEqual(['DBARK_SQL_FILES_DIRTY_PENDING:' + f.choice.nonce]); expect(f.app.quit).not.toHaveBeenCalled(); expect(main.broker.close).not.toHaveBeenCalled(); expect(main.historyDelete.close).not.toHaveBeenCalled(); expect(f.dialog.showMessageBox).toBe(f.original);
  const receipt = await consumeSqlFilesDirtyExitAnswer(f.application, f.choice); expect(receipt).toEqual({ pid: 101, window: 31, contents: 41, calls: 1, restored: true, consumed: true }); expect(f.realm.__sqlFilesDirtyExit).toBeUndefined(); expect(f.app.quit).not.toHaveBeenCalled();
  await vi.runAllTimersAsync(); expect(f.app.quit).toHaveBeenCalledOnce(); expect(main.historyDelete.close).toHaveBeenCalledOnce(); expect(main.store.close).toHaveBeenCalledOnce(); expect(shutdownOrder).toEqual(['history-delete', 'store']); expect(main.shutdownComplete).toBe(true); expect(main.hasPendingEdits).toBe(true); expect(document).toEqual(before); expect(f.original).not.toHaveBeenCalled();
});
it('两个独立原owner各回答一次，准确选项为退出客户端；同一原应用禁止重装', async () => {
  for (let index = 0; index < 2; index++) {
    const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); const answer = f.dialog.showMessageBox(f.owner, f.options);
    expect(f.dialog.showMessageBox).toBe(f.original); expect(f.realm.__sqlFilesDirtyExit.calls).toBe(1); expect(f.realm.__sqlFilesDirtyExit.consumed).toBe(false);
    await consumeSqlFilesDirtyExitAnswer(f.application, f.choice); await vi.runAllTimersAsync(); expect(await answer).toEqual({ response: 1, checkboxChecked: false }); expect(f.realm.__sqlFilesDirtyExit).toBeUndefined(); expect(f.events).toEqual(['DBARK_SQL_FILES_DIRTY_PENDING:' + f.choice.nonce, 'DBARK_SQL_FILES_DIRTY_CONSUMED:' + f.choice.nonce]); await expect(installSqlFilesDirtyExitAnswer(f.application, f.choice)).rejects.toThrow('不得重装');
  }
});
it.each(['title', 'message', 'buttons', 'button-collision', 'type', 'defaultId', 'cancelId', 'extra'])('未知提示字段%s不回答、不消费、不自动恢复未知状态', async field => {
  const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); const options: Record<string, unknown> = { ...f.options }; if (field === 'button-collision') options.buttons = ['继续工作|退出客户端']; else options[field] = field === 'buttons' ? ['返回工作台', '强制退出客户端'] : '未知';
  await expect(f.dialog.showMessageBox(f.owner, options)).rejects.toThrow('未知或迟到'); await expect(consumeSqlFilesDirtyExitAnswer(f.application, f.choice)).rejects.toThrow(); expect(f.original).not.toHaveBeenCalled(); expect(f.realm.__sqlFilesDirtyExit.failed).toBe(true); expect(f.realm.__sqlFilesDirtyExit.consumed).toBe(false);
});
it.each(['window', 'contents', 'app', 'deadline'])('原提示后%s漂移不授权消费，恢复旧值也拒绝', async mode => {
  const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); const pending = f.dialog.showMessageBox(f.owner, f.options); void pending.catch(() => {});
  if (mode === 'window') f.windows[0] = { ...f.owner }; if (mode === 'contents') f.owner.webContents = { ...f.contents }; if (mode === 'app') f.context.app = { ...f.app }; if (mode === 'deadline') vi.setSystemTime(f.choice.deadline);
  await expect(consumeSqlFilesDirtyExitAnswer(f.application, f.choice)).rejects.toThrow('归属或期限'); f.windows[0] = f.owner; f.owner.webContents = f.contents; f.context.app = f.app; vi.setSystemTime(1000); await expect(consumeSqlFilesDirtyExitAnswer(f.application, f.choice)).rejects.toThrow(); expect(f.realm.__sqlFilesDirtyExit.failed).toBe(true); expect(f.original).not.toHaveBeenCalled();
});
it('迟到提示先拒绝，安装也不能把已过原期限的新owner重签', async () => {
  const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); vi.setSystemTime(f.choice.deadline); await expect(f.dialog.showMessageBox(f.owner, f.options)).rejects.toThrow('迟到'); const fresh = fixture(); await expect(installSqlFilesDirtyExitAnswer(fresh.application, fresh.choice)).rejects.toThrow('期限未知');
});
it('确认回执后恢复原回答之前再过期，仍不能回答退出或重获授权', async () => {
  const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); const pending = f.dialog.showMessageBox(f.owner, f.options), rejected = expect(pending).rejects.toThrow('归属或期限'); await consumeSqlFilesDirtyExitAnswer(f.application, f.choice); vi.setSystemTime(f.choice.deadline); await vi.runAllTimersAsync(); await rejected; expect(f.events).toContain('DBARK_SQL_FILES_DIRTY_FAILED:' + f.choice.nonce); expect(f.events).not.toContain('DBARK_SQL_FILES_DIRTY_CONSUMED:' + f.choice.nonce);
});
it('原wrapper第二次回调即停链，已经恢复的原函数不提供全局默认回答', async () => {
  const f = fixture(); await installSqlFilesDirtyExitAnswer(f.application, f.choice); const originalWrapper = f.dialog.showMessageBox, pending = originalWrapper(f.owner, f.options); void pending.catch(() => {});
  await expect(originalWrapper(f.owner, f.options)).rejects.toThrow('未知或迟到'); expect(f.dialog.showMessageBox).toBe(f.original); await expect(consumeSqlFilesDirtyExitAnswer(f.application, f.choice)).rejects.toThrow(); expect(f.realm.__sqlFilesDirtyExit.failed).toBe(true); expect(f.original).not.toHaveBeenCalled();
});
it('父进程原owner漂移或原scope失效，在消费RPC前停链保留', async () => {
  const source = readFileSync(new URL('../e2e/query-files-native-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true), close = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'closeDirtyOwner') as ts.FunctionDeclaration;
  const names = new Set(['current', 'preserve']); const methods = close.body!.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name!.text)); const listener = close.body!.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(tree) === 'listener'))!;
  for (const mode of ['owner', 'deadline']) {
    const application = {}, page = {}, owner = { application, page }, run = { retained: false, assert: vi.fn() }, scope = { assertCurrent: vi.fn(() => { if (mode === 'deadline') throw Error('原期限失效'); }) }, consume = vi.fn(), output: Record<string, any> = {};
    const body = 'let installed={pid:101},receipt,consuming,failure,pending=0,consumed=0;'+methods.map(node => node.getText(tree)).join('\n')+'\n'+listener.getText(tree)+'\nglobalThis.listener=listener;';
    runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { globalThis: output, scope, run, owner, application, page, witness: { failed: false }, choice: { nonce: '本例' }, consumeSqlFilesDirtyExitAnswer: consume, expect });
    if (mode === 'owner') owner.page = {}; output.listener({ text: () => 'DBARK_SQL_FILES_DIRTY_PENDING:本例' }); expect(run.retained).toBe(true); expect(consume).not.toHaveBeenCalled();
  }
});
