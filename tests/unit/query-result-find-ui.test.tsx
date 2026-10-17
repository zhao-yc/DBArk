import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { DataRow, QueryResult, ResultColumn } from '../../src/shared/contracts';
import { queryResultFindZh as text } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryResultColumnsZh as columnText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
const ports = vi.hoisted(() => ({ grids: [] as any[], scroll: vi.fn(), activate: vi.fn(), hostKey: 0 }));
// 仅替换虚拟布局与Monaco端口，真实Grid/查找栏/QueryTab/store/导出窗口全部运行。
vi.mock('react-data-grid', async () => {
  const { useImperativeHandle, useRef } = await import('react');
  return { SelectColumn: { key: 'select-row' }, DataGrid(props: any) { const host = useRef<HTMLDivElement>(null); ports.grids.push(props); useImperativeHandle(props.ref, () => ({ element: host.current, scrollToCell: ports.scroll, setActivePosition: ports.activate })); return <div key={ports.hostKey} ref={host} role="grid" tabIndex={0}/>; } };
});
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => <div role="textbox" aria-label="RAM SQL编辑器"/> }));
let Grid: typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'];
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let original: QueryResult, commands: string[], exports: any[], observers: Set<Function>;
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT','MutationObserver','Element'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: () => true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  observers = new Set(); (globalThis as any).Element = create('div').constructor;
  (globalThis as any).MutationObserver = class { constructor(private callback: Function) { observers.add(callback); } observe() {} disconnect() { observers.delete(this.callback); } };
  ({ createRoot } = await import('react-dom/client')); ({ ResultsGrid: Grid } = await import('../../src/renderer/components/ResultsGrid'));
  ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.useRealTimers(); await flush(); delete (window as any).dbark; vi.restoreAllMocks(); ports.grids = []; ports.scroll.mockClear(); ports.activate.mockClear(); ports.hostKey = 0; document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function container() { const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); }
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name || name === zh.query.text010 && node.textContent.startsWith(name)); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function search(value: string) { const node = document.querySelector(`input[aria-label="${text.input}"]`)!; expect(node).not.toBeNull(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
/** 定时器只推进本例RAM分块；不启动浏览器，也不使用系统clipboard。 */
async function settle() { await act(async () => { await vi.runAllTimersAsync(); }); }
function latestGrid() { return ports.grids.at(-1)!; }
/** 保存真实React闭包以检验旧代次迟到回调，不把UI按钮是否禁用当作唯一防护。 */
function callback(node: any, event = 'onClick') { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return node[key][event] as Function; }
function copy(grid = latestGrid()) { const values = new Map<string,string>(); grid.onCellCopy({ row: grid.rows[0], column: { key: grid.columns[1].key } }, { preventDefault() {}, clipboardData: { setData: (key: string, value: string) => values.set(key, value) } }); return values; }
const cols: ResultColumn[] = [{ key: 'a', name: '同名', type: 'TEXT' }, { key: 'b', name: '同名', type: 'TEXT' }];

it('真实Grid局部Ctrl/Cmd+F打开、分块搜索、上下/Enter环绕并滚动唯一可见列；不改变勾选或复制', async () => {
  (window as any).dbark = { invoke: vi.fn(async () => undefined) }; store.setState({ settings: { theme: 'light' } as any }); container();
  const rows = [{ a: 'Alpha', b: 'z' }, { a: 'other', b: 'ALPHA' }], selected = vi.fn(() => true);
  await act(async () => root!.render(<Grid columns={cols} rows={rows} selectionScope={{}} isCurrent={() => true} onSelectionChange={selected}/>));
  await act(async () => latestGrid().onSelectedRowsChange(new Set([1]))); const before = copy();
  vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] });
  for (const modifier of ['ctrlKey','metaKey']) { const event = Object.assign(new MemoryEvent('keydown'), { key: 'f', [modifier]: true }); await act(async () => document.querySelector('[role="grid"]')!.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true); }
  const clone = vi.spyOn(globalThis, 'structuredClone'); await search('alpha'); await settle(); expect(document.body.textContent).toContain('2 个匹配单元格');
  await click(text.next); expect(ports.scroll).toHaveBeenLastCalledWith({ rowIdx: 0, idx: 1 });
  await click(text.previous); expect(ports.scroll).toHaveBeenLastCalledWith({ rowIdx: 1, idx: 2 });
  const enter = Object.assign(new MemoryEvent('keydown'), { key: 'Enter' }); await act(async () => document.querySelector(`input[aria-label="${text.input}"]`)!.dispatchEvent(enter)); expect(ports.scroll).toHaveBeenLastCalledWith({ rowIdx: 0, idx: 1 });
  expect(latestGrid().columns[1].cellClass(rows[0])).toBe('query-result-find-hit'); expect(latestGrid().selectedRows).toEqual(new Set([1])); expect(copy()).toEqual(before); expect(selected).toHaveBeenCalledOnce(); expect(ports.activate).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled();
  const sensitive = document.querySelector('input[type="checkbox"]')!; await act(async () => { sensitive.checked = true; sensitive.dispatchEvent(new MemoryEvent('click')); }); await settle(); expect(document.body.textContent).toContain(text.noMatch); expect(button(text.next).disabled).toBe(true);
});

