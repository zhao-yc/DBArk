import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { RecordPageNavigation, recordPageScope } from '../../src/renderer/recordPageNavigation';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { maxTablePage } from '../../src/renderer/tableFilters';
import { duplicateRecordDraft, recordDuplicateReadonlyReason } from '../../src/renderer/recordDuplicate';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import type { TableInfo } from '../../src/shared/contracts';
import { recordCopyMetadataReason, recordCopySourceReady } from '../../src/renderer/recordCopySource';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { recordTargetKey } from '../../src/renderer/recordViews';
import { recordCopySourceZh } from '../../src/renderer/locales/recordCopySource.zh-CN';

const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map<string, string>(), attributes = new Map<string, string>(), buttons = new Map<string, string>();
let load = '', consume = '', blocked = '';
/** 按 AST 提取合并后的真实函数和接线；只替换组件 setter、DOM 存在性和 IPC 返回时机。 */
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(tree) === 'load' && node.initializer && ts.isCallExpression(node.initializer)) load = node.initializer.arguments[0].getText(tree);
    if (node.name.getText(tree) === 'blocked') blocked = node.initializer!.getText(tree);
  }
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useLayoutEffect' && node.arguments[0]?.getText(tree).includes('recordPages.consume')) consume = node.arguments[0].getText(tree);
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const props = new Map<string, string>();
    for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) props.set(attribute.name.getText(tree), attribute.initializer.expression.getText(tree));
    const tag = node.tagName.getText(tree);
    if (['DataGrid', 'PageFindPanel', 'RecordFormPanel'].includes(tag)) for (const [name, value] of props) attributes.set(`${tag}_${name}`, value);
    if (tag === 'button' && /^onTable(?:Rename|AutoIncrement|Comment|DefaultEncoding)$/.test(props.get('onClick') ?? '')) buttons.set(props.get('onClick')!, props.get('disabled')!);
  }
  ts.forEachChild(node, visit);
}
visit(tree);

