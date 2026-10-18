import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { recordBatchFillZh as text } from '../../src/renderer/locales/recordBatchFill.zh-CN';
import { draftHistoryZh as historyText } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const grid = vi.hoisted(() => ({ props: null as any, rows: [] as DraftRow[] }));
// 只替换网格/Monaco外界渲染端口；TableTab、类型编辑器、弹窗、store与历史运行生产代码。
vi.mock('react-data-grid', async () => {
  const { useImperativeHandle, createElement } = await import('react');
  return { SelectColumn: { key: 'select-row' }, DataGrid(props: any) {
    grid.props = props; grid.rows = props.rows;
    useImperativeHandle(props.ref, () => ({ setActivePosition() {}, scrollToCell() {} }), []);
    return createElement('div', { role: 'grid' });
  } };
});
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let TableTab: typeof import('../../src/renderer/components/TableTab')['TableTab'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let commands: string[], previews: any[];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 仅补HTMLSelectElement/布尔disabled语义，不推导或替换产品状态。
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flush(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 所有IPC都在RAM内响应；未知命令立即失败，绝不连接服务器或真实数据库。 */
async function mount() {
  commands = []; previews = [];
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'note', 'num', 'doc', 'bin'].map(name => ({ name, type: name === 'num' ? 'decimal(65,30)' : name === 'doc' ? 'json' : name === 'bin' ? 'blob' : 'text', nullable: name !== 'id' && name !== 'num', defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const source = [1, 2, 3].map(id => ({ id: String(id), note: '原' + id, num: '0.00000000000000000000001', doc: '{"n":900719925474099312345,"x":-0}', bin: { type: 'binary', base64: 'AP8=' } }));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (['settings.save', 'connections.open', 'query.cancel', 'table.copySourceRelease'].includes(command)) return;
    if (command === 'table.preferences.get') return null;
    if (command === 'metadata.table') return info;
    if (command === 'table.page') return { page: input.page, pageSize: input.pageSize, hasMore: false, rows: structuredClone(source), columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(info) };
    if (command === 'table.preview') { previews.push(structuredClone(input)); return { sql: '仅RAM预览', warnings: [] }; }
    throw Error('禁止额外IO：' + command);
  } };
  const tab = { id: '表页', kind: 'table' as const, connectionId: '连接', database: 'db', table: 'items', title: '合成表' };
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: tab.id, tabs: [tab] }, connections: [{ id: '连接', name: '合成离线', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { 连接: 1 }, activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} });
  const noop = () => {}, container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<TableTab tab={tab} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop} />));
  expect(grid.rows).toHaveLength(3); await select(new Set(grid.rows.slice(0, 2).map(row => row.id))); return info;
}
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === name || node.textContent === name); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function select(ids: ReadonlySet<string>) { await act(async () => grid.props.onSelectedRowsChange(ids)); }
const dialog = () => document.querySelector(`[aria-label="${text.title}"]`);
async function change(node: MemoryNode, value: string, event: string) { await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent(event)); }); }
async function column(name: string) { await change(document.querySelector(`[aria-label="${text.field}"]`)!, name, 'change'); }
async function mode(value: string) { const node = document.querySelectorAll('select').find(node => node.getAttribute('id')?.endsWith('-mode')); expect(node).toBeDefined(); await change(node!, value, 'change'); }
async function input(value: string) { const node = document.querySelectorAll('textarea').find(node => node.getAttribute('class')?.includes('record-field-input')); expect(node).toBeDefined(); await change(node!, value, 'input'); }
/** 仅抓取已挂载真实React事件闭包，模拟节点移除后的迟到投递。 */
function callback(node: MemoryNode, event = 'onClick'): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('没有真实React事件'); return (node as any)[key][event]; }

