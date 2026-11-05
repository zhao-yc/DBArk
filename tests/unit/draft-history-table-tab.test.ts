import { tableEditWorkspaceZh as workspaceText } from '../../src/renderer/locales/tableEditWorkspace.zh-CN';
import { randomUUID } from 'node:crypto';
import { emptyTableApplyEvidence } from '../../src/shared/tableApplyReceipt';
import { tableApplyRecoveryZh as recoveryText } from '../../src/renderer/locales/tableApplyRecovery.zh-CN';
import { navigationMenuVmPort, navigationToolbarVmChildren } from '../helpers/sidebarMenuRamPort';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import * as zod from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as recordTemplates from '../../src/renderer/recordTemplates';
afterEach(() => vi.unstubAllGlobals());
import * as lib from '../../src/renderer/lib';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import type { TableInfo } from '../../src/shared/contracts';
import { draftHistoryZh as text } from '../../src/renderer/locales/draftHistory.zh-CN';
import { recordTemplatesZh } from '../../src/renderer/locales/recordTemplates.zh-CN';
import { pasteInsertZh } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { createStore } from 'zustand/vanilla';

type Element = { type: unknown; props: Record<string, any> };
const renderer = fileURLToPath(new URL('../../src/renderer', import.meta.url)), compiled = new Map<string, string>();
/** 执行完整生产TableTab与真实useRecordViews/helper，React调度、DOM和IPC仅替换成RAM端口。 */
async function fixture(options: { batch?: boolean; plainKey?: boolean; lease?: boolean; pages?: boolean } = {}) {
  const slots: any[] = []; let cursor = 0, dirty = false, tree: Element, dialog = false, editor = false, counter = 0;
  const effects: (() => void)[] = [];
  const equal = (a: any[], b: any[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: any) { const index = cursor++; if (!Object.hasOwn(slots, index)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value: any) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial: any) { const index = cursor++; if (!Object.hasOwn(slots, index)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(fn: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useCallback(fn: () => any, deps: any[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || !equal(slots[index].deps, deps)) { const prior = slots[index]; const current = { deps, cleanup: undefined as any }; slots[index] = current; effects.push(() => { prior?.cleanup?.(); current.cleanup = fn(); }); } },
    useLayoutEffect(fn: () => any, deps: any[]) { hooks.useEffect(fn, deps); }
  };
  class Node {
    constructor(private kind = 'grid') {}
    closest(selector: string) { if (selector === '[role="grid"]') return this.kind === 'grid' ? this : null; if (selector === '.grid-input') return this.kind === 'editor' ? this : null; return this.kind === 'input' || this.kind === 'editor' || this.kind === 'monaco' ? this : null; }
    querySelector(selector: string) { return selector === '.grid-input' && editor ? {} : null; }
  }
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'note', 'bytes', 'doc'].map(name => ({ name, type: name === 'bytes' ? 'blob' : 'text', nullable: true, defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const tab = { id: '表页', kind: 'table', connectionId: '连接', database: 'db', table: 'items' };
  const workspaceSeed = { settings: { activeTabId: tab.id, tabs: [tab], pageSize: 50, theme: 'dark' }, connections: [{ id: '连接', name: '合成连接' }], connectionVersions: { 连接: 1 }, activeJobs: {} as Record<string, boolean>, setDirty: vi.fn(), setBusy: vi.fn(), setTableLayoutDraft: vi.fn(), notify: vi.fn(), updateSettings: vi.fn() };
  const stateApi = createStore<typeof workspaceSeed>(() => workspaceSeed);
  // 保留旧例直接赋值的端口，但经真实Zustand setState发布不可变前后态，ABA不能等到render才观察。
  const workspace = new Proxy(workspaceSeed, {
    get(_target, key, receiver) {
      const current = stateApi.getState();
      if (key === 'settings' || key === 'connectionVersions' || key === 'activeJobs') return new Proxy(current[key], {
        set(_branch, property, value) { stateApi.setState(state => ({ [key]: { ...state[key], [property]: value } } as Partial<typeof workspaceSeed>)); return true; }
      });
      return Reflect.get(current, key, receiver);
    },
    set(_target, key, value) { stateApi.setState({ [key]: value } as Partial<typeof workspaceSeed>); return true; }
  });
  const source = { id: '18446744073709551615', note: '原值', bytes: { type: 'binary', base64: 'AAH/' }, doc: '{"x":1,"x":-0,"n":9007199254740993}' };
  if (options.plainKey) info.columns[0].extra = '';
  const sourceRows = options.batch || options.pages ? [source, { ...source, id: '18446744073709551614', note: '' }] : [source];
  const pageSource = { status: 'ready', pageRef: 'RAM页引用', rowRefs: ['RAM行1', 'RAM行2'], expiresAt: Date.now() + 60_000, metadataKey: tableCopyMetadataKey(info), missingColumns: [] as string[] };
  let failApply = false;
  // IPC端口按command返回异构合同，异常场景可独立注入真实回执或读取失败。
  const invoke = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'metadata.table') return info;
    if (command === 'table.page') return { page: input.page, pageSize: input.pageSize, hasMore: options.pages ? input.page < 2 : true, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), rows: structuredClone(options.pages && input.page !== 1 ? input.page === 2 ? [{ ...source, id: '18446744073709551613', note: '第三行' }] : [] : sourceRows), copyMetadataKey: tableCopyMetadataKey(info), ...(options.batch && options.lease ? { copySource: pageSource } : {}) };
    if (command === 'table.preview') return { sql: '仅RAM模拟预览', previewId: 'c64d7916-1111-4111-8111-111111111111', statements: input.changes.map(() => ({ sql: 'RAM', params: [] })), warnings: [] };
    if (command === 'table.applyReceipt.list') return { items: [], total: 0, page: 0 };
    if (command === 'table.apply') { if (failApply) throw Error('合成执行结果未知'); return { affectedRows: 1 }; }
    if (command === 'table.preferences.get' || command === 'connections.open') return null;
    throw Error('未授权的RAM端口：' + command);
  });
  const store = Object.assign((selector: (value: any) => any) => selector(stateApi.getState()), stateApi);
  const documentPort = { querySelector: () => dialog ? {} : null, querySelectorAll: () => [] }; vi.stubGlobal('document', documentPort);
  const confirm = vi.fn(() => true); let taskListener: ((event: any) => void) | undefined;
  const context = createContext({ Error, Object, structuredClone, HTMLElement: Node, TextEncoder, TextDecoder, URL, atob, btoa, document: documentPort, window: { confirm, dbark: { onTask: (listener: (event: any) => void) => { taskListener = listener; return () => { taskListener = undefined; }; } } } });
  const modules = new Map<string, { exports: any }>();
  function load(file: string): any {
    file = path.resolve(file); if (modules.has(file)) return modules.get(file)!.exports;
    const module = { exports: {} as any }; modules.set(file, module);
    if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText);
    runInContext('(function(require,module,exports){' + compiled.get(file) + '\n})', context)((name: string) => {
      if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'zod') return zod;
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      if (name === 'react-data-grid') return { DataGrid: 'DataGrid', SelectColumn: { key: 'select-row' } };
      if (name.endsWith('.css')) return {};
      const target = path.resolve(path.dirname(file), name);
      if (target === path.join(renderer, 'recordTemplates')) return recordTemplates;
      if (target === path.join(renderer, 'store')) return { useWorkspace: store };
      if (target === path.join(renderer, 'uiCommands')) return navigationMenuVmPort;
      if (target === path.join(renderer, 'lib')) return { ...lib, invoke, uid: vi.fn(() => 'UUID-' + ++counter) };
      if (target.startsWith(path.join(renderer, 'components') + path.sep)) return new Proxy({}, { get: (_, key) => String(key) });
      for (const extension of ['.ts', '.tsx']) if (existsSync(target + extension)) return load(target + extension);
      throw Error('纯组件不允许未知依赖：' + name);
    }, module, module.exports);
    return module.exports;
  }
  const component = load(path.join(renderer, 'components/TableTab.tsx')).TableTab;
  const props = { tab, refreshVersion: 0, onDesign: vi.fn(), onTransfer: vi.fn(), onColumnPatches: vi.fn(), onIndexPatches: vi.fn(), onForeignKeyPatches: vi.fn(), onTableRename: vi.fn(), onTableAutoIncrement: vi.fn(), onTableComment: vi.fn(), onTableDefaultEncoding: vi.fn() };
  function all(type: unknown) { const found: Element[] = []; function walk(value: any) { if (Array.isArray(value)) value.forEach(walk); else if (value?.props) { if (value.type === type) found.push(value); walk(navigationToolbarVmChildren(value)); walk(value.props.children); } } walk(tree); return found; }
  async function render() {
    for (let round = 0; round < 40; round++) {
      cursor = 0; dirty = false; tree = component(props);
      tree.props.ref.current = new Node(); const grid = all('DataGrid')[0]; if (grid) grid.props.ref.current = { setActivePosition: vi.fn(), scrollToCell: vi.fn() };
      while (effects.length) effects.shift()!();
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
      if (!dirty && !effects.length) return;
    }
    throw Error('组件RAM调度未稳定');
  }
  function button(label: string) { const button = all('button').find(element => element.props['aria-label'] === label || element.props.children === label || Array.isArray(element.props.children) && element.props.children.includes(label)); if (!button) throw Error('缺少按钮：' + label); return button; }
  const grid = () => all('DataGrid')[0].props;
  const record = () => all('RecordEditorDialogs')[0].props.editor;
  async function click(label: string) { const found = button(label); expect(found.props.disabled).not.toBe(true); await found.props.onClick(); await render(); }
  async function change(value: string) { const rows = grid().rows; grid().onRowsChange(rows.map((row: any, index: number) => index ? row : { ...row, data: { ...row.data, note: value } })); await render(); }
  async function press(key: string, patch: Record<string, any> = {}, kind = 'grid', mode = 'ACTIVE') {
    const event = { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, nativeEvent: {}, target: new Node(kind), preventGridDefault: vi.fn(), preventDefault: vi.fn(), ...patch };
    grid().onCellKeyDown({ mode, row: grid().rows[0], column: { key: 'note' } }, event); await render(); return event;
  }
  await render(); expect(grid().rows).toHaveLength(options.batch || options.pages ? 2 : 1);
  return { confirm, emitTask: (event: any) => taskListener?.(event), render, click, change, press, grid, record, button, all, props, workspace, store, invoke, info, pageSource, preparePasteInsert: load(path.join(renderer, 'pasteInsert.ts')).preparePasteInsert, editor(value: boolean) { editor = value; }, modal(value: boolean) { dialog = value; }, failApply() { failApply = true; } };
}

