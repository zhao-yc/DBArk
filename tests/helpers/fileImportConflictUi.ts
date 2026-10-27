import type { ElectronApplication } from '@playwright/test';

/** 一次性回答原CSV/JSON文件对话框；Main仍从原返回路径签发能力，不替换IPC或预览。 */
export async function installConflictFileAnswer(application: ElectronApplication, input: { nonce: string; path: string; format: 'csv' | 'json' }) {
  await application.evaluate(({ dialog, BrowserWindow }, input) => {
    type State = { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog };
    const root = globalThis as typeof globalThis & { __conflictFileAnswer?: State }, windows = BrowserWindow.getAllWindows();
    if (root.__conflictFileAnswer || windows.length !== 1) throw Error('冲突导入原文件选择归属未知');
    const window = windows[0], original = dialog.showOpenDialog, state: State = { nonce: input.nonce, calls: 0, restored: false, original }; root.__conflictFileAnswer = state;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const expected = { title: '选择文件', properties: ['openFile'], filters: [{ name: input.format.toUpperCase() + ' 文件', extensions: [input.format] }, { name: '所有文件', extensions: ['*'] }] };
      if (root.__conflictFileAnswer !== state || state.calls || args.length !== 2 || args[0] !== window || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || JSON.stringify(args[1]) !== JSON.stringify(expected)) throw Error('不是本例原冲突导入文件选择');
      state.calls++; dialog.showOpenDialog = original; state.restored = true; return { canceled: false, filePaths: [input.path] };
    }) as typeof dialog.showOpenDialog;
  }, input);
}

/** 原选择只消费一次，未恢复原函数时不进入下一文件。 */
export async function finishConflictFileAnswer(application: ElectronApplication, nonce: string) {
  return application.evaluate(({ dialog }, nonce) => {
    const root = globalThis as typeof globalThis & { __conflictFileAnswer?: { nonce: string; calls: number; restored: boolean; original: typeof dialog.showOpenDialog } }, state = root.__conflictFileAnswer;
    if (!state || state.nonce !== nonce || state.calls !== 1 || !state.restored || dialog.showOpenDialog !== state.original) throw Error('冲突导入原文件选择未闭合');
    delete root.__conflictFileAnswer; return { calls: state.calls, originalRestored: true, nativeInputVerified: false };
  }, nonce);
}
