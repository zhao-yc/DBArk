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
