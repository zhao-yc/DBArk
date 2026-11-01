import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableQuery } from '../../src/renderer/sqliteTableBrowser';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';
import { sqliteFilteredSelectZh as filteredSelectText } from '../../src/renderer/locales/sqliteFilteredSelect.zh-CN';

/** 真实父入口与Intent编译；store／DOM／编辑器和Browser身份为RAM，绝不伪装真实执行。 */
function fixture(writable = false, name = '原表🚢') {
  const source = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['filteredSelectReady', 'openFilteredSelect', 'filteredSelectCurrent', 'openFilteredSelectQuery', 'closeFilteredSelect'], methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(source)); ts.forEachChild(node, walk); } walk(source); expect(methods).toHaveLength(names.length);
  const tab = { id: 't', kind: 'table', connectionId: 'c', database: 'main', table: name }, profile = { id: 'c', dialect: 'sqlite' }, token = {};
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: name, kind: writable ? 'table' : 'view' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }], offset: 100, limit: 50, hasMore: true, result: { columns: [], rows: [], statement: '', elapsedMs: 0, truncated: false } };
  // 本地SQL生成不需要读取实际当前页内容；任何误读都让本例失败。
  Object.defineProperty(page, 'result', { enumerable: true, get: () => { throw Error('不应读取表页行数据'); } });
  const query: SqliteTableQuery = { limit: 50, mode: 'and', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '9007199254740993' } }], sort: [{ column: 'id', direction: 'desc' }] }, applied = { current: query };
  const rows: unknown[] = [{ id: 'draft-marker', values: '本地待提交内容' }], inputOpen = vi.fn(), editor = writable ? { page, view: { rows, dirty: true }, canEdit: vi.fn(() => true), inputOpen } : null, editorRef = { current: editor as typeof editor };
  const workspace = { settings: { tabs: [tab] as any[], activeTabId: 't' }, connections: [profile], connectionVersions: { c: 0 }, activeJobs: {} as Record<string, unknown>, selection: { connectionId: 'another-connection', database: 'another-db' }, openTab: vi.fn((candidate: any) => { workspace.settings.tabs = [...workspace.settings.tabs, { ...candidate, id: 'new-query' }]; workspace.settings.activeTabId = 'new-query'; }) };
  const dialogs = { owners: [] as string[], markers: 1 }, filteredSelectRef = { current: null as any }, refs = { inputRef: { current: null as any }, previewRef: { current: null as any }, pasteRef: { current: null as any }, rangeRef: { current: null as any }, fillRef: { current: null as any }, importRef: { current: null as any }, fullExportRef: { current: null as any }, findRef: { current: null as any } };
  const current = { value: true }, controller = { pageCurrent: vi.fn((value: SqliteTablePage) => current.value && value === page) }, latest = { current: { tab, active: true, refreshVersion: 0 } };
  let sequence = 0;
  const context: any = createContext({ tab, profile, version: 0, refreshVersion: 0, page, view: { busy: false }, applied, editorRef, renderedEditor: editor, editRows: rows, filteredSelectRef, latest, controller, ...refs, exportData: null,
    available: () => !filteredSelectRef.current && !refs.fillRef.current && dialogs.owners.length === 0,
    editRender: { current: token }, editRenderTicket: token, uid: () => 'filtered-' + ++sequence, SqliteFilteredSelectIntent, filteredSelectText, errorMessage: (error: Error) => error.message,
    document: { querySelectorAll: () => dialogs.owners.map(owner => ({ querySelectorAll: () => Array.from({ length: dialogs.markers }, () => ({ getAttribute: () => owner })) })) }, useWorkspace: { getState: () => workspace }, setFilteredSelectOpen: vi.fn(), setValidation: vi.fn(), closeFind: vi.fn() });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  function open() { context.api.openFilteredSelect(); const owner = filteredSelectRef.current; expect(owner).toBeTruthy(); dialogs.owners = [owner.id]; expect(owner.intent.current()).toBe(true); return owner; }
  return { api: context.api, context, page, tab, profile, rows, editor, inputOpen, workspace, applied, query, dialogs, filteredSelectRef, refs, controller, current, editorRef, latest, open };
}
it.each([false, true])('只读／脏%s来源均不读原行；取消不执行、不清原修改或打开标签', writable => {
  const f = fixture(writable), owner = f.open(); expect(owner.intent.compile(['note', 'id']).sql).toContain('9007199254740993'); f.api.closeFilteredSelect(owner); expect(f.filteredSelectRef.current).toBeNull(); expect(f.workspace.openTab).not.toHaveBeenCalled(); expect(f.workspace.settings.tabs).toEqual([f.tab]); expect(f.editor?.view.rows).toBe(writable ? f.rows : undefined); expect(f.inputOpen).not.toHaveBeenCalled();
});
it('只按原连接main及已应用筛选开独立草稿，不采用左树选择或当前offset', () => {
  const f = fixture(true), owner = f.open(), plan = owner.intent.compile(['note', 'id']); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true);
  expect(f.workspace.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'query', connectionId: 'c', database: 'main', databaseContext: { state: 'known', database: 'main' }, title: filteredSelectText.queryTitle(f.page.target.table), sql: plan.sql }); expect(plan.sql).not.toMatch(/OFFSET|LIMIT/); expect(f.editor?.view.dirty).toBe(true); expect(f.editor?.view.rows).toBe(f.rows); expect(f.inputOpen).not.toHaveBeenCalled(); expect(owner.intent.current()).toBe(false); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(false);
});
it('字段顺序与显式行数只由本意图最新plan决定，旧plan及伪造对象不打开', () => {
  const f = fixture(), owner = f.open(), old = owner.intent.compile(['id']), plan = owner.intent.compile(['note', 'id'], 3); expect(f.api.openFilteredSelectQuery(owner, old)).toBe(false); expect(f.api.openFilteredSelectQuery(owner, { ...plan })).toBe(false); expect(f.workspace.openTab).not.toHaveBeenCalled(); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true); expect(plan.sql).toMatch(/LIMIT 3;?$/); expect(plan.sql.indexOf('"note"')).toBeLessThan(plan.sql.indexOf('"id"'));
});
it('首次0DOM只准编译而不打开，挂载唯一自身Modal后同plan可打开', () => {
  const f = fixture(); f.api.openFilteredSelect(); const owner = f.filteredSelectRef.current, plan = owner.intent.compile(['id']); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(false); f.dialogs.owners = [owner.id]; expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true);
});
it('100标签边界不消费原计划，关闭其它标签后可明确重试', () => {
  const f = fixture(), owner = f.open(), plan = owner.intent.compile(['id']); f.workspace.settings.tabs = [f.tab, ...Array.from({ length: 99 }, (_, index) => ({ id: 'other-' + index }))]; expect(() => f.api.openFilteredSelectQuery(owner, plan)).toThrow(filteredSelectText.tabs); expect(owner.intent.current()).toBe(true); expect(f.workspace.openTab).not.toHaveBeenCalled(); f.workspace.settings.tabs = [f.tab]; expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true);
});
it('同步开标签回调重入仅一次，成功后来源失活是预期而不重复打开', () => {
  const f = fixture(), owner = f.open(), plan = owner.intent.compile(['id']); f.workspace.openTab.mockImplementation(() => { expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(false); }); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true); expect(f.workspace.openTab).toHaveBeenCalledOnce();
});
it('长Unicode表名只缩短显示标题，SQL保留准确完整表名且不割裂代理项', () => {
  const name = 'a'.repeat(179) + '🚢' + 'b'.repeat(300), f = fixture(false, name), owner = f.open(), plan = owner.intent.compile(['id']); expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(true); const candidate = f.workspace.openTab.mock.calls[0][0]; expect(candidate.title.length).toBeLessThan(256); expect(candidate.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u); expect(candidate.sql).toContain(name);
});
it.each(['active', 'job', 'version', 'profile', 'query-reference', 'query-value', 'page-metadata', 'page-read', 'editor-rows', 'modal', 'two-modals', 'duplicate-marker', 'detached', 'structure', 'input'] as const)('%s变化后不打开也不复活旧来源', change => {
  const f = fixture(true), owner = f.open(), plan = owner.intent.compile(['id']);
  if (change === 'active') f.workspace.settings.activeTabId = 'other';
  if (change === 'job') f.workspace.activeJobs.t = {};
  if (change === 'version') f.workspace.connectionVersions.c++;
  if (change === 'profile') f.workspace.connections[0] = { ...f.profile };
  if (change === 'query-reference') f.applied.current = { ...f.query };
  if (change === 'query-value') f.query.sort[0].direction = 'asc';
  if (change === 'page-metadata') f.page.columns[0].name = 'later';
  if (change === 'page-read') { f.editorRef.current = null; f.current.value = false; }
  if (change === 'editor-rows') f.editor!.view.rows = [...f.rows];
  if (change === 'modal') f.dialogs.owners = ['foreign'];
  if (change === 'two-modals') f.dialogs.owners.push('foreign');
  if (change === 'duplicate-marker') f.dialogs.markers = 2;
  if (change === 'detached') f.dialogs.owners = [];
  if (change === 'structure') f.latest.current.refreshVersion++;
  if (change === 'input') f.refs.inputRef.current = {};
  expect(owner.intent.current()).toBe(false); f.workspace.settings.activeTabId = 't'; delete f.workspace.activeJobs.t; f.dialogs.owners = [owner.id]; f.dialogs.markers = 1; f.workspace.connectionVersions.c = 0; f.workspace.connections[0] = f.profile;
  expect(f.api.openFilteredSelectQuery(owner, plan)).toBe(false); expect(f.workspace.openTab).not.toHaveBeenCalled(); f.api.closeFilteredSelect(owner); expect(f.filteredSelectRef.current).toBeNull();
});
it('旧关闭不能清后来窗口，旧保存不能消费后来最新plan', () => {
  const f = fixture(), first = f.open(), old = first.intent.compile(['id']); f.api.closeFilteredSelect(first); f.dialogs.owners = []; const later = f.open(), plan = later.intent.compile(['note']); f.api.closeFilteredSelect(first); expect(f.filteredSelectRef.current).toBe(later); expect(f.api.openFilteredSelectQuery(first, old)).toBe(false); expect(f.api.openFilteredSelectQuery(later, plan)).toBe(true);
});
it.each(['inputRef', 'previewRef', 'pasteRef', 'rangeRef', 'fillRef', 'importRef', 'fullExportRef'] as const)('%s已有输入或任务时不生成', key => {
  const f = fixture(); f.refs[key].current = {}; f.api.openFilteredSelect(); expect(f.filteredSelectRef.current).toBeNull(); expect(f.workspace.openTab).not.toHaveBeenCalled();
});