/** 使用真实回执合同，只将Main/数据库I/O替换为RAM端口。 */
function recoveryReceipt(input: any, outcome: 'committed' | 'rolled-back' | 'not-sent') {
  return { version: 1, operationId: randomUUID(), taskId: input.taskId, previewId: input.previewId,
    target: { connectionId: input.connectionId, database: input.database, table: input.table, connectionRevision: 99 },
    intent: { insert: 0, update: input.changes.length, delete: 0, statementCount: input.changes.length }, startedAt: '2026-11-05T00:00:00.000Z', finishedAt: '2026-11-05T00:00:01.000Z',
    phase: 'terminal', outcome, reason: outcome === 'committed' ? 'none' : 'validation', sequence: 3, scope: 'target-transaction-only', committedReportedRows: outcome === 'committed' ? input.changes.length : 0,
    evidence: { ...emptyTableApplyEvidence(), ...(outcome === 'not-sent' ? {} : { dmlMayHaveBeenSent: true, dmlAcknowledged: input.changes.length, serverReportedRows: input.changes.length, transactionProtected: true, transactionKnown: true }),
      ...(outcome === 'committed' ? { commitMayHaveBeenSent: true, commitAcknowledged: true } : outcome === 'rolled-back' ? { rollbackAcknowledged: true } : {}) } };
}

