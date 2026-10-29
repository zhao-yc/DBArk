import { navigationMenuVmPort, navigationToolbarVmChildren } from '../helpers/sidebarMenuRamPort';
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
  const sourceRows = options.batch ? [source, { ...source, id: '18446744073709551614', note: '' }] : [source];
  const pageSource = { status: 'ready', pageRef: 'RAM页引用', rowRefs: ['RAM行1', 'RAM行2'], expiresAt: Date.now() + 60_000, metadataKey: tableCopyMetadataKey(info), missingColumns: [] as string[] };
  let failApply = false;
  const invoke = vi.fn(async (command: string, input: any) => {
    if (command === 'metadata.table') return info;
    if (command === 'table.page') return { page: input.page, pageSize: input.pageSize, hasMore: true, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), rows: structuredClone(sourceRows), copyMetadataKey: tableCopyMetadataKey(info), ...(options.batch && options.lease ? { copySource: pageSource } : {}) };
    if (command === 'table.valueOptions') return { source: structuredClone(info), sourceDigest: 'a'.repeat(64), column: input.column, ...(input.searchPattern ? { searchPattern: input.searchPattern } : {}), values: [{ value: '原值', count: '1000001' }, { value: null, count: '4' }], truncated: false, warnings: ['仅RAM服务器回执，不是实库验收'] };
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
  await render(); expect(grid().rows).toHaveLength(options.batch ? 2 : 1);
  return { confirm, render, click, change, press, grid, record, button, all, props, workspace, store, invoke, info, pageSource, preparePasteInsert: load(path.join(renderer, 'pasteInsert.ts')).preparePasteInsert, editor(value: boolean) { editor = value; }, modal(value: boolean) { dialog = value; }, failApply() { failApply = true; } };
}

import React, { act } from 'react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { tableValueOptionsZh as text } from '../../src/renderer/locales/tableValueOptions.zh-CN';

