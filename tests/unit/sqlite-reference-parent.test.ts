import { sqliteRelatedTabPrefix } from '../../src/shared/sqliteRelatedTab';
import { sqliteRelatedTableZh as relatedText } from '../../src/renderer/locales/sqliteRelatedTable.zh-CN';
import { sqliteRelatedTableRelation, registerSqliteRelatedTable, sqliteRelatedTargetGuard, watchSqliteRelatedScope, sqliteRelatedTableScope } from '../../src/renderer/sqliteRelatedTable';
import { sqliteRelationZh as relationText } from '../../src/renderer/locales/sqliteRelation.zh-CN';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteReferenceDraft } from '../../src/renderer/sqliteReferenceChoice';
import { captureSqliteReferenceSource } from '../../src/renderer/sqliteReferenceSource';
import { sqliteIncomingZh as incomingText } from '../../src/renderer/locales/sqliteIncoming.zh-CN';
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
  let modal: boolean | string = false; const context: any = createContext({ page, tab, profile, version: 0, refreshVersion: 0, view: { busy: false }, available: () => !modal && !state.activeJobs.t, editorRef: { current: editor ?? null }, inputRef: { current: null }, previewRef: { current: null }, selectedRow: editor?.view.rows[0].id, detailSelectionRef: { current: { binding: {}, index: 0 } }, rowDetailsCurrent: () => true, controller: { pageCurrent: (candidate: unknown) => candidate === page }, captureSqliteReferenceSource, sqliteReferenceDraft, referenceText, incomingText, relationText, relatedText, sqliteRelatedTabPrefix, sqliteRelatedTableRelation, registerSqliteRelatedTable, sqliteRelatedTargetGuard, watchSqliteRelatedScope, latest: { current: { active: true, tab, refreshVersion: 0 } }, referenceRef: { current: undefined }, useWorkspace: { getState: () => state }, uid: () => 'reference-owner', errorMessage: (error: Error) => error.message, setValidation: vi.fn(), document: { querySelectorAll: () => modal ? [{ getAttribute: () => modal === 'relations' ? relationText.title : modal === 'incoming' ? incomingText.title : modal === 'choose' ? referenceText.choiceTitle : referenceText.title }] : [] } });
  context.setReferenceOpen = vi.fn((value: any) => { modal = value ? value.navigation ? 'relations' : value.incoming ? 'incoming' : value.stage ? 'choose' : true : false; });
  const publish = () => context.referenceRef.current?.current();
  context.acquireWorkspaceBusy = () => { const token = {}; state.activeJobs.t = token; publish(); return { owns: () => state.activeJobs.t === token, release: () => { if (state.activeJobs.t !== token) return false; delete state.activeJobs.t; publish(); return true; } }; };
  runInContext(ts.transpileModule(method + '\nglobalThis.open=openReference;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, state, page, editor, forbidden, publish, open: (mode: 'browse' | 'choose' | 'incoming' | 'relations' = 'browse') => { context.open(mode); return context.referenceRef.current; }, dispose: () => editor?.dispose() };
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

it.each([true, false])('子记录入口editable=%s取已保存原值，保持源草稿和undo，打开零写任务', editable => {
  const f = fixture(editable), before = f.editor?.view.rows, owner = f.open('incoming'); expect(owner.incoming).toBe(true); expect(owner.values).toEqual([{ kind: 'text', value: '001' }]); expect(owner.current()).toBe(true);
  owner.activity(1); expect(owner.current()).toBe(true); expect(f.editor?.view.rows).toBe(before); owner.activity(-1); expect(owner.current()).toBe(true); expect(f.forbidden).not.toHaveBeenCalled(); f.dispose();
});
it('未保存新行不提供子记录入口，原草稿保留', () => { const f = fixture(); const id = f.editor!.add(); f.context.selectedRow = id; const before = f.editor!.view.rows; expect(f.open('incoming')).toBeUndefined(); expect(f.editor!.view.rows).toBe(before); f.dispose(); });

it.each([true, false])('关联浏览器editable=%s锚定已保存值，打开零IO，原草稿与撤销栈保持', editable => {
  const f = fixture(editable), rows = f.editor?.view.rows, owner = f.open('relations'); expect(owner.navigation).toBe(true); expect(owner.values).toEqual([{ kind: 'text', value: '001' }]); expect(owner.current()).toBe(true);
  owner.activity(1); expect(owner.current()).toBe(true); expect(f.editor?.view.rows).toBe(rows); owner.activity(-1); expect(f.forbidden).not.toHaveBeenCalled(); expect(owner.current()).toBe(true); f.dispose();
});
it('未保存新行不进入关联浏览器，原草稿保持', () => { const f = fixture(); f.context.selectedRow = f.editor!.add(); const rows = f.editor!.view.rows; expect(f.open('relations')).toBeUndefined(); expect(f.editor!.view.rows).toBe(rows); f.dispose(); });

/** 已通过共享回包门的合成关联页，正式父移交函数不得改动原Editor草稿。 */
function relatedProof(f: ReturnType<typeof fixture>): any { return { request: { incoming: 'page', connectionId: 'c', database: 'main', table: 'parent', schemaKey: 'b'.repeat(64), childTable: 'child', childSchemaKey: f.page.schemaKey, foreignKey: 0, values: [{ kind: 'integer', value: '1' }], offset: 0, limit: 50, taskId: '00000000-0000-4000-8000-000000000001' }, source: { name: 'parent', columns: [{ name: 'id', type: 'INTEGER', notNull: true, primaryKey: 1, hidden: 0 }], foreignKeys: [] }, references: [{ table: 'child', schemaKey: f.page.schemaKey, key: { ordinal: 0, columns: ['p'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'NO ACTION' }, referencedColumns: ['id'] }], page: { ...f.page, edit: undefined } }; }
it('正式父移交创建独立关联页，租约持有时拒绝；原草稿不动，设置不携带父值，连接变化撤销内存来源', () => {
  const f = fixture(), owner = f.open('incoming'), original = f.editor!.view.rows, listeners = new Set<() => void>();
  f.context.useWorkspace.subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  Object.assign(f.state, { openTab: (tab: any) => { f.state.settings.tabs.push(tab); f.state.settings.activeTabId = tab.id; } });
  const proof = relatedProof(f); owner.activity(1); expect(owner.open(proof)).toBe(false); owner.activity(-1); expect(owner.open(proof)).toBe(true);
  const target = f.state.settings.tabs[1]; expect(target.id).toBe(sqliteRelatedTabPrefix + 'reference-owner'); expect(target).not.toHaveProperty('relation'); expect(f.editor!.view.rows).toBe(original); expect(f.editor!.dirty).toBe(true); expect(f.forbidden).not.toHaveBeenCalled();
  const scope = sqliteRelatedTableScope(target.id)!; expect(scope.current()).toBe(true); expect(scope.relation.values).toEqual([{ kind: 'integer', value: '1' }]);
  f.state.connectionVersions.c++; listeners.forEach(listener => listener()); f.state.connectionVersions.c--; expect(scope.current()).toBe(false); expect(sqliteRelatedTableScope(target.id)).toBeUndefined(); f.dispose();
});
it('关联移交标签数达到门槛前拒绝，既有源行草稿保留', () => {
  const f = fixture(), owner = f.open('incoming'); while (f.state.settings.tabs.length < 100) f.state.settings.tabs.push({ id: '其它' + f.state.settings.tabs.length, connectionId: 'c' });
  const rows = f.editor!.view.rows; expect(() => owner.open(relatedProof(f))).toThrow('100'); expect(f.editor!.view.rows).toBe(rows); expect(f.forbidden).not.toHaveBeenCalled(); f.dispose();
});