describe('完整TableTab多页草稿工作区', () => {
  it('切走标签后的旧表单跨页回调不暂存隐藏输入，不消费原输入或读取新页', async () => {
    const f = await fixture({ pages: true }), row = f.grid().rows[1]; f.grid().onCellClick({ row, column: { key: 'note' } }); f.record().openForm(row.id); await f.render();
    f.record().expand('note'); await f.render(); f.record().change('note', { mode: 'text', text: '尚未暂存' }); await f.render(); expect(f.record().hasInput()).toBe(true);
    const oldNavigate = f.all('RecordFormPanel')[0].props.pageNavigation.onNavigate, before = f.grid().rows, calls = f.invoke.mock.calls.length;
    f.workspace.settings.activeTabId = '其它'; oldNavigate(1); await f.render(); expect(f.grid().rows).toBe(before); expect(f.record().hasInput()).toBe(true); expect(f.invoke).toHaveBeenCalledTimes(calls);
  });

  it('返回缓存页恢复原记录选择，已打开表单重新绑定原UUID及新显示代次', async () => {
    const f = await fixture({ pages: true }), first = f.grid().rows[0]; f.grid().onCellClick({ row: first, column: { key: 'note' } }); f.record().openForm(first.id); await f.render();
    await f.click(zh.common.pageNext); const second = f.grid().rows[0]; f.grid().onCellClick({ row: second, column: { key: 'note' } }); await f.render();
    await f.click(zh.common.pagePrevious); expect(f.record().formOpen).toBe(true); expect(f.record().draft.rowId).toBe(first.id); expect(f.record().draft.data).toBe(f.grid().rows[0].data);
    await f.click(zh.common.pageNext); expect(f.record().draft.rowId).toBe(second.id); expect(f.record().draft.data).toBe(f.grid().rows[0].data);
  });

  it('普通切页保留两页不同草稿及独立历史，返回缓存无页读取和丢稿确认', async () => {
    const f = await fixture({ pages: true }); await f.change('第一页修改'); const first = f.grid().rows;
    await f.click(zh.common.pageNext); expect(f.grid().rows[0].data.note).toBe('第三行'); expect(f.workspace.setDirty).toHaveBeenLastCalledWith(f.props.tab.id, true);
    await f.change('第二页修改'); const second = f.grid().rows, reads = f.invoke.mock.calls.filter(call => call[0] === 'table.page').length;
    await f.click(zh.common.pagePrevious); expect(f.grid().rows).toBe(first); await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('原值');
    await f.click(zh.common.pageNext); expect(f.grid().rows).toBe(second); expect(f.button(text.undo).props.children).toContain(1);
    await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('第三行'); await f.click(text.redo); expect(f.grid().rows[0].data.note).toBe('第二页修改');
    expect(f.invoke.mock.calls.filter(call => call[0] === 'table.page')).toHaveLength(reads); expect(f.confirm).not.toHaveBeenCalled(); expect(f.all('TableEditWorkspaceBar')[0].props.pages).toHaveLength(2);
  });
  it('当前干净页也统一预览后台修改，取消保留整组；已确认提交重读后清除全部旧页', async () => {
    const f = await fixture({ pages: true }); await f.change('后台草稿'); await f.click(zh.common.pageNext);
    f.button(zh.table.text019).props.onClick(); await f.render();
    const request = f.invoke.mock.calls.find(call => call[0] === 'table.preview')![1]; expect(request.changes).toHaveLength(1); expect(request.changes[0]).toMatchObject({ kind: 'update', before: { note: '原值' }, values: { note: '后台草稿' } });
    f.all('Modal')[0].props.onClose(); await f.render(); expect(f.all('TableEditWorkspaceBar')[0].props.changes).toBe(1);
    f.button(zh.table.text019).props.onClick(); await f.render(); f.button(zh.common.confirmApply).props.onClick(); await f.render();
    expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1); expect(f.all('TableEditWorkspaceBar')[0].props.pages).toHaveLength(1); expect(f.all('TableEditWorkspaceBar')[0].props.changes).toBe(0); expect(f.grid().rows[0].data.note).toBe('第三行');
  });
  it('次页读取失败原数组／历史保持，页码回到原页且不再隐式重读', async () => {
    const f = await fixture({ pages: true }); await f.change('不丢稿'); const rows = f.grid().rows, original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (command, input) => { if (command === 'table.page' && input.page === 2) throw Error('受控次页失败'); return original(command, input); });
    const before = f.invoke.mock.calls.filter(call => call[0] === 'table.page').length; await f.click(zh.common.pageNext);
    expect(f.grid().rows).toBe(rows); expect(f.button(zh.common.pagePrevious).props.disabled).toBe(true); expect(f.button(text.undo).props.disabled).toBe(false); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.page')).toHaveLength(before + 1);
    expect(f.all('ErrorBox').some(element => String(element.props.message).includes('受控次页失败'))).toBe(true); await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('原值');
  });
  it('两页未知结果关闭旧预览后仍锁全组，旧切页和逐页放弃回调不读库或丢页', async () => {
    const f = await fixture({ pages: true }); await f.change('第一页'); await f.click(zh.common.pageNext); await f.change('第二页');
    const bar = f.all('TableEditWorkspaceBar')[0].props; f.button(zh.table.text019).props.onClick(); await f.render(); f.failApply(); f.button(zh.common.confirmApply).props.onClick(); await f.render(); f.all('Modal')[0].props.onClose(); await f.render();
    const before = f.invoke.mock.calls.length; bar.onSelect(bar.pages[0]); bar.onDiscard(bar.pages[0]); await f.render();
    expect(f.invoke).toHaveBeenCalledTimes(before); expect(f.all('TableEditWorkspaceBar')[0].props.pages).toHaveLength(2); expect(f.all('TableEditWorkspaceBar')[0].props.disabled).toBe(true); expect(f.all('TableEditWorkspaceBar')[0].props.changes).toBe(2); expect(f.all('TableApplyRecoveryBanner')[0].props.view.outcome).toBe('unknown');
  });
  it('两页严格回滚保留全部草稿，当前干净页／脏页都不能靠旧历史重放提交', async () => {
    const f = await fixture({ pages: true }); await f.change('第一页'); await f.click(zh.common.pageNext); await f.change('第二页'); const original = f.invoke.getMockImplementation()!; let receipt: any;
    f.invoke.mockImplementation(async (command, input) => { if (command === 'table.apply') { receipt = recoveryReceipt(input, 'rolled-back'); throw Error('受控整批回滚'); } if (command === 'table.applyReceipt.list') return { items: [receipt], total: 1, page: 0 }; return original(command, input); });
    f.button(zh.table.text019).props.onClick(); await f.render(); f.button(zh.common.confirmApply).props.onClick(); await f.render(); f.all('Modal')[0].props.onClose(); await f.render();
    expect(f.all('TableApplyRecoveryBanner')[0].props.view.outcome).toBe('rolled-back'); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.all('TableEditWorkspaceBar')[0].props.changes).toBe(2);
    await f.click(zh.common.pagePrevious); expect(f.grid().rows[0].data.note).toBe('第一页'); expect(f.button(text.undo).props.disabled).toBe(true); f.button(zh.table.text019).props.onClick(); await f.render();
    expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(2); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it('明确放弃后台页不读库，放弃当前页返回另一准确缓存，刷新取消保持整组', async () => {
    const f = await fixture({ pages: true }); await f.change('第一页'); await f.click(zh.common.pageNext); await f.change('第二页');
    const before = f.invoke.mock.calls.length; let bar = f.all('TableEditWorkspaceBar')[0].props;
    f.confirm.mockReturnValueOnce(false); await f.click(zh.common.refresh); expect(f.confirm).toHaveBeenLastCalledWith(workspaceText.confirmAll); expect(f.invoke).toHaveBeenCalledTimes(before); expect(f.all('TableEditWorkspaceBar')[0].props.pages).toHaveLength(2);
    bar.onDiscard(bar.current); await f.render(); expect(f.all('TableEditWorkspaceBar')[0].props.pages).toHaveLength(2); bar = f.all('TableEditWorkspaceBar')[0].props; bar.onDiscard(bar.current); await f.render(); expect(f.grid().rows[0].data.note).toBe('第一页'); expect(f.invoke).toHaveBeenCalledTimes(before); bar = f.all('TableEditWorkspaceBar')[0].props; expect(bar.pages).toHaveLength(1); expect(bar.changes).toBe(1);
    await f.click(zh.common.pageNext); await f.change('新第二页'); bar = f.all('TableEditWorkspaceBar')[0].props; const reads = f.invoke.mock.calls.length; bar.onDiscard(bar.pages[0]); await f.render(); expect(f.invoke).toHaveBeenCalledTimes(reads); expect(f.grid().rows[0].data.note).toBe('新第二页'); expect(f.all('TableEditWorkspaceBar')[0].props.changes).toBe(1);
  });
});