it('新文字/关闭重开撤销旧扫描与导航；超限及无匹配不会保留旧位置', async () => {
  (window as any).dbark = { invoke: vi.fn(async () => undefined) }; store.setState({ settings: { theme: 'light' } as any }); container();
  const rows = Array.from({ length: 700 }, () => ({ a: 'hit', b: 'second' }));
  await act(async () => root!.render(<Grid columns={cols} rows={rows} selectionScope={{}} isCurrent={() => true}/>)); vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] });
  await click(text.open); await search('hit'); await act(async () => { await vi.advanceTimersToNextTimerAsync(); }); expect(document.body.textContent).toContain('正在查找'); const stale = callback(button(text.next));
  await search('second'); await act(async () => stale()); expect(ports.scroll).not.toHaveBeenCalled(); await settle(); await click(text.next); expect(ports.scroll).toHaveBeenLastCalledWith({ rowIdx: 0, idx: 2 });
  const oldNext = callback(button(text.next)), oldClose = callback(button(text.close)); await click(text.close); await click(text.open); await search('missing'); await settle();
  await act(async () => { oldNext(); oldClose(); }); expect(document.body.textContent).toContain(text.noMatch); expect(document.querySelector(`input[aria-label="${text.input}"]`)).not.toBeNull(); expect(ports.scroll).toHaveBeenCalledOnce();
  await search('x'.repeat(257)); await settle(); expect(document.body.textContent).toContain(text.invalid); expect(button(text.next).disabled).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

/** 原查询端口只返回合成常量；选择/导出/设置全部走RAM原UI命令，不实际执行SQL或文件。 */
async function mountQuery() {
  commands = []; exports = [];
  original = { columns: [...cols, { key: 'n', name: '空值', type: 'TEXT' }, { key: 'bytes', name: '字节', type: 'BLOB' }], rows: [{ a: 'hit', b: '18446744073709551615', n: null, bytes: { type: 'binary', base64: 'AP8=' } }, { a: 'hit', b: '0.12345678901234567890', n: '', bytes: { type: 'binary', base64: '' } }], elapsedMs: 1, truncated: true, statement: 'SELECT RAM' };
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command); if (['settings.save','connections.open','sessions.close'].includes(command)) return;
    if (command === 'sessions.open') return { sessionId: 's' };
    if (command === 'query.completionState') return { databaseKnown: true, database: null, temporaryObjects: [] };
    if (command === 'query.execute') return { results: [original, { ...original, columns: [{ key: 'new', name: '新列', type: 'TEXT' }], rows: [{ new: 'hit' }] }], elapsedMs: 1, transactionOpen: false };
    if (command === 'files.choose') return { token: 'ram-file', name: '内存文件' };
    if (command === 'files.exportResult') { exports.push(input); return { rows: input.result.rows.length }; }
    throw Error('禁止真实命令：' + command);
  } };
  store.setState({ settings: { theme: 'light', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query', connectionId: 'c', title: '查询', sql: 'SELECT RAM', databaseContext: { state: 'known', database: null } }] }, connections: [{ id: 'c', name: 'RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { c: 1 }, activeJobs: {}, dirtyTabs: {} });
  function Harness() { const tabs = store(state => state.settings.tabs); return tabs.map(tab => <QueryTab key={tab.id} tab={tab} onHistory={() => {}}/>); }
  container(); await act(async () => root!.render(<Harness/>)); await click(zh.query.text010);
  vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] });
}

