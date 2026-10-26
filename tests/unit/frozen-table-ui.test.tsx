import { act, useState, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import type { TablePreferences } from '../../src/shared/tablePreferences';
import { frozenTableKeys, reconcileTablePreferences } from '../../src/renderer/tableColumnPreferences';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { cellClipboardType } from '../../src/renderer/gridClipboard';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const port = vi.hoisted(() => ({ grids: [] as any[], invoke: vi.fn() }));
// 内存端口不模拟浏览器sticky布局；实际ResultsGrid、选择/复制守卫和偏好对话框仍运行。
vi.mock('react-data-grid', () => ({ SelectColumn: Object.freeze({ key: 'select-row', frozen: true }), DataGrid(props: any) { port.grids.push(props); return <div role="grid"/>; } }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Preferences: typeof import('../../src/renderer/components/TablePreferencesDialog')['TablePreferencesDialog'];
let Grid: typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'];
let store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
type Node = ReturnType<typeof memoryDocument>['body'];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') {
      let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } });
    }
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
  ({ TablePreferencesDialog: Preferences } = await import('../../src/renderer/components/TablePreferencesDialog'));
  ({ ResultsGrid: Grid } = await import('../../src/renderer/components/ResultsGrid'));
  ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; port.grids.length = 0; port.invoke.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

async function mount(element: ReactNode) { port.invoke.mockImplementation(() => { throw Error('冻结布局不得调用数据库、文件或系统剪贴板'); }); (window as any).dbark = { invoke: port.invoke }; const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await render(element); }
async function render(element: ReactNode) { await act(async () => root!.render(element)); }
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.getAttribute('aria-label') === label || item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function props(node: Node) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }

/** 偏好变化经真实React重渲染，保存端口只记录显式动作，不代替真实文件或数据库验收。 */
async function preferences(initial: TablePreferences = { version: 1, columns: [{ name: 'id', hidden: false, width: 165 }, { name: 'amount', hidden: false, width: 200 }, { name: 'payload', hidden: false, width: 250 }, { name: 'secret', hidden: true }] }) {
  let current = initial, replace!: (next: TablePreferences) => void;
  const changes = vi.fn(), saved = vi.fn(), reset = vi.fn(), closed = vi.fn();
  function Harness({ pending = false }: { pending?: boolean }) {
    const [value, setValue] = useState(initial); current = value; replace = setValue;
    return <Preferences preferences={value} pending={pending} dirty={changes.mock.calls.length > 0} error="" onChange={next => { current = next; changes(next); setValue(next); }} onSave={() => saved(current)} onReset={() => { const next = reconcileTablePreferences(initial.columns.map(column => column.name), null); current = next; reset(); setValue(next); }} onClose={closed}/>;
  }
  await mount(<Harness/>);
  return { get current() { return current; }, changes, saved, reset, closed, Harness, replace: async (next: TablePreferences) => { await act(async () => replace(next)); } };
}

it('冻结只即时设置可见边界，不重排列或显式保存，隐藏列不能作为边界且可统一取消', async () => {
  const f = await preferences(), order = f.current.columns.map(column => column.name);
  expect(button(text.freezeThrough('secret')).disabled).toBe(true); expect(button(text.unfreeze).disabled).toBe(true);
  await click(text.freezeThrough('amount')); expect(f.current.frozenThrough).toBe('amount'); expect(frozenTableKeys(f.current)).toEqual(['id', 'amount']);
  expect(f.current.columns.map(column => column.name)).toEqual(order); expect(f.saved).not.toHaveBeenCalled(); expect(f.reset).not.toHaveBeenCalled();
  expect(document.querySelector(`[role="status"][aria-label="${text.frozenThrough('amount')}"]`)!.textContent).toBe(text.frozenThrough('amount')); expect(document.body.textContent).toContain(text.freezeHint);
  await click(text.unfreeze); expect(f.current).not.toHaveProperty('frozenThrough'); expect(frozenTableKeys(f.current)).toEqual([]); expect(f.saved).not.toHaveBeenCalled(); expect(port.invoke).not.toHaveBeenCalled();
});