describe('完整TableTab提交后核对与防重复投递', () => {
  it('确认后的读取尚未结束时连接修订改变，旧回包不能替换草稿或解除保护', async () => {
    const f = await fixture(); await f.change('待核对'); f.button(zh.table.text019).props.onClick(); await f.render(); f.failApply(); f.button(zh.common.confirmApply).props.onClick(); await f.render(); f.all('Modal')[0].props.onClose(); await f.render();
    const rows = f.grid().rows, original = f.invoke.getMockImplementation()!; let finish!: (value: any) => void;
    const pending = new Promise(resolve => { finish = resolve; }); let requested: any;
    f.invoke.mockImplementation(async (command, input) => { if (command === 'table.page') { requested = input; return pending; } return original(command, input); });
    f.all('TableApplyRecoveryBanner')[0].props.onRead(); await f.render(); expect(f.all('TableApplyRecoveryBanner')[0].props.view.reading).toBe(true); expect(requested).toBeDefined();
    f.workspace.connectionVersions.连接++; await f.render(); finish(await original('table.page', requested)); await f.render();
    expect(f.grid().rows).toBe(rows); expect(f.all('TableApplyRecoveryBanner')[0].props.view).toMatchObject({ locked: true, reading: false, outcome: 'unknown' }); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it('未知结果关闭旧预览后仍拒绝旧按钮、网格编辑及新预览；取消或失败读取均保留只读草稿', async () => {
    const f = await fixture(); await f.change('待核对');
    const oldPreview = f.button(zh.table.text019).props.onClick, oldAdd = f.button(zh.common.add).props.onClick;
    oldPreview(); await f.render(); f.failApply(); f.button(zh.common.confirmApply).props.onClick(); await f.render();
    f.all('Modal')[0].props.onClose(); await f.render();
    const rows = f.grid().rows, pages = () => f.invoke.mock.calls.filter(call => call[0] === 'table.page').length;
    expect(f.all('TableApplyRecoveryBanner')[0].props.view.outcome).toBe('unknown'); expect(f.button(zh.table.text019).props.disabled).toBe(true);
    oldPreview(); oldAdd(); await f.change('不应覆盖'); await f.render(); expect(f.grid().rows).toBe(rows);
    expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(1); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
    const before = pages(); f.confirm.mockReturnValueOnce(false); f.all('TableApplyRecoveryBanner')[0].props.onRead(); await f.render(); expect(pages()).toBe(before); expect(f.grid().rows).toBe(rows);
    const original = f.invoke.getMockImplementation()!; let failRead = true;
    f.invoke.mockImplementation(async (command, input) => { if (command === 'table.page' && failRead) throw Error('受控读取失败'); return original(command, input); });
    f.all('TableApplyRecoveryBanner')[0].props.onRead(); await f.render(); expect(pages()).toBe(before + 1); expect(f.grid().rows).toBe(rows); expect(f.all('TableApplyRecoveryBanner')[0].props.view).toMatchObject({ outcome: 'unknown', locked: true, reading: false });
    expect(f.confirm).toHaveBeenLastCalledWith(recoveryText.confirmUnknown); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.button(text.redo).props.disabled).toBe(true);
    failRead = false; f.all('TableApplyRecoveryBanner')[0].props.onRead(); await f.render(); expect(f.all('TableApplyRecoveryBanner')[0].props.view.locked).toBe(false); expect(f.grid().rows[0].data.note).toBe('原值'); expect(f.grid().rows).not.toBe(rows); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it.each(['正常成功', '响应丢失'] as const)('%s已确认提交但自动重读失败时保留草稿，只在明确成功重读后恢复编辑', async mode => {
    const f = await fixture(); await f.change('已提交草稿'); const original = f.invoke.getMockImplementation()!; let applied = false, failRead = true, receipt: any;
    f.invoke.mockImplementation(async (command, input) => {
      if (command === 'table.apply') { applied = true; receipt = recoveryReceipt(input, 'committed'); if (mode === '响应丢失') throw Error('受控响应丢失'); return { affectedRows: 1, receiptId: receipt.operationId }; }
      if (command === 'table.applyReceipt.list') return { items: [receipt], total: 1, page: 0 };
      if (command === 'table.page' && applied) { if (failRead) throw Error('受控刷新失败'); const result = await original(command, input); return { ...result, rows: [{ ...result.rows[0], note: '服务器新值' }] }; }
      return original(command, input);
    });
    f.button(zh.table.text019).props.onClick(); await f.render(); const rows = f.grid().rows; f.button(zh.common.confirmApply).props.onClick(); await f.render();
    expect(f.all('Modal')).toHaveLength(0); expect(f.grid().rows).toBe(rows); expect(f.all('TableApplyRecoveryBanner')[0].props.view).toMatchObject({ outcome: 'committed', locked: true, reading: false });
    expect(f.button(zh.table.text019).props.disabled).toBe(true); failRead = false; f.all('TableApplyRecoveryBanner')[0].props.onRead(); await f.render();
    expect(f.confirm).toHaveBeenCalledWith(recoveryText.confirmCommitted); expect(f.grid().rows[0].data.note).toBe('服务器新值'); expect(f.all('TableApplyRecoveryBanner')[0].props.view.locked).toBe(false); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it.each(['rolled-back', 'not-sent'] as const)('同批严格%s回执允许修正并新预览，仍不恢复执行前历史或自动重投', async outcome => {
    const f = await fixture(); await f.change('保留草稿'); const original = f.invoke.getMockImplementation()!; let receipt: any;
    f.invoke.mockImplementation(async (command, input) => { if (command === 'table.apply') { receipt = recoveryReceipt(input, outcome); throw Error('受控已终态异常'); } if (command === 'table.applyReceipt.list') return { items: [receipt], total: 1, page: 0 }; return original(command, input); });
    f.button(zh.table.text019).props.onClick(); await f.render(); f.button(zh.common.confirmApply).props.onClick(); await f.render(); f.all('Modal')[0].props.onClose(); await f.render();
    expect(f.all('TableApplyRecoveryBanner')[0].props.view).toMatchObject({ outcome, locked: false }); expect(f.grid().rows[0].data.note).toBe('保留草稿'); expect(f.button(text.undo).props.disabled).toBe(true);
    await f.change('修正草稿'); f.button(zh.table.text019).props.onClick(); await f.render(); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(2); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it('未知后迟到ACK更新同批展示但不自动读取或重放；旧render核对回调不能领取新目标', async () => {
    const f = await fixture(); await f.change('待核对'); let input: any; const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (command, value) => { if (command === 'table.apply') { input = value; throw Error('受控丢失'); } return original(command, value); });
    f.button(zh.table.text019).props.onClick(); await f.render(); f.button(zh.common.confirmApply).props.onClick(); await f.render(); f.all('Modal')[0].props.onClose(); await f.render();
    const oldRead = f.all('TableApplyRecoveryBanner')[0].props.onRead, receipt = recoveryReceipt(input, 'committed'), before = f.invoke.mock.calls.length;
    f.emitTask({ taskId: input.taskId, tableApply: { operationId: receipt.operationId, sequence: receipt.sequence, phase: receipt.phase, reason: receipt.reason, evidence: receipt.evidence } }); await f.render();
    expect(f.all('TableApplyRecoveryBanner')[0].props.view).toMatchObject({ outcome: 'committed', locked: true }); expect(f.invoke).toHaveBeenCalledTimes(before);
    oldRead(); await f.render(); expect(f.invoke).toHaveBeenCalledTimes(before); f.workspace.connectionVersions.连接++; await f.render(); const afterVersion = f.invoke.mock.calls.length; oldRead(); await f.render(); expect(f.invoke).toHaveBeenCalledTimes(afterVersion); expect(f.invoke.mock.calls.slice(before).map(call => call[0])).toEqual(['table.preferences.get']); expect(f.all('TableApplyRecoveryBanner')[0].props.view.locked).toBe(true);
  });
});

describe('完整TableTab及记录控制器的RAM编辑历史', () => {
  it('RAM订阅在render前同步交付独立前后态及ABA，取消订阅后停止交付', async () => {
    const f = await fixture(), transitions: string[][] = [], calls = f.invoke.mock.calls.length;
    const unsubscribe = f.store.subscribe((state, previous) => transitions.push([previous.settings.activeTabId, state.settings.activeTabId]));
    f.workspace.settings.activeTabId = '其它'; f.workspace.settings.activeTabId = f.props.tab.id;
    expect(transitions).toEqual([[f.props.tab.id, '其它'], ['其它', f.props.tab.id]]);
    unsubscribe(); f.workspace.settings.activeTabId = '已取消订阅'; expect(transitions).toHaveLength(2); expect(f.invoke).toHaveBeenCalledTimes(calls);
  });
  it('一次单格编辑及往返保持original/字节/JSON，撤销重做零额外IPC', async () => {
    const f = await fixture(), original = f.grid().rows[0].original; await f.change('精度900719925474099312345'); const calls = f.invoke.mock.calls.length;
    await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('原值'); await f.click(text.redo); expect(f.grid().rows[0].data.note).toBe('精度900719925474099312345'); expect(f.grid().rows[0].original).toBe(original); expect(f.grid().rows[0].data.bytes).toEqual({ type: 'binary', base64: 'AAH/' }); expect(f.invoke).toHaveBeenCalledTimes(calls);
  });
  it('新增、复制新增和批量新增各为一步，重做保留全部原UUID且不调用复制或连接', async () => {
    const f = await fixture(); f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'note' } }); await f.render();
    await f.click(recordDuplicateZh.action); const duplicate = f.grid().rows[1].id; await f.click(text.undo); const calls = f.invoke.mock.calls.length; await f.click(text.redo); expect(f.grid().rows[1].id).toBe(duplicate); expect(f.invoke).toHaveBeenCalledTimes(calls);
    await f.click(zh.common.add); const id = f.grid().rows[2].id; await f.click(text.undo); await f.click(text.redo); expect(f.grid().rows[2].id).toBe(id);
    await f.click(pasteInsertZh.action); const dialog = f.all('PasteInsertDialog')[0]; dialog.props.onStage(f.preparePasteInsert(f.info, [['甲'], ['乙']], ['note'])); await f.render(); const ids = f.grid().rows.slice(-2).map((row: any) => row.id);
    await f.click(text.undo); expect(f.grid().rows).toHaveLength(3); await f.click(text.redo); expect(f.grid().rows.slice(-2).map((row: any) => row.id)).toEqual(ids);
  });
  it('多格粘贴仅一次history操作，按原RDG回调提交，Delete与删除行也可往返', async () => {
    const f = await fixture(), current = f.grid().rows[0];
    const event = { preventDefault: vi.fn(), clipboardData: { getData: (type: string) => type === 'text/plain' ? '文字NULL\t0x' : '' } };
    const pasted = f.grid().onCellPaste({ row: current, column: { key: 'note' } }, event); f.grid().onRowsChange([pasted]); await f.render();
    expect(f.button(text.undo).props.children).toContain(1); await f.click(text.undo); expect(f.grid().rows[0].data).toEqual(current.data); await f.click(text.redo); expect(f.grid().rows[0].data.note).toBe('文字NULL');
    await f.press('Delete', { ctrlKey: false }); expect(f.grid().rows[0].data.note).toBeNull(); await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('文字NULL');
    f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'note' } }); await f.render(); await f.click(zh.common.delete); expect(f.grid().rows[0].deleted).toBe(true); await f.click(text.undo); expect(f.grid().rows[0].deleted).toBe(false);
  });
  it('表单未暂存输入禁用历史，暂存一整行后一次撤销并重建真实记录缓冲', async () => {
    const f = await fixture(); f.record().openForm(f.grid().rows[0].id); await f.render(); f.record().change('note', { mode: 'text', text: '表单新值' }); await f.render();
    expect(f.record().dirty).toBe(true); expect(f.button(text.undo).props.disabled).toBe(true); f.record().stage(); await f.render(); expect(f.record().dirty).toBe(false);
    await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('原值'); expect(f.record().draft.data).toBe(f.grid().rows[0].data); await f.click(text.redo); expect(f.grid().rows[0].data.note).toBe('表单新值');
  });
  it.each(['input', 'editor', 'monaco'])('%s焦点不劫持原生CtrlZ，EDIT和IME同样不处理历史', async kind => {
    const f = await fixture(); await f.change('新值');
    for (const event of [await f.press('z', {}, kind), await f.press('z', {}, 'grid', 'EDIT'), await f.press('z', { nativeEvent: { isComposing: true } }), await f.press('z', { nativeEvent: { keyCode: 229 } })]) expect(event.preventDefault).not.toHaveBeenCalled();
    expect(f.grid().rows[0].data.note).toBe('新值'); await f.press('z'); expect(f.grid().rows[0].data.note).toBe('原值'); await f.press('z', { ctrlKey: false, metaKey: true, shiftKey: true }); expect(f.grid().rows[0].data.note).toBe('新值');
  });
  it('模态、编辑器、切走标签和未渲染的连接修订同步拒绝旧按钮回调', async () => {
    const f = await fixture(); await f.change('新值'); const staleClick = f.button(text.undo).props.onClick;
    f.modal(true); staleClick(); f.modal(false); f.editor(true); staleClick(); f.editor(false); f.workspace.settings.activeTabId = '其它'; staleClick(); f.workspace.settings.activeTabId = f.props.tab.id; f.workspace.connectionVersions.连接++; staleClick();
    expect(f.grid().rows[0].data.note).toBe('新值'); await f.render(); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.grid().rows[0].data.note).toBe('新值');
  });
  it('目录代次改变清历史但保留草稿；显式撤销全部仍沿原load并清历史', async () => {
    const f = await fixture(); await f.change('保留草稿'); f.props.refreshVersion++; await f.render(); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.grid().rows[0].data.note).toBe('保留草稿');
    await f.click(zh.table.text018); expect(f.grid().rows[0].data.note).toBe('原值'); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.button(text.redo).props.disabled).toBe(true);
  });
  it.each([false, true])('仅预览保留历史；开始提交清空，两种执行结果fail=%s均不能重做', async fail => {
    const f = await fixture(); await f.change('待提交'); const previewClick = f.button(zh.table.text019).props.onClick; previewClick(); await f.render();
    expect(f.button(text.undo).props.disabled).toBe(true); const preview = f.all('Modal')[0]; preview.props.onClose(); await f.render(); await f.click(text.undo); expect(f.grid().rows[0].data.note).toBe('原值'); await f.click(text.redo);
    f.button(zh.table.text019).props.onClick(); await f.render(); if (fail) f.failApply(); f.button(zh.common.confirmApply).props.onClick(); await f.render();
    expect(f.button(text.undo).props.disabled).toBe(true); expect(f.button(text.redo).props.disabled).toBe(true); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(1);
  });
  it.each(['分页', '排序', '筛选'])('%s走原放弃确认和load，历史不跨页或条件保留', async operation => {
    const f = await fixture(); await f.change('旧条件草稿');
    if (operation === '分页') await f.click(zh.common.pageNext);
    else if (operation === '排序') { f.grid().onSortColumnsChange([{ columnKey: 'note', direction: 'ASC' }]); await f.render(); }
    else { await f.click(zh.table.text006); f.all('TableFilterPanel')[0].props.onFiltersChange([{ column: 'note', operator: '=', value: '原值' }]); await f.render(); }
    expect(f.button(text.undo).props.disabled).toBe(true); expect(f.button(text.redo).props.disabled).toBe(true); expect(f.grid().rows[0].data.note).toBe('原值');
  });
  it('原位目录变化和返回原目录不复活历史，草稿仍保持', async () => {
    const f = await fixture(); await f.change('草稿'); const type = f.info.columns[1].type; f.info.columns[1].type = 'varchar(100)'; await f.render(); f.info.columns[1].type = type; await f.render();
    expect(f.button(text.undo).props.disabled).toBe(true); expect(f.grid().rows[0].data.note).toBe('草稿');
  });
  it('投递预览首个await之前的忙碌门同步拒绝旧撤销按钮回调', async () => {
    const f = await fixture(); await f.change('草稿'); const oldUndo = f.button(text.undo).props.onClick; f.button(zh.table.text019).props.onClick(); oldUndo(); await f.render();
    expect(f.grid().rows[0].data.note).toBe('草稿'); expect(f.button(text.undo).props.disabled).toBe(true);
  });
  it('单次超8MiB预算只清历史，完整新草稿及容量提示保留在真实组件', async () => {
    const f = await fixture(); await f.change('已有草稿'); await f.change('大'.repeat(4_300_000));
    expect(f.grid().rows[0].data.note).toHaveLength(4_300_000); expect(f.button(text.undo).props.disabled).toBe(true); expect(f.button(text.redo).props.disabled).toBe(true);
    expect(f.all('div').some(element => element.props.role === 'status' && element.props.children === text.overflow)).toBe(true);
  });
  it('复制新增及显式重复键经过两次撤销重做后仍由原集中预览在IPC前拒绝', async () => {
    const f = await fixture(); f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'note' } }); await f.render(); await f.click(recordDuplicateZh.action);
    const rows = f.grid().rows; f.grid().onRowsChange([rows[0], { ...rows[1], data: { ...rows[1].data, id: rows[0].data.id } }]); await f.render();
    await f.click(text.undo); await f.click(text.undo); await f.click(text.redo); await f.click(text.redo);
    f.button(zh.table.text019).props.onClick(); await f.render(); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(0);
    expect(f.all('ErrorBox').some(element => String(element.props.message).includes('冲突'))).toBe(true);
  });
});