describe('真实React表页批量填充RAM', () => {
  it('中文入口复用类型输入，仅改勾选记录，一步撤销/重做；手动预览进入原集中update路径', async () => {
    await mount(); const before = [...grid.rows], calls = commands.length; await click(text.action); expect(dialog()).not.toBeNull();
    expect(document.querySelector(`[aria-label="${text.field}"]`)!.querySelectorAll('option').map(node => node.value)).toEqual(['note', 'num', 'doc', 'bin']);
    await input('统一值'); await click(text.stage); expect(dialog()).toBeNull(); expect(grid.rows.slice(0, 2).map(row => row.data.note)).toEqual(['统一值', '统一值']); expect(grid.rows[2]).toBe(before[2]); expect(grid.rows[0].original).toBe(before[0].original);
    expect(commands).toHaveLength(calls); expect(button(historyText.undo).textContent).toContain('(1)'); await click(historyText.undo); expect(grid.rows).toEqual(before); await click(historyText.redo); expect(grid.rows[1].data.note).toBe('统一值'); expect(commands).toHaveLength(calls);
    await click(zh.table.text019); expect(previews).toHaveLength(1); expect(previews[0].changes).toHaveLength(2); expect(previews[0].changes.every((change: any) => change.kind === 'update')).toBe(true); expect(commands.filter(command => command === 'table.apply')).toEqual([]);
  });
  it.each([['num', 'text', '18446744073709551615.123456789012345678901'], ['doc', 'json', '{ "x":900719925474099312345,"x":-0 }'], ['bin', 'binary', '0x00FF00'], ['note', 'null', ''], ['note', 'text', 'NULL']] as const)('真实%s/%s输入保持原值语义且不发送IPC', async (name, kind, value) => {
    await mount(); const calls = commands.length; await click(text.action); await column(name); await mode(kind); if (kind !== 'null') await input(value); await click(text.stage);
    const expected = kind === 'binary' ? { type: 'binary', base64: 'AP8A' } : kind === 'null' ? null : value;
    expect(grid.rows.slice(0, 2).map(row => row.data[name])).toEqual([expected, expected]); expect(commands).toHaveLength(calls); expect(button(historyText.undo).textContent).toContain('(1)');
  });
  it('非法JSON整批不写，留在弹窗修正后仍只暂存一步', async () => {
    await mount(); const before = grid.rows, calls = commands.length; await click(text.action); await column('doc'); await input('{'); await click(text.stage); expect(dialog()).not.toBeNull(); expect(grid.rows).toBe(before); expect(button(historyText.undo).disabled).toBe(true);
    await input('{ "修正":true }'); await click(text.stage); expect(grid.rows[0].data.doc).toBe('{ "修正":true }'); expect(button(historyText.undo).textContent).toContain('(1)'); expect(commands).toHaveLength(calls);
  });
  it('选择ABA变化后旧弹窗和已移除的迟到暂存闭包都不能写', async () => {
    await mount(); const before = grid.rows, ids = grid.props.selectedRows; await click(text.action); await input('旧值'); const oldStage = callback(button(text.stage));
    await select(new Set([before[2].id])); await select(ids); expect(button(text.stage).disabled).toBe(true); await act(async () => oldStage()); expect(grid.rows).toBe(before);
    await click(zh.common.cancel); await click(text.action); await input('新值'); const newStage = callback(button(text.stage)); await act(async () => { oldStage(); newStage(); newStage(); }); expect(grid.rows.slice(0, 2).map(row => row.data.note)).toEqual(['新值', '新值']); expect(button(historyText.undo).textContent).toContain('(1)');
  });
  it.each(['inactive', 'connection', 'metadata'] as const)('%s变化使已打开意图永久失效，不补取行列', async changeKind => {
    const info = await mount(); const before = grid.rows, state = store.getState(), calls = commands.length; await click(text.action); await input('迟到值'); const stage = callback(button(text.stage));
    if (changeKind === 'inactive') { await act(async () => store.setState({ settings: { ...state.settings, activeTabId: '其它' } })); await act(async () => store.setState({ settings: state.settings })); }
    if (changeKind === 'connection') await act(async () => store.setState({ connectionVersions: { 连接: 2 } }));
    if (changeKind === 'metadata') { info.columns[1].generated = true; await select(grid.props.selectedRows); }
    await act(async () => stage()); expect(grid.rows.some(row => row.data.note === '迟到值')).toBe(false); expect(commands.slice(calls).filter(command => command === 'table.copyRead' || command === 'table.preview' || command === 'table.apply')).toEqual([]);
    if (changeKind !== 'connection') expect(grid.rows).toBe(before);
  });
  it('字段ABA切换撤销旧输入闭包，关闭后旧暂存也不写', async () => {
    await mount(); const before = grid.rows; await click(text.action); const node = document.querySelectorAll('textarea').find(node => node.getAttribute('class')?.includes('record-field-input'))!, oldInput = callback(node, 'onChange'), oldStage = callback(button(text.stage));
    await column('num'); await column('note'); await input('有效新值'); await act(async () => oldInput({ target: { value: '失效旧值' } })); await click(zh.common.cancel); await act(async () => oldStage()); expect(grid.rows).toBe(before); expect(button(historyText.undo).disabled).toBe(true);
  });
  it.each(['inactive', 'job', 'connection'] as const)('同一事件轮次%s切走再恢复，合并渲染前的旧暂存也不能写', async kind => {
    await mount(); const before = grid.rows, state = store.getState(); await click(text.action); await input('不可复活'); const stage = callback(button(text.stage));
    await act(async () => {
      if (kind === 'inactive') { store.setState({ settings: { ...state.settings, activeTabId: '其它' } }); store.setState({ settings: state.settings }); }
      if (kind === 'job') { store.setState({ activeJobs: { 表页: true } }); store.setState({ activeJobs: {} }); }
      if (kind === 'connection') { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); }
      stage();
    });
    expect(grid.rows).toBe(before); expect(button(text.stage).disabled).toBe(true);
  });
  it('相同值整批无变化时不伪造历史，并显示原中文无变更说明', async () => {
    await mount(); await select(new Set([grid.rows[0].id])); const before = grid.rows; await click(text.action); await input('原1'); await click(text.stage);
    expect(grid.rows).toBe(before); expect(button(historyText.undo).disabled).toBe(true); expect(document.body.textContent).toContain(text.unchanged);
  });
});