it('冻结和列移动保留未失焦宽度草稿，显式保存才合并输入，恢复默认会清除冻结', async () => {
  const f = await preferences(), width = document.querySelector(`input[aria-label="${text.width} id"]`)!;
  await act(async () => { width.value = '333'; width.dispatchEvent(new MemoryEvent('input')); });
  await click(text.freezeThrough('amount')); expect(width.value).toBe('333'); expect(f.current.columns.find(column => column.name === 'id')!.width).toBe(165);
  await click(`${text.up} payload`); expect(f.current.columns.map(column => column.name)).toEqual(['id', 'payload', 'amount', 'secret']); expect(frozenTableKeys(f.current)).toEqual(['id', 'payload', 'amount']); expect(width.value).toBe('333');
  await click(text.save); expect(f.saved).toHaveBeenCalledTimes(1); expect(f.saved.mock.calls[0][0].columns.find((column: { name: string }) => column.name === 'id').width).toBe(333); expect(f.saved.mock.calls[0][0].frozenThrough).toBe('amount');
  await click(text.reset); expect(f.reset).toHaveBeenCalledTimes(1); expect(f.current).not.toHaveProperty('frozenThrough'); expect(width.value).toBe('165'); expect(port.invoke).not.toHaveBeenCalled();
});

it('隐藏边界后立即取消冻结；宽度非法仍拒绝保存，不以冻结动作丢弃输入或自动修正', async () => {
  const f = await preferences(); await click(text.freezeThrough('amount'));
  const checkbox = document.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent.includes('amount'))!;
  await act(async () => { checkbox.checked = false; checkbox.dispatchEvent(new MemoryEvent('click')); }); expect(f.current).not.toHaveProperty('frozenThrough'); expect(f.current.columns.find(column => column.name === 'amount')!.hidden).toBe(true);
  const width = document.querySelector(`input[aria-label="${text.width} id"]`)!; await act(async () => { width.value = ''; width.dispatchEvent(new MemoryEvent('input')); });
  await click(text.freezeThrough('payload')); expect(width.value).toBe(''); await click(text.save); expect(f.saved).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.widthInvalid); expect(width.value).toBe('');
});

it('pending、偏好ABA及卸载不能借旧冻结按钮追加布局变更', async () => {
  const f = await preferences(), original = f.current, old = props(button(text.freezeThrough('amount'))).onClick;
  await render(<f.Harness pending/>); await act(async () => old()); expect(f.changes).not.toHaveBeenCalled(); expect(button(text.freezeThrough('amount')).disabled).toBe(true);
  await render(<f.Harness/>); await f.replace({ ...original, columns: original.columns.map(column => ({ ...column })) }); await f.replace(original);
  await act(async () => old()); expect(f.changes).not.toHaveBeenCalled(); const current = props(button(text.freezeThrough('amount'))).onClick;
  await render(<span/>); await act(async () => current()); expect(f.changes).not.toHaveBeenCalled();
});

const columns = Object.freeze([{ key: 'id', name: '重复列名', type: 'LONGLONG' }, { key: 'amount', name: '重复列名', type: 'NEWDECIMAL' }, { key: 'payload', name: '字节', type: 'BLOB' }].map(Object.freeze)) as unknown as ResultColumn[];
const rows = Object.freeze([Object.freeze({ id: '9007199254740993', amount: '0.12345678901234567890', payload: Object.freeze({ type: 'binary', base64: 'AP8=' }) })]) as unknown as DataRow[];
function grid() { const result = port.grids.at(-1); expect(result).toBeDefined(); return result!; }
function dataColumns() { return grid().columns.filter((column: { key: string }) => column.key !== 'select-row'); }
function configureGridStore() { store.setState(state => ({ settings: { ...state.settings, theme: 'light', activeTabId: 'q', tabs: [{ id: 'q', kind: 'query', title: '内存查询', connectionId: 'c', sql: 'SELECT fixture' }] }, connections: [], connectionVersions: { c: 1 }, activeJobs: {} })); }

it.each([[undefined, 0], [[], 0], [['id'], 1], [['id', 'amount'], 2], [['id', 'amount', 'payload'], 3]] as const)('ResultsGrid只冻结实际列前缀 %j，保留选择列对象和原始显示顺序', async (frozenKeys, expected) => {
  configureGridStore(); const beforeColumns = JSON.stringify(columns), beforeRows = JSON.stringify(rows);
  await mount(<Grid columns={columns} rows={rows} frozenKeys={frozenKeys}/>);
  expect(dataColumns().map((column: { key: string }) => column.key)).toEqual(['id', 'amount', 'payload']); expect(dataColumns().map((column: { frozen: boolean }) => column.frozen)).toEqual(columns.map((_, index) => index < expected));
  expect(grid().columns[0]).toEqual({ key: 'select-row', frozen: true }); expect(grid().rows).toBe(rows); expect(JSON.stringify(columns)).toBe(beforeColumns); expect(JSON.stringify(rows)).toBe(beforeRows); expect(port.invoke).not.toHaveBeenCalled();
});