const batchAction = '复制勾选记录为新增草稿';

describe('完整TableTab勾选复制入口', () => {
  it('勾选两行仅发布一次历史、保留勾选和类型，撤销重做及直接再次回调零额外IPC', async () => {
    const f = await fixture({ batch: true }); const initial = f.grid().rows, selected = new Set(initial.map((row: any) => row.id));
    expect(f.button(batchAction).props.disabled).toBe(true); f.grid().onSelectedRowsChange(selected); await f.render();
    const click = f.button(batchAction).props.onClick, calls = f.invoke.mock.calls.length; click(); click(); await f.render();
    expect(f.grid().rows).toHaveLength(4); expect(f.grid().selectedRows).toBe(selected); expect(f.button(text.undo).props.children).toContain(1);
    const added = f.grid().rows.slice(2); expect(added[0].data.bytes).toEqual(initial[0].data.bytes); expect(added[0].data.bytes).not.toBe(added[1].data.bytes); expect(added[0].data.bytes).not.toBe(initial[0].data.bytes);
    expect(added[0].data.doc).toBe(initial[0].data.doc); expect(added[1].data.note).toBe(''); expect(Object.hasOwn(added[0].data, 'id')).toBe(false);
    await f.click(text.undo); expect(f.grid().rows).toHaveLength(2); await f.click(text.redo); expect(f.grid().rows.slice(2).map((row: any) => row.id)).toEqual(added.map((row: any) => row.id)); expect(Array.from(f.grid().selectedRows)).toEqual(Array.from(selected)); expect(f.invoke).toHaveBeenCalledTimes(calls);
  });
  it.each(['缺失', '删除', '新增', '缺值', '截断来源', '来源到期', '字节预算'] as const)('%s整批拒绝，保持已有草稿和历史，零补取/预览/剪贴板', async condition => {
    const f = await fixture({ batch: true, lease: ['截断来源', '来源到期'].includes(condition) }); await f.change('已有暂存值');
    if (condition === '新增') await f.click(zh.common.add);
    const rows = f.grid().rows;
    if (condition === '删除') { f.grid().onSelectedRowsChange(new Set([rows[1].id])); await f.render(); await f.click(zh.common.delete); }
    if (condition === '缺值') f.grid().onRowsChange(rows.map((row: any, index: number) => index === 1 ? { ...row, data: { ...row.data, doc: undefined } } : row));
    if (condition === '字节预算') f.grid().onRowsChange(rows.map((row: any, index: number) => index === 1 ? { ...row, data: { ...row.data, note: '大'.repeat(90_000) } } : row));
    if (condition === '截断来源') f.pageSource.missingColumns = ['doc'];
    if (condition === '来源到期') f.pageSource.expiresAt = Date.now() - 1;
    const selected = new Set(rows.map((row: any) => row.id)); if (condition === '缺失') selected.add('不存在'); f.grid().onSelectedRowsChange(selected); await f.render();
    const before = f.grid().rows, undo = f.button(text.undo).props.children, calls = f.invoke.mock.calls.length; await f.click(batchAction);
    expect(f.grid().rows).toBe(before); expect(f.grid().selectedRows).toBe(selected); expect(f.button(text.undo).props.children).toEqual(undo); expect(f.invoke).toHaveBeenCalledTimes(calls); expect(f.all('ErrorBox').some(element => !!element.props.message)).toBe(true);
  });
  it.each(['勾选变化', '页变化', '目标变化', '连接版本', '模态', '编辑器', '目录ABA'] as const)('%s同步拒绝旧真实按钮回调', async condition => {
    const f = await fixture({ batch: true }); f.grid().onSelectedRowsChange(new Set(f.grid().rows.map((row: any) => row.id))); await f.render();
    const oldClick = f.button(batchAction).props.onClick;
    if (condition === '勾选变化') f.grid().onSelectedRowsChange(new Set([f.grid().rows[0].id]));
    if (condition === '页变化') await f.click(zh.common.pageNext);
    if (condition === '目标变化') f.workspace.settings.activeTabId = '其它';
    if (condition === '连接版本') f.workspace.connectionVersions.连接++;
    if (condition === '模态') f.modal(true);
    if (condition === '编辑器') f.editor(true);
    if (condition === '目录ABA') { const type = f.info.columns[1].type; f.info.columns[1].type = 'varchar(500)'; await f.render(); f.info.columns[1].type = type; await f.render(); }
    const calls = f.invoke.mock.calls.length; oldClick(); expect(f.invoke).toHaveBeenCalledTimes(calls); await f.render(); expect(f.grid().rows).toHaveLength(2); expect(f.invoke.mock.calls.filter(call => ["table.copySourceRead", "table.copyInsertSql", "table.preview", "table.apply"].includes(call[0]))).toHaveLength(0);
  });
  it('非自增键冲突经过整批撤销重做仍在原集中预览前阻止，修改两个新键后沿原table.preview', async () => {
    const f = await fixture({ batch: true, plainKey: true }); f.grid().onSelectedRowsChange(new Set(f.grid().rows.map((row: any) => row.id))); await f.render(); await f.click(batchAction); await f.click(text.undo); await f.click(text.redo);
    f.button(zh.table.text019).props.onClick(); await f.render(); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(0); expect(f.all('ErrorBox').some(element => String(element.props.message).includes('冲突'))).toBe(true);
    f.grid().onRowsChange(f.grid().rows.map((row: any, index: number) => index < 2 ? row : { ...row, data: { ...row.data, id: '1844674407370955161' + index } })); await f.render();
    f.button(zh.table.text019).props.onClick(); await f.render(); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.preview')).toHaveLength(1); expect(f.invoke.mock.calls.filter(call => call[0] === 'table.apply')).toHaveLength(0);
  });
});

