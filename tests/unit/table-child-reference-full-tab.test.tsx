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
  return { render, click, change, press, grid, record, button, all, props, workspace, store, invoke, info, pageSource, preparePasteInsert: load(path.join(renderer, 'pasteInsert.ts')).preparePasteInsert, editor(value: boolean) { editor = value; }, modal(value: boolean) { dialog = value; }, failApply() { failApply = true; } };
}


import React, { act } from 'react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { ChildReferenceServices } from '../../src/renderer/components/ChildReferenceDialog';
import { childReferencesZh as childText } from '../../src/renderer/locales/childReferences.zh-CN';

vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: ({ rows }: { rows: unknown[] }) => <pre aria-label="完整表页子网格RAM端口">{JSON.stringify(rows)}</pre> }));
let memory: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], dialogRoot: ReturnType<typeof createRoot> | undefined;
let ChildReferenceDialog: typeof import('../../src/renderer/components/ChildReferenceDialog')['ChildReferenceDialog'];
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
beforeAll(async () => {
  memory = memoryDocument();
  const create=memory.createElement.bind(memory); memory.createElement=name=>{
    const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);
    // 原生option省略value时以正文为值，仅修DOM端口反射，不替代组件事件或参数。
    if(name==='option')Object.defineProperty(node,'value',{get:()=>node.getAttribute('value')??node.textContent,set:value=>{set('value',String(value));}});
    node.setAttribute=(key,value)=>{set(key,value);if(key==='disabled')node.disabled=true;if(key==='value'&&name==='option')node.value=value;};
    node.removeAttribute=key=>{remove(key);if(key==='disabled')node.disabled=false;};
    if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{get:()=>node.querySelectorAll('option').find(option=>(option as MemoryNode&{selected?:boolean}).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as MemoryNode&{selected?:boolean}).selected=option.value===value;}});}
    return node;
  }; ({createRoot}=await import('react-dom/client')); ({ChildReferenceDialog}=await import('../../src/renderer/components/ChildReferenceDialog'));
});
afterEach(async()=>{if(dialogRoot){await act(async()=>dialogRoot!.unmount());dialogRoot=undefined;}memory.body.textContent='';});
afterAll(()=>{for(const[key,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});

it('完整生产TableTab实际点击→真实Dialog→指定只读服务；无正向FK、父暂存草稿和精度字节全部保留',async()=>{
  const f=await fixture();await f.change('父行已暂存草稿');const row=f.grid().rows[0],original=row.original;
  f.grid().onActivePositionChange({row,column:{key:'note'}});await f.render();
  expect(f.info.foreignKeys).toEqual([]);expect(f.button(childText.title).props.disabled).toBe(false);await f.click(childText.title);
  const child=f.all('ChildReferenceDialog')[0];expect(child).toBeDefined();expect(child.props.intent.current()).toBe(true);expect(child.props.intent.data.note).toBe('父行已暂存草稿');
  const source=child.props.intent.source,relation={database:'child_db',table:'child',digest:'b'.repeat(64),foreignKey:{name:'fk',columns:['parent_id','parent_note'],referencedDatabase:source.database,referencedTable:source.name,referencedColumns:['id','note'],onUpdate:'RESTRICT',onDelete:'RESTRICT'}};
  const incoming=vi.fn(async()=>({source,sourceDigest:'a'.repeat(64),relations:[relation],scope:'visible-only' as const}));
  const page=vi.fn<ChildReferenceServices['page']>(async input=>({source,sourceDigest:'a'.repeat(64),relation,target:{...source,database:'child_db',name:'child'},page:{rows:[{value:'只读子行'}],columns:[{key:'value',name:'value',type:'TEXT'}],page:input.page,pageSize:input.pageSize,hasMore:false},stablePagination:true}));
  const host=memory.createElement('div');memory.body.appendChild(host);dialogRoot=createRoot(host as any);await act(async()=>{dialogRoot!.render(<ChildReferenceDialog {...child.props as any} services={{incoming,page,cancel:async()=>{}}}/>);});
  expect(incoming).toHaveBeenCalledWith({connectionId:'连接',database:'db',table:'items',taskId:expect.any(String)});
  const select=memory.body.querySelectorAll('select').find(node=>node.getAttribute('aria-label')===childText.relations)!;
  await act(async()=>{select.value='0';select.dispatchEvent(new MemoryEvent('change'));});
  expect(page).toHaveBeenCalledOnce();expect(page.mock.calls[0][0].matchValues).toEqual(['18446744073709551615','父行已暂存草稿']);expect(page.mock.calls[0][0].relation).toEqual({database:'child_db',table:'child',foreignKeyName:'fk',digest:'b'.repeat(64)});
  expect(f.grid().rows[0]).toBe(row);expect(f.grid().rows[0].original).toBe(original);expect(f.grid().rows[0].data.note).toBe('父行已暂存草稿');expect(f.grid().rows[0].data.bytes).toEqual({type:'binary',base64:'AAH/'});
  expect(f.invoke.mock.calls.some(([command])=>command.startsWith('query.execute')||command==='table.apply')).toBe(false);
});
it.each(['new','deleted','view'])('完整生产表页%s行/对象入口禁用，不打开窗口或清草稿',async mode=>{
  const f=await fixture();await f.change('保留草稿');if(mode==='new'){await f.click(zh.common.add);}else if(mode==='deleted'){const rows=f.grid().rows;rows[0].deleted=true;f.grid().onActivePositionChange({row:rows[0],column:{key:'note'}});await f.render();}else{f.info.objectKind='view';f.grid().onActivePositionChange({row:f.grid().rows[0],column:{key:'note'}});await f.render();}
  expect(f.button(childText.title).props.disabled).toBe(true);expect(f.all('ChildReferenceDialog')).toHaveLength(0);expect(f.grid().rows[0].data.note).toBe('保留草稿');
});
