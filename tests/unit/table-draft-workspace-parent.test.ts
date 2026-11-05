import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { TableEditWorkspace } from '../../src/renderer/tableEditWorkspace';
import { collectChanges } from '../../src/renderer/dataChanges';
import { captureTableDraft, restoreTableDraftRows } from '../../src/renderer/tableDraft';
import { recordPageScope } from '../../src/renderer/recordPageNavigation';
import { assertCopiedRecordKeys } from '../../src/renderer/recordDuplicate';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { decodeTableDraft, encodeTableDraft, type TableDraftDocument } from '../../src/shared/tableDraft';
import { tableDraftFilesZh as savedDraftText } from '../../src/renderer/locales/tableDraftFiles.zh-CN';
import { tableEditWorkspaceZh as workspaceText } from '../../src/renderer/locales/tableEditWorkspace.zh-CN';
import type { TableInfo } from '../../src/shared/contracts';
const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = ['setRows', 'adoptWorkspacePage', 'selectRestoredWorkspacePage', 'assertSavedDraft', 'acceptSavedDraft', 'openSavedDraft'], functions: string[] = [];
/** 执行生产父处理器及真实类，不在VM内改变普通对象原型或放宽文件校验。 */
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && wanted.includes(node.name.text)) functions.push(node.getText(tree)); node.forEachChild(visit); } visit(tree);
if (functions.length !== wanted.length) throw Error('缺少草稿恢复生产父处理器');
const code = ts.transpileModule(functions.join('\n') + ';return { ' + wanted.join(',') + ' };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** React状态端口只记录发布；文件解析、草稿分组、dirty、历史与守卫全部执行生产代码。 */
function fixture() {
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: ['id', 'note'].map(name => ({ name, type: 'text', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' })) };
  const tab = { id: '表页', connectionId: 'conn' }, connection = {}, frame = {}, edits = new TableEditWorkspace(), setDirty = vi.fn();
  const state = { settings: { activeTabId: tab.id, tabs: [tab] }, connections: [connection], connectionVersions: { conn: 1 }, setDirty, setBusy: vi.fn() };
  Object.assign(connection, { id: 'conn' });
  const p: any = { tableEdits: edits, mounted: { current: true }, tableReadAction: { current: frame }, tableReadRender: frame, base: { connectionId: 'conn', database: 'db', table: 'items' }, connection, connectionVersion: 1, refreshVersion: 0, filters: [], filterMode: 'all', filterGroup: undefined, sort: [], pageIndex: 1, pageSize: 50, tab, info, page: { page: 1, pageSize: 50, hasMore: true, columns: [], rows: [] }, editable: true, useWorkspace: { getState: () => state }, rowsRef: { current: [] }, history: edits.history, inputDirtyRef: { current: false }, copiedDraftIds: { current: new Set() }, copySources: { current: null }, copyRowRefs: { current: new Map() }, copyPage: { current: null }, filteredSelectPage: { current: null }, selectedRowsRef: { current: new Set() }, selectionRef: { current: undefined }, loadGeneration: { current: 9 }, workspaceSkipLoad: { current: undefined }, recordPages: { cancel: vi.fn() }, activeGridEditor: { current: null }, externalStaleRef: { current: false }, applyRecovery: { locked: false }, blockedRef: { current: false }, record: { hasInput: vi.fn(() => false), reset: vi.fn(), pending: false }, recordControllerRef: { current: { reset: vi.fn(), formOpen: false } }, recordContextRef: { current: { info, stale: false } }, draftLease: { current: null }, referenceCount: { current: 0 }, savedDraftValues: [], restoredDraftView: false, showPreferences: false, referenceDialog: null, gridEditing: false, document: { querySelector: () => null }, uid: () => crypto.randomUUID(), collectChanges, captureTableDraft, restoreTableDraftRows, recordPageScope, assertCopiedRecordKeys, savedDraftText, workspaceText, recordTargetKey: () => '准确目标', invalidateCopyRead: vi.fn(), releaseCopySources: vi.fn(async () => {}), reloadBlocked: () => false, errorMessage: (reason: Error) => reason.message, setError: vi.fn(), setDuplicateNotice: vi.fn(), setReferenceBusy: vi.fn(), setDraftDialog: vi.fn(), setInfo: vi.fn(), setSelectedRows: vi.fn(), setSelection: vi.fn(), invoke: vi.fn() };
  for (const name of ['rowTransferIntent', 'childReferenceIntent', 'tableStatisticsIntent', 'tableValueOptionsIntent', 'filteredExportIntent', 'filteredUpdateIntent', 'filteredDeleteIntent', 'filteredSelectIntent', 'batchFillIntent', 'recordBatchIntent', 'selectedFilterRef']) p[name] = { current: null };
  p.setRowsState = (rows: any) => { p.rows = rows; };
  p.setPage = (page: any) => { p.page = page; }; p.setPageIndex = (index: number) => { p.pageIndex = index; };
  p.setPageSize = (size: number) => { p.pageSize = size; }; p.setRestoredDraftView = (value: boolean) => { p.restoredDraftView = value; };
  p.getRecordPageContext = () => ({ scope: recordPageScope({ target: p.base, connectionVersion: 1, refreshVersion: 0, pageSize: p.pageSize, filters: p.filters, filterMode: 'all', sort: [] }) });
  const actions = new Function('ports', 'with (ports) {' + code + '}')(p);
  Object.assign(p, actions);
  const lease = { mode: 'restore', info, page: p.page, rows: p.rowsRef.current, generation: 9, invalid: false, values: [] }; p.draftLease.current = lease;
  const document: TableDraftDocument = { kind: 'dbark.table-draft', version: 2, endpointKey: 'a'.repeat(64), target: p.base, metadataKey: tableCopyMetadataKey(info), workspace: { pageSize: 1, activePage: 3, pages: [{ index: 1, changes: 1 }, { index: 3, changes: 1 }] }, changes: [{ kind: 'update', before: { id: '1', note: '第一页原值' }, values: { note: '第一页修改' } }, { kind: 'update', before: { id: '3', note: '第三页原值' }, values: { note: '第三页修改' } }] };
  function ready() { p.draftLease.current = null; p.blockedRef.current = false; p.tableReadAction.current = frame; }
  return { p, state, edits, actions, lease, document, ready };
}

it('文件解码后由真实父恢复原页分组，零写入，dirty覆盖后台组；再次保存与新父页恢复保持相同修改', () => {
  const f = fixture(), doc = decodeTableDraft(encodeTableDraft(f.document)); f.actions.acceptSavedDraft(f.lease, doc);
  expect(f.p.restoredDraftView).toBe(true); expect(f.p.pageIndex).toBe(3); expect(f.p.pageSize).toBe(1); expect(f.p.rowsRef.current[0].data.note).toBe('第三页修改'); expect(f.p.copyPage.current).toBeNull(); expect(f.p.filteredSelectPage.current).toBeNull(); expect(f.p.workspaceSkipLoad.current.entry).toBe(f.edits.selected);
  expect(f.state.setDirty).toHaveBeenLastCalledWith('表页', true); expect(f.p.invoke).not.toHaveBeenCalled(); f.ready();
  f.actions.selectRestoredWorkspacePage(f.edits.pages[0]); expect(f.p.pageIndex).toBe(1); expect(f.p.rowsRef.current[0].data.note).toBe('第一页修改'); expect(f.p.restoredDraftView).toBe(true);
  // 恢复后同一页的后续修改可撤销，另一个分组的历史不被污染。
  f.ready(); const before = f.p.rowsRef.current; f.actions.setRows(before.map((row: any) => ({ ...row, data: { ...row.data, note: '恢复后续改' } })));
  const undone = f.edits.history.move(f.p.rowsRef.current, 'undo'); f.actions.setRows(undone, 'replay'); expect(f.p.rowsRef.current[0].data.note).toBe('第一页修改');
  f.actions.openSavedDraft('save'); const saved = f.p.setDraftDialog.mock.calls.at(-1)[0].payload;
  expect(saved.workspace).toEqual({ ...doc.workspace, activePage: 1 }); expect(saved.changes).toEqual(doc.changes);
  const next = fixture(); next.actions.acceptSavedDraft(next.lease, decodeTableDraft(encodeTableDraft({ ...saved, kind: 'dbark.table-draft', version: 2, endpointKey: doc.endpointKey })));
  expect(next.p.pageIndex).toBe(1); expect(next.edits.pages.map(page => page.index)).toEqual([1, 3]); expect(collectChanges(next.edits.allRows(next.p.rowsRef.current))).toEqual(doc.changes); expect(next.p.invoke).not.toHaveBeenCalled();
});
it.each(['未暂存输入', '活动编辑器', '旧渲染', '切走标签', '连接版本变化', '提交结果锁定', '失效分组'])('%s不能切换恢复组、发布行或改页码', kind => {
  const f = fixture(); f.actions.acceptSavedDraft(f.lease, f.document); f.ready(); const before = f.p.rowsRef.current, index = f.p.pageIndex;
  if (kind === '未暂存输入') f.p.record.hasInput.mockReturnValue(true);
  if (kind === '活动编辑器') f.p.activeGridEditor.current = {};
  if (kind === '旧渲染') f.p.tableReadAction.current = {};
  if (kind === '切走标签') f.state.settings.activeTabId = '其它';
  if (kind === '连接版本变化') f.state.connectionVersions.conn++;
  if (kind === '提交结果锁定') f.p.applyRecovery.locked = true;
  if (kind === '失效分组') f.edits.invalidate();
  f.actions.selectRestoredWorkspacePage(f.edits.pages[0]); expect(f.p.rowsRef.current).toBe(before); expect(f.p.pageIndex).toBe(index); expect(f.p.invoke).not.toHaveBeenCalled();
});
it('同页同页长恢复不会留下跳过下一次显式服务器读取的票据', () => {
  const f = fixture(); f.document.workspace!.activePage = 1; f.document.workspace!.pageSize = 50;
  f.actions.acceptSavedDraft(f.lease, f.document); expect(f.p.workspaceSkipLoad.current).toBeUndefined();
});
it('旧单页文件继续走独立列表恢复，不伪造原页分组', () => {
  const f = fixture(), { workspace: _workspace, ...doc } = f.document; doc.version = 1;
  f.actions.acceptSavedDraft(f.lease, doc); expect(f.p.restoredDraftView).toBe(true); expect(f.edits.pages).toHaveLength(0); expect(f.p.rowsRef.current).toHaveLength(2); expect(f.p.invoke).not.toHaveBeenCalled();
});
it('核验期间父页或连接变化拒绝整次恢复，保留原行与工作区', () => {
  const f = fixture(); f.lease.invalid = true; const before = f.p.rowsRef.current;
  expect(() => f.actions.acceptSavedDraft(f.lease, f.document)).toThrow(); expect(f.edits.pages).toHaveLength(0); expect(f.p.rowsRef.current).toBe(before);
});
