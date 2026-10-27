import type { ElectronApplication } from '@playwright/test';

/** 沿用既有一次性原生选择回答模式；只回答SQL路径，Main仍自行签发真实文件能力。 */
export async function installSqlImportFileAnswer(application: ElectronApplication, choice: { nonce: string; path: string }) {
  await application.evaluate(({ dialog, BrowserWindow }, choice) => {
    type State = { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog };
    const root = globalThis as typeof globalThis & { __sqlImportFileAnswer?: State };
    const windows = BrowserWindow.getAllWindows();
    if (root.__sqlImportFileAnswer || windows.length !== 1) throw Error('SQL导入本例选择器归属未知');
    const window = windows[0], original = dialog.showOpenDialog, state: State = { nonce: choice.nonce, calls: 0, restored: false, original };
    root.__sqlImportFileAnswer = state;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args[1] as Electron.OpenDialogOptions;
      const expected = [{ name: 'SQL 文件', extensions: ['sql'] }, { name: '所有文件', extensions: ['*'] }];
      if (root.__sqlImportFileAnswer !== state || state.calls || args.length !== 2 || args[0] !== window || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || options.title !== '选择文件' || options.properties?.join(',') !== 'openFile' || JSON.stringify(options.filters) !== JSON.stringify(expected)) throw Error('不是本例原SQL导入文件选择');
      state.calls++; dialog.showOpenDialog = original; state.restored = true;
      return { canceled: false, filePaths: [choice.path] };
    }) as typeof dialog.showOpenDialog;
  }, choice);
}

/** 只消费已发生且原函数已恢复的选择回执，不直接调用files.choose或伪造token。 */
export async function finishSqlImportFileAnswer(application: ElectronApplication, nonce: string) {
  return application.evaluate(({ dialog }, nonce) => {
    const root = globalThis as typeof globalThis & { __sqlImportFileAnswer?: { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog } }, state = root.__sqlImportFileAnswer;
    if (!state || state.nonce !== nonce || state.calls !== 1 || !state.restored || dialog.showOpenDialog !== state.original) throw Error('SQL导入原文件选择未确认闭合');
    delete root.__sqlImportFileAnswer;
    return { calls: state.calls, restored: state.restored, nativeInputVerified: false };
  }, nonce);
}
