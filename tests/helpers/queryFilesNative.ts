import type { ElectronApplication } from '@playwright/test';

export const recentSql = "-- 最近文件合成样本\nSELECT '原用户明确选择';\n";
export const sourceSql = "-- 原UTF16LE文件\r\nSELECT '保存前';\r\n";
export const savedSql = "-- 键盘修改后保存\r\nSELECT '精确编码与换行';\r\n";
export const draftSql = "-- 外改后的原编辑草稿\r\nSELECT '必须保留';\r\n";
export const externalSql = "-- 外来文件原文\r\nSELECT '明确重读';\r\n";
/** 独立手工UTF16LE+BOM字节，不借产品编码器或读取结果生成预期。 */
export function utf16NativeBytes(sql: string) { return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sql, 'utf16le')]); }

/** 仅一次原OpenDialog回答；精确窗口/标题/SQL过滤器后立即恢复原函数，不替换IPC、授权、模型或结果。 */
export async function installSqlFilesOpenAnswer(application: ElectronApplication, choice: { nonce: string; path?: string }) {
  return application.evaluate(({ dialog, BrowserWindow }, choice) => {
    type State = { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog };
    const root = globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: State };
    const windows = BrowserWindow.getAllWindows(); if (root.__sqlFilesOpenAnswer || windows.length !== 1) throw Error('原SQL文件选择窗口未知');
    const window = windows[0], original = dialog.showOpenDialog, state: State = { nonce: choice.nonce, calls: 0, restored: false, original }; root.__sqlFilesOpenAnswer = state;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args[1] as Electron.OpenDialogOptions;
      if (root.__sqlFilesOpenAnswer !== state || state.calls || args.length !== 2 || args[0] !== window || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || options.title !== '打开SQL文件' || options.properties?.join(',') !== 'openFile' || options.filters?.length !== 1 || options.filters[0].name !== 'SQL文件' || options.filters[0].extensions.join(',') !== 'sql') throw Error('不是本例原SQL文件选择');
      state.calls++; dialog.showOpenDialog = original; state.restored = true;
      return { canceled: choice.path === undefined, filePaths: choice.path === undefined ? [] : [choice.path] };
    }) as typeof dialog.showOpenDialog;
    return { calls: 0, restored: false };
  }, choice);
}
/** 只消费本例一次已恢复回执；未知函数不自动恢复，失败保留原记录。 */
export async function finishSqlFilesOpenAnswer(application: ElectronApplication, nonce: string) {
  return application.evaluate(({ dialog }, nonce) => {
    const root = globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog } }, state = root.__sqlFilesOpenAnswer;
    if (!state || state.nonce !== nonce || state.calls !== 1 || !state.restored || dialog.showOpenDialog !== state.original) throw Error('原SQL文件选择未确认闭合');
    delete root.__sqlFilesOpenAnswer; return { calls: state.calls, restored: state.restored };
  }, nonce);
}

