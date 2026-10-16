import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { PasteInsertIntent, preparePasteInsert } from '../../src/renderer/pasteInsert';
import { captureRecordPagePreview, recordReadonlyReason, recordTargetKey, type RecordContext } from '../../src/renderer/recordViews';
import { assertCopiedRecordKeys } from '../../src/renderer/recordDuplicate';
import { pasteInsertZh } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

const file = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions: string[] = []; let scope = '', invalidate = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['assertGridWritable', 'assertPasteInsertTarget', 'openPasteInsert', 'closePasteInsert', 'stagePasteInsert', 'makePreview'].includes(node.name.text)) functions.push(node.getText(tree));
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'pasteInsertValues') scope = node.initializer!.getText(tree);
  if (ts.isIfStatement(node) && node.expression.getText(tree).startsWith('pasteInsertValues.some')) invalidate = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
const code = ts.transpileModule(functions.join('\n') + '\nglobalThis.actions={open:openPasteInsert,stage:stagePasteInsert,close:closePasteInsert,preview:makePreview,render:()=>{const pasteInsertValues=' + scope + ';' + invalidate + '}};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** 正式处理器原文运行；仅用合成工作区、状态setter和IPC端口，不启动应用/数据库。 */
function fixture() {
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], columns: [
    { name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: 'auto_increment', generated: false, comment: '' },
    { name: 'note', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' }
  ] };
  const target = { connectionId: 'connection', database: 'db', table: 'items' }, tab = { id: 'tab', kind: 'table', ...target };
  const current: RecordContext = { target, connectionVersion: 1, generation: 1, info, loaded: true, stale: false, busy: false };
  const original = { id: 7, note: '载入值' }, row = { id: 'old', original, data: { ...original, note: '旧草稿' }, inserted: false, deleted: false };
  const workspace = { settings: { activeTabId: 'tab', tabs: [{ ...tab }] }, connections: [{ id: 'connection' }], connectionVersions: { connection: 1 }, setBusy: vi.fn() };
  const setRows = vi.fn(), invoke = vi.fn(async (_command: string, _input: { changes: unknown[] }) => ({ sql: '合成集中预览', warnings: [] })); let id = 0;
  const port = createContext({ Error, structuredClone, pasteInsertZh, PasteInsertIntent, recordReadonlyReason, recordTargetKey, tableCopyMetadataKey, errorMessage, recordViewZh, recordDuplicateZh, captureRecordPagePreview, assertCopiedRecordKeys,
    tab, base: target, connectionVersion: 1, refreshVersion: 0, info, page: {}, layoutRevision: { current: 0 }, externalStale: false, pageIndex: 1, pageSize: 50, filters: [], filterMode: 'all', sort: [],
    record: { hasInput: () => false, dirty: false, request: vi.fn() }, mounted: { current: true }, rootElement: { current: { querySelector: () => null } }, document: { querySelector: () => null }, getRecordContext: () => current,
    useWorkspace: { getState: () => workspace }, rowsRef: { current: [row] }, visibleKeys: ['id', 'note'], pasteInsertIntent: { current: null }, pasteInsertEnvironment: { current: [] }, copiedDraftIds: { current: new Set() },
    selectedRows: new Set(['old']), selectionRef: { current: { rowId: 'old', key: 'note' } }, setSelection: vi.fn(), setSelectedRows: vi.fn(), uid: vi.fn(() => 'new-' + ++id), setRows,
    setPasteInsertDialog: vi.fn(), setError: vi.fn(), setDuplicateNotice: vi.fn(), invoke, blockedRef: { current: false }, previewingRef: { current: false }, applyingRef: { current: false }, preview: null, referenceCount: { current: 0 }, loadGeneration: { current: 1 }, recordContextRef: { current }, setPreviewing: vi.fn(), setPreview: vi.fn(), loadingCount: { current: 0 }, preferencesLock: { current: false }, copyPendingRef: { current: false }
  });
  setRows.mockImplementation(value => { port.rowsRef.current = value; });
  runInContext(code, port); port.actions.render(); port.actions.open();
  return { port, current, info, workspace, row, original, intent: port.pasteInsertIntent.current as PasteInsertIntent, setRows, invoke };
}

