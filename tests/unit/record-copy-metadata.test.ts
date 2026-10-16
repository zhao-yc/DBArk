import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey, type TableCopySourceReadResult } from '../../src/shared/tableCopySource';
import { beginRecordCopyRead, consumeRecordCopyRead, recordCopyMetadataReason, recordCopySourceReady } from '../../src/renderer/recordCopySource';
import { recordReadonlyReason, recordTargetKey } from '../../src/renderer/recordViews';
import { duplicateRecordDraft, recordDuplicateReadonlyReason } from '../../src/renderer/recordDuplicate';
import { collectChanges } from '../../src/renderer/dataChanges';
import { errorMessage } from '../../src/renderer/lib';
import { formatText } from '../../src/renderer/locales/zh-CN';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { recordCopySourceZh } from '../../src/renderer/locales/recordCopySource.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { RecordPageNavigation, recordPageScope } from '../../src/renderer/recordPageNavigation';
import { maxTablePage } from '../../src/renderer/tableFilters';
import { DraftHistory } from '../../src/renderer/draftHistory';

// 员工3的7660最小反例已原样保留；这里将同一旧目录/新页场景接入实际load、按钮和异步处理器。
const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), functions: string[] = [];
let load = '', disabled = '', copyValues = '', environment = '', resize = '', activePosition = '', cellClick = '', selectionSync = '';
/** 取生产原文并替换外界端口，按钮守卫与实际处理器不能各测一套实现。 */
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['setRows', 'getRecordContext', 'getRecordPageContext', 'navigateRecordPage', 'selectCurrentCell', 'assertGridWritable', 'invalidateCopyRead', 'releaseCopySources', 'duplicateCurrentRow', 'readCompleteCopySource'].includes(node.name.text)) functions.push(node.getText(tree));
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'load') load = node.initializer!.getText(tree);
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'copyValues') copyValues = node.initializer!.getText(tree);
  if (ts.isIfStatement(node) && node.expression.getText(tree).startsWith('copyValues.some')) environment = node.getText(tree);
  if (ts.isExpressionStatement(node) && node.getText(tree) === 'selectionRef.current = selection;') selectionSync = node.getText(tree);
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'DataGrid') {
    const attr = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'onColumnResize');
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) resize = attr.initializer.expression!.getText(tree);
    for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      if (attribute.name.getText(tree) === 'onActivePositionChange') activePosition = attribute.initializer.expression!.getText(tree);
      if (attribute.name.getText(tree) === 'onCellClick') cellClick = attribute.initializer.expression!.getText(tree);
    }
  }
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'aria-label' && attr.initializer?.getText(tree) === '{recordDuplicateZh.action}')) {
    const attr = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'disabled'); if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) disabled = attr.initializer.expression!.getText(tree);
  }
  node.forEachChild(visit);
}
visit(tree);
if (!activePosition || !cellClick || !selectionSync) throw Error('缺少真实网格选择回调或渲染引用同步语句');
const code = ts.transpileModule(functions.join('\n') + '\nconst load=' + load + ';globalThis.handlers={load,copy:duplicateCurrentRow,read:readCompleteCopySource,context:getRecordContext,navigate:navigateRecordPage,invalidate:invalidateCopyRead,activePosition:(' + activePosition + '),cellClick:(' + cellClick + '),renderSelection:()=>{' + selectionSync + '},resize:(' + resize + '),disabled:()=>(' + disabled + '),environment:()=>{const copyValues=' + copyValues + ';' + environment + '}};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** 仅模拟IO；旧目录id/note，新来源页声明新增hidden INVISIBLE，服务器回包由测试显式结束。 */
async function fixture(mode: 'mismatch' | 'matching' | 'unavailable' | 'local' = 'mismatch') {
  const old: TableInfo = { database: 'db', name: 'records', engine: 'InnoDB', objectKind: 'table', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: [{ name: 'id', type: 'int', nullable: false, extra: 'auto_increment', generated: false, defaultValue: null, comment: '' }, { name: 'note', type: 'text', nullable: true, extra: '', generated: false, defaultValue: null, comment: '' }] };
  const fresh = structuredClone(old); fresh.columns.push({ ...fresh.columns[1], name: 'hidden', extra: 'INVISIBLE', defaultValue: '默认值' });
  const metadata = mode === 'matching' ? fresh : old, actual = mode === 'local' ? old : fresh;
  const page: TablePage = { copyMetadataKey: tableCopyMetadataKey(actual), page: 1, pageSize: 50, hasMore: false, columns: [{ key: 'id', name: 'id', type: 'int' }, { key: 'note', name: 'note', type: 'text' }], rows: [{ id: 1, note: '源记录' }], ...(mode === 'local' ? {} : { copySource: mode === 'unavailable' ? { status: 'unavailable' as const, reason: 'identity-permission' as const, missingColumns: ['hidden'] } : { status: 'ready' as const, pageRef: randomUUID(), rowRefs: [randomUUID()], expiresAt: Date.now() + 300000, metadataKey: tableCopyMetadataKey(fresh), missingColumns: ['hidden'] } }) };
  const base = { connectionId: 'conn', database: 'db', table: 'records' }, setRowsState = vi.fn(); let finish!: (result: TableCopySourceReadResult) => void;
  const pending = new Promise<TableCopySourceReadResult>(resolve => { finish = resolve; });
  const invoke = vi.fn(async (command: string) => { if (command === 'metadata.table') return metadata; if (command === 'table.page') return page; if (command === 'table.copySourceRead') return pending; if (['connections.open', 'table.copySourceRelease', 'query.cancel'].includes(command)) return undefined; throw Error('不应调用:' + command); });
  const uid = vi.fn(randomUUID), record = { hasInput: () => false, dirty: false };
  // 组合后的load保留D04真实导航门；本组为普通读取，不建立跨页票据。
  const tab = { id: 'tab', ...base }, workspace = { settings: { tabs: [tab], activeTabId: tab.id }, connectionVersions: { conn: 1 }, setBusy: vi.fn(), setDirty: vi.fn() };
  const port = createContext({ history: new DraftHistory(), structuredClone, Error, useCallback: (action: unknown) => action, useWorkspace: { getState: () => workspace }, invoke, uid, base, tab, connectionVersion: 1, refreshVersion: 0, pageIndex: 1, pageSize: 50, filters: [], filterMode: 'all', sort: [],
    recordPages: new RecordPageNavigation(), recordPageScope, recordPageScopeRef: { current: { value: { target: base, connectionVersion: 1, refreshVersion: 0, pageSize: 50, filters: [], filterMode: 'all', sort: [] }, page: 1 } }, setRecordPageMessage: vi.fn(), setPageIndex: vi.fn(), showPreferences: false, maxTablePage,
    visibleKeys: ['id', 'note'], updatePreferences: vi.fn(), setPreferencesError: vi.fn(),
    loadGeneration: { current: 0 }, blockedRef: { current: false }, loadingCount: { current: 0 }, referenceCount: { current: 0 }, applyingRef: { current: false }, preferencesLock: { current: false }, copyPendingRef: { current: false }, mounted: { current: true }, copyPageTask: { current: undefined }, copyPage: { current: null }, copySources: { current: null }, copyRowRefs: { current: new Map() }, copyReadIntent: { current: null }, copyEnvironment: { current: { values: [] } }, rowsRef: { current: [] }, selectionRef: { current: undefined }, copiedDraftIds: { current: new Set() }, inputDirtyRef: { current: false }, recordControllerRef: { current: { ...record, reset: vi.fn() } }, previewingRef: { current: false }, preview: null,
    recordContextRef: { current: { target: base, connectionVersion: 1, generation: 0, info: null, loaded: false, stale: false, busy: false } }, record, rootElement: { current: { querySelector: () => null } }, document: { querySelector: () => null }, blocked: false, copySourceReady: false, copyMetadataReason: '', referenceRow: undefined, info: null, page: null,
    setRowsState, setError: vi.fn(), setCopyPending: vi.fn(), setDuplicateNotice: vi.fn(), setSelectedRows: vi.fn(), setSelection: vi.fn(), setExternalStale: vi.fn(), setBusy: vi.fn(), setInfo: vi.fn(), setPage: vi.fn(),
    recordReadonlyReason, recordTargetKey, tableCopyMetadataKey, recordCopyMetadataReason, recordCopySourceReady, recordDuplicateReadonlyReason, duplicateRecordDraft, beginRecordCopyRead, consumeRecordCopyRead, collectChanges, errorMessage, formatText, recordDuplicateZh, recordCopySourceZh, recordViewZh,
  });
  port.setInfo = (value: TableInfo) => { port.info = value; port.recordContextRef.current.info = value; }; port.setPage = (value: TablePage) => { port.page = value; port.recordContextRef.current.loaded = !!value; };
  port.setCopyPending = vi.fn((value: boolean) => { port.blocked = value; });
  // React状态与同步引用分别观察；真实setter既接收对象，也接收函数式更新。
  port.setSelection = vi.fn((value: unknown) => { port.selection = typeof value === 'function' ? value(port.selection) : value; });
  runInContext(code, port); await port.handlers.load(); port.blockedRef.current = false;
  const row = port.rowsRef.current[0]; port.selectionRef.current = { rowId: row.id, key: 'note' }; port.selection = port.selectionRef.current; port.referenceRow = row;
  /** 模拟React渲染，仅计算生产辅助函数及生产不可复活守卫原文。 */
  function render() { port.handlers.environment(); port.copyMetadataReason = recordCopyMetadataReason(port.handlers.context(), port.copyPage.current, port.copySources.current?.source); port.copySourceReady = !port.copyMetadataReason && recordCopySourceReady(port.handlers.context(), row, port.copySources.current?.source, port.copyRowRefs.current.get(row.id)); }
  render(); invoke.mockClear(); uid.mockClear(); setRowsState.mockClear();
  const ready = page.copySource?.status === 'ready' ? page.copySource : undefined;
  const result = { target: base, pageRef: ready?.pageRef ?? '', rowRef: ready?.rowRefs[0] ?? '', metadataKey: page.copyMetadataKey!, readAt: new Date().toISOString(), complete: true as const, values: { id: 1, note: '源记录', hidden: '源值而非默认值' } };
  return { port, old, fresh, metadata, page, invoke, uid, setRowsState, render, finish: () => finish(result) };
}

describe('复制补取的同坐标通知与令牌', () => {
  it('同坐标通知后自有busy渲染按生产语句回写ref，完整回包仍只追加一次', async () => {
    const f = await fixture('matching'), p = f.port, state = p.selection;
    p.handlers.activePosition({ row: p.rowsRef.current[0], column: { key: 'note' } });
    const captured = p.selectionRef.current, pending = p.handlers.read();
    expect(p.copyReadIntent.current.selection).toBe(captured); p.handlers.renderSelection();
    expect(p.selectionRef.current).toBe(state); f.finish(); await pending;
    expect(p.setError.mock.calls.at(-1)?.[0] ?? '').toBe(''); expect(p.rowsRef.current).toHaveLength(2); expect(f.setRowsState).toHaveBeenCalledOnce();
    expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead']);
  });
  it('真实新坐标把同一令牌发布给React和同步引用，渲染回写不再分裂身份', async () => {
    const f = await fixture('matching'), p = f.port, previous = p.selectionRef.current;
    p.handlers.activePosition({ row: p.rowsRef.current[0], column: { key: 'id' } });
    const token = p.selectionRef.current; expect(token).not.toBe(previous); expect(p.selection).toBe(token);
    p.selectionRef.current = p.selection; expect(p.selectionRef.current).toBe(token);
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.setRowsState).not.toHaveBeenCalled();
  });
  it.each(['activePosition', 'cellClick'] as const)('%s重复同坐标不重建同步或React选择令牌', async event => {
    const f = await fixture('matching'), p = f.port, token = p.selectionRef.current, row = p.rowsRef.current[0];
    p.handlers[event]({ row, column: { key: 'note' } }); p.handlers[event]({ row, column: { key: 'note' } });
    expect(p.selectionRef.current).toBe(token); expect(p.selection).toBe(token);
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.setRowsState).not.toHaveBeenCalled();
  });
  it.each(['activePosition', 'cellClick'] as const)('自有占门提交期间%s同坐标通知后仍消费一次完整回包', async event => {
    const f = await fixture('matching'), p = f.port, token = p.selectionRef.current, rows = p.rowsRef.current, sourcePage = p.copyPage.current;
    const consume = vi.fn(consumeRecordCopyRead); p.consumeRecordCopyRead = consume;
    // useState提交前仍可能收到上一轮props转交的网格通知；执行正式回调及处理器，不改造结果。
    p.setCopyPending.mockImplementation((value: boolean) => { if (value) p.handlers[event]({ row: rows[0], column: { key: 'note' } }); p.blocked = value; });
    const pending = p.handlers.read(); f.finish(); await pending;
    expect(consume).toHaveBeenCalledOnce(); const [intent, actualRows, context, selection, source, rowRef, result] = consume.mock.calls[0];
    expect(intent.invalidated).toBe(false); expect(actualRows).toBe(rows); expect(intent.row).toBe(rows[0]); expect(context.info).toBe(intent.info);
    expect(context.connectionVersion).toBe(intent.version); expect(context.generation).toBe(intent.generation); expect(source).toBe(intent.source); expect(rowRef).toBe(intent.rowRef);
    expect(rows[0].data).toEqual(intent.dataSnapshot); expect(rows[0].original).toEqual(intent.originalSnapshot); expect(p.copyPage.current).toBe(sourcePage); expect(result.complete).toBe(true);
    expect(intent.selection).toBe(token); expect(selection, '同坐标不得触发consume的selection引用拒绝条件').toBe(token);
    expect(p.rowsRef.current).toHaveLength(2); expect(p.rowsRef.current[0]).toBe(rows[0]); expect(p.rowsRef.current[1].data.hidden).toBe('源值而非默认值');
    expect(f.setRowsState).toHaveBeenCalledOnce(); expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead']);
  });
  it.each(['行', '列', '清空'] as const)('真正%s变化再恢复同坐标仍永久拒绝，忙态也只取消一次', async change => {
    const f = await fixture('matching'), p = f.port, originalRows = p.rowsRef.current, row = originalRows[0];
    if (change === '行') originalRows.push({ ...row, id: row.id + '-another', data: { ...row.data, id: 2 }, original: { ...row.original, id: 2 } });
    const pending = p.handlers.read();
    const other = change === '行' ? { row: originalRows[1], column: { key: 'note' } } : change === '列' ? { row, column: { key: 'id' } } : { row: undefined, column: undefined };
    p.handlers.activePosition(other); p.handlers.activePosition({ row, column: { key: 'note' } });
    p.handlers.activePosition(other); p.handlers.activePosition({ row, column: { key: 'note' } });
    expect(p.copyReadIntent.current.invalidated).toBe(true); expect(p.copyPendingRef.current).toBe(true);
    f.finish(); await pending;
    expect(p.rowsRef.current).toBe(originalRows); expect(f.setRowsState).not.toHaveBeenCalled();
    expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead', 'query.cancel']);
  });
});