type DirtyExitChoice = { nonce: string; deadline: number; window: number; contents: number };
interface DirtyExitState extends DirtyExitChoice { app: Electron.App; owner: Electron.BrowserWindow; webContents: Electron.WebContents; pid: number; calls: number; restored: boolean; consumed: boolean; failed: boolean; original: typeof Electron.dialog.showMessageBox; resolve?: (answer: Electron.MessageBoxReturnValue) => void; reject?: (reason: Error) => void; }
const dirtyExitApplications = new WeakSet<ElectronApplication>();
/** 只登记这个owner的一次dirty退出提示；原提示出现后暂停回答，交回父进程原期限/owner门确认。 */
export async function installSqlFilesDirtyExitAnswer(application: ElectronApplication, choice: DirtyExitChoice) {
  if (dirtyExitApplications.has(application)) throw Error('同一原应用不得重装dirty退出回答'); dirtyExitApplications.add(application);
  return application.evaluate(({ app, dialog, BrowserWindow }, choice) => {
    const root = globalThis as typeof globalThis & { __sqlFilesDirtyExit?: DirtyExitState }, windows = BrowserWindow.getAllWindows(), owner = windows[0];
    if (root.__sqlFilesDirtyExit || windows.length !== 1 || owner.isDestroyed() || owner.id !== choice.window || owner.webContents.id !== choice.contents || !Number.isFinite(choice.deadline) || Date.now() >= choice.deadline) throw Error('dirty退出安装的原窗口或期限未知');
    const state: DirtyExitState = { ...choice, app, owner, webContents: owner.webContents, pid: process.pid, calls: 0, restored: false, consumed: false, failed: false, original: dialog.showMessageBox }; root.__sqlFilesDirtyExit = state;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      try {
        const current = BrowserWindow.getAllWindows(), options = args[1] as Electron.MessageBoxOptions;
        if (root.__sqlFilesDirtyExit !== state || state.calls || state.failed || state.consumed || app !== state.app || process.pid !== state.pid || Date.now() >= state.deadline || current.length !== 1 || current[0] !== owner || owner.isDestroyed() || owner.webContents !== state.webContents || state.webContents.isDestroyed() || owner.id !== state.window || state.webContents.id !== state.contents || args.length !== 2 || args[0] !== owner || !options || Object.keys(options).sort().join(',') !== 'buttons,cancelId,defaultId,message,title,type' || options.type !== 'warning' || options.title !== '仍有待完成的工作' || options.message !== '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。' || !Array.isArray(options.buttons) || options.buttons.length !== 2 || options.buttons[0] !== '继续工作' || options.buttons[1] !== '退出客户端' || options.defaultId !== 0 || options.cancelId !== 0) throw Error('未知或迟到dirty退出提示，保留原应用');
        state.calls = 1; dialog.showMessageBox = state.original; state.restored = true;
        return await new Promise<Electron.MessageBoxReturnValue>((resolve, reject) => { state.resolve = resolve; state.reject = reject; console.log('DBARK_SQL_FILES_DIRTY_PENDING:' + state.nonce); });
      } catch (reason) { state.failed = true; console.log('DBARK_SQL_FILES_DIRTY_FAILED:' + state.nonce); throw reason; }
    }) as typeof dialog.showMessageBox;
    return { pid: state.pid, window: state.window, contents: state.contents, calls: 0, restored: false };
  }, choice);
}
/** 父进程已见原提示且重新核原owner后，才确认消费并卸本例状态；随后仅返回准确“退出客户端”。 */
export async function consumeSqlFilesDirtyExitAnswer(application: ElectronApplication, choice: DirtyExitChoice) {
  return application.evaluate(({ app, dialog, BrowserWindow }, choice) => {
    const root = globalThis as typeof globalThis & { __sqlFilesDirtyExit?: DirtyExitState }, state = root.__sqlFilesDirtyExit;
    function current() {
      const windows = BrowserWindow.getAllWindows();
      if (!state || state.nonce !== choice.nonce || state.deadline !== choice.deadline || state.window !== choice.window || state.contents !== choice.contents || state.failed || state.calls !== 1 || !state.restored || !state.resolve || !state.reject || dialog.showMessageBox !== state.original || app !== state.app || process.pid !== state.pid || Date.now() >= state.deadline || windows.length !== 1 || windows[0] !== state.owner || state.owner.isDestroyed() || state.owner.webContents !== state.webContents || state.webContents.isDestroyed() || state.owner.id !== choice.window || state.webContents.id !== choice.contents) throw Error('原dirty退出回答归属或期限失效');
    }
    try {
      current(); if (state!.consumed || root.__sqlFilesDirtyExit !== state) throw Error('原dirty退出回答已消费');
      state!.consumed = true; const receipt = { pid: state!.pid, window: state!.window, contents: state!.contents, calls: 1, restored: true, consumed: true }; delete root.__sqlFilesDirtyExit;
      // 与原正常quit适配器相同：先返回消费回执，再在下一任务恢复原before-quit等待；不调用退出API。
      setTimeout(() => { try { current(); if (!state!.consumed || root.__sqlFilesDirtyExit) throw Error('dirty退出回答被重新认领'); console.log('DBARK_SQL_FILES_DIRTY_CONSUMED:' + state!.nonce); state!.resolve!({ response: 1, checkboxChecked: false }); } catch (reason) { state!.failed = true; console.log('DBARK_SQL_FILES_DIRTY_FAILED:' + state!.nonce); state!.reject!(reason instanceof Error ? reason : Error('dirty退出回答未知失败')); } }, 0);
      return receipt;
    } catch (reason) { if (state) state.failed = true; console.log('DBARK_SQL_FILES_DIRTY_FAILED:' + choice.nonce); throw reason; }
  }, choice);
}
