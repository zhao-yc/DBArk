import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableCellFilterZh as text } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { buildPageSql } from '../../src/engine/sql';
import { tableFilterEnabledZh as enabledText } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';

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

/** 只经真实受控select修改草稿，分页请求仍来自生产TableTab。 */
async function chooseSort(label: string, value: string) { const node = field(label); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }

describe('真实React表页多列服务器排序RAM', () => {
  it('编辑顺序和方向期间零读取，应用一次保留精确筛选并生成服务器ORDER BY', async () => {
    const info = await mount(); await selectCell(0, 'num'); await click(text.equal); await applyCondition();
    const jump = field(zh.table.pageJumpLabel), propsKey = Object.keys(jump).find(key => key.startsWith('__reactProps$'))!;
    await act(async () => (jump as any)[propsKey].onChange({ target: { value: '3' } }));
    await act(async () => document.querySelector('form[class="page-jump"]')!.dispatchEvent(new MemoryEvent('submit'))); expect(pages.at(-1).page).toBe(3);
    const count = pages.length; await click(sortText.entry); await click(sortText.add); const noteField = field(sortText.field(1)); await chooseSort(sortText.field(1), 'note'); expect(field(sortText.field(1))).toBe(noteField); await chooseSort(sortText.direction(1), 'DESC'); await click(sortText.add); await chooseSort(sortText.field(2), 'num'); await click(sortText.earlier(2));
    expect(field(sortText.field(1)).value).toBe('num'); expect(field(sortText.field(2))).toBe(noteField); expect(field(sortText.direction(2)).value).toBe('DESC'); expect(pages).toHaveLength(count);
    const old = callback(button(sortText.apply)); await click(sortText.apply); await act(async () => old()); expect(pages).toHaveLength(count + 1);
    const input = pages.at(-1); expect(input).toMatchObject({ page: 1, pageSize: 50, filters: [{ column: 'num', operator: '=', value: '0.00000000000000000000001' }], filterMode: 'all', sort: [{ column: 'num', direction: 'ASC' }, { column: 'note', direction: 'DESC' }] });
    const sql = buildPageSql(info, input.page, input.pageSize, input.filters, input.sort, input.filterMode); expect(sql.sql).toContain('ORDER BY `num` ASC, `note` DESC, `id` ASC LIMIT 51 OFFSET 0'); expect(sql.params).toEqual(['0.00000000000000000000001']); expect(previews).toEqual([]); expect(commands.includes('table.apply')).toBe(false);
  });
  it('取消、拒绝丢弃和确认应用分别保留或放弃原数据草稿；清空规则仍保留可靠键兜底', async () => {
    const info = await mount(); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '尚未提交' } })));
    const originalConfirm = window.confirm, confirm = vi.fn(() => false); window.confirm = confirm;
    try {
      const count = pages.length; await click(sortText.entry); await click(sortText.add); await click(sortText.cancel); expect(pages).toHaveLength(count); expect(grid.rows[0].data.note).toBe('尚未提交'); expect(confirm).not.toHaveBeenCalled();
      await click(sortText.entry); await click(sortText.add); await chooseSort(sortText.direction(1), 'DESC'); await click(sortText.apply); expect(confirm).toHaveBeenCalledWith(recordViewZh.discardPage); expect(pages).toHaveLength(count); expect(grid.rows[0].data.note).toBe('尚未提交'); expect(document.body.textContent).toContain(sortText.declined);
      confirm.mockReturnValue(true); await click(sortText.apply); expect(pages).toHaveLength(count + 1); expect(grid.rows[0].data.note).toBe('原1'); expect(pages.at(-1).sort).toEqual([{ column: 'id', direction: 'DESC' }]);
      await click(sortText.entry); await click(sortText.clear); expect(pages).toHaveLength(count + 1); await click(sortText.apply); expect(pages).toHaveLength(count + 2); expect(pages.at(-1).sort).toEqual([]); expect(buildPageSql(info, 1, 50, [], []).sql).toContain('ORDER BY `id` ASC');
    } finally { window.confirm = originalConfirm; }
  });
  it('旧草稿回调不能覆盖新优先级；表连接ABA后原草稿永久失效', async () => {
    await mount(); await click(sortText.entry); await click(sortText.add); const old = callback(button(sortText.apply)), count = pages.length;
    await chooseSort(sortText.direction(1), 'DESC'); await act(async () => old()); expect(pages).toHaveLength(count);
    await act(async () => { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); });
    await click(sortText.apply); expect(document.body.textContent).toContain(sortText.stale); expect(pages).toHaveLength(count); expect(button(sortText.apply).disabled).toBe(true); await click(sortText.cancel); expect(grid.rows).toHaveLength(3);
  });
  it('列头排序变化使旧面板失效，重新打开保留新顺序；未改规则直接关闭不查询', async () => {
    await mount(); await click(sortText.entry); await click(sortText.add); const old = callback(button(sortText.apply));
    await act(async () => grid.props.onSortColumnsChange([{ columnKey: 'note', direction: 'DESC' }])); const count = pages.length;
    await act(async () => old()); expect(pages).toHaveLength(count); await click(sortText.apply); expect(document.body.textContent).toContain(sortText.stale); await click(sortText.cancel);
    await click(sortText.entry); expect(field(sortText.field(1)).value).toBe('note'); expect(field(sortText.direction(1)).value).toBe('DESC'); await click(sortText.apply); expect(pages).toHaveLength(count); expect(document.querySelector(`[aria-label="${sortText.title}"]`)).toBeNull();
  });
});

