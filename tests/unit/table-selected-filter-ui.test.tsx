import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableSelectedFilterZh as text } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
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
let commands: string[], previews: any[], pages: any[], opened: any[], navigations: number;
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let restoreNavigationMenuPort = () => {};
beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 仅补HTMLSelectElement、输入type及布尔disabled语义，不推导或替换产品状态。
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
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flush(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 所有IPC都在RAM内响应；未知命令立即失败，绝不连接服务器或真实数据库。 */
async function mount() {
  commands = []; previews = []; pages = []; opened = []; navigations = 0; (window as any).confirm = vi.fn(() => true);
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
  await act(async () => root!.render(<TableTab tab={tab} onQueryTemplateNavigation={() => { navigations++; }} onOpenGeneratedQuery={candidate => { opened.push(structuredClone(candidate)); store.getState().openTab(candidate); }} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop} />));
  expect(grid.rows).toHaveLength(3); return info;
}
function button(name: string) { const node = navigationMenuRamButton(document.body, name); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 只调用真实React事件端口，不修改组件内部state；旧闭包用于验证迟到事件。 */
function props(node: MemoryNode): any { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }
/** 模拟网格选中当前列和整行勾选，原TableTab自行冻结原值。 */
async function chooseRows(indices: number[], key = 'note'): Promise<void> {
  await act(async () => grid.props.onActivePositionChange({ row: grid.rows[0], column: { key } }));
  await act(async () => grid.props.onSelectedRowsChange(new Set(indices.map(index => grid.rows[index].id))));
}
/** 手工筛选继续走正式编辑器和父应用合同，值不经过脚本SQL拼接。 */
async function addCondition(value: string): Promise<void> {
  const field = document.querySelector(`[aria-label="${zh.table.text011}"]`)!;
  await act(async () => { field.value = value; field.dispatchEvent(new MemoryEvent('input')); });
  // 既有RAM DOM只支持标签／属性选择器；按真实class属性定位，不增补或改写产品表单。
  const form = document.querySelectorAll('form').find(node => node.getAttribute('class')?.split(' ').includes('filter-rule-form'))!;
  expect(form).toBeDefined(); await act(async () => props(form).onSubmit({ preventDefault() {} }));
}
function region() { return document.querySelector(`[aria-label="${text.title}"]`); }

describe('真实TableTab勾选值筛选接线（仅RAM）', () => {
  it('零勾选不开放；预览不请求，取消不改变页、勾选和原行草稿', async () => {
    await mount(); expect(button(text.entry).disabled).toBe(true); await chooseRows([0, 1]);
    const before = structuredClone(grid.rows), selected = grid.props.selectedRows, count = pages.length;
    await click(text.entry); expect(region()).not.toBeNull(); expect(pages).toHaveLength(count); expect(previews).toEqual([]);
    expect(region()!.textContent).toContain('原1'); await click(text.cancel); expect(region()).toBeNull(); expect(grid.rows).toEqual(before); expect(grid.props.selectedRows).toBe(selected); expect(pages).toHaveLength(count);
  });
  it('包含原NULL与标量一次发布完整OR组，排除无NULL保留NULL，均只调用参数分页', async () => {
    await mount(); await chooseRows([0, 1]); await click(text.entry); const before = pages.length;
    const oldApply = props(button(text.apply)).onClick; await click(text.apply); await act(async () => oldApply({}));
    expect(pages).toHaveLength(before + 1); expect(pages.at(-1)).toMatchObject({ page: 1, filters: [{ column: 'note', operator: 'IN', values: ['原1'] }, { column: 'note', operator: 'IS NULL' }], filterMode: 'any', filterGroup: { mode: 'any', children: [0, 1] } });
    expect(region()).toBeNull(); expect(commands.some(command => /query\.execute|table\.apply|table\.preview/.test(command))).toBe(false);
    await click(zh.common.clearAll); await chooseRows([0]); await click(text.excludeEntry); await click(text.apply);
    expect(pages.at(-1)).toMatchObject({ filters: [{ column: 'note', operator: 'NOT IN', values: ['原1'] }, { column: 'note', operator: 'IS NULL' }], filterMode: 'any', filterGroup: { mode: 'any', children: [0, 1] } });
  });
  it('旧任一条件作为整体与新值AND，多列排序保持且只重读一次第一页', async () => {
    await mount(); await click(zh.table.text006); await addCondition('1'); await addCondition('2');
    const mode = document.querySelector(`[aria-label="${zh.table.filterModeLabel}"]`)!; await act(async () => { mode.value = 'any'; mode.dispatchEvent(new MemoryEvent('change')); });
    await act(async () => grid.props.onSortColumnsChange([{ columnKey: 'id', direction: 'DESC' }, { columnKey: 'num', direction: 'ASC' }]));
    await chooseRows([0, 1]); const before = pages.length, previous = structuredClone(pages.at(-1)); await click(text.entry); await click(text.apply);
    expect(pages).toHaveLength(before + 1); expect(pages.at(-1).filters).toEqual([...previous.filters, { column: 'note', operator: 'IN', values: ['原1'] }, { column: 'note', operator: 'IS NULL' }]);
    expect(pages.at(-1)).toMatchObject({ page: 1, sort: previous.sort, filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: 'any', children: [2, 3] }] } });
  });
  it('旁列暂存修改仍可预览，拒绝丢稿保持提案、原草稿、条件和页，确认后才重读', async () => {
    await mount(); await chooseRows([0], 'num'); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '旁列未提交' } })));
    const before = structuredClone(grid.rows), count = pages.length; (window as any).confirm = vi.fn(() => false); await click(text.entry); await click(text.apply);
    expect((window as any).confirm).toHaveBeenCalledOnce(); expect(region()).not.toBeNull(); expect(document.body.textContent).toContain(text.declined); expect(grid.rows).toEqual(before); expect(pages).toHaveLength(count);
    (window as any).confirm = vi.fn(() => true); await click(text.apply); expect(pages).toHaveLength(count + 1); expect(region()).toBeNull(); expect(pages.at(-1).filters[0].values).toEqual(['0.00000000000000000000001']); expect(previews).toEqual([]);
  });
  it.each(['activeTab', 'connectionVersion', 'selection', 'selectedRows', 'rows'] as const)('%s同轮切走再恢复不能复活原提案', async change => {
    await mount(); await chooseRows([0, 1]); const selected = grid.props.selectedRows, original = [...grid.rows]; await click(text.entry); const apply = props(button(text.apply)).onClick, count = pages.length;
    await act(async () => {
      if (change === 'activeTab') { store.setState(state => ({ settings: { ...state.settings, activeTabId: '别页' } })); store.setState(state => ({ settings: { ...state.settings, activeTabId: '表页' } })); }
      if (change === 'connectionVersion') { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); }
      if (change === 'selection') { grid.props.onActivePositionChange({ row: original[0], column: { key: 'num' } }); grid.props.onActivePositionChange({ row: original[0], column: { key: 'note' } }); }
      if (change === 'selectedRows') { grid.props.onSelectedRowsChange(new Set([original[2].id])); grid.props.onSelectedRowsChange(selected); }
      if (change === 'rows') { grid.props.onRowsChange(original.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '临时变化' } })); grid.props.onRowsChange(original); }
      apply({});
    });
    expect(pages).toHaveLength(count); expect(document.body.textContent).toContain(text.unavailable); await act(async () => apply({})); expect(pages).toHaveLength(count); await click(text.cancel); expect(region()).toBeNull();
  });
  it('拒绝所选列已修改的原行，不静默使用草稿或遗漏行读取服务器', async () => {
    await mount(); await chooseRows([0]); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '本列已改' } })));
    const count = pages.length; await click(text.entry); expect(region()).toBeNull(); expect(document.body.textContent).toContain(text.unavailable); expect(pages).toHaveLength(count); expect(grid.rows[0].data.note).toBe('本列已改');
  });
  it.each(['conditions', 'mode'] as const)('手工%s变更先排队，旧提案不得覆盖尚未提交的条件意图', async change => {
    await mount(); await click(zh.table.text006); await addCondition('1'); await chooseRows([0, 1]); await click(text.entry);
    const apply = props(button(text.apply)).onClick, count = pages.length;
    const field = document.querySelector(`[aria-label="${zh.table.text011}"]`)!; await act(async () => { field.value = '2'; field.dispatchEvent(new MemoryEvent('input')); });
    const form = document.querySelectorAll('form').find(node => node.getAttribute('class')?.split(' ').includes('filter-rule-form'))!, submit = props(form).onSubmit, clear = props(button(zh.common.clearAll)).onClick;
    const mode = props(document.querySelector(`[aria-label="${zh.table.filterModeLabel}"]`)!).onChange;
    await act(async () => {
      if (change === 'conditions') { submit({ preventDefault() {} }); clear(); }
      else mode({ target: { value: 'any' } });
      apply({});
    });
    expect(pages).toHaveLength(count + 1); expect(region()).not.toBeNull(); expect(document.body.textContent).toContain(text.unavailable);
    if (change === 'conditions') expect(pages.at(-1).filters).toEqual([]);
    else expect(pages.at(-1)).toMatchObject({ filters: [{ column: 'id', operator: '=', value: '1' }], filterMode: 'any' });
  });
  it('丢稿确认期间连接切走再恢复，owner例外仍不得复活旧提案或重读', async () => {
    await mount(); await chooseRows([0], 'num'); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '确认前原草稿' } })));
    await click(text.entry); const count = pages.length, before = structuredClone(grid.rows);
    (window as any).confirm = vi.fn(() => { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); return true; });
    await click(text.apply); expect(pages).toHaveLength(count); expect(grid.rows).toEqual(before); expect(region()).not.toBeNull(); expect(document.body.textContent).toContain(text.unavailable);
  });
});