/** 完整MySQL父页运行正式模板回调，保留原草稿和一步undo，不触发任何IPC。 */
it('MySQL模板从当前暂存值生成整批新增，精确字节/JSON不变，原草稿单独保留', async () => {
  const f = await fixture(); await f.change('已暂存原草稿');
  f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'note' } }); await f.render();
  await f.click(recordTemplatesZh.open); const dialog = f.all('RecordTemplatesDialog')[0];
  expect(dialog.props.candidate.fields.map((field: any) => field.name)).toEqual(['note', 'bytes', 'doc']);
  expect(f.button(text.undo).props.disabled).toBe(true);
  const content = { version: 1, dialect: 'mysql', fields: dialog.props.candidate.fields.map(({ name, signature, value }: any) => ({ name, signature, value })) };
  const calls = f.invoke.mock.calls.length, original = f.grid().rows[0];
  dialog.props.onStage(content, 2); await f.render(); const added = f.grid().rows.slice(1);
  expect(added).toHaveLength(2); expect(f.grid().rows[0]).toBe(original);
  for (const row of added) { expect(row.data).toEqual({ note: '已暂存原草稿', bytes: original.data.bytes, doc: original.data.doc }); expect(row.data).not.toHaveProperty('id'); }
  expect(() => dialog.props.onStage(content, 2)).toThrow();
  await f.click(text.undo); expect(f.grid().rows).toEqual([original]);
  await f.click(text.redo); expect(f.grid().rows.slice(1).map((row: any) => row.id)).toEqual(added.map((row: any) => row.id));
  expect(f.invoke).toHaveBeenCalledTimes(calls);
});
it('MySQL模板旧父回调在原草稿undo/redo ABA后永久拒绝，不追加部分记录', async () => {
  const f = await fixture(); await f.change('暂存'); const oldUndo = f.button(text.undo).props.onClick; await f.click(recordTemplatesZh.open);
  const dialog = f.all('RecordTemplatesDialog')[0], before = f.grid().rows, calls = f.invoke.mock.calls.length;
  // 绕过按钮禁用模拟迟到旧回调；正式历史函数仍按原状态处理，模板必须额外识别代次。
  oldUndo(); await f.render(); expect(f.grid().rows[0].data.note).toBe('原值'); const oldRedo = f.button(text.redo).props.onClick; oldRedo(); await f.render();
  expect(f.grid().rows).toEqual(before); expect(() => dialog.props.onStage({ version: 1, dialect: 'mysql', fields: [] }, 1)).toThrow();
  expect(f.grid().rows).toEqual(before); expect(f.invoke).toHaveBeenCalledTimes(calls);
});
