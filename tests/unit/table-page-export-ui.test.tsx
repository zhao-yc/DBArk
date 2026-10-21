import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tablePageExportZh as text } from '../../src/renderer/locales/tablePageExport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const grid = vi.hoisted(() => ({ props: null as any, rows: [] as DraftRow[] }));
// 只替换网格/Monaco外界渲染端口；TableTab、类型编辑器、弹窗、store与历史运行生产代码。
vi.mock('react-data-grid', async () => {
  const { useImperativeHandle, createElement } = await import('react');
  return { SelectColumn: { key: 'select-row' }, DataGrid(props: any) {
    if (props['aria-label'] === '当前页数据网格') { grid.props = props; grid.rows = props.rows; }
    useImperativeHandle(props.ref, () => ({ setActivePosition() {}, scrollToCell() {} }), []);
    return createElement('div', { role: 'grid' });
  } };
});
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let TableTab: typeof import('../../src/renderer/components/TableTab')['TableTab'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let commands: string[], previews: any[], pages: any[], exports: any[];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 仅补HTMLSelectElement/布尔disabled语义，不推导或替换产品状态。
    if (name === 'option') {
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
      // React通过option.selected更新受控select；浏览器会同步取消同一select的其它选项。
      let selected = false;
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = Boolean(value); if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } });
    }
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
  commands = []; previews = []; pages = []; exports = [];
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'note', 'num', 'doc', 'bin'].map(name => ({ name, type: name === 'num' ? 'decimal(65,30)' : name === 'doc' ? 'json' : name === 'bin' ? 'blob' : 'text', nullable: name !== 'id' && name !== 'num', defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const source = [1, 2, 3].map(id => ({ id: String(id), note: id === 2 ? null : '原' + id, num: '0.00000000000000000000001', doc: '{"n":900719925474099312345,"x":-0}', bin: { type: 'binary', base64: 'AP8=' } }));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (['settings.save', 'connections.open', 'query.cancel', 'table.copySourceRelease'].includes(command)) return;
    if (command === 'table.preferences.get') return { version: 1, columns: ['bin', 'id', 'num', 'note', 'doc'].map(name => ({ name, hidden: name === 'doc' })) };
    if (command === 'files.choose') return { token: 'RAM文件', name: '本页.json' };
    if (command === 'files.exportResult') { exports.push(structuredClone(input)); return { rows: input.result.rows.length }; }
    if (command === 'metadata.table') return info;
    if (command === 'table.presets.list') return { revision: 0, source: 'absent', bindingToken: 'ram-only', entries: [] };
    if (command === 'table.page') { pages.push(structuredClone(input)); return { page: input.page, pageSize: input.pageSize, hasMore: false, rows: structuredClone(source), columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(info) }; }
    if (command === 'table.preview') { previews.push(structuredClone(input)); return { sql: '仅RAM预览', warnings: [] }; }
    throw Error('禁止额外IO：' + command);
  } };
  const tab = { id: '表页', kind: 'table' as const, connectionId: '连接', database: 'db', table: 'items', title: '合成表' };
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: tab.id, tabs: [tab] }, connections: [{ id: '连接', name: '合成离线', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { 连接: 1 }, activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} });
  const noop = () => {}, container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<TableTab tab={tab} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop} />));
  expect(grid.rows).toHaveLength(3); return info;
}
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === name || node.textContent === name); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 通过真实网格回调勾选，倒序Set不能改变文件中的显示顺序。 */
async function select(indices: number[]) { await act(async () => grid.props.onSelectedRowsChange(new Set(indices.map(index => grid.rows[index].id)))); }
function dialog(title: string) { return document.querySelector(`[aria-label="${title}"]`); }
/** 只取得旧按钮闭包，反证迟到事件不能导出后来选择。 */
function callback(node: MemoryNode): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (node as any)[key].onClick; }

describe('真实React表页快照导出RAM', () => {
  it('本页倒序勾选沿显示顺序、列偏好和精确原值进入既有JSON文件任务，不重查或写数据库', async () => {
    await mount(); expect(button(text.selected).disabled).toBe(true); await select([2, 0]); const count = pages.length; await click(text.selected);
    expect(dialog(text.selected)).not.toBeNull(); expect(document.body.textContent).toContain(text.selectedRows(2)); expect(document.body.textContent).toContain(text.scope); expect(pages).toHaveLength(count); expect(grid.props.selectedRows.size).toBe(0);
    const format = document.querySelector(`[aria-label="${zh.resultExport.format}"]`)!;
    await act(async () => { format.value = 'json'; format.dispatchEvent(new MemoryEvent('change')); });
    const picker = document.querySelectorAll('button').find(node => node.classList.contains('file-picker')); expect(picker).toBeDefined(); await act(async () => picker!.dispatchEvent(new MemoryEvent('click'))); await click(zh.resultExport.start);
    expect(exports).toHaveLength(1); expect(exports[0].format).toBe('json'); expect(exports[0].result.columns.map((column: any) => column.key)).toEqual(['bin', 'id', 'num', 'note']); expect(exports[0].result.rows.map((row: any) => row.id)).toEqual(['1', '3']); expect(exports[0].result.rows[0].num).toBe('0.00000000000000000000001'); expect(exports[0].result.rows[0].bin).toEqual({ type: 'binary', base64: 'AP8=' }); expect(JSON.stringify(exports[0].result)).not.toContain('900719925474099312345'); expect(pages).toHaveLength(count); expect(previews).toEqual([]); expect(commands.includes('table.apply')).toBe(false);
    await click(zh.common.done); expect(dialog(text.selected)).toBeNull();
  });
  it('全页入口明确只导出三条已载入记录，关闭不查询，取消不保留旧导出窗口', async () => {
    await mount(); const count = pages.length; await click(text.page); expect(dialog(text.page)).not.toBeNull(); expect(document.body.textContent).toContain(text.pageRows(3)); expect(pages).toHaveLength(count); await click(zh.common.close); expect(dialog(text.page)).toBeNull(); expect(exports).toEqual([]); expect(pages).toHaveLength(count);
  });
  it('旧勾选回调、未知勾选和未提交草稿不会退回全页或打开新窗口', async () => {
    await mount(); await select([0]); const old = callback(button(text.selected)), count = pages.length; await select([1]); await act(async () => old()); expect(dialog(text.selected)).toBeNull();
    await act(async () => grid.props.onSelectedRowsChange(new Set(['旧页ID']))); await click(text.selected); expect(dialog(text.selected)).toBeNull(); expect(document.body.textContent).toContain(text.stale);
    await select([0]); const stalePage = callback(button(text.page)); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '未提交' } }))); expect(button(text.page).disabled).toBe(true); expect(button(text.selected).disabled).toBe(true); await act(async () => stalePage()); expect(dialog(text.page)).toBeNull(); expect(pages).toHaveLength(count); expect(exports).toEqual([]);
  });
});
