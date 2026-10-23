import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import * as zod from 'zod';
import { describe, expect, it, vi } from 'vitest';
import * as lib from '../../src/renderer/lib';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import type { TableInfo } from '../../src/shared/contracts';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { createStore } from 'zustand/vanilla';

type Element = { type: unknown; props: Record<string, any> };
const renderer = fileURLToPath(new URL('../../src/renderer', import.meta.url)), compiled = new Map<string, string>();
/** 执行完整生产TableTab与真实useRecordViews/helper，React调度、DOM和IPC仅替换成RAM端口。 */
async function fixture(options: { batch?: boolean; plainKey?: boolean; lease?: boolean } = {}) {
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
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: 'CREATE TABLE items(id TEXT, note TEXT, bytes BLOB, doc TEXT)', columns: ['id', 'note', 'bytes', 'doc'].map(name => ({ name, type: name === 'bytes' ? 'blob' : 'text', nullable: true, defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const tab = { id: '表页', kind: 'table', connectionId: '连接', database: 'db', table: 'items' };
  const workspaceSeed = { settings: { activeTabId: tab.id, tabs: [tab], pageSize: 50, theme: 'dark' }, connections: [{ id: '连接', name: '合成连接' }], connectionVersions: { 连接: 1 }, activeJobs: {} as Record<string, boolean>, setDirty: vi.fn(), setBusy: vi.fn((_id: string, _busy: boolean) => undefined), setTableLayoutDraft: vi.fn(), notify: vi.fn(), updateSettings: vi.fn() };
  const stateApi = createStore<typeof workspaceSeed>(() => workspaceSeed);
  workspaceSeed.setBusy.mockImplementation((id, value) => { stateApi.setState(state => ({ activeJobs: { ...state.activeJobs, [id]: value } })); return undefined; });
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
  const sourceRows = options.batch ? [source, { ...source, id: '18446744073709551614', note: '' }] : [source];
  const pageSource = { status: 'ready', pageRef: 'RAM页引用', rowRefs: ['RAM行1', 'RAM行2'], expiresAt: Date.now() + 60_000, metadataKey: tableCopyMetadataKey(info), missingColumns: [] as string[] };
  let failApply = false;
  const invoke = vi.fn(async (command: string, input: any) => {
    if (command === 'metadata.table') return info;
    if (command === 'table.page') return { page: input.page, pageSize: input.pageSize, hasMore: true, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), rows: structuredClone(sourceRows), copyMetadataKey: tableCopyMetadataKey(info), ...(options.batch && options.lease ? { copySource: pageSource } : {}) };
    if (command === 'table.valueOptions') return { source: structuredClone(info), sourceDigest: 'a'.repeat(64), column: input.column, ...(input.searchPattern ? { searchPattern: input.searchPattern } : {}), values: [{ value: '原值', count: '1000001' }, { value: null, count: '4' }], truncated: false, warnings: ['仅RAM服务器回执，不是实库验收'] };
    if (command === 'files.choose') return { token: 'filtered-file', name: 'filtered.csv' };
    if (command === 'table.exportFiltered') return { rows: 1105, fileCommitted: true };
    if (command === 'query.cancel') return { cancelled: true };
    if (command === 'table.preview') return { sql: '仅RAM模拟预览', warnings: [] };
    if (command === 'table.apply') { if (failApply) throw Error('合成执行结果未知'); return { affectedRows: 1 }; }
    if (command === 'table.preferences.get' || command === 'connections.open') return null;
    throw Error('未授权的RAM端口：' + command);
  });
  const store = Object.assign((selector: (value: any) => any) => selector(stateApi.getState()), stateApi);
  const confirm = vi.fn((_message?: string): boolean => true);
  const context = createContext({ Error, Object, queueMicrotask, structuredClone, HTMLElement: Node, TextEncoder, TextDecoder, URL, atob, btoa, document: { querySelector: (selector: string) => dialog ? {} : memory.body.querySelector(selector), querySelectorAll: (selector: string) => dialog ? [{}] : memory.body.querySelectorAll(selector) }, window: { confirm } });
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
      if (target === path.join(renderer, 'store')) return { useWorkspace: store };
      if (target === path.join(renderer, 'lib')) return { ...lib, invoke, uid: vi.fn(() => 'UUID-' + ++counter) };
      if (target.startsWith(path.join(renderer, 'components') + path.sep)) return new Proxy({}, { get: (_, key) => String(key) });
      for (const extension of ['.ts', '.tsx']) if (existsSync(target + extension)) return load(target + extension);
      throw Error('纯组件不允许未知依赖：' + name);
    }, module, module.exports);
    return module.exports;
  }
  const component = load(path.join(renderer, 'components/TableTab.tsx')).TableTab;
  const props = { tab, refreshVersion: 0, onDesign: vi.fn(), onTransfer: vi.fn(), onColumnPatches: vi.fn(), onIndexPatches: vi.fn(), onForeignKeyPatches: vi.fn(), onTableRename: vi.fn(), onTableAutoIncrement: vi.fn(), onTableComment: vi.fn(), onTableDefaultEncoding: vi.fn() };
  function all(type: unknown) { const found: Element[] = []; function walk(value: any) { if (Array.isArray(value)) value.forEach(walk); else if (value?.props) { if (value.type === type) found.push(value); walk(value.props.children); } } walk(tree); return found; }
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
  await render(); expect(grid().rows).toHaveLength(options.batch ? 2 : 1);
  return { confirm, render, click, change, press, grid, record, button, all, props, workspace, store, invoke, info, pageSource, preparePasteInsert: load(path.join(renderer, 'pasteInsert.ts')).preparePasteInsert, editor(value: boolean) { editor = value; }, modal(value: boolean) { dialog = value; }, failApply() { failApply = true; } };
}


