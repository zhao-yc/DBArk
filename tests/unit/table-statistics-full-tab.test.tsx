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
import { draftHistoryZh as text } from '../../src/renderer/locales/draftHistory.zh-CN';
import { pasteInsertZh } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
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
  const sourceRows = options.batch ? [source, { ...source, id: '18446744073709551614', note: '' }] : [source];
  const pageSource = { status: 'ready', pageRef: 'RAM页引用', rowRefs: ['RAM行1', 'RAM行2'], expiresAt: Date.now() + 60_000, metadataKey: tableCopyMetadataKey(info), missingColumns: [] as string[] };
  let failApply = false;
  const invoke = vi.fn(async (command: string, input: any) => {
    if (command === 'metadata.table') return info;
    if (command === 'table.page') return { page: input.page, pageSize: input.pageSize, hasMore: true, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), rows: structuredClone(sourceRows), copyMetadataKey: tableCopyMetadataKey(info), ...(options.batch && options.lease ? { copySource: pageSource } : {}) };
    if (command === 'table.preview') return { sql: '仅RAM模拟预览', warnings: [] };
    if (command === 'table.apply') { if (failApply) throw Error('合成执行结果未知'); return { affectedRows: 1 }; }
    if (command === 'table.preferences.get' || command === 'connections.open') return null;
    throw Error('未授权的RAM端口：' + command);
  });
  const store = Object.assign((selector: (value: any) => any) => selector(stateApi.getState()), stateApi);
  const context = createContext({ Error, Object, queueMicrotask, structuredClone, HTMLElement: Node, TextEncoder, TextDecoder, URL, atob, btoa, document: { querySelector: () => dialog ? {} : null }, window: { confirm: () => true } });
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
  return { render, click, change, press, grid, record, button, all, props, workspace, store, invoke, info, pageSource, preparePasteInsert: load(path.join(renderer, 'pasteInsert.ts')).preparePasteInsert, editor(value: boolean) { editor = value; }, modal(value: boolean) { dialog = value; }, failApply() { failApply = true; } };
}


import React, { act } from 'react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { memoryDocument } from '../fixtures/memory-dom';
import type { TableStatisticsServices } from '../../src/renderer/components/TableStatisticsDialog';
import { tableStatisticsZh as statisticsText } from '../../src/renderer/locales/tableStatistics.zh-CN';

let memory: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], dialogRoot: ReturnType<typeof createRoot> | undefined;
let TableStatisticsDialog: typeof import('../../src/renderer/components/TableStatisticsDialog')['TableStatisticsDialog'];
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
beforeAll(async()=>{
  memory=memoryDocument();const create=memory.createElement.bind(memory);memory.createElement=name=>{const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key,value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key);if(key==='disabled')node.disabled=false;};return node;};
  ({createRoot}=await import('react-dom/client'));({TableStatisticsDialog}=await import('../../src/renderer/components/TableStatisticsDialog'));
});
afterEach(async()=>{if(dialogRoot){await act(async()=>dialogRoot!.unmount());dialogRoot=undefined;}memory.body.textContent='';});
afterAll(()=>{for(const[key,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});

/** 真正TableTab按钮→真实Dialog，RAM只提供受限服务回执，不替代生产选择/围栏/请求参数。 */
it('无活动行且有父草稿仍可打开正式统计，冻结服务器筛选并读取全部百万行COUNT',async()=>{
  const f=await fixture();await f.click(zh.table.text006);const filters=[{column:'id',operator:'>=',value:'9007199254740993'},{column:'note',operator:'=',value:'保留停用精确值',enabled:false}];
  f.all('TableFilterPanel')[0].props.onFiltersChange(filters);await f.render();f.all('TableFilterPanel')[0].props.onModeChange('any');await f.render();await f.change('未提交父草稿');
  const row=f.grid().rows[0],original=row.original;expect(f.button(statisticsText.title).props.disabled).toBe(false);await f.click(statisticsText.title);
  const element=f.all('TableStatisticsDialog')[0];expect(element).toBeDefined();expect(element.props.intent.current()).toBe(true);expect(element.props.intent.conditions).toEqual({filters,filterMode:'any'});
  const statistics=vi.fn<TableStatisticsServices['statistics']>(async()=>({source:element.props.intent.source,sourceDigest:'a'.repeat(64),rowCount:'1000001',columns:[],warnings:[]}));
  const host=memory.createElement('div');memory.body.appendChild(host);dialogRoot=createRoot(host as any);await act(async()=>{dialogRoot!.render(<TableStatisticsDialog {...element.props as any} services={{statistics,cancel:async()=>{}}}/>);});
  expect(statistics).not.toHaveBeenCalled();const start=memory.body.querySelectorAll('button').find(node=>node.textContent===statisticsText.start)!;
  const {MemoryEvent}=await import('../fixtures/memory-dom');await act(async()=>{start.dispatchEvent(new MemoryEvent('click'));});
  expect(statistics).toHaveBeenCalledWith({connectionId:'连接',database:'db',table:'items',taskId:expect.any(String),columns:[],filters,filterMode:'any'});
  expect(memory.body.querySelector('[aria-label="'+statisticsText.rowCount+'"]')?.textContent).toBe('1000001');expect(f.grid().rows).toHaveLength(1);expect(f.grid().rows[0]).toBe(row);expect(row.data.note).toBe('未提交父草稿');expect(row.original).toBe(original);
  expect(f.invoke.mock.calls.some(([command])=>command==='table.apply'||command==='table.preview'||command.startsWith('query.execute'))).toBe(false);
});
it('完整TableTab的视图入口可达，活动标签与连接ABA同步永久撤销原意图',async()=>{
  const f=await fixture();f.info.objectKind='view';f.info.engine='';await f.render();expect(f.button(statisticsText.title).props.disabled).toBe(false);await f.click(statisticsText.title);const intent=f.all('TableStatisticsDialog')[0].props.intent;expect(intent.current()).toBe(true);
  f.workspace.settings.activeTabId='other';f.workspace.settings.activeTabId=f.props.tab.id;expect(intent.current()).toBe(false);expect(f.grid().rows).toHaveLength(1);
});
it('统计模态实际阻止父表新操作，原取消回调只关闭原实例而不清草稿',async()=>{
  const f=await fixture();await f.change('保留草稿');await f.click(statisticsText.title);const dialog=f.all('TableStatisticsDialog')[0];expect(f.button(zh.common.add).props.disabled).toBe(true);expect(f.button(statisticsText.title).props.disabled).toBe(true);dialog.props.onClose();await f.render();expect(f.grid().rows[0].data.note).toBe('保留草稿');expect(f.all('TableStatisticsDialog')).toHaveLength(0);expect(f.button(statisticsText.title).props.disabled).toBe(false);
});