/** 使用实际导航 helper 和生产 TableTab 方法，不另写一套跨页或选择令牌判断。 */
function fixture() {
  const rows = [{ id: '原页本地UUID', data: { id: '50', text: '原值' }, original: { id: '50', text: '原值' }, inserted: false, deleted: false }];
  const base = { connectionId: '连接', database: '库', table: '表' }, tab = { id: '活动页', ...base };
  const value = { target: base, connectionVersion: 4, refreshVersion: 2, pageSize: 50, filters: [{ column: 'id', operator: '>=', value: '1' }], filterMode: 'all', sort: [{ column: 'id', direction: 'ASC' }] };
  const workspace = { settings: { tabs: [tab], activeTabId: tab.id }, connectionVersions: { [base.connectionId]: 4 }, setBusy: vi.fn() };
  const gate = new RecordPageNavigation(), reset = vi.fn(), select = vi.fn((_: string, activate: () => void) => { activate(); return true; });
  let sequence = 0;
  const context = createContext({
    RecordPageNavigation, recordPageScope, recordViewZh, tableGridZh, maxTablePage, structuredClone, base, tab,
    ...value, pageIndex: 1, rows, rowsRef: { current: rows }, page: { hasMore: true, columns: [{ key: 'id' }, { key: 'text' }] }, info: { objectKind: 'table', columns: [{ name: 'id' }, { name: 'text' }] },
    useWorkspace: { getState: () => workspace }, recordPages: gate, recordPageScopeRef: { current: { value, page: 1 } }, loadGeneration: { current: 10 },
    record: { draft: { rowId: rows[0].id }, formOpen: true, dirty: false, hasInput: vi.fn(() => false), reset, select }, recordControllerRef: { current: { formOpen: true, hasInput: () => false, reset } }, recordContextRef: { current: { stale: false } },
    selectionRef: { current: { rowId: rows[0].id, key: 'text' } }, selection: { rowId: rows[0].id, key: 'text' }, visibleKeys: ['id', 'text'], selectedRows: new Set([rows[0].id]),
    busy: false, referenceBusy: false, applying: false, preferencesPending: false, previewing: false, preview: null, blocked: false, blockedRef: { current: false }, showPreferences: false, copyPending: false,
    rootElement: { current: { querySelector: vi.fn(() => null) } }, document: { querySelector: vi.fn(() => null) }, window: { confirm: vi.fn(() => true) }, referenceCount: { current: 0 }, referenceDialog: null,
    loadingCount: { current: 0 }, applyingRef: { current: false }, preferencesLock: { current: false },
    // D02复制状态是实际load的新依赖；保留D04原断言，补齐组合后的真实端口。
    copiedDraftIds: { current: new Set<string>() }, setDuplicateNotice: vi.fn(), duplicateRecordDraft, recordDuplicateZh,
    // 来源租约、失效和释放使用真实生产方法，IO保持在本地端口。
    copyPendingRef: { current: false }, copyReadIntent: { current: null }, copyPageTask: { current: undefined }, copySources: { current: null }, copyRowRefs: { current: new Map() }, copyPage: { current: null }, mounted: { current: true },
    recordCopyMetadataReason, recordCopySourceReady, recordDuplicateReadonlyReason, recordTargetKey, recordCopySourceZh, setCopyPending: vi.fn(),
    grid: { current: { scrollToCell: vi.fn(), setActivePosition: vi.fn() } }, handleGridKeyDown: vi.fn(), restoreGridFocus: vi.fn(),
    uid: () => `新页本地UUID-${++sequence}`, errorMessage: String, formatText: (text: string, page: number) => text.replace('{0}', String(page)),
    invoke: vi.fn(async (command: string, input: { page?: number }) => command === 'metadata.table' ? { objectKind: 'table', columns: [] } : command === 'table.page' ? { page: input.page, pageSize: 50, hasMore: input.page === 1, rows: [{ id: input.page === 2 ? '51' : '49', text: '新值一' }, ...(input.page === 1 ? [{ id: '50', text: '新值末' }] : [])] } : undefined),
    assertGridWritable: vi.fn(), getRecordContext: () => ({ info: {} }), recordReadonlyReason: () => undefined, pageFindGeneration: () => 1,
    applyPageReplacement: vi.fn(), collectChanges: vi.fn(() => []),
    setError: vi.fn(), setInfo: vi.fn(), setExternalStale: vi.fn(), setRecordPageMessage: vi.fn(),
  });
  context.setBusy = vi.fn((value: boolean) => { context.busy = value; context.blocked = !!runInContext(blocked, context); context.blockedRef.current = context.blocked; });
  context.setRows = vi.fn((rows: unknown[]) => { context.rows = rows; context.rowsRef.current = rows; });
  context.setPage = vi.fn((page: unknown) => { context.page = page; });
  context.setSelectedRows = vi.fn((rows: unknown) => { context.selectedRows = rows; });
  context.setSelection = vi.fn((selection: unknown) => { context.selection = typeof selection === 'function' ? selection(context.selection) : selection; });
  context.setPageIndex = vi.fn((index: number) => { context.pageIndex = index; context.recordPageScopeRef.current.page = index; });
  const names = ['getRecordPageContext', 'navigateRecordPage', 'jumpToMatch', 'selectCurrentCell', 'applyPagePlan', 'canReload', 'duplicateCurrentRow', 'invalidateCopyRead', 'releaseCopySources'];
  if (names.some(name => !functions.has(name)) || !load || !consume || !blocked || buttons.size !== 4) throw Error('缺少生产跨页或原有工具接线');
  const declarations = names.map(name => functions.get(name)).join('\n') + '\n' + names.map(name => `globalThis.${name}=${name};`).join('\n');
  const expressions = ['DataGrid_onCellClick', 'DataGrid_onCellKeyDown', 'PageFindPanel_getSelectionToken'];
  for (const name of expressions) if (!attributes.has(name)) throw Error('缺少生产属性：' + name);
  const script = declarations + `\nglobalThis.load=${load};globalThis.consume=${consume};\n` + expressions.map(name => `globalThis.${name}=${attributes.get(name)};`).join('\n');
  runInContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, gate, workspace, rows, reset, select, navigate: (direction: -1 | 1 = 1) => context.navigateRecordPage(direction), load: () => context.load() as Promise<void>, consume: () => context.consume() };
}