it('真实QueryTab查找不再执行SQL，Monaco快捷键不被接管；当前导出仍是全部已返回行和原精确值', async () => {
  await mountQuery(); const grid = latestGrid(); await act(async () => grid.onSelectedRowsChange(new Set([1]))); const copied = copy();
  const event = Object.assign(new MemoryEvent('keydown'), { key: 'f', ctrlKey: true }); await act(async () => document.querySelector('[aria-label="RAM SQL编辑器"]')!.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false); expect(document.querySelector(`input[aria-label="${text.input}"]`)).toBeNull();
  await click(text.open); await search('hit'); await settle(); await click(text.next); expect(copy()).toEqual(copied); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
  await click(zh.resultExport.title); const choose = document.querySelectorAll('button').find(node => node.textContent.includes(zh.resultExport.chooseFile))!; await act(async () => choose.dispatchEvent(new MemoryEvent('click'))); await click(zh.resultExport.start);
  expect(exports).toHaveLength(1); expect(exports[0].result.rows).toHaveLength(2); expect(exports[0].result.rows[0].b).toBe('18446744073709551615'); expect(exports[0].result.rows[1].b).toBe('0.12345678901234567890'); expect(exports[0].result.columns.map((column: any) => column.key)).toEqual(original.columns.map(column => column.key)); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1); expect(ports.activate).not.toHaveBeenCalled();
});

it.each(['result','pin','layout','job','version','inactive','closed','modal','binary','unmount'] as const)('真实QueryTab的%s变化后旧查找导航永久失效，恢复也不重领', async change => {
  await mountQuery(); await click(text.open); await search('hit'); await settle(); const old = callback(button(text.next)), grid = latestGrid(), saved = store.getState().settings;
  if (change === 'result') await click(zh.query.text017 + '2');
  else if (change === 'pin') await click(zh.query.pinResult);
  else if (change === 'layout') { await click(columnText.open); await click(columnText.up(2)); await click(columnText.apply); }
  else if (change === 'job') await act(async () => { store.getState().setBusy('q', true); store.getState().setBusy('q', false); });
  else if (change === 'version') await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  else if (change === 'inactive') await act(async () => { store.setState({ settings: { ...saved, activeTabId: 'other' } }); store.setState({ settings: saved }); });
  else if (change === 'closed') await act(async () => { store.setState({ settings: { ...saved, tabs: [] } }); store.setState({ settings: saved }); });
  else if (change === 'modal') { const modal = document.createElement('div'); modal.setAttribute('role','dialog'); document.body.appendChild(modal); modal.parentNode!.removeChild(modal); await act(async () => { for (const observer of [...observers]) observer([{ addedNodes: [modal] }]); }); }
  else if (change === 'binary') await act(async () => grid.onCellDoubleClick({ row: original.rows[0], column: { key: 'bytes' } }));
  else { await act(async () => root!.unmount()); root = undefined; }
  await act(async () => old()); await settle(); await act(async () => old());
  expect(ports.scroll).not.toHaveBeenCalled(); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1); expect(exports).toHaveLength(0); expect(ports.activate).not.toHaveBeenCalled();
});


it('宿主替换撤销对照：真实RDG式handle重发可连续导航，原宿主被替换后旧导航不可复活', async () => {
  (window as any).dbark = { invoke: vi.fn(async () => undefined) }; store.setState({ settings: { theme: 'light' } as any }); container();
  const rows = [{ a: 'hit', b: 'x' }, { a: 'x', b: 'hit' }], scope = {};
  const render = () => act(async () => root!.render(<Grid columns={cols} rows={rows} selectionScope={scope} isCurrent={() => true}/>));
  await render(); vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] });
  await click(text.open); await search('hit'); await settle(); await click(text.next); await click(text.next);
  expect(ports.scroll.mock.calls).toEqual([[{ rowIdx: 0, idx: 1 }], [{ rowIdx: 1, idx: 2 }]]);
  const old = callback(button(text.next)), originalHost = document.querySelector('[role="grid"]');
  ports.hostKey++; await render(); expect(document.querySelector('[role="grid"]')).not.toBe(originalHost);
  await act(async () => old()); await settle(); expect(ports.scroll).toHaveBeenCalledTimes(2);
  ports.hostKey = 0; await render(); await act(async () => old()); expect(ports.scroll).toHaveBeenCalledTimes(2);
  await click(text.open); await search('hit'); await settle(); await click(text.next); expect(ports.scroll).toHaveBeenCalledTimes(3);
  expect(ports.activate).not.toHaveBeenCalled();
});