import React, { act } from 'react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { tableFilteredExportZh as text } from '../../src/renderer/locales/tableFilteredExport.zh-CN';
import type { TableFilteredExportServices } from '../../src/renderer/components/TableFilteredExportDialog';
let memory: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], dialogRoot: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableFilteredExportDialog')['TableFilteredExportDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  memory = memoryDocument(); Object.defineProperty(memory, 'oninput', { value: null, configurable: true });
  const create = memory.createElement.bind(memory);
  /** 只补标准HTML属性端口；组件、React状态、任务Promise与条件核心均使用真实产品实现。 */
  memory.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, {
      options: { configurable: true, get: () => node.querySelectorAll('option') },
      value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } },
    });
    if (name === 'option') {
      let selected = false, dirty = false;
      Object.defineProperties(node, {
        value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) },
        selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; if (selected) { let parent = node.parentNode; while (parent && parent.tagName !== 'SELECT') parent = parent.parentNode; if (parent) for (const option of parent.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } } },
        defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } },
      });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableFilteredExportDialog: Dialog } = await import('../../src/renderer/components/TableFilteredExportDialog'));
});
afterEach(async () => { if (dialogRoot) { await act(async () => dialogRoot!.unmount()); dialogRoot = undefined; } memory.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

function dialogButton(label: string): MemoryNode { const node = memory.querySelectorAll('button').find(value => value.textContent === label); if (!node) throw Error('缺少正式导出按钮：' + label); return node; }
async function dialogClick(label: string): Promise<void> { const node = dialogButton(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
/** 正式TableTab实际产生的intent和回调交给真实React Dialog，IPC边界只提供RAM端口。 */
async function openDialog(f: Awaited<ReturnType<typeof fixture>>) {
  await f.click(text.entry); const element = f.all('TableFilteredExportDialog')[0]; expect(element).toBeDefined();
  const services: TableFilteredExportServices = { choose: async input => await f.invoke('files.choose', input) as any, execute: async input => await f.invoke('table.exportFiltered', input) as any, cancel: async id => await f.invoke('query.cancel', { taskId: id }), subscribe: () => () => undefined };
  const host = memory.createElement('div'); memory.body.appendChild(host); dialogRoot = createRoot(host as any);
  await act(async () => { dialogRoot!.render(<Dialog {...element.props as any} services={services}/>); }); return element;
}
function pageReads(f: Awaited<ReturnType<typeof fixture>>) { return f.invoke.mock.calls.filter(([command]) => command === 'table.page'); }

describe('完整TableTab→全量筛选导出正式Dialog集成（RAM边界）', () => {
  it('独立正式入口接受未提交父草稿，全量1105行导出不套当前页1行且父原行不改', async () => {
    const f = await fixture(); await f.change('未提交本页草稿'); const row = f.grid().rows[0], original = row.original, before = pageReads(f).length;
    const element = await openDialog(f); expect(element.props.intent.current()).toBe(true); expect(f.button(zh.common.add).props.disabled).toBe(true); expect(f.button(text.entry).props.disabled).toBe(true);
    expect(f.invoke.mock.calls.some(([command]) => command === 'table.exportFiltered')).toBe(false); await dialogClick(text.choose); await f.render(); expect(element.props.intent.current()).toBe(true);
    await dialogClick(text.start); await f.render(); expect(memory.body.textContent).toContain(text.completed(1105)); expect(pageReads(f)).toHaveLength(before); expect(f.grid().rows).toHaveLength(1); expect(f.grid().rows[0]).toBe(row); expect(row.original).toBe(original); expect(row.data.note).toBe('未提交本页草稿'); expect(f.confirm).not.toHaveBeenCalled();
    const input = f.invoke.mock.calls.find(([command]) => command === 'table.exportFiltered')![1]; expect(input).toMatchObject({ connectionId: '连接', database: 'db', table: 'items', metadataKey: tableCopyMetadataKey(f.info), filters: [], filterMode: 'all', sort: [], format: 'csv', encoding: 'utf8', csvDelimiter: ',', fileToken: 'filtered-file' }); expect(Object.hasOwn(input, 'rows')).toBe(false); expect(Object.hasOwn(input, 'page')).toBe(false);
    expect(f.invoke.mock.calls.some(([command]) => command === 'files.export' || command === 'files.exportResult' || command === 'table.apply' || command.startsWith('query.execute'))).toBe(false); expect(f.workspace.activeJobs[f.props.tab.id]).toBe(false);
  });
  it('原已应用OR/停用条件、多列排序与第2页来源保持；导出不修改页码或再取当前页', async () => {
    const f = await fixture(); await f.click(zh.table.text006); const filters = [{ column: 'id', operator: '>=', value: '9007199254740993' }, { column: 'note', operator: '=', value: '原停用值', enabled: false }];
    f.all('TableFilterPanel')[0].props.onFiltersChange(filters); await f.render(); f.all('TableFilterPanel')[0].props.onModeChange('any'); await f.render();
    f.grid().onSortColumnsChange([{ columnKey: 'note', direction: 'ASC' }, { columnKey: 'id', direction: 'DESC' }]); await f.render(); await f.click(zh.common.pageNext); const before = pageReads(f).length; expect(pageReads(f).at(-1)![1].page).toBe(2);
    const element = await openDialog(f); expect(element.props.intent.conditions).toEqual({ filters, filterMode: 'any' }); await dialogClick(text.choose); await dialogClick(text.start); await f.render();
    const input = f.invoke.mock.calls.find(([command]) => command === 'table.exportFiltered')![1]; expect(input).toMatchObject({ filters, filterMode: 'any', sort: [{ column: 'note', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] }); expect(pageReads(f)).toHaveLength(before); expect(pageReads(f).at(-1)![1].page).toBe(2);
  });
  it.each(['tab', 'profile', 'version'])('原%s变化再恢复不复活chooser授权或源意图', async cause => {
    const f = await fixture(), element = await openDialog(f);
    if (cause === 'tab') { f.workspace.settings.activeTabId = 'other'; f.workspace.settings.activeTabId = f.props.tab.id; }
    else if (cause === 'profile') { const original = f.workspace.connections; f.workspace.connections = [{ ...original[0], name: '临时变化' }]; f.workspace.connections = original; }
    else { f.workspace.connectionVersions.连接 = 2; f.workspace.connectionVersions.连接 = 1; }
    expect(element.props.intent.current()).toBe(false); await act(async () => { await Promise.resolve(); }); expect(dialogButton(text.start).disabled).toBe(true); expect(f.invoke.mock.calls.some(([command]) => command === 'files.choose' || command === 'table.exportFiltered')).toBe(false);
  });
  it('原行引用或目录发生变化撤销意图，旧关闭回调不关闭新窗口', async () => {
    const f = await fixture(); await f.click(text.entry); const old = f.all('TableFilteredExportDialog')[0]; old.props.onClose(); await f.render(); await f.change('第二次父草稿'); await f.click(text.entry); const current = f.all('TableFilteredExportDialog')[0]; old.props.onClose(); await f.render(); expect(f.all('TableFilteredExportDialog')[0].props.intent).toBe(current.props.intent); expect(old.props.intent.current()).toBe(false); expect(current.props.intent.current()).toBe(true);
    f.info.columns[0].comment = '目录已变化'; expect(current.props.intent.current()).toBe(false); expect(f.grid().rows[0].data.note).toBe('第二次父草稿');
  });
  it('视图也有只读全量导出入口，旧全表传输回调保留', async () => {
    const f = await fixture(); f.info.objectKind = 'view'; f.info.engine = ''; await f.render(); const element = await openDialog(f); expect(element.props.intent.source.objectKind).toBe('view'); expect(f.props.onTransfer).not.toHaveBeenCalled(); expect(f.all('button').some(node => node.props.onClick && Array.isArray(node.props.children) && node.props.children.includes(zh.common.export))).toBe(true);
  });
});
