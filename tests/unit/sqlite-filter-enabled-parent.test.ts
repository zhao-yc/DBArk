import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqliteTableDraft, type SqliteFilterDraft } from '../../src/renderer/sqliteTableBrowser';

/** 执行真实父组件的应用/刷新/放弃确认函数，外部端口用RAM观察，不冒称窗口或实库。 */
function fixture() {
  const source = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['apply', 'prepareRead', 'read'], methods: string[] = [];
  function walk(node: ts.Node): void { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(source)); ts.forEachChild(node, walk); } walk(source); expect(methods).toHaveLength(names.length);
  const filters: SqliteFilterDraft[] = [{ id: 'a', column: 'id', operator: 'gte', kind: 'integer', value: '9007199254740993', enabled: false }];
  const old = { limit: 10, mode: 'and', filters: [], sort: [] }, applied = { current: old }, editor = { busy: false, dirty: false }, confirm = vi.fn(() => true), dropEditor = vi.fn(), load = vi.fn(), setValidation = vi.fn(), state = { current: true };
  const context: any = createContext({ tab: { connectionId: 'owned', database: 'main', table: 'subject' }, limit: 5, mode: 'or', filters, sort: [{ id: 'sort', column: 'id', direction: 'desc' }], sqliteTableDraft, applied, controller: { load }, editorRef: { current: editor }, window: { confirm }, editText: { confirmDiscard: '放弃原草稿？' }, automaticReads: { current: { blocked: true } }, available: () => state.current, dropEditor, setValidation, errorMessage: (value: Error) => value.message });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { filters, applied, old, editor, confirm, dropEditor, load, setValidation, state, api: context.api as { apply(): void; read(offset: number): void } };
}
it('只有明确应用才捕获停用条件，偏移回0且原整数不转Number，刷新继续使用已应用配置', () => {
  const f = fixture(); f.api.read(10); expect(f.load).toHaveBeenCalledExactlyOnceWith(f.old, 10); expect(f.applied.current).toBe(f.old);
  f.load.mockClear(); f.api.apply(); expect(f.load).toHaveBeenCalledExactlyOnceWith({ limit: 5, mode: 'or', filters: [{ column: 'id', operator: 'gte', enabled: false, value: { kind: 'integer', value: '9007199254740993' } }], sort: [{ column: 'id', direction: 'desc' }] }, 0);
  f.filters[0].enabled = true; expect((f.applied.current.filters as any[])[0].enabled).toBe(false); f.api.read(5); expect(f.load.mock.calls.at(-1)).toEqual([f.applied.current, 5]);
});
it('有未提交修改且放弃确认取消时，保留旧页/已应用条件/停用表单，不发送读取', () => {
  const f = fixture(); f.editor.dirty = true; f.confirm.mockReturnValue(false); f.api.apply();
  expect(f.confirm).toHaveBeenCalledExactlyOnceWith('放弃原草稿？'); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.applied.current).toBe(f.old); expect(f.filters[0].enabled).toBe(false);
});
it('停用的非法整数仍在放弃草稿确认之前拒绝，不丢行草稿也不读取', () => {
  const f = fixture(); f.editor.dirty = true; f.filters[0].value = '9223372036854775808'; f.api.apply();
  expect(f.setValidation).toHaveBeenCalledOnce(); expect(f.confirm).not.toHaveBeenCalled(); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.applied.current).toBe(f.old);
});
it.each(['busy', 'target'] as const)('%s时旧应用回调不更改已应用配置或读取', kind => {
  const f = fixture(); if (kind === 'busy') f.editor.busy = true; else f.state.current = false; f.api.apply();
  expect(f.load).not.toHaveBeenCalled(); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.applied.current).toBe(f.old);
});