describe('D04与现有TableTab工具的混合正负向接线', () => {
  it('D02复制形成整页草稿后，D04拒绝跨页且保留复制身份、活动选择和原行', () => {
    const f = fixture(), c = f.context, token = c.selectionRef.current, original = structuredClone(f.rows[0]);
    const info: TableInfo = { database: c.base.database, name: c.base.table, objectKind: 'table', engine: 'InnoDB',
      columns: [{ name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: 'auto_increment', generated: false, comment: '' }, { name: 'text', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' }],
      primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '' };
    c.getRecordContext = () => ({ target: c.base, info, loaded: true, busy: c.blockedRef.current, stale: false, connectionVersion: 4, generation: c.loadGeneration.current });
    c.copyPage.current = { page: { copyMetadataKey: tableCopyMetadataKey(info) }, target: recordTargetKey(c.base), connectionVersion: 4, generation: c.loadGeneration.current };
    c.duplicateCurrentRow();
    const copied = c.rowsRef.current[1];
    expect(c.rowsRef.current[0]).toEqual(original); expect(copied).toMatchObject({ inserted: true, deleted: false, data: { text: '原值' } });
    expect(Object.hasOwn(copied.data, 'id')).toBe(false); expect(c.copiedDraftIds.current.has(copied.id)).toBe(true);
    expect(c.selectionRef.current).toBe(token); expect(c.setDuplicateNotice).toHaveBeenCalledWith(recordDuplicateZh.staged);
    f.navigate();
    expect(c.setRecordPageMessage).toHaveBeenLastCalledWith({ revision: f.gate.revision, text: recordViewZh.pageDirty });
    expect(c.rowsRef.current).toHaveLength(2); expect(c.selectionRef.current).toBe(token); expect(c.setPageIndex).not.toHaveBeenCalled();
    expect(c.invoke).not.toHaveBeenCalled(); expect(c.window.confirm).not.toHaveBeenCalled();
  });
  it('跨页成功加载同时重置D02复制状态并完成D04真实目标选择', async () => {
    const f = fixture(), c = f.context; c.copiedDraftIds.current.add('之前已结束的复制草稿');
    f.navigate(); await f.load(); f.consume();
    expect(c.copiedDraftIds.current.size).toBe(0); expect(c.setDuplicateNotice).toHaveBeenCalledWith('');
    expect(c.selectionRef.current).toEqual({ rowId: '新页本地UUID-2', key: 'text' }); expect(f.gate.pending).toBe(false);
    expect(c.invoke.mock.calls.every(([command]: [string]) => ['connections.open', 'metadata.table', 'table.page'].includes(command))).toBe(true);
  });
  it('正反跨页只走原load，按新页真实UUID选择首末行，保留筛选排序且不写数据库', async () => {
    const f = fixture(), c = f.context;
    f.navigate(); expect(c.selectionRef.current).toBeUndefined(); expect(c.rowsRef.current).toHaveLength(0); expect(c.blockedRef.current).toBe(true);
    f.navigate(); expect(c.setPageIndex).toHaveBeenCalledOnce();
    await f.load(); f.consume();
    expect(c.selectionRef.current).toEqual({ rowId: '新页本地UUID-2', key: 'text' }); expect(f.select).toHaveBeenCalledWith('新页本地UUID-2', expect.any(Function));
    c.record.draft = { rowId: '新页本地UUID-2' };
    f.navigate(-1); await f.load(); f.consume();
    expect(c.selectionRef.current).toEqual({ rowId: '新页本地UUID-5', key: 'text' });
    const calls = c.invoke.mock.calls;
    expect(calls.map((call: unknown[]) => call[0])).toEqual(['connections.open', 'metadata.table', 'table.page', 'connections.open', 'metadata.table', 'table.page']);
    expect(calls.filter((call: unknown[]) => call[0] === 'table.page').map((call: [string, object]) => call[1])).toEqual([2, 1].map(page => ({ ...c.base, page, pageSize: 50, filters: c.filters, filterMode: 'all', sort: c.sort, copySource: true, taskId: page === 2 ? '新页本地UUID-1' : '新页本地UUID-3' })));
    expect(c.window.confirm).not.toHaveBeenCalled(); expect(c.applyPageReplacement).not.toHaveBeenCalled();
  });
  it.each(['previewing', 'preview', 'busy', 'referenceBusy', 'applying', 'preferencesPending', '布局面板', '模态', '外键读取'])('%s阻止跨页且四种表工具维持独立busy保护', kind => {
    const f = fixture(), c = f.context;
    if (kind === '布局面板') c.showPreferences = true;
    else if (kind === '模态') c.document.querySelector.mockReturnValue({});
    else if (kind === '外键读取') c.referenceCount.current = 1;
    else { c[kind] = kind === 'preview' ? {} : true; c.blocked = !!runInContext(blocked, c); c.blockedRef.current = c.blocked; }
    const token = c.selectionRef.current; f.navigate();
    expect(c.rowsRef.current).toBe(f.rows); expect(c.selectionRef.current).toBe(token); expect(f.reset).not.toHaveBeenCalled(); expect(c.setPageIndex).not.toHaveBeenCalled(); expect(c.invoke).not.toHaveBeenCalled();
    for (const expression of buttons.values()) expect(runInContext(expression, c)).toBe(c.blocked);
  });
  it('正常表允许四种工具入口，跨页同步busy后全部禁用，视图始终禁用', () => {
    const f = fixture(), c = f.context;
    for (const expression of buttons.values()) expect(runInContext(expression, c)).toBe(false);
    f.navigate(); for (const expression of buttons.values()) expect(runInContext(expression, c)).toBe(true);
    c.blocked = false; c.info.objectKind = 'view'; for (const expression of buttons.values()) expect(runInContext(expression, c)).toBe(true);
  });
  it.each(['记录输入', '网格输入', '非当前行草稿', '新增', '删除'])('%s阻止跨页且不确认放弃或清理输入、选择与草稿', kind => {
    const f = fixture(), c = f.context;
    if (kind === '记录输入') c.record.hasInput.mockReturnValue(true);
    else if (kind === '网格输入') c.rootElement.current.querySelector.mockReturnValue({ value: '{' });
    else if (kind === '非当前行草稿') f.rows.unshift({ ...f.rows[0], id: '非当前行', data: { id: '1', text: '待提交' } });
    else if (kind === '新增') f.rows[0].inserted = true;
    else f.rows[0].deleted = true;
    const token = c.selectionRef.current, snapshot = JSON.stringify(f.rows); f.navigate();
    expect(c.rowsRef.current).toBe(f.rows); expect(JSON.stringify(f.rows)).toBe(snapshot); expect(c.selectionRef.current).toBe(token);
    expect(c.setRecordPageMessage).toHaveBeenCalledWith({ revision: f.gate.revision, text: recordViewZh.pageDirty });
    expect(f.reset).not.toHaveBeenCalled(); expect(c.setPageIndex).not.toHaveBeenCalled(); expect(c.window.confirm).not.toHaveBeenCalled(); expect(c.invoke).not.toHaveBeenCalled();
  });
  it('跨页清除同步选择令牌，迟到的单处替换不能写到新页', async () => {
    const f = fixture(), c = f.context, token = c.PageFindPanel_getSelectionToken(), only = { rowId: f.rows[0].id, key: 'text' }, plan = { patches: [only] };
    f.navigate(); expect(c.PageFindPanel_getSelectionToken()).toBeUndefined();
    expect(() => c.applyPagePlan(plan, only, token)).toThrow(tableGridZh.changed);
    await f.load(); f.consume(); expect(c.PageFindPanel_getSelectionToken()).not.toBe(token);
    expect(() => c.applyPagePlan(plan, only, token)).toThrow(tableGridZh.changed); expect(c.applyPageReplacement).not.toHaveBeenCalled();
  });
  it('网格点击与键盘先取消跨页意图，再保留原选择令牌和键盘委派', () => {
    const f = fixture(), c = f.context;
    const result = f.gate.begin(c.getRecordPageContext(), { rows: f.rows, rowId: f.rows[0].id, key: 'text', direction: 1, hasMore: true, busy: false, inputDirty: false });
    expect(result.kind).toBe('ready');
    c.DataGrid_onCellClick({ row: f.rows[0], column: { key: 'text' } }); expect(f.gate.pending).toBe(false);
    expect(c.selectionRef.current).toEqual({ rowId: f.rows[0].id, key: 'text' });
    const args = { marker: '原键盘参数' }, event = { marker: '原事件' }; c.DataGrid_onCellKeyDown(args, event);
    expect(c.handleGridKeyDown).toHaveBeenCalledExactlyOnceWith(args, event);
    expect(f.select).toHaveBeenCalledWith(f.rows[0].id, expect.any(Function));
  });
  it.each(['空页', '读取失败', '错误页码'])('%s沿用实际load清空旧展示和选择，不自动寻找或重试', async kind => {
    const f = fixture(), c = f.context;
    c.invoke.mockImplementation(async (command: string) => {
      if (command === 'table.page') { if (kind === '读取失败') throw Error('固定读取失败'); return { page: kind === '错误页码' ? 3 : 2, pageSize: 50, rows: [] }; }
      return command === 'metadata.table' ? { columns: [] } : undefined;
    });
    f.navigate(); await f.load(); f.consume();
    expect(c.rowsRef.current).toHaveLength(0); expect(c.selectionRef.current).toBeUndefined(); expect(f.select).not.toHaveBeenCalled(); expect(f.gate.pending).toBe(false); expect(c.invoke).toHaveBeenCalledTimes(3);
    expect(c.setRecordPageMessage).toHaveBeenLastCalledWith({ revision: expect.any(Number), text: (kind === '空页' ? recordViewZh.pageEmpty : recordViewZh.pageFailed).replace('{0}', '2') });
    if (kind === '错误页码') expect(c.setError).toHaveBeenCalledWith(expect.stringContaining(recordViewZh.pageChanged));
  });
  it.each(['连接修订', '结构刷新', '切换标签', '关闭表单', '失效'])('%s在迟到真实方法回调前撤销意图，恢复条件也不选旧行', async kind => {
    const f = fixture(), c = f.context;
    let release!: (value: unknown) => void;
    const response = new Promise(resolve => { release = resolve; });
    c.invoke.mockImplementation(async (command: string) => command === 'table.page' ? response : command === 'metadata.table' ? { columns: [] } : undefined);
    f.navigate(); const loading = f.load(); await Promise.resolve();
    if (kind === '连接修订') f.workspace.connectionVersions['连接']++;
    else if (kind === '结构刷新') c.recordPageScopeRef.current.value.refreshVersion++;
    else if (kind === '切换标签') f.workspace.settings.activeTabId = '其它页';
    else if (kind === '关闭表单') c.recordControllerRef.current.formOpen = false;
    else c.recordContextRef.current.stale = true;
    f.gate.observe(c.getRecordPageContext());
    f.workspace.connectionVersions['连接'] = 4; c.recordPageScopeRef.current.value.refreshVersion = 2; f.workspace.settings.activeTabId = c.tab.id; c.recordControllerRef.current.formOpen = true; c.recordContextRef.current.stale = false;
    release({ page: 2, pageSize: 50, rows: [{ id: '51', text: '迟到结果' }] }); await loading; f.consume();
    expect(f.select).not.toHaveBeenCalled(); expect(c.selectionRef.current).toBeUndefined(); expect(f.gate.pending).toBe(false);
  });
  it('普通刷新仍保留草稿确认守卫，拒绝后保留跨页意图，接受后才取消并重置', () => {
    const f = fixture(), c = f.context;
    f.gate.begin(c.getRecordPageContext(), { rows: f.rows, rowId: f.rows[0].id, key: 'text', direction: 1, hasMore: true, busy: false, inputDirty: false });
    c.record.hasInput.mockReturnValue(true); c.window.confirm.mockReturnValue(false);
    expect(c.canReload()).toBe(false); expect(f.gate.pending).toBe(true); expect(f.reset).not.toHaveBeenCalled();
    c.window.confirm.mockReturnValue(true); expect(c.canReload()).toBe(true); expect(f.gate.pending).toBe(false); expect(f.reset).toHaveBeenCalledOnce();
  });
});
