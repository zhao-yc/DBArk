import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SqliteTableBrowser, type SqliteTableScope } from '../../src/renderer/sqliteTableBrowser';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

const file = ts.createSourceFile('SqliteTableTab.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** 提取真实父组件读页门，确认草稿取舍不被测试专用回调替代。 */
function fixture() {
  const methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && ['prepareRead', 'read'].includes(node.name.text)) methods.push(node.getText(file)); ts.forEachChild(node, walk); } walk(file); expect(methods).toHaveLength(2);
  const editor = { dirty: true, busy: false }, editorRef = { current: editor }, confirm = vi.fn(() => false), dropEditor = vi.fn(), applied = { current: { limit: 10, mode: 'and', filters: [], sort: [] } }, load = vi.fn(), setValidation = vi.fn();
  const vm: any = createContext({ editorRef, window: { confirm }, editText, dropEditor, applied, controller: { load }, available: () => true, setValidation });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.readPage=read;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, vm);
  return { editor, confirm, dropEditor, applied, load, vm };
}
describe('SQLite 父页真实草稿读页边界', () => {
  it('拒绝放弃则保留原草稿及页，零读取；明确同意后才释放并使用已应用配置', () => {
    const f = fixture(); f.vm.readPage(20); expect(f.confirm).toHaveBeenCalledWith(editText.confirmDiscard); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled();
    f.confirm.mockReturnValue(true); f.vm.readPage(20); expect(f.dropEditor).toHaveBeenCalledOnce(); expect(f.load).toHaveBeenCalledWith(f.applied.current, 20);
  });
  it('写任务在途不能通过翻页/刷新打开丢稿确认或替换页', () => {
    const f = fixture(); f.editor.busy = true; f.confirm.mockReturnValue(true); f.vm.readPage(0); expect(f.confirm).not.toHaveBeenCalled(); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled();
  });
  it.each([false, true])('只有读写scope opt-in editing=%s，原只读请求不携带editing字段', async editing => {
    const scope: SqliteTableScope = { tab: {}, profile: {}, connectionId: 'sqlite', database: 'main', table: '表', version: 0, present: true, active: true, sqlite: true, ...(editing ? { editing: true } : {}) };
    const read = vi.fn(async (_input: unknown) => { throw Error('夹具在发送后停止，不需要伪造编辑回包'); });
    const browser = new SqliteTableBrowser({ scope: () => scope, acquire: () => ({ owns: () => true, release: () => true }), read, cancel: async () => {}, id: () => 'task', changed: () => {}, subscribe: () => () => {} }); browser.activate(); await browser.load({ limit: 10, mode: 'and', filters: [], sort: [] }, 0);
    expect(read).toHaveBeenCalledOnce(); if (editing) expect(read.mock.calls[0][0]).toHaveProperty('editing', true); else expect(read.mock.calls[0][0]).not.toHaveProperty('editing'); browser.dispose();
  });
});