it.each([['amount'], ['amount', 'id'], ['id', 'missing'], ['id', 'id'], ['id', 'amount', 'payload', 'extra']].map(keys => [keys] as const))('非前缀或过期键整组不冻结，不让RDG静默重排：%j', async frozenKeys => {
  configureGridStore(); await mount(<Grid columns={columns} rows={rows} frozenKeys={frozenKeys}/>); expect(dataColumns().every((column: { frozen: boolean }) => column.frozen === false)).toBe(true); expect(dataColumns().map((column: { key: string }) => column.key)).toEqual(columns.map(column => column.key));
});

it('稀疏和访问器冻结键安全整组关闭，不执行getter；重复内部列键也不授予冻结', async () => {
  configureGridStore(); const getter = vi.fn(() => 'id'), accessor = ['id']; Object.defineProperty(accessor, '0', { enumerable: true, get: getter });
  await mount(<Grid columns={columns} rows={rows} frozenKeys={accessor}/>); expect(getter).not.toHaveBeenCalled(); expect(dataColumns().every((column: { frozen: boolean }) => column.frozen === false)).toBe(true);
  await render(<Grid columns={columns} rows={rows} frozenKeys={new Array(2)}/>); expect(dataColumns().every((column: { frozen: boolean }) => column.frozen === false)).toBe(true);
  await render(<Grid columns={[columns[0], { ...columns[1], key: 'id' }]} rows={rows} frozenKeys={['id']}/>); expect(dataColumns().every((column: { frozen: boolean }) => column.frozen === false)).toBe(true);
});

it('冻结变化撤销旧网格回调，当前排序/选择/复制仍保持完整原值和同一顺序', async () => {
  configureGridStore(); const selection = vi.fn(() => true), sorted = vi.fn(), owner = {}, current = () => true;
  const renderGrid = (frozenKeys: readonly string[]) => <Grid columns={columns} rows={rows} frozenKeys={frozenKeys} selectionScope={owner} isCurrent={current} onSelectionChange={selection} onSortChange={sorted}/>;
  await mount(renderGrid(['id'])); const old = grid(); await render(renderGrid(['id', 'amount'])); await render(renderGrid(['id']));
  const values = new Map<string, string>(), event = { preventDefault: vi.fn(), clipboardData: { setData: (key: string, value: string) => values.set(key, value) } };
  await act(async () => { old.onSortColumnsChange([{ columnKey: 'amount', direction: 'DESC' }]); old.onSelectedRowsChange(new Set([0])); old.onCellCopy({ row: rows[0], column: columns[0] }, event); });
  expect(sorted).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled(); expect(values.size).toBe(0);
  await act(async () => { grid().onSortColumnsChange([{ columnKey: 'amount', direction: 'DESC' }]); grid().onSelectedRowsChange(new Set([0])); }); expect(sorted).toHaveBeenCalledWith([{ column: 'amount', direction: 'DESC' }]);
  await act(async () => grid().onCellCopy({ row: rows[0], column: columns[0] }, event)); expect(values.get('text/plain')).toContain('9007199254740993\t0.12345678901234567890'); expect(values.get(cellClipboardType)).toContain('AP8=');
  expect(dataColumns().map((column: { key: string }) => column.key)).toEqual(['id', 'amount', 'payload']); expect(grid().rows).toBe(rows); expect(port.invoke).not.toHaveBeenCalled();
});

it('相同前缀的新数组不制造新的布局变化，原网格选择回调仍可被当前scope接纳', async () => {
  configureGridStore(); const selected = vi.fn(() => true), owner = {}, current = () => true;
  const view = (frozenKeys: readonly string[]) => <Grid columns={columns} rows={rows} frozenKeys={frozenKeys} selectionScope={owner} isCurrent={current} onSelectionChange={selected}/>;
  await mount(view(['id'])); const original = grid(); await render(view(['id'])); await act(async () => original.onSelectedRowsChange(new Set([0]))); expect(selected).toHaveBeenCalledTimes(1);
});