describe('TableTab新增入口的真实处理器回放', () => {
  it('一次暂存保留旧草稿、选择及original，键保护集合包含每个新ID，直接IPC为0', () => {
    const f = fixture(), selected = f.port.selectionRef.current, checked = f.port.selectedRows;
    expect(f.intent).toBeInstanceOf(PasteInsertIntent); expect(f.port.uid).not.toHaveBeenCalled();
    f.port.actions.stage(f.intent, preparePasteInsert(f.info, [['a'], ['b']], ['note']));
    expect(f.setRows).toHaveBeenCalledOnce(); expect(f.port.rowsRef.current[0]).toBe(f.row); expect(f.row.original).toBe(f.original); expect(f.port.selectionRef.current).toBe(selected); expect(f.port.selectedRows).toBe(checked);
    expect([...f.port.copiedDraftIds.current]).toEqual(['new-1', 'new-2']); expect(f.invoke).not.toHaveBeenCalled();
    expect(() => f.port.actions.stage(f.intent, preparePasteInsert(f.info, [['a']], ['note']))).toThrow(); expect(f.setRows).toHaveBeenCalledOnce();
  });
  it('关闭/重新打开后的旧stage与旧close回调都不影响新弹窗', () => {
    const f = fixture(); f.port.actions.close(f.intent); f.port.actions.open(); const next = f.port.pasteInsertIntent.current;
    f.port.actions.close(f.intent); expect(f.port.pasteInsertIntent.current).toBe(next);
    expect(() => f.port.actions.stage(f.intent, preparePasteInsert(f.info, [['a']], ['note']))).toThrow(); expect(f.setRows).not.toHaveBeenCalled();
  });
  it.each(['closed', 'inactive', 'target', 'connection', 'version', 'input', 'grid-input', 'busy'] as const)('同步%s变化立即拒绝，不等React效果且分配UUID为0', condition => {
    const f = fixture(), plan = preparePasteInsert(f.info, [['a']], ['note']);
    if (condition === 'closed') f.port.mounted.current = false; if (condition === 'inactive') f.workspace.settings.activeTabId = 'other';
    if (condition === 'target') f.workspace.settings.tabs[0].table = 'other'; if (condition === 'connection') f.workspace.connections = [];
    if (condition === 'version') f.workspace.connectionVersions.connection++; if (condition === 'input') f.port.record.hasInput = () => true;
    if (condition === 'grid-input') f.port.rootElement.current.querySelector = () => ({}); if (condition === 'busy') f.current.busy = true;
    expect(() => f.port.actions.stage(f.intent, plan)).toThrow(); expect(f.port.uid).not.toHaveBeenCalled(); expect(f.setRows).not.toHaveBeenCalled(); expect(f.row.data.note).toBe('旧草稿');
  });
  it('观察过页面/目录变化后即使回到旧值，也不能复活旧票据', () => {
    const f = fixture(), old = f.port.page, plan = preparePasteInsert(f.info, [['a']], ['note']);
    f.port.page = {}; f.port.actions.render(); f.port.page = old; f.port.actions.render();
    expect(() => f.port.actions.stage(f.intent, plan)).toThrow(); expect(f.port.uid).not.toHaveBeenCalled();
  });
  it('显式自增键冲突经原makePreview在发送SQL预览前拒绝', async () => {
    const f = fixture(); f.port.actions.stage(f.intent, preparePasteInsert(f.info, [['7']], ['id']));
    await f.port.actions.preview(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.port.setError.mock.calls.at(-1)[0]).toContain('冲突');
  });
  it('合法草稿只在用户另行集中预览时走原table.preview，附带旧草稿修改', async () => {
    const f = fixture(); f.port.actions.stage(f.intent, preparePasteInsert(f.info, [['a']], ['note'])); expect(f.invoke).not.toHaveBeenCalled();
    await f.port.actions.preview(); expect(f.invoke).toHaveBeenCalledOnce(); expect(f.invoke.mock.calls[0][0]).toBe('table.preview'); expect(f.invoke.mock.calls[0][1].changes).toHaveLength(2);
  });
});
