import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultPresetSnapshotSchema, queryResultPresetValueSchema, type QueryResultPresetValue } from '../../src/shared/queryResultPresets';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { queryResultPresetsZh as presetsText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultMemoryZh as memoryText } from '../../src/renderer/locales/queryResultMemory.zh-CN';
import { queryResultHistoryZh as historyText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { captureQueryResultMemory } from '../../src/renderer/queryResultMemory';
import { zh } from '../../src/renderer/locales/zh-CN';
import { validateResultExportData } from '../../src/shared/resultExport';

const grids = vi.hoisted(() => ({ all: [] as any[] }));
// 只合成Monaco和虚拟网格端口，真实QueryTab、列管理、方案、暂存、历史和store仍共同运行。
vi.mock('react-data-grid', () => ({ DataGrid: (props: any) => { grids.all.push(props); return null; }, SelectColumn: { key: 'select-row' } }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let original: QueryResult, commands: string[], exports: any[], savedValues: QueryResultPresetValue[], entries: Array<{ id: string; name: string; connectionDigest: string; value: QueryResultPresetValue }>, observers: Set<Function>;
const presetId = '11111111-1111-4111-8111-111111111111', token = '22222222-2222-4222-8222-222222222222', digest = 'd'.repeat(64);
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'MutationObserver', 'Element'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);

beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: () => true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
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
  (globalThis as any).MutationObserver = class { constructor(private action: Function) { observers.add(action); } observe() {} disconnect() { observers.delete(this.action); } };
  ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; await flush(); delete (window as any).dbark; document.body.textContent = ''; grids.all = []; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 合成返回包含重名别名和精确值；IPC仅在RAM中记录，不接磁盘、系统剪贴板或服务器。 */
async function mount(value?: Partial<QueryResultPresetValue>) {
  commands = []; exports = []; savedValues = [];
  original = { columns: [{ key: 'c0', name: '同名', type: 'BIGINT' }, { key: 'c1', name: '同名', type: 'VARCHAR' }, { key: 'c2', name: '空值', type: 'TEXT' }], rows: [{ c0: '9007199254740993', c1: '保留', c2: null }, { c0: '2', c1: '排除', c2: '原文' }, { c0: '1', c1: '保留', c2: '' }], truncated: false, elapsedMs: 1, statement: 'SELECT 仅RAM' };
  const configuration = queryResultPresetValueSchema.parse({ columns: original.columns, visible: original.columns, configuration: { expression: { mode: 'AND', children: [] }, sort: [] }, ...value });
  entries = [{ id: presetId, name: '已有方案', connectionDigest: digest, value: configuration }]; let revision = 1;
  const snapshot = () => queryResultPresetSnapshotSchema.parse({ version: 1, revision, bindingToken: token, source: { connectionRevision: 1, connectionDigest: digest }, entries });
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (['settings.save', 'connections.open', 'sessions.close'].includes(command)) return;
    if (command === 'sessions.open') return { sessionId: 'session' };
    if (command === 'query.completionState') return { databaseKnown: true, database: null, temporaryObjects: [] };
    if (command === 'query.execute') return { results: [original], elapsedMs: 1, transactionOpen: false };
    if (command === 'result.presets.list') return structuredClone(snapshot());
    if (command === 'result.presets.read') return structuredClone(entries.find(entry => entry.id === input.id)!.value);
    if (command === 'result.presets.save') {
      const admitted = queryResultPresetValueSchema.parse(input.value); savedValues.push(admitted);
      entries.push({ id: '33333333-3333-4333-8333-333333333333', name: input.name, connectionDigest: digest, value: admitted }); revision++; return structuredClone(snapshot());
    }
    if (command === 'files.choose') return { token: 'ram-file', name: '内存导出' };
    if (command === 'files.exportResult') { validateResultExportData(input.result); exports.push(structuredClone(input)); return { rows: input.result.rows.length }; }
    throw Error('冻结列RAM用例拒绝外界命令：' + command);
  } };
  store.setState({ settings: { theme: 'light', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query', connectionId: 'c', title: '查询', sql: 'SELECT 仅RAM', databaseContext: { state: 'known', database: null } }] }, connections: [{ id: 'c', name: 'RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { c: 1 }, activeJobs: {}, dirtyTabs: {} });
  function Harness() { return store(state => state.settings.tabs).map(tab => <QueryTab key={tab.id} tab={tab} onHistory={() => {}}/>); }
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Harness/>)); await click(zh.query.text010);
}

