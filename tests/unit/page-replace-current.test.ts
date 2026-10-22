import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { FilterGroup, TableInfo } from '../../src/shared/contracts';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { applyPageReplacement, findPageCellsInWorker, nextPageOccurrenceAfterReplacement, pageOccurrences, pageReplaceWritable, previewPageReplacement, previewPageReplacementInWorker, type PageFindOptions, type PageOccurrence, type PageReplacement } from '../../src/renderer/pageFindReplace';
import type { PageFindRequest, PageFindResult } from '../../src/renderer/pageFindWorkerClient';
import { ownCell, errorMessage } from '../../src/renderer/lib';
import { recordReadonlyReason, recordTargetKey, type RecordContext } from '../../src/renderer/recordViews';
import { tableCellKeyIsComposing } from '../../src/renderer/tableCellKeyboard';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

/** 直接执行当前产品命名处理函数和快照effect；替换DOM/React端口，不复制一份守卫。 */
function production(path: string, names: string[], snapshotEffect = false): string {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8'), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), parts: string[] = [];
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) parts.push(node.getText(tree)); if (snapshotEffect && ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[1]?.getText(tree) === '[snapshot]') parts.push('function snapshotChanged()' + (node.arguments[0] as ts.ArrowFunction).body.getText(tree)); node.forEachChild(visit); }
  visit(tree); expect(parts).toHaveLength(names.length + Number(snapshotEffect));
  // 静态Worker URL不参与本模型执行，固定为合法脚本字面量；其它生产语句原样保留。
  return ts.transpileModule(parts.join('\n').replaceAll('import.meta.url', '"file:///PageFindPanel.tsx"') + '\nObject.assign(globalThis,{' + [...names, ...(snapshotEffect ? ['snapshotChanged'] : [])].join(',') + '});', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const parentCode = production('../../src/renderer/components/TableTab.tsx', ['assertGridWritable', 'pageFindGeneration', 'applyPagePlan', 'selectCurrentCell', 'invalidateCopyRead']);
const panelCode = production('../../src/renderer/components/PageFindPanel.tsx', ['selectPosition', 'invalidateIntent', 'changeReplacement', 'changeOptions', 'compositionStarted', 'compositionEnded', 'sameCurrent', 'jump', 'replaceCurrent', 'inputKey', 'run', 'cancel', 'apply'], true);
const options: PageFindOptions = { kind: 'text', query: 'old', caseSensitive: false, wholeCell: false, column: 'note' };

/** 保存独立original、大整数/DECIMAL/NULL/零字节及已有旁列草稿。 */
function fixture() {
  const info: TableInfo = { database: 'd', name: 't', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: ['id', 'note', 'other', 'nil', 'bytes', 'amount', 'generated'].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,6)' : name === 'bytes' ? 'BLOB' : 'TEXT', nullable: true, defaultValue: null, extra: '', generated: name === 'generated', comment: '' })) };
  const data = { id: '18446744073709551615', note: '😀old前old后old', other: '原旁列', nil: null, bytes: { type: 'binary' as const, base64: '' }, amount: '12345678901234567890.123456', generated: 'old' };
  const row: DraftRow = { id: 'uuid-1', data: { ...data, other: '已有草稿' }, original: structuredClone(data), inserted: false, deleted: false }, other: DraftRow = { ...row, id: 'uuid-2', data: { ...data, id: '9007199254740993', note: 'old' }, original: { ...data, id: '9007199254740993', note: 'old' } };
  const keys = ['note', 'other', 'nil', 'bytes', 'amount', 'generated'], state: RecordContext = { target: { connectionId: 'c', database: 'd', table: 't' }, connectionVersion: 1, generation: 3, info, loaded: true, busy: false, stale: false };
  let input = false;
  // 本组没有打开批量填充；筛选分组也按生产缺省值显式提供，真实失效函数仍原样执行。
  const filterGroup: FilterGroup | undefined = undefined;
  const parent = createContext({ selectedFilterRef: { current: null }, tableStatisticsIntent: { current: null }, childReferenceIntent: { current: null }, batchFillIntent: { current: null }, copyReadIntent: { current: null }, invoke: vi.fn(async () => undefined), rowsRef: { current: [row, other] }, selectionRef: { current: { rowId: row.id, key: 'note' } }, record: { dirty: false, hasInput: () => input, formOpen: false }, blocked: false, page: { columns: keys.map(key => ({ key })) }, document: { querySelector: () => null }, setSelection: vi.fn(), getRecordContext: () => state, blockedRef: { current: false }, rootElement: { current: { querySelector: vi.fn(() => null) } }, recordReadonlyReason, recordTargetKey, recordViewZh, tableGridZh: text, applyPageReplacement, visibleKeys: keys, refreshVersion: 0, pageIndex: 1, pageSize: 100, sort: [], filters: [], filterMode: 'all', pageFindContext: { current: { values: [], generation: 0 } }, setRows: vi.fn(), setError: vi.fn() });
  parent.filterGroup = filterGroup;
  parent.setRows.mockImplementation((rows: DraftRow[]) => { parent.rowsRef.current = rows; }); runInContext(parentCode, parent);
  const timers: (() => void)[] = [], worker = vi.fn(async (request: PageFindRequest): Promise<PageFindResult> => request.operation === 'find' ? { status: 'ready', operation: 'find', matches: findPageCellsInWorker(request.rows, request.keys, request.options) } : { status: 'ready', operation: 'preview', preview: previewPageReplacementInWorker(request.rows, request.keys, request.options, request.replacement!, request.info!, request.generation, request.only) });
  const snapshot = { rows: parent.rowsRef.current, keys, info, generation: parent.pageFindGeneration(), options, disabled: false, replaceDisabled: false };
  const panel = createContext({ ...snapshot, snapshot, latest: { current: snapshot }, intentRevision: { current: 0 }, activeOptions: { current: options }, replacement: '新old', latestReplacement: { current: '新old' }, advance: { current: null }, previewSource: { current: null }, preview: null, applyLock: { current: false }, queryInput: { current: null }, singleLock: { current: false }, positionRef: { current: 1 }, workingRef: { current: false }, composingRef: { current: false }, requestSerial: { current: 0 }, autoTimer: { current: undefined }, client: { current: { run: worker, cancel: vi.fn(async () => undefined) } }, occurrences: pageOccurrences(findPageCellsInWorker(snapshot.rows, keys, options)), ownCell, pageReplaceWritable, pageOccurrences, nextPageOccurrenceAfterReplacement, tableCellKeyIsComposing, errorMessage, text, getSelectionToken: () => parent.selectionRef.current, onApply: vi.fn((plan: PageReplacement, only?: PageOccurrence, token?: unknown) => parent.applyPagePlan(plan, only, token)), onJump: vi.fn((rowId: string, key: string) => { parent.selectionRef.current = { rowId, key }; }), setPosition: vi.fn(), setWorking: vi.fn(), setComposing: vi.fn(), setReplacement: vi.fn(), setOptions: vi.fn(), setError: vi.fn(), setPreview: vi.fn(), setFound: vi.fn(), setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; }, clearTimeout: vi.fn() });
  panel.setFound.mockImplementation((value: { matches: Parameters<typeof pageOccurrences>[0] }) => { panel.occurrences = pageOccurrences(value.matches); }); runInContext(panelCode, panel);
  /** 模拟父组件把真实写入返回的同一rows引用和下一代传给面板，不伪造查找结果。 */
  function render(extra: Record<string, unknown> = {}) { const next = { ...panel.snapshot, rows: parent.rowsRef.current, generation: parent.pageFindGeneration(), ...extra }; Object.assign(panel, next); panel.snapshot = next; panel.latest.current = next; panel.activeOptions.current = next.options; panel.snapshotChanged(); }
  return { parent, panel, state, row, other, info, keys, worker, timers, render, input(value: boolean) { input = value; } };
}
/** 只刷新已经启动的Promise，不启动GUI或延时等待测试体。 */
async function flush() { for (let index = 0; index < 6; index++) await Promise.resolve(); }

