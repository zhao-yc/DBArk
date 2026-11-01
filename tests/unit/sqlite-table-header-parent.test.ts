import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableBrowser, type SqliteTableQuery } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { sqliteHeaderSortFromGrid } from '../../src/renderer/sqliteTableHeaderSort';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

/** 执行真实父入口、Browser及editor；仅DOM／store／确认和React发布使用RAM端口。 */
async function fixture(writable = false) {
  const source = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names = ['available', 'headerSortCurrent', 'sortFromHeader'], methods: string[] = [];
  function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(source)); ts.forEachChild(node, walk); } walk(source); expect(methods).toHaveLength(names.length);
  const tab = { id: 't', kind: 'table', connectionId: 'c', database: 'main', table: 'subject' }, profile = {}, token = {}, listeners = new Set<() => void>();
  const workspace = { settings: { activeTabId: tab.id, tabs: [tab] }, connections: [profile], connectionVersions: { c: 0 }, activeJobs: {} as Record<string, unknown> };
  Object.assign(profile, { id: 'c' });
  const applied = { current: { limit: 10, mode: 'or', filters: [{ column: 'note', operator: 'contains', value: { kind: 'text', value: '原筛选🚢' } }], sort: [{ column: 'id', direction: 'asc' }] } as SqliteTableQuery };
  const page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), offset: 20, limit: 10, hasMore: true, columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'note', declaredType: 'TEXT' }], result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }, { key: 'c1', name: 'note', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807', c1: '原筛选🚢' }], statement: '', elapsedMs: 0, truncated: false }, ...(writable ? { edit: { kind: 'editable' as const, snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 300000).toISOString(), columns: [{ name: 'id', declaredType: 'INTEGER', generated: false, nullable: false, hasDefault: false }, { name: 'note', declaredType: 'TEXT', generated: false, nullable: true, hasDefault: false }], rows: [[{ kind: 'integer' as const, value: '9223372036854775807' }, { kind: 'text' as const, value: '原筛选🚢' }]], locator: { kind: 'rowid' as const, columns: [] } } } : {}) };
  const state = { active: true, modal: false, alive: true }, latest = { current: { active: true, refreshVersion: 0 } }, refs = { inputRef: { current: null as any }, previewRef: { current: null as any }, pasteRef: { current: null as any }, rangeRef: { current: null as any }, importRef: { current: null as any }, fullExportRef: { current: null as any }, findRef: { current: null as any }, fillRef: { current: null as any }, filteredSelectRef: { current: null as any } };
  const read = vi.fn(async (input: any) => ({ ...page, offset: input.offset, limit: input.limit })), release = vi.fn(async () => {});
  let view: any;
  const browser = new SqliteTableBrowser({ scope: () => ({ tab: workspace.settings.tabs[0], profile: workspace.connections[0], connectionId: 'c', database: 'main', table: 'subject', version: workspace.connectionVersions.c, schemaRevision: latest.current.refreshVersion, present: state.alive, active: state.active && workspace.settings.activeTabId === tab.id, sqlite: true }), acquire: () => ({ owns: () => true, release: () => true }), read, release, cancel: vi.fn(async () => {}), id: () => 'read', changed: next => { view = next; }, subscribe: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; } });
  browser.activate(); await browser.load(applied.current, 20); read.mockClear();
  // RO用Browser真正交付的页，RW用同一页的实际编辑快照。
  const displayed = view.page as SqliteTablePage;
  const editor = writable ? new SqliteTableEditor(displayed, { current: () => state.alive && workspace.settings.tabs[0] === tab && workspace.connections[0] === profile && workspace.connectionVersions.c === 0, active: () => state.active, available: () => !workspace.activeJobs.t, acquire: () => ({ owns: () => true, release: () => true }), now: Date.now, id: () => 'new', changed: () => {}, dirty: () => {}, preview: vi.fn(), apply: vi.fn(), release, cancel: vi.fn(), committed: () => {} }) : null;
  if (editor) expect(browser.adopt(displayed)).toBe(true);
  const editorRef = { current: editor }, confirm = vi.fn(() => false), dropEditor = vi.fn(() => { editorRef.current?.dispose(); editorRef.current = null; }), setSort = vi.fn(), setValidation = vi.fn(), load = vi.spyOn(browser, 'load');
  const context: any = createContext({ page: displayed, tab, profile, version: 0, refreshVersion: 0, latest, active: true, invalidTarget: false, view, useWorkspace: { getState: () => workspace, subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } }, document: { querySelector: () => state.modal ? {} : null }, window: { confirm }, editRender: { current: token }, editRenderTicket: token, renderedEditor: editor, editRows: editor?.view.rows ?? [], editorRef, controller: browser, ...refs, exportData: null, applied, sqliteHeaderSortFromGrid, editText, dropEditor, setSort, setValidation, uid: () => 'sort-id', errorMessage: (reason: Error) => reason.message });
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const emit = () => { [...listeners].forEach(cb => cb()); editor?.observe(); };
  return { api: context.api, context, state, page: displayed, workspace, latest, refs, browser, editor, editorRef, applied, read, load, confirm, dropEditor, setSort, setValidation, emit, listeners, dirty() { editor!.save(editor!.view.rows[0].id, [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '未提交' }]); context.editRows = editor!.view.rows; }, dispose() { editor?.dispose(); browser.dispose(); } };
}
it.each([false, true])('准确%s读写来源立即offset0读取，保已应用筛选／limit而不采表单草稿', async writable => {
  const f = await fixture(writable), original = f.applied.current, rows = structuredClone(f.page.result.rows), before = f.listeners.size;
  f.api.sortFromHeader([{ columnKey: 'c1', direction: 'DESC' }, { columnKey: 'c0', direction: 'ASC' }]);
  expect(f.load).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledWith({ ...original, sort: [{ column: 'note', direction: 'desc' }, { column: 'id', direction: 'asc' }] }, 0);
  expect(f.read.mock.calls[0][0]).toMatchObject({ offset: 0, limit: 10, mode: 'or', filters: original.filters }); expect(f.dropEditor).toHaveBeenCalledTimes(1); expect(f.confirm).not.toHaveBeenCalled(); expect(f.setSort).toHaveBeenCalledWith([{ id: 'sort-id', column: 'note', direction: 'desc' }, { id: 'sort-id', column: 'id', direction: 'asc' }]); expect(f.page.result.rows).toEqual(rows); expect(f.listeners.size).toBe(before); f.dispose();
});
it('脏页取消不改变原rows、撤销栈、排序、输入与请求', async () => {
  const f = await fixture(true); f.dirty(); const rows = f.editor!.view.rows, query = f.applied.current, listeners = f.listeners.size;
  f.api.sortFromHeader([{ columnKey: 'c0', direction: 'DESC' }]);
  expect(f.confirm).toHaveBeenCalledWith(editText.confirmDiscard); expect(f.editor!.view.rows).toBe(rows); expect(f.editor!.view.undo).toBe(true); expect(f.editor!.dirty).toBe(true); expect(f.applied.current).toBe(query); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.setSort).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(listeners); f.dispose();
});
it('脏页确认后只丢原editor，清排序也走原查询服务端重读', async () => {
  const f = await fixture(true); f.dirty(); f.confirm.mockReturnValue(true); f.api.sortFromHeader([]);
  expect(f.load).toHaveBeenCalledWith(expect.objectContaining({ sort: [] }), 0); expect(f.setSort).toHaveBeenCalledWith([]); expect(f.editorRef.current).toBeNull(); f.dispose();
});
it.each(['page', 'render', 'rows', 'query', 'version', 'profile', 'active-aba', 'job-aba', 'modal', 'structure'] as const)('确认期间%s变化不丢草稿也不重读后继目标', async change => {
  const f = await fixture(true); f.dirty(); const rows = f.editor!.view.rows;
  f.confirm.mockImplementation(() => {
    if (change === 'page') f.context.page = { ...f.page };
    if (change === 'render') f.context.editRender.current = {};
    if (change === 'rows') { f.editor!.save(rows[0].id, [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '后继草稿' }]); f.context.editRows = f.editor!.view.rows; }
    if (change === 'query') f.applied.current = { ...f.applied.current };
    if (change === 'version') f.workspace.connectionVersions.c++;
    if (change === 'profile') f.workspace.connections[0] = {};
    if (change === 'structure') f.latest.current.refreshVersion++;
    if (change === 'modal') f.state.modal = true;
    if (change === 'active-aba') { f.workspace.settings.activeTabId = 'other'; f.emit(); f.workspace.settings.activeTabId = 't'; }
    if (change === 'job-aba') { f.workspace.activeJobs.t = {}; f.emit(); delete f.workspace.activeJobs.t; }
    f.emit(); return true;
  });
  f.api.sortFromHeader([{ columnKey: 'c0', direction: 'DESC' }]); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.setSort).not.toHaveBeenCalled(); expect(f.editor!.dirty).toBe(true); f.dispose();
});
it.each(['inputRef', 'previewRef', 'pasteRef', 'rangeRef', 'importRef', 'fullExportRef', 'fillRef', 'filteredSelectRef'] as const)('%s持有输入或任务时列头零确认零请求', async key => {
  const f = await fixture(true); f.refs[key].current = {}; f.api.sortFromHeader([]); expect(f.load).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); f.dispose();
});
it('相同排序与无效九列均不丢草稿；错误只显示原页', async () => {
  const f = await fixture(true); f.dirty(); f.api.sortFromHeader([{ columnKey: 'c0', direction: 'ASC' }]); expect(f.setValidation).not.toHaveBeenCalled(); f.api.sortFromHeader(Array.from({ length: 9 }, (_, i) => ({ columnKey: 'c' + i, direction: 'ASC' }))); expect(f.setValidation).toHaveBeenCalledTimes(1); expect(f.confirm).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled(); expect(f.editor!.dirty).toBe(true); f.dispose();
});
it('失活再恢复的RO旧Browser页不能用同名来源复活', async () => {
  const f = await fixture(); f.state.active = false; f.emit(); f.state.active = true; f.emit(); f.api.sortFromHeader([]); expect(f.load).not.toHaveBeenCalled(); expect(f.dropEditor).not.toHaveBeenCalled(); f.dispose();
});
it.each(['modal', 'export', 'find-preview', 'busy', 'render', 'editor-unknown'] as const)('初始%s不确认不读取也不覆盖草稿', async blocker => {
  const f = await fixture(true); f.dirty();
  if (blocker === 'modal') f.state.modal = true;
  if (blocker === 'export') f.context.exportData = {};
  if (blocker === 'find-preview') f.refs.findRef.current = { preview: true };
  if (blocker === 'busy') f.workspace.activeJobs.t = {};
  if (blocker === 'render') f.context.editRender.current = {};
  if (blocker === 'editor-unknown') f.context.renderedEditor = {};
  f.api.sortFromHeader([]); expect(f.load).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); expect(f.dropEditor).not.toHaveBeenCalled(); expect(f.editor!.dirty).toBe(true); f.dispose();
});
