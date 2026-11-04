import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteReferenceDraft } from '../../src/renderer/sqliteReferenceChoice';
import { captureSqliteReferenceSource } from '../../src/renderer/sqliteReferenceSource';
import { sqliteReferenceZh as referenceText } from '../../src/renderer/locales/sqliteReference.zh-CN';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';

/** 运行正式父入口和Editor；DOM/store/页身份为RAM边界，不把此用例描述成真实数据库UI。 */
function fixture(editable = true) {
  const file = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let method = '';
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openReference') method = node.getText(file); ts.forEachChild(node, visit); } visit(file); expect(method).not.toBe('');
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'p', declaredType: '' }], storageTypes: ['t'], result: { columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '001' }], statement: '', elapsedMs: 0, truncated: false }, offset: 0, limit: 50, hasMore: false,
    edit: editable ? { kind: 'editable', snapshotId: 's', expiresAt: new Date(60000).toISOString(), columns: [{ name: 'p', declaredType: '', generated: false, nullable: true, hasDefault: false }], rows: [[{ kind: 'text', value: '001' }]], locator: { kind: 'rowid', columns: [] } } : undefined };
  const tab = { id: 't', connectionId: 'c' }, profile = { id: 'c' }, state = { settings: { activeTabId: 't', tabs: [tab] }, connections: [profile], connectionVersions: { c: 0 }, activeJobs: {} as Record<string, unknown> };
  const forbidden = vi.fn(async (_value: unknown): Promise<any> => { throw Error('父关联入口不能预览或提交'); }), editor = editable ? new SqliteTableEditor(page, { current: () => true, active: () => true, available: () => !state.activeJobs.t, acquire: () => { throw Error('原编辑器不得取得写事务'); }, id: () => 'id', now: () => 0, changed: () => {}, dirty: () => {}, preview: forbidden, apply: forbidden, release: async () => {}, cancel: async () => {}, committed: () => {} }) : undefined;
  if (editor) editor.save(editor.view.rows[0].id, [{ kind: 'text', value: '002' }]);
  let modal: boolean | string = false; const context: any = createContext({ page, tab, profile, version: 0, refreshVersion: 0, view: { busy: false }, available: () => !modal && !state.activeJobs.t, editorRef: { current: editor ?? null }, inputRef: { current: null }, previewRef: { current: null }, selectedRow: editor?.view.rows[0].id, detailSelectionRef: { current: { binding: {}, index: 0 } }, rowDetailsCurrent: () => true, controller: { pageCurrent: (candidate: unknown) => candidate === page }, captureSqliteReferenceSource, sqliteReferenceDraft, referenceText, latest: { current: { active: true, tab, refreshVersion: 0 } }, referenceRef: { current: undefined }, useWorkspace: { getState: () => state }, uid: () => 'reference-owner', errorMessage: (error: Error) => error.message, setValidation: vi.fn(), document: { querySelectorAll: () => modal ? [{ getAttribute: () => modal === 'choose' ? referenceText.choiceTitle : referenceText.title }] : [] } });
  context.setReferenceOpen = vi.fn((value: any) => { modal = value ? value.stage ? 'choose' : true : false; });
  const publish = () => context.referenceRef.current?.current();
  context.acquireWorkspaceBusy = () => { const token = {}; state.activeJobs.t = token; publish(); return { owns: () => state.activeJobs.t === token, release: () => { if (state.activeJobs.t !== token) return false; delete state.activeJobs.t; publish(); return true; } }; };
  runInContext(ts.transpileModule(method + '\nglobalThis.open=openReference;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, state, page, editor, forbidden, publish, open: (mode: 'browse' | 'choose' = 'browse') => { context.open(mode); return context.referenceRef.current; }, dispose: () => editor?.dispose() };
}
it.each([true, false])('父入口editable=%s捕获准确当前值，打开零读取／提交，源草稿和撤销栈保持', editable => {
  const f = fixture(editable), before = f.editor?.view.rows, owner = f.open(); expect(owner.values).toEqual([{ kind: 'text', value: editable ? '002' : '001' }]);
  expect(owner.current()).toBe(true); owner.activity(1); expect(owner.current()).toBe(true); if (f.editor) { expect(f.editor.canEdit()).toBe(false); expect(f.editor.view.rows).toBe(before); expect(f.editor.view.undo).toBe(true); expect(f.editor.changes).toHaveLength(1); }
  owner.activity(-1); expect(f.state.activeJobs.t).toBeUndefined(); expect(owner.current()).toBe(true); expect(f.forbidden).not.toHaveBeenCalled(); f.dispose();
});
it.each(['active', 'version', 'profile', 'row', 'schema', 'lease'] as const)('%s ABA撤销原父读取权，恢复原对象也不能复活', change => {
  const f = fixture(), owner = f.open(); owner.activity(1);
  if (change === 'active') { f.state.settings.activeTabId = 'other'; f.publish(); f.state.settings.activeTabId = 't'; }
  if (change === 'version') { f.state.connectionVersions.c++; f.publish(); f.state.connectionVersions.c--; }
  if (change === 'profile') { f.state.connections[0] = { ...f.state.connections[0] }; f.publish(); }
  if (change === 'row') { f.editor!.view.rows[0].values[0] = { kind: 'text', value: '新值' }; f.publish(); }
  if (change === 'schema') { f.page.schemaKey = 'b'.repeat(64); f.publish(); f.page.schemaKey = 'a'.repeat(64); }
  if (change === 'lease') { const own = f.state.activeJobs.t; f.state.activeJobs.t = {}; f.publish(); f.state.activeJobs.t = own; }
  expect(owner.current()).toBe(false); owner.activity(-1); expect(f.forbidden).not.toHaveBeenCalled(); f.dispose();
});

it('父键确认只能在读取租约释放后暂存，原草稿可再撤销且不调用预览提交', () => {
  const f = fixture(), owner = f.open('choose');
  const proof: any = { request: { connectionId: 'c', database: 'main', table: 'child', schemaKey: f.page.schemaKey, reference: 'page', foreignKey: 0, values: [{ kind: 'integer', value: '9' }] }, source: { name: 'child', foreignKeys: [{ ordinal: 0, columns: ['p'] }] }, referencedColumns: ['id'], page: { ...f.page, columns: [{ name: 'id', declaredType: 'INTEGER' }], storageTypes: ['i'], result: { ...f.page.result, columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '9' }] } } };
  const choice = { foreignKey: 0, proof, values: [{ kind: 'integer', value: '9' }] };
  owner.activity(1); expect(owner.stage(choice)).toBe(false); expect(f.editor!.view.rows[0].values).toEqual([{ kind: 'text', value: '002' }]);
  owner.activity(-1); expect(owner.stage(choice)).toBe(true); expect(f.context.referenceRef.current).toBeUndefined(); expect(f.editor!.view.rows[0].values).toEqual(choice.values);
  f.editor!.undo(); expect(f.editor!.view.rows[0].values).toEqual([{ kind: 'text', value: '002' }]); expect(f.forbidden).not.toHaveBeenCalled(); f.dispose();
});
it('undo/redo恢复同一rows引用仍撤销选择权，不能利用未观察到的来源ABA暂存', () => {
  const f = fixture(), owner = f.open('choose'), rows = f.editor!.view.rows;
  f.editor!.undo(); f.editor!.redo(); expect(f.editor!.view.rows).toBe(rows); expect(owner.current()).toBe(false); f.dispose();
});
it('只读源不能打开外键选择入口', () => { const f = fixture(false); expect(f.open('choose')).toBeUndefined(); expect(f.context.setReferenceOpen).not.toHaveBeenCalled(); });