let memory: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], dialogRoot: ReturnType<typeof createRoot> | undefined;
let TableValueOptionsDialog: typeof import('../../src/renderer/components/TableValueOptionsDialog')['TableValueOptionsDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  memory = memoryDocument(); Object.defineProperty(memory, 'oninput', { value: null, configurable: true });
  const create = memory.createElement.bind(memory);
  /** 只补标准HTML输入/选择属性，产品组件与真实React状态不被替换。 */
  memory.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    // 真实祖先及真实选择器结果决定归属，不构造可绕过产品模态门的固定返回值。
    Reflect.set(node, 'closest', (selector: string) => { for (let current: MemoryNode | null = node; current; current = current.parentNode) if (current.parentNode?.querySelectorAll(selector).includes(current)) return current; return null; });
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
  ({ createRoot } = await import('react-dom/client')); ({ TableValueOptionsDialog } = await import('../../src/renderer/components/TableValueOptionsDialog'));
});
afterEach(async () => { if (dialogRoot) { await act(async () => dialogRoot!.unmount()); dialogRoot = undefined; } memory.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

function dialogButton(label: string): MemoryNode { const button = memory.body.querySelectorAll('button').find(node => node.textContent === label); if (!button) throw Error('缺少正式弹窗按钮：' + label); return button; }
async function dialogClick(label: string): Promise<void> { const button = dialogButton(label); expect(button.disabled).not.toBe(true); await act(async () => { button.dispatchEvent(new MemoryEvent('click')); }); }
async function selectValue(value: string | null): Promise<void> {
  const box = memory.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.value(value)); if (!box) throw Error('缺少正式候选：' + text.value(value));
  await act(async () => { box.checked = true; box.dispatchEvent(new MemoryEvent('click')); });
}
/** 把真实TableTab产生的完整props交给正式Dialog，保留其services和onApply，不能以模拟接纳代替父门。 */
async function openDialog(f: Awaited<ReturnType<typeof fixture>>) {
  await f.click(text.open); const element = f.all('TableValueOptionsDialog')[0]; expect(element).toBeDefined();
  const host = memory.createElement('div'); memory.body.appendChild(host); dialogRoot = createRoot(host as any);
  await act(async () => { dialogRoot!.render(<TableValueOptionsDialog {...element.props as any}/>); });
  expect(memory.body.querySelector('[data-table-value-options-dialog]')).not.toBeNull(); return element;
}
function pageReads(f: Awaited<ReturnType<typeof fixture>>) { return f.invoke.mock.calls.filter(([command]) => command === 'table.page'); }

describe('服务器不同值的完整TableTab→正式Dialog产品集成（RAM边界）', () => {
  it('无活动行及父表草稿仍有正式入口，默认首个可用列，读取全部服务器匹配行而不写库', async () => {
    const f = await fixture(); await f.change('未提交父草稿'); const row = f.grid().rows[0], original = row.original;
    const element = await openDialog(f); expect(element.props.column).toBe('id'); expect(element.props.target).toEqual({ connectionId: '连接', database: 'db', table: 'items' }); expect(element.props.isCurrent()).toBe(true); expect(f.button(zh.common.add).props.disabled).toBe(true); expect(f.button(text.open).props.disabled).toBe(true);
    expect(f.invoke.mock.calls.some(([command]) => command === 'table.valueOptions')).toBe(false); await dialogClick(text.read);
    expect(f.invoke).toHaveBeenCalledWith('table.valueOptions', { connectionId: '连接', database: 'db', table: 'items', column: 'id', taskId: expect.any(String), filters: [], filterMode: 'all' });
    expect(memory.body.textContent).toContain(text.count('1000001')); expect(f.grid().rows).toHaveLength(1); expect(f.grid().rows[0]).toBe(row); expect(row.original).toBe(original); expect(row.data.note).toBe('未提交父草稿');
    expect(f.invoke.mock.calls.some(([command]) => command === 'table.apply' || command === 'table.preview' || command.startsWith('query.execute'))).toBe(false);
  });
  it('活动列优先；二进制活动列退到首个支持列，视图同样提供只读不同值入口', async () => {
    const f = await fixture(); f.info.objectKind = 'view'; f.info.engine = ''; await f.render();
    f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'note' } }); await f.render(); await f.click(text.open);
    let element = f.all('TableValueOptionsDialog')[0]; expect(element.props.column).toBe('note'); expect(element.props.source.objectKind).toBe('view'); element.props.onClose(); await f.render();
    f.grid().onActivePositionChange({ row: f.grid().rows[0], column: { key: 'bytes' } }); await f.render(); await f.click(text.open); element = f.all('TableValueOptionsDialog')[0]; expect(element.props.column).toBe('id');
  });
  it('正式候选应用把原OR及停用条件整体AND，保留两列排序并回到第一页', async () => {
    const f = await fixture(); await f.click(zh.table.text006);
    const filters = [{ column: 'id', operator: '>=', value: '9007199254740993' }, { column: 'note', operator: '=', value: '停用原值', enabled: false }];
    f.all('TableFilterPanel')[0].props.onFiltersChange(filters); await f.render(); f.all('TableFilterPanel')[0].props.onModeChange('any'); await f.render();
    const sortColumns = [{ columnKey: 'note', direction: 'ASC' }, { columnKey: 'id', direction: 'DESC' }]; f.grid().onSortColumnsChange(sortColumns); await f.render(); await f.click(zh.common.pageNext);
    expect(pageReads(f).at(-1)![1].page).toBe(2); const element = await openDialog(f); expect(element.props.conditions).toEqual({ filters, filterMode: 'any' });
    await dialogClick(text.read); await selectValue('原值'); await dialogClick(text.apply); await f.render();
    const latest = pageReads(f).at(-1)![1]; expect(latest).toMatchObject({ page: 1, filters: [...filters, { column: 'id', operator: 'IN', values: ['原值'] }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] }, sort: [{ column: 'note', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] });
    expect(f.grid().sortColumns).toEqual(sortColumns); expect(f.all('TableValueOptionsDialog')).toHaveLength(0);
    expect(f.invoke.mock.calls.some(([command]) => command === 'table.apply' || command === 'table.preview' || command.startsWith('query.execute'))).toBe(false);
  });
  it('有草稿时拒绝同一丢弃提示保留原rows、条件、弹窗及勾选，不偷偷重读', async () => {
    const f = await fixture(); await f.change('必须保留草稿'); const row = f.grid().rows[0], data = row.data, original = row.original;
    const element = await openDialog(f), before = pageReads(f).length; await dialogClick(text.read); await selectValue('原值'); f.confirm.mockReturnValue(false); await dialogClick(text.apply); await f.render();
    expect(f.confirm).toHaveBeenCalledExactlyOnceWith(recordViewZh.discardPage); expect(pageReads(f)).toHaveLength(before); expect(f.grid().rows[0]).toBe(row); expect(row.data).toBe(data); expect(row.original).toBe(original); expect(row.data.note).toBe('必须保留草稿');
    expect(f.all('TableValueOptionsDialog')[0].props.conditions).toBe(element.props.conditions); expect(memory.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.value('原值'))?.checked).toBe(true); expect(memory.body.textContent).toContain(text.rejected);
  });
  it('同一丢弃提示确认后确实接纳筛选，清草稿并通过正式page读取更新页面', async () => {
    const f = await fixture(); await f.change('明确丢弃的草稿'); await openDialog(f); const before = pageReads(f).length;
    await dialogClick(text.read); await selectValue('原值'); await dialogClick(text.apply); await f.render();
    expect(f.confirm).toHaveBeenCalledExactlyOnceWith(recordViewZh.discardPage); expect(pageReads(f)).toHaveLength(before + 1); expect(pageReads(f).at(-1)![1]).toMatchObject({ page: 1, filters: [{ column: 'id', operator: 'IN', values: ['原值'] }] }); expect(f.grid().rows[0].data.note).toBe('原值'); expect(f.all('TableValueOptionsDialog')).toHaveLength(0);
  });
  it('真实DOM出现另一模态时父owner门零丢稿，移除后才接受同一正式勾选', async () => {
    const f = await fixture(); await f.change('必须先保留'); await openDialog(f); await dialogClick(text.read); await selectValue('原值'); const row = f.grid().rows[0], before = pageReads(f).length;
    const foreign = memory.createElement('section'); foreign.setAttribute('role', 'dialog'); memory.body.appendChild(foreign); await dialogClick(text.apply); await f.render();
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.grid().rows[0]).toBe(row); expect(row.data.note).toBe('必须先保留'); expect(pageReads(f)).toHaveLength(before);
    memory.body.removeChild(foreign); await dialogClick(text.apply); await f.render(); expect(f.confirm).toHaveBeenCalledExactlyOnceWith(recordViewZh.discardPage); expect(pageReads(f)).toHaveLength(before + 1); expect(f.all('TableValueOptionsDialog')).toHaveLength(0);
  });
  it.each(['tab', 'profile', 'version', 'source'])('丢弃确认中的%s变化不允许先reset草稿后发现失效', async cause => {
    const f = await fixture(); await f.change('确认期间必须保留'); const row = f.grid().rows[0], data = row.data, element = await openDialog(f); await dialogClick(text.read); await selectValue('原值'); const before = pageReads(f).length;
    f.confirm.mockImplementation(() => {
      if (cause === 'tab') { f.workspace.settings.activeTabId = 'other'; f.workspace.settings.activeTabId = f.props.tab.id; }
      else if (cause === 'profile') { const profiles = f.workspace.connections; f.workspace.connections = [{ ...profiles[0], name: '临时变化' }]; f.workspace.connections = profiles; }
      else if (cause === 'version') { f.workspace.connectionVersions.连接 = 2; f.workspace.connectionVersions.连接 = 1; }
      else f.info.columns[0].comment = '确认期间目录改变';
      return true;
    });
    await dialogClick(text.apply); await f.render(); expect(f.confirm).toHaveBeenCalledOnce(); expect(pageReads(f)).toHaveLength(before); expect(f.grid().rows[0]).toBe(row); expect(row.data).toBe(data); expect(row.data.note).toBe('确认期间必须保留'); expect(f.all('TableValueOptionsDialog')).toHaveLength(1); expect(element.props.isCurrent()).toBe(false);
  });
  it('旧关闭回调不能清新弹窗，父行变化令旧来源永久失效且无晚应用', async () => {
    const f = await fixture(); await f.click(text.open); const old = f.all('TableValueOptionsDialog')[0]; old.props.onClose(); await f.render(); await f.change('新草稿'); await f.click(text.open); const current = f.all('TableValueOptionsDialog')[0]; old.props.onClose(); await f.render();
    expect(f.all('TableValueOptionsDialog')[0].props.conditions).toBe(current.props.conditions); expect(current.props.isCurrent()).toBe(true); expect(old.props.isCurrent()).toBe(false); expect(f.grid().rows[0].data.note).toBe('新草稿');
  });
  it('读取等待中正式父刷新撤销原页来源，迟到成功不展示候选或自动重读', async () => {
    const f = await fixture(), element = await openDialog(f); let resolve!: (value: any) => void;
    f.invoke.mockImplementationOnce(async (command: string): Promise<any> => { if (command !== 'table.valueOptions') throw Error('本例只允许原不同值读取'); return new Promise(yes => { resolve = yes; }); });
    await dialogClick(text.read); f.props.refreshVersion++; await f.render(); expect(element.props.isCurrent()).toBe(false);
    await act(async () => { resolve({ source: element.props.source, sourceDigest: 'a'.repeat(64), column: element.props.column, values: [{ value: '不可发布', count: '1000001' }], truncated: false, warnings: ['合成迟到回执'] }); });
    expect(memory.body.querySelectorAll('input').filter(node => node.type === 'checkbox')).toHaveLength(0); expect(dialogButton(text.apply).disabled).toBe(true); expect(f.invoke.mock.calls.filter(([command]) => command === 'table.valueOptions')).toHaveLength(1); expect(f.invoke.mock.calls.some(([command]) => command === 'table.apply')).toBe(false);
  });
});