describe('替换当前一次与匹配移动', () => {
  it('实际处理链只替换第二处，跳过新插入的old并保留其它草稿、original和精度', async () => {
    const f = fixture(); f.panel.replaceCurrent(); f.panel.replaceCurrent(); await flush(); expect(f.worker).toHaveBeenCalledTimes(1); expect(f.panel.onApply).toHaveBeenCalledTimes(1);
    const rows = f.parent.rowsRef.current as DraftRow[]; expect(rows[0].data.note).toBe('😀old前新old后old'); expect(rows[0].data.other).toBe('已有草稿'); expect(rows[0].data.nil).toBeNull(); expect(rows[0].data.bytes).toEqual({ type: 'binary', base64: '' }); expect(rows[0].data.amount).toBe('12345678901234567890.123456'); expect(rows[0].original).toBe(f.row.original); expect(rows[1]).toBe(f.other); expect(collectChanges(rows)[0]).toEqual({ kind: 'update', before: f.row.original, values: { note: '😀old前新old后old', other: '已有草稿' } });
    f.render(); await flush(); f.timers.at(-1)!(); await flush(); expect(f.panel.positionRef.current).toBe(2); expect(f.panel.occurrences[2]).toMatchObject({ rowId: f.row.id, range: { start: 11, end: 14 } }); expect(f.panel.onJump).toHaveBeenLastCalledWith(f.row.id, 'note', false);
  });
  it('空文字仅删除当前出现，末尾循环到首处；没有命中不产生位置', () => {
    const f = fixture(), selected = f.panel.occurrences[2] as PageOccurrence;
    const plan = previewPageReplacement(f.parent.rowsRef.current, f.keys, options, '', f.info, 1, selected), rows = applyPageReplacement(f.parent.rowsRef.current, plan, f.info, 1), matches = pageOccurrences(findPageCellsInWorker(rows, f.keys, options));
    expect(rows[0].data.note).toBe('😀old前old后'); expect(nextPageOccurrenceAfterReplacement(rows, f.keys, matches, selected, '')).toBe(2); expect(matches[2].rowId).toBe(f.other.id);
    expect(nextPageOccurrenceAfterReplacement(rows, f.keys, [], selected, '')).toBe(-1); expect(nextPageOccurrenceAfterReplacement(rows, [], matches, selected, '')).toBe(-1);
    expect(nextPageOccurrenceAfterReplacement(rows, f.keys, matches, { rowId: f.other.id, key: 'note', occurrence: 1, range: { start: 0, end: 3 } }, 'x')).toBe(0);
  });
  it('相邻出现不跳过，零宽不反复定位同一原边界；按可见列顺序跨格', () => {
    const f = fixture(), current: PageOccurrence = { rowId: f.row.id, key: 'note', occurrence: 1, range: { start: 0, end: 3 } };
    expect(nextPageOccurrenceAfterReplacement([f.row], ['note'], [{ ...current, range: { start: 1, end: 4 } }], current, 'x')).toBe(0);
    const matches = [{ ...current, range: { start: 1, end: 1 } }, { ...current, range: { start: 4, end: 4 } }]; expect(nextPageOccurrenceAfterReplacement([f.row], ['note'], matches, { ...current, range: { start: 0, end: 0 } }, 'x')).toBe(1);
    expect(nextPageOccurrenceAfterReplacement([f.row], ['other', 'note'], [{ ...current, key: 'other' }, current], { ...current, key: 'other' }, 'x')).toBe(1);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])('IME %j不导航或替换，普通Enter和Shift+Enter保留焦点', async nativeEvent => {
    const f = fixture(); const event = { key: 'Enter', nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() }; f.panel.inputKey(event, 'replacement'); f.panel.inputKey(event, 'query'); await flush(); expect(f.worker).not.toHaveBeenCalled(); expect(f.panel.onJump).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
    f.panel.inputKey({ ...event, nativeEvent: {}, shiftKey: true }, 'query'); expect(f.panel.positionRef.current).toBe(0); expect(f.panel.onJump).toHaveBeenLastCalledWith(f.row.id, 'note', false);
    f.panel.inputKey({ ...event, nativeEvent: {} }, 'query'); expect(f.panel.positionRef.current).toBe(1); f.panel.inputKey({ ...event, nativeEvent: {} }, 'replacement'); await flush(); expect(f.parent.rowsRef.current[0].data.note).toBe('😀old前新old后old');
  });
  it.each(['generated', 'amount', 'bytes', 'nil', 'readonly', 'no-info', 'disabled', 'composition', 'no-current'] as const)('%s当前目标不会回退成整格或整页替换', async condition => {
    const f = fixture(); if (condition === 'readonly') f.panel.replaceDisabled = true; else if (condition === 'no-info') f.panel.info = null; else if (condition === 'disabled') f.panel.disabled = true; else if (condition === 'composition') f.panel.composingRef.current = true; else if (condition === 'no-current') f.panel.positionRef.current = -1; else { f.panel.occurrences = [{ rowId: f.row.id, key: condition, occurrence: 1, range: { start: 0, end: 3 } }]; f.panel.positionRef.current = 0; }
    f.panel.replaceCurrent(); await flush(); expect(f.worker).not.toHaveBeenCalled(); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
  it.each(['new-snapshot', 'replacement', 'composition', 'cancel'] as const)('迟到预览遇到%s不写草稿', async condition => {
    const f = fixture(); let release!: (value: PageFindResult) => void; f.worker.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); f.panel.replaceCurrent(); expect(f.worker).toHaveBeenCalledTimes(1); const request = f.worker.mock.calls[0][0];
    if (condition === 'new-snapshot') f.panel.latest.current = { ...f.panel.snapshot }; else if (condition === 'replacement') f.panel.latestReplacement.current = '其它替换'; else if (condition === 'composition') f.panel.composingRef.current = true; else await f.panel.cancel();
    release({ status: 'ready', operation: 'preview', preview: previewPageReplacementInWorker(request.rows, request.keys, request.options, request.replacement!, request.info!, request.generation, request.only) }); await flush(); expect(f.panel.onApply).not.toHaveBeenCalled(); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
  it('本次写入以外的rows引用、代次或选项变化不能接续旧定位', async () => {
    for (const change of ['rows', 'generation', 'options']) { const f = fixture(); f.panel.replaceCurrent(); await flush(); const before = f.panel.advance.current; if (change === 'rows') f.parent.rowsRef.current = [...f.parent.rowsRef.current]; f.render(change === 'generation' ? { generation: before.source.generation + 2 } : change === 'options' ? { options: { ...options, query: '其它' } } : {}); await flush(); f.timers.at(-1)!(); await flush(); expect(f.panel.positionRef.current).toBe(-1); expect(f.panel.onJump).not.toHaveBeenCalled(); }
  });
});

describe('TableTab最终应用复用真实RecordContext和完整旧值', () => {
  it('同叶不同括号改变实际查找代次，恢复原分组也不能复活旧单处计划', () => {
    const f = fixture(), original: FilterGroup = { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] };
    const changed: FilterGroup = { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] };
    f.parent.filters = [{ column: 'id', operator: '>=', value: '1' }, { column: 'note', operator: 'LIKE', value: '%old%' }, { column: 'nil', operator: 'IS NULL' }];
    f.parent.filterGroup = original;
    const generation = f.parent.pageFindGeneration(), only = f.panel.occurrences[1] as PageOccurrence, token = f.parent.selectionRef.current;
    const plan = previewPageReplacement(f.parent.rowsRef.current, f.keys, options, '新', f.info, generation, only);
    f.parent.filterGroup = changed;
    expect(f.parent.pageFindGeneration()).toBeGreaterThan(generation);
    expect(() => f.parent.applyPagePlan(plan, only, token)).toThrow();
    f.parent.filterGroup = original;
    expect(f.parent.pageFindGeneration()).toBeGreaterThan(generation + 1);
    expect(() => f.parent.applyPagePlan(plan, only, token)).toThrow();
    expect(f.parent.setRows).not.toHaveBeenCalled(); expect(f.parent.rowsRef.current[0]).toBe(f.row); expect(f.row.data.note).toBe('😀old前old后old');
  });
  it('切换选择执行真实来源失效函数，恢复坐标也只请求一次取消', () => {
    const f = fixture(), intent = { taskId: 'copy-source-task', invalidated: false, consumed: false, cancelSent: false }; f.parent.copyReadIntent.current = intent;
    f.parent.selectCurrentCell(f.other, 'note'); f.parent.selectCurrentCell(f.row, 'note');
    expect(intent.invalidated).toBe(true); expect(intent.cancelSent).toBe(true); expect(f.parent.invoke).toHaveBeenCalledExactlyOnceWith('query.cancel', { taskId: intent.taskId }); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
  it('网格取消选择同步撤销令牌，无需等待React渲染', () => {
    const f = fixture(), only = f.panel.occurrences[1] as PageOccurrence, token = f.parent.selectionRef.current, plan = previewPageReplacement(f.parent.rowsRef.current, f.keys, options, '新', f.info, f.parent.pageFindGeneration(), only);
    f.parent.selectCurrentCell(undefined, undefined);
    expect(f.parent.selectionRef.current).toBeUndefined(); expect(() => f.parent.applyPagePlan(plan, only, token)).toThrow(); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
  it('当前选择离开后恢复同一坐标，也不能沿用旧选择对象授权', () => {
    const f = fixture(), only = f.panel.occurrences[1] as PageOccurrence, token = f.parent.selectionRef.current, plan = previewPageReplacement(f.parent.rowsRef.current, f.keys, options, '新', f.info, f.parent.pageFindGeneration(), only);
    f.parent.selectCurrentCell(f.other, 'note'); f.parent.selectCurrentCell(f.row, 'note');
    expect(() => f.parent.applyPagePlan(plan, only, token)).toThrow(); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
  it.each(['stale', 'busy', 'blocked', 'grid-input', 'not-loaded', 'no-info', 'unknown', 'view', 'no-key', 'non-InnoDB', 'generated', 'no-column', 'hidden', 'deleted', 'input', 'dirty', 'revision', 'target', 'page-generation', 'row-replaced', 'old-original', 'binary'] as const)('%s同步变化拒绝旧单处计划', condition => {
    const f = fixture(), plan = previewPageReplacement(f.parent.rowsRef.current, f.keys, options, '新', f.info, f.parent.pageFindGeneration(), f.panel.occurrences[1]);
    if (condition === 'stale') f.state.stale = true; else if (condition === 'busy') f.state.busy = true; else if (condition === 'blocked') f.parent.blockedRef.current = true; else if (condition === 'grid-input') f.parent.rootElement.current.querySelector.mockReturnValue({}); else if (condition === 'not-loaded') f.state.loaded = false; else if (condition === 'no-info') f.state.info = null; else if (condition === 'unknown') f.info.objectKind = undefined; else if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'no-key') f.info.editableKey = []; else if (condition === 'non-InnoDB') f.info.engine = 'MyISAM'; else if (condition === 'generated') f.info.columns.find(item => item.name === 'note')!.generated = true; else if (condition === 'no-column') f.info.columns = f.info.columns.filter(item => item.name !== 'note'); else if (condition === 'hidden') f.parent.visibleKeys = ['other']; else if (condition === 'deleted') f.row.deleted = true; else if (condition === 'input') f.input(true); else if (condition === 'dirty') f.parent.record.dirty = true; else if (condition === 'revision') f.state.connectionVersion++; else if (condition === 'target') f.state.target = { ...f.state.target, table: '其它表' }; else if (condition === 'page-generation') f.state.generation++; else if (condition === 'row-replaced') f.parent.rowsRef.current = [f.other]; else if (condition === 'old-original') f.row.original = { ...f.row.original, amount: '已变化' }; else f.row.data.note = { type: 'binary', base64: 'b2xk' };
    expect(() => f.parent.applyPagePlan(plan)).toThrow(); expect(f.parent.setRows).not.toHaveBeenCalled();
  });
});