/** 用户入口按原列序号定位，不以重复显示名称辨认列。 */
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name || name === zh.query.text010 && node.textContent.startsWith(name)); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function toggle(position: number, checked: boolean) { const node = document.querySelector(`input[aria-label="${text.visible(position)}"]`)!; expect(node).not.toBeNull(); await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function change(selector: string, value: string, event = 'change') { const node = document.querySelector(selector)!; expect(node).not.toBeNull(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent(event)); }); }
function grid() { expect(grids.all.length).toBeGreaterThan(0); return grids.all.at(-1)!; }
function frozen() { return grid().columns.filter((column: any) => column.key !== 'select-row' && column.frozen === true).map((column: any) => column.key); }
function visible() { return grid().columns.filter((column: any) => column.key !== 'select-row').map((column: any) => column.key); }
function callback(node: any, event = 'onClick') { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React闭包'); return node[key][event] as Function; }
async function freeze(position: number) { await click(text.open); await click(text.freezeThrough(position)); await click(text.apply); }
/** 只使用合成ClipboardEvent数据比较复制语义，绝不读取或覆盖系统剪贴板。 */
function copy(props = grid()) { const data = new Map<string, string>(); props.onCellCopy({ row: props.rows[0], column: { key: props.columns.find((column: any) => column.key !== 'select-row').key } }, { preventDefault() {}, clipboardData: { setData: (key: string, value: string) => data.set(key, value) } }); return data; }
async function applyPreset() { await click(presetsText.open); await change(`select[aria-label="${presetsText.choose}"]`, presetId); await click(presetsText.apply); }

it('正式查询入口冻结重名第二列，仅设可见前缀，行、精度、复制及导出保持', async () => {
  await mount(); const before = structuredClone(original), old = grid(), copied = copy();
  await click(text.open); await click(text.freezeThrough(2)); expect(document.body.textContent).toContain(text.frozenThrough(2)); expect(button(text.freezeThrough(2)).getAttribute('aria-pressed')).toBe('true'); await click(text.apply);
  expect(frozen()).toEqual(['c0', 'c1']); expect(visible()).toEqual(['c0', 'c1', 'c2']); expect(grid().rows).toBe(original.rows); expect(original).toEqual(before); expect(copy()).toEqual(copied); expect(copy(old).size).toBe(0);
  await click(zh.resultExport.title); const choose = document.querySelectorAll('button').find(node => node.textContent.includes(zh.resultExport.chooseFile))!; await act(async () => choose.dispatchEvent(new MemoryEvent('click'))); await click(zh.resultExport.start);
  expect(exports[0].result.rows).toEqual(original.rows); expect(exports[0].result.columns.map((column: any) => column.key)).toEqual(['c0', 'c1', 'c2']); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('冻结/取消冻结草稿不立即发布，隐藏边界时清除且不按同名另一列替代', async () => {
  await mount(); await click(text.open); await click(text.freezeThrough(1)); await click(zh.common.cancel); expect(frozen()).toEqual([]);
  await freeze(2); await click(text.open); await click(text.unfreeze); await click(zh.common.cancel); expect(frozen()).toEqual(['c0', 'c1']);
  await click(text.open); await toggle(2, false); expect(button(text.freezeThrough(2)).disabled).toBe(true); expect(document.body.textContent).toContain(text.notFrozen); await click(text.apply);
  expect(frozen()).toEqual([]); expect(visible()).toEqual(['c0', 'c2']); expect(Object.hasOwn(grid().rows[0], 'c1')).toBe(true);
});

it('移动及恢复顺序保持同一内部边界，隐藏前方列只缩短实际冻结前缀', async () => {
  await mount(); await freeze(2); await click(text.open); await click(text.up(3)); await click(text.apply);
  expect(visible()).toEqual(['c0', 'c2', 'c1']); expect(frozen()).toEqual(['c0', 'c2', 'c1']);
  await click(text.open); await click(text.restore); expect(document.body.textContent).toContain(text.frozenThrough(2)); await click(text.apply); expect(frozen()).toEqual(['c0', 'c1']);
  await click(text.open); await toggle(1, false); await click(text.apply); expect(frozen()).toEqual(['c1']); expect(visible()).toEqual(['c1', 'c2']);
});

it('只改变冻结边界不清除已生效筛选/排序，撤销重做只恢复整理并保留当前冻结', async () => {
  await mount({ frozenThrough: 'c1', configuration: { expression: { mode: 'AND', children: [{ column: 'c1', operator: 'eq', value: '保留' }] }, sort: [{ column: 'c0', direction: 'DESC' }] } });
  await applyPreset(); expect(grid().rows.map((row: any) => row.c0)).toEqual(['9007199254740993', '1']); expect(frozen()).toEqual(['c0', 'c1']);
  const rows = grid().rows, sorted = grid().sortColumns; await freeze(1);
  expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual(sorted); expect(frozen()).toEqual(['c0']);
  await click(historyText.undo); expect(grid().rows).toBe(original.rows); expect(frozen()).toEqual(['c0']);
  await click(historyText.redo); expect(grid().rows.map((row: any) => row.c0)).toEqual(['9007199254740993', '1']); expect(frozen()).toEqual(['c0']);
});

it('真实命名方案入口捕获边界并显示原序号，取消冻结后应用原方案恢复', async () => {
  await mount(); await freeze(2); await click(presetsText.open);
  expect(document.querySelector(`[aria-label="${presetsText.currentFrozen}"]`)!.textContent).toBe(presetsText.frozenThrough(2, '同名'));
  await change(`input[aria-label="${presetsText.name}"]`, '冻结方案', 'input'); await click(presetsText.create); expect(savedValues).toHaveLength(1); expect(savedValues[0].frozenThrough).toBe('c1');
  expect(document.querySelector(`[aria-label="${presetsText.savedFrozen}"]`)!.textContent).toBe(presetsText.frozenThrough(2, '同名')); await click(zh.common.close);
  await click(text.open); await click(text.unfreeze); await click(text.apply); expect(frozen()).toEqual([]);
  await click(presetsText.open); await change(`select[aria-label="${presetsText.choose}"]`, '33333333-3333-4333-8333-333333333333'); await click(presetsText.apply); expect(frozen()).toEqual(['c0', 'c1']);
});

it('旧方案无边界明确取消当前冻结，界面预览不会误称沿用', async () => {
  await mount(); await freeze(2); await click(presetsText.open); await change(`select[aria-label="${presetsText.choose}"]`, presetId);
  expect(document.querySelector(`[aria-label="${presetsText.savedFrozen}"]`)!.textContent).toBe(presetsText.notFrozen); await click(presetsText.apply); expect(frozen()).toEqual([]);
});

it('内存暂存完整携带边界，旧无边界暂存仍保持旧形状且应用会清除冻结', async () => {
  await mount(); const plain = captureQueryResultMemory(original, original.columns, { expression: { mode: 'AND', children: [] }, sort: [] });
  expect(Object.keys(plain).sort()).toEqual(['columns', 'configuration', 'visible']);
  const stored = captureQueryResultMemory(original, original.columns, plain.configuration, 'c1'); expect(stored.frozenThrough).toBe('c1'); expect(Object.isFrozen(stored)).toBe(true); expect(JSON.stringify(stored)).not.toContain('SELECT'); expect(JSON.stringify(stored)).not.toContain('rows');
  await freeze(2); await click(memoryText.save); await click(text.open); await click(text.unfreeze); await click(text.apply); await click(memoryText.apply); expect(frozen()).toEqual(['c0', 'c1']);
  await click(text.open); await click(text.unfreeze); await click(text.apply); await click(memoryText.save); await freeze(2); await click(memoryText.apply); expect(frozen()).toEqual([]);
});

it('当前固定快照能独立冻结，切换准确来源按原布局寿命重置', async () => {
  await mount(); await freeze(2); await click(zh.query.pinResult); expect(frozen()).toEqual([]);
  const pinnedRows = grid().rows; expect(pinnedRows).not.toBe(original.rows); await freeze(1); expect(frozen()).toEqual(['c0']); expect(grid().rows).toBe(pinnedRows);
  const old = grid(); await click(zh.query.currentResults); expect(frozen()).toEqual([]); expect(grid().rows).toBe(original.rows); expect(copy(old).size).toBe(0);
});

it('旧冻结行和应用闭包不能越过草稿换代、关闭重开及工作台ABA', async () => {
  await mount(); await click(text.open); const staleFreeze = callback(button(text.freezeThrough(1))); await click(text.freezeThrough(2)); await act(async () => staleFreeze());
  expect(document.body.textContent).toContain(text.frozenThrough(2)); const staleApply = callback(button(text.apply)); await click(zh.common.cancel); await click(text.open); await act(async () => staleApply()); await click(text.apply); expect(frozen()).toEqual([]);
  await click(text.open); const oldFreeze = callback(button(text.freezeThrough(2))), oldApply = callback(button(text.apply));
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  await act(async () => { oldFreeze(); oldApply(); }); expect(frozen()).toEqual([]); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});