describe('7660目录/页结构竞态的实际入口回归', () => {
  it('补取占门期间D04跨页和布局都不变，重复取消只发一次且迟到完整回包不追加', async () => {
    const f = await fixture('matching'), p = f.port, originalRows = p.rowsRef.current;
    p.record.formOpen = true; p.record.draft = { rowId: originalRows[0].id }; p.recordControllerRef.current.formOpen = true;
    const pending = p.handlers.read(); expect(p.copyPendingRef.current).toBe(true);
    p.handlers.navigate(1); p.handlers.resize({ key: 'note' }, 300);
    expect(p.setPageIndex).not.toHaveBeenCalled(); expect(p.updatePreferences).not.toHaveBeenCalled(); expect(p.recordPages.pending).toBe(false);
    p.handlers.invalidate(); p.handlers.invalidate(); p.handlers.navigate(1);
    expect(p.copyPendingRef.current).toBe(true); expect(p.blockedRef.current).toBe(true);
    f.finish(); await pending;
    expect(p.rowsRef.current).toBe(originalRows); expect(f.setRowsState).not.toHaveBeenCalled(); expect(p.copyPendingRef.current).toBe(false);
    expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead', 'query.cancel']);
  });
  it('实际重新加载撤销旧补取并释放旧租约，迟到回包不覆盖新页或自动重试', async () => {
    const f = await fixture('matching'), p = f.port, oldRows = p.rowsRef.current, pending = p.handlers.read();
    await p.handlers.load(); const newRows = p.rowsRef.current, writes = f.setRowsState.mock.calls.length;
    expect(newRows).not.toBe(oldRows); expect(newRows).toHaveLength(1); expect(newRows[0].id).not.toBe(oldRows[0].id);
    f.finish(); await pending;
    expect(p.rowsRef.current).toBe(newRows); expect(f.setRowsState).toHaveBeenCalledTimes(writes); expect(p.rowsRef.current).toHaveLength(1);
    expect(f.invoke.mock.calls.filter(([command]) => command === 'query.cancel')).toHaveLength(1);
    expect(f.invoke.mock.calls.filter(([command]) => command === 'table.copySourceRelease')).toHaveLength(1);
    expect(f.invoke.mock.calls.filter(([command]) => command === 'table.copySourceRead')).toHaveLength(1);
  });
  it.each(['mismatch', 'unavailable'] as const)('%s来源报告新INVISIBLE而目录旧：按钮禁用，强行调用也无草稿/任务/SQL', async mode => { const f = await fixture(mode); expect(f.port.handlers.disabled()).toBe(true); f.port.handlers.copy(); expect(f.port.rowsRef.current).toHaveLength(1); expect(f.setRowsState).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.uid).not.toHaveBeenCalled(); expect(f.port.setError).toHaveBeenLastCalledWith(expect.stringContaining('结构身份未知或不一致')); });
  it('目录一致正例实际发起只读补取，完整回包只追加含新列源值的一条草稿', async () => { const f = await fixture('matching'); expect(f.port.handlers.disabled()).toBe(false); const active = f.port.handlers.read(); expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead']); expect(f.port.rowsRef.current).toHaveLength(1); f.finish(); await active; expect(f.port.rowsRef.current).toHaveLength(2); expect(f.port.rowsRef.current[1].data).toEqual({ note: '源记录', hidden: '源值而非默认值' }); expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['table.copySourceRead']); });
  it('完整且结构一致的普通行保留本地快捷复制，零IPC', async () => { const f = await fixture('local'); expect(f.port.handlers.disabled()).toBe(false); f.port.handlers.copy(); expect(f.port.rowsRef.current).toHaveLength(2); expect(f.port.rowsRef.current[1].data).toEqual({ note: '源记录' }); expect(f.invoke).not.toHaveBeenCalled(); });
  it.each(['unknown', 'empty', 'key', 'source-key', 'missing-columns', 'source-object', 'connection', 'target', 'generation'])('%s未知或不一致不能被本地完整判断兜底', async change => {
    const f = await fixture('matching'); if (change === 'unknown') delete f.page.copyMetadataKey; else if (change === 'empty') f.page.copyMetadataKey = ''; else if (change === 'key') f.page.copyMetadataKey += 'changed'; else if (change === 'source-key') f.port.copySources.current.source.metadataKey = ''; else if (change === 'missing-columns') f.port.copySources.current.source.missingColumns.push('unknown'); else if (change === 'source-object') f.port.copySources.current.source = { ...f.port.copySources.current.source }; else if (change === 'connection') f.port.recordContextRef.current.connectionVersion++; else if (change === 'target') f.port.recordContextRef.current.target = { ...f.port.base, connectionId: 'other' }; else f.port.loadGeneration.current++;
    f.render(); expect(f.port.handlers.disabled()).toBe(true); f.port.handlers.copy(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.setRowsState).not.toHaveBeenCalled(); expect(f.uid).not.toHaveBeenCalled();
  });
  it.each(['charset', 'collation', 'comment', 'column-type', 'column-charset', 'column-default'])('完整字段身份%s变化均拒绝，不只核缺列名单', async change => { const f = await fixture('local'); if (change === 'charset') f.metadata.charset = 'latin1'; else if (change === 'collation') f.metadata.collation = 'utf8mb4_bin'; else if (change === 'comment') f.metadata.comment = '新注释'; else if (change === 'column-type') f.metadata.columns[1].type = 'blob'; else if (change === 'column-charset') f.metadata.columns[1].characterSet = 'latin1'; else f.metadata.columns[1].defaultValue = '新默认值'; f.render(); expect(f.port.handlers.disabled()).toBe(true); f.port.handlers.copy(); expect(f.setRowsState).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); });
  it('按钮渲染后目录才变化，实际处理器同步拒绝，不分配任务号', async () => { const f = await fixture('local'); expect(f.port.handlers.disabled()).toBe(false); f.metadata.columns.push({ ...f.metadata.columns[1], name: 'later', extra: 'INVISIBLE' }); f.port.handlers.copy(); expect(f.uid).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.setRowsState).not.toHaveBeenCalled(); });
  it.each(['structure-aba', 'page-aba', 'source-key-aba'])('%s结构切走再切回不复活已开始的补取', async change => { const f = await fixture('matching'), active = f.port.handlers.read(); const old = f.metadata.columns[1].type, originalPage = f.port.page, originalKey = f.port.page.copySource.metadataKey; if (change === 'structure-aba') f.metadata.columns[1].type = 'blob'; else if (change === 'source-key-aba') f.port.page.copySource.metadataKey = 'different'; else f.port.page = { ...f.port.page }; f.render(); if (change === 'structure-aba') f.metadata.columns[1].type = old; else if (change === 'source-key-aba') f.port.page.copySource.metadataKey = originalKey; else f.port.page = originalPage; f.render(); expect(f.port.copyReadIntent.current.invalidated).toBe(true); f.finish(); await active; expect(f.setRowsState).not.toHaveBeenCalled(); expect(f.port.rowsRef.current).toHaveLength(1); expect(f.invoke.mock.calls.filter(([command]) => command === 'table.copySourceRead')).toHaveLength(1); });
});
