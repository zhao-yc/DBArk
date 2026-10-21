import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableCellFilterZh as text } from '../../src/renderer/locales/tableCellFilter.zh-CN';
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
let commands: string[], previews: any[], pages: any[];
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
  commands = []; previews = []; pages = [];
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'note', 'num', 'doc', 'bin'].map(name => ({ name, type: name === 'num' ? 'decimal(65,30)' : name === 'doc' ? 'json' : name === 'bin' ? 'blob' : 'text', nullable: name !== 'id' && name !== 'num', defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const source = [1, 2, 3].map(id => ({ id: String(id), note: id === 2 ? null : '原' + id, num: '0.00000000000000000000001', doc: '{"n":900719925474099312345,"x":-0}', bin: { type: 'binary', base64: 'AP8=' } }));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (['settings.save', 'connections.open', 'query.cancel', 'table.copySourceRelease'].includes(command)) return;
    if (command === 'table.preferences.get') return null;
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
/** 仅通过网格端口给出真实活动格；过滤按钮和条件表单运行生产React代码。 */
async function selectCell(index: number, key: string) { await act(async () => grid.props.onActivePositionChange({ row: grid.rows[index], column: { key } })); }
async function applyCondition() { const form = document.querySelector('form[class="filter-rule-form"]'); expect(form).not.toBeNull(); await act(async () => form!.dispatchEvent(new MemoryEvent('submit'))); }
function field(label: string) { const node = document.querySelector(`[aria-label="${label}"]`); expect(node).not.toBeNull(); return node!; }
/** 只取得旧React按钮闭包用于迟到投递反例，不改产品状态。 */
function callback(node: MemoryNode): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('没有真实React事件'); return (node as any)[key].onClick; }

describe('真实React表页按单元格预填全表筛选RAM', () => {
  it('选择精确小数先带入可审阅草稿，显式添加才参数化请求；修改不进入写SQL', async () => {
    await mount(); expect(button(text.equal).disabled).toBe(true); await selectCell(0, 'num'); const original = structuredClone(grid.rows), count = pages.length;
    await click(text.equal); expect(pages).toHaveLength(count); expect(field(zh.table.text009).value).toBe('num'); expect(field(zh.table.text011).value).toBe('0.00000000000000000000001'); expect(document.body.textContent).toContain(text.staged);
    await applyCondition(); expect(pages).toHaveLength(count + 1); expect(pages.at(-1)).toMatchObject({ page: 1, filters: [{ column: 'num', operator: '=', value: '0.00000000000000000000001' }], filterMode: 'all' }); expect(grid.rows.map(row => row.data)).toEqual(original.map(row => row.data)); expect(previews).toEqual([]); expect(commands.includes('table.apply')).toBe(false);
  });
  it('排除NULL只带入IS NOT NULL；保留已有条件及明确任一组合，再添加才读取', async () => {
    await mount(); await selectCell(0, 'id'); await click(text.equal); await applyCondition();
    const mode = field(zh.table.filterModeLabel); await act(async () => { mode.value = 'any'; mode.dispatchEvent(new MemoryEvent('change')); });
    await selectCell(1, 'note'); const count = pages.length; await click(text.exclude); expect(pages).toHaveLength(count); expect(field(zh.table.filterOperatorLabel).value).toBe('IS NOT NULL'); expect(document.querySelector(`[aria-label="${zh.table.text011}"]`)).toBeNull();
    await applyCondition(); expect(pages.at(-1)).toMatchObject({ page: 1, filterMode: 'any', filters: [{ column: 'id', operator: '=', value: '1' }, { column: 'note', operator: 'IS NOT NULL' }] }); expect(previews).toEqual([]);
  });
  it('拒绝二进制、未提交数据和旧选择按钮，手动开关条件面板不会复用旧seed', async () => {
    await mount(); await selectCell(0, 'num'); const old = callback(button(text.equal)), count = pages.length;
    await selectCell(0, 'bin'); expect(button(text.equal).disabled).toBe(true); await act(async () => old()); expect(document.querySelector('form[class="filter-rule-form"]')).toBeNull(); expect(pages).toHaveLength(count);
    await selectCell(0, 'id'); await click(text.equal); expect(field(zh.table.text011).value).toBe('1'); await click(zh.table.text006); await click(zh.table.text006); expect(field(zh.table.text011).value).toBe('');
    await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '未提交' } }))); expect(button(text.equal).disabled).toBe(true); expect(button(text.exclude).disabled).toBe(true); expect(pages).toHaveLength(count); expect(previews).toEqual([]);
  });
});