/** 此RAM端口只投递真实React勾选事件；原生checkbox另由实库窗口验证。 */
function enabledHandler(index: number): Function { const node = field(enabledText.enabled(index)), key = Object.keys(node).find(key => key.startsWith('__reactProps$'))!; return (node as any)[key].onChange; }
async function enableRule(index: number, checked: boolean) { await act(async () => enabledHandler(index)({ target: { checked } })); }

describe('真实TableTab服务器筛选启停RAM', () => {
  it('单条和批量一次读取，保留精确值、NULL、任一模式及已应用排序；编辑不隐式启用', async () => {
    await mount(); await selectCell(0, 'num'); await click(text.equal); await applyCondition(); await selectCell(1, 'note'); await click(text.equal); await applyCondition();
    const mode = field(zh.table.filterModeLabel); await act(async () => { mode.value = 'any'; mode.dispatchEvent(new MemoryEvent('change')); }); await act(async () => grid.props.onSortColumnsChange([{ columnKey: 'num', direction: 'DESC' }]));
    const original = structuredClone(pages.at(-1).filters), count = pages.length; await enableRule(1, false); expect(pages).toHaveLength(count + 1); expect(pages.at(-1)).toMatchObject({ page: 1, filterMode: 'any', sort: [{ column: 'num', direction: 'DESC' }], filters: [{ ...original[0], enabled: false }, original[1]] });
    await click(enabledText.disableAll); expect(pages).toHaveLength(count + 2); expect(pages.at(-1).filters).toEqual(original.map((rule: any) => ({ ...rule, enabled: false }))); expect(button(enabledText.disableAll).disabled).toBe(true);
    await click(zh.table.filterEditCondition.replace('{0}', '1')); expect(field(zh.table.text011).value).toBe('0.00000000000000000000001'); await applyCondition(); expect(pages.at(-1).filters[0].enabled).toBe(false);
    const beforeEnable = pages.length; await click(enabledText.enableAll); expect(pages).toHaveLength(beforeEnable + 1); expect(pages.at(-1).filters).toEqual(original); expect(document.body.textContent).toContain(enabledText.status(2, 2)); expect(commands.includes('table.apply')).toBe(false);
  });
  it('拒绝丢弃不切换，接受后从第一页读取并放弃原草稿，零写入', async () => {
    await mount(); await selectCell(0, 'num'); await click(text.equal); await applyCondition(); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '保留原草稿' } })));
    const originalConfirm = window.confirm, confirm = vi.fn(() => false); window.confirm = confirm;
    try {
      const count = pages.length; await enableRule(1, false); expect(confirm).toHaveBeenCalledWith(recordViewZh.discardPage); expect(pages).toHaveLength(count); expect(field(enabledText.enabled(1)).checked).toBe(true); expect(grid.rows[0].data.note).toBe('保留原草稿'); expect(document.body.textContent).toContain(enabledText.declined);
      confirm.mockReturnValue(true); await enableRule(1, false); expect(pages).toHaveLength(count + 1); expect(pages.at(-1).filters[0].enabled).toBe(false); expect(grid.rows[0].data.note).toBe('原1'); expect(previews).toEqual([]); expect(commands.includes('table.apply')).toBe(false);
    } finally { window.confirm = originalConfirm; }
  });
  it('移除条件后旧编号回调无效，非活动表页不能接受当前筛选修改', async () => {
    await mount(); await selectCell(0, 'id'); await click(text.equal); await applyCondition(); await selectCell(1, 'note'); await click(text.equal); await applyCondition(); const old = enabledHandler(2);
    await click(zh.table.filterRemoveCondition.replace('{0}', '1')); const count = pages.length; await act(async () => old({ target: { checked: false } })); expect(pages).toHaveLength(count); expect(field(enabledText.enabled(1)).checked).toBe(true);
    await act(async () => store.setState(state => ({ settings: { ...state.settings, activeTabId: '别的标签' } }))); await enableRule(1, false); expect(pages).toHaveLength(count); expect(pages.at(-1).filters).toEqual([{ column: 'note', operator: 'IS NULL' }]);
  });
});
