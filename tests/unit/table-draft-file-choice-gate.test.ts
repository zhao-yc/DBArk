import { afterEach, expect, it, vi } from 'vitest';
import { installTableWorkspaceFileChoice as install, readTableWorkspaceFileChoices as read } from '../e2e/table-workspace-live-gate';
const owner = 'dbark-table-workspace:' + 'a'.repeat(32), path = '/tmp/workspace-' + 'a'.repeat(32) + '.dbark-draft';
afterEach(() => { Reflect.deleteProperty(globalThis, '__dbarkTableWorkspaceFileChoice'); });
/** 只模拟Electron选择器返回，不读写任何文件或连接数据库。 */
function fixture() { const dialog = { showSaveDialog: vi.fn<(...args: unknown[]) => Promise<unknown>>(), showOpenDialog: vi.fn<(...args: unknown[]) => Promise<unknown>>() }, original = { ...dialog }; return { dialog, original, filters: [{ name: '草稿', extensions: ['dbark-draft'] }] }; }
it('准确一次保存和一次打开分别消费路径、恢复原函数，并保留真实选择器选项', async () => {
  const f = fixture(); install(f, { owner, path, mode: 'save' }); expect(() => read(f, owner)).toThrow();
  expect(await f.dialog.showSaveDialog({}, { title: '保存表格草稿', filters: f.filters })).toEqual({ canceled: false, filePath: path }); expect(f.dialog.showSaveDialog).toBe(f.original.showSaveDialog);
  install(f, { owner, path, mode: 'open' }); expect(await f.dialog.showOpenDialog({}, { title: '打开表格草稿', filters: f.filters })).toEqual({ canceled: false, filePaths: [path] });
  expect(read(f, owner).map(item => item.mode)).toEqual(['save', 'open']); expect(f.dialog.showOpenDialog).toBe(f.original.showOpenDialog);
});
it('其它选择器不能消费草稿路径，失败先恢复原函数但永久撤销该owner', async () => {
  const f = fixture(); install(f, { owner, path, mode: 'open' }); await expect(f.dialog.showOpenDialog({}, { title: '其它文件', filters: f.filters })).rejects.toThrow();
  expect(f.dialog.showOpenDialog).toBe(f.original.showOpenDialog); expect(() => read(f, owner)).toThrow(); expect(() => install(f, { owner, path, mode: 'open' })).toThrow();
});
it('并发安装、归属漂移或相对路径不得领取原选择器', () => {
  const f = fixture(); expect(() => install(f, { owner, path: 'workspace-' + 'a'.repeat(32) + '.dbark-draft', mode: 'save' })).toThrow();
  install(f, { owner, path, mode: 'save' }); expect(() => install(f, { owner, path, mode: 'open' })).toThrow(); expect(() => read(f, owner + 'b')).toThrow();
});
it('Windows绝对路径同样受准确owner文件名约束', async () => {
  const f = fixture(), winPath = 'C:\\验收\\workspace-' + 'a'.repeat(32) + '.dbark-draft'; install(f, { owner, path: winPath, mode: 'save' });
  expect(await f.dialog.showSaveDialog({}, { title: '保存表格草稿', filters: f.filters })).toEqual({ canceled: false, filePath: winPath }); expect(read(f, owner)).toHaveLength(1);
});
