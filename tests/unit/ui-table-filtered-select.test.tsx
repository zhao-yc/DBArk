import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableFilteredSelectZh as text } from '../../src/renderer/locales/tableFilteredSelect.zh-CN';
import { tableQueryTemplateZh as templates } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';
import { tablePresetsZh as presets } from '../../src/renderer/locales/tablePresets.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { TableFilteredSelectScope } from '../../src/renderer/tableFilteredSelectUi';

const grid = vi.hoisted(() => ({ props: null as any, rows: [] as DraftRow[] }));
/** 仅替换没有布局的网格和Monaco呈现；父组件、store、筛选面板和生成对话框均运行生产代码。 */
vi.mock('react-data-grid', async () => { const { useImperativeHandle, createElement } = await import('react'); return { SelectColumn: { key: 'select-row' }, DataGrid(props: any) { grid.props = props; grid.rows = props.rows; useImperativeHandle(props.ref, () => ({ setActivePosition() {}, scrollToCell() {} }), []); return createElement('div', { role: 'grid' }); } }; });
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let TableTab: typeof import('../../src/renderer/components/TableTab')['TableTab'], Dialog: typeof import('../../src/renderer/components/TableQueryTemplateDialog')['TableQueryTemplateDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let commands: string[], pages: any[], opened: any[];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const readScope = (): TableFilteredSelectScope => ({ filters: [{ column: 'label', operator: '=', value: 'Alpha' }, { column: 'label', operator: '=', value: 'Beta' }, { column: 'id', operator: '>=', value: '9007199254740993' }, { column: 'note', operator: '=', value: '停用条件不进入SQL', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2, 3] }, sort: [{ column: 'label', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] });
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); const create = doc.createElement.bind(doc);
  /** 仅补标准属性，不读取或改写React组件内部状态作为通过证据。 */
  doc.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    if (name === 'option') {
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
      let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = Boolean(value); if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } });
    }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ TableQueryTemplateDialog: Dialog } = await import('../../src/renderer/components/TableQueryTemplateDialog')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; await flush(); doc.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 初始化表页需要的IO均为RAM端口；生成和打开动作必须没有任何新增IPC。 */
async function mount(options: { wide?: number; view?: boolean; weird?: boolean } = {}) {
  commands = []; pages = []; opened = [];
  const database = options.weird ? '库`?名' : 'db', name = options.weird ? '表`?\n名' : 'items';
  const info: TableInfo = { database, name, objectKind: options.view ? 'view' : 'table', engine: options.view ? '' : 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'label', 'amount', 'note', ...(options.weird ? ['__proto__', '列`?\n名'] : [])].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,12)' : 'TEXT', nullable: name !== 'id', defaultValue: null, extra: '', generated: false, comment: '' })) };
  if (options.wide) info.columns = [info.columns[0], ...Array.from({ length: options.wide - 1 }, (_, i) => ({ ...info.columns[1], name: `field${i + 1}` }))];
  const source = Object.fromEntries(info.columns.map(column => [column.name, column.name === 'id' ? '9007199254740993' : column.name === 'amount' ? '9007199254740993.123456789012' : column.name === 'label' ? 'Alpha' : '原值']));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (['settings.save', 'connections.open', 'query.cancel', 'table.copySourceRelease'].includes(command)) return;
    if (command === 'table.preferences.get') return null; if (command === 'metadata.table') return info;
    if (command === 'table.page') { pages.push(structuredClone(input)); return { page: input.page, pageSize: input.pageSize, hasMore: true, rows: [structuredClone(source)], columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(info) }; }
    if (command === 'table.presets.list') return { revision: 0, source: 'present', bindingToken: 'ram-only', entries: [{ id: 'original-scope', name: '原筛选组合', updatedAt: '2026-10-23T00:00:00.000Z' }] };
    if (command === 'table.presets.apply') return readScope();
    throw Error('禁止额外IO：' + command);
  } };
  const tab = { id: '表页', kind: 'table' as const, connectionId: '连接', database, table: name, title: '原表' };
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: tab.id, tabs: [tab] }, connections: [{ id: '连接', name: 'RAM离线', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { 连接: 1 }, activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} });
  const noop = () => {}, host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<TableTab tab={tab} onOpenGeneratedQuery={candidate => { opened.push(structuredClone(candidate)); store.getState().openTab(candidate); }} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop}/>));
  expect(grid.rows).toHaveLength(1); return { info, tab };
}
function button(label: string): MemoryNode { const node = doc.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label || node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function select(label: string, value: string) { const node = doc.querySelectorAll('select').find(value => value.getAttribute('aria-label') === label)!; expect(node).toBeDefined(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function input(label: string, value: string) { const node = doc.querySelectorAll('input').find(value => value.getAttribute('aria-label') === label)!; expect(node).toBeDefined(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function choose(name: string) { const node = doc.querySelectorAll('input').find(value => value.getAttribute('aria-label') === templates.chooseColumn(name))!; expect(node).toBeDefined(); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
function sql() { return doc.querySelectorAll('pre').find(node => node.getAttribute('aria-label') === text.preview)?.textContent ?? ''; }
function oldCallback(node: MemoryNode, event = 'onClick'): (...args: any[]) => any { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少实际React回调'); return Reflect.get(node, key)[event]; }
/** 经正式命名方案入口应用完整树，未直接设置父filters/sort或组件state。 */
async function applyScope() { await click(zh.table.text006); await select(presets.choose, 'original-scope'); await click(presets.apply); expect(pages.at(-1)).toMatchObject(readScope()); }

describe('当前筛选SELECT真实TableTab及共用对话框RAM（非数据库/原生验收）', () => {
  it('第二页完整嵌套OR/停用/多排序、选列顺序进入SQL，取消保草稿/勾选且零新增IPC', async () => {
    await mount(); await applyScope(); await click(zh.common.pageNext);
    await act(async () => { grid.props.onSelectedRowsChange(new Set([grid.rows[0].id])); grid.props.onRowsChange(grid.rows.map(row => ({ ...row, data: { ...row.data, note: '不得进入生成SQL的父草稿' } }))); });
    const beforeRows = structuredClone(grid.rows), selected = [...grid.props.selectedRows], io = commands.length, reads = pages.length;
    await click(text.entry); expect(doc.querySelector('[data-table-filtered-select-dialog]')).not.toBeNull(); expect(doc.querySelectorAll('select').some(node => node.getAttribute('aria-label') === templates.kind)).toBe(false);
    expect(doc.body.textContent).toContain(text.disabledRule); await click(templates.clearColumns); expect(button(templates.open).disabled).toBe(true); await choose('label'); await choose('id'); await choose('amount'); await click(templates.moveColumnUp('amount'));
    const reviewed = sql(); expect(reviewed).toContain('SELECT `label`, `amount`, `id` FROM `db`.`items` WHERE ((('); expect(reviewed).toContain(' OR '); expect(reviewed).toContain(' AND '); expect(reviewed).toContain('UNSIGNED'); expect(reviewed).toContain('ORDER BY `label` ASC, `id` DESC LIMIT 1000;'); expect(reviewed).not.toContain('OFFSET'); expect(reviewed).not.toContain('不得进入生成SQL'); expect(reviewed).not.toContain('停用条件不进入SQL');
    await click(templates.close); expect(grid.rows).toEqual(beforeRows); expect([...grid.props.selectedRows]).toEqual(selected); expect(pages).toHaveLength(reads); expect(commands).toHaveLength(io); expect(opened).toEqual([]);
  });
  it('明确打开只建同连接known库独立未执行草稿，SQL与预览逐字一致，连点旧动作也只建一次', async () => {
    await mount(); await applyScope(); await click(text.entry); const reviewed = sql(), originalRows = structuredClone(grid.rows), io = commands.filter(command => command !== 'settings.save'), originalTab = store.getState().settings.tabs[0], open = oldCallback(button(templates.open));
    await act(async () => { open(); open(); }); expect(opened).toHaveLength(1); expect(opened[0]).toEqual({ kind: 'query', title: text.queryTitle('items'), connectionId: '连接', database: 'db', databaseContext: { state: 'known', database: 'db' }, sql: reviewed });
    expect(store.getState().settings.tabs[0]).toBe(originalTab); expect(store.getState().settings.tabs).toHaveLength(2); expect(grid.rows).toEqual(originalRows); expect(commands.filter(command => command !== 'settings.save')).toEqual(io); expect(commands.some(command => /query\.execute|files\.|table\.preview|table\.apply/.test(command))).toBe(false);
  });
  it.each(['activeTab', 'version', 'limit'] as const)('%s来回变化永久失效，新选择或旧打开不能重新领取原来源', async change => {
    await mount(); await click(text.entry); const open = oldCallback(button(templates.open));
    await act(async () => {
      if (change === 'activeTab') { store.setState(state => ({ settings: { ...state.settings, activeTabId: '其它页' } })); store.setState(state => ({ settings: { ...state.settings, activeTabId: '表页' } })); }
      if (change === 'version') { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); }
      if (change === 'limit') { store.setState(state => ({ settings: { ...state.settings, resultLimit: 5 } })); store.setState(state => ({ settings: { ...state.settings, resultLimit: 1000 } })); }
      open();
    }); expect(opened).toEqual([]); expect(doc.body.textContent).toContain(text.changed); await click(templates.close);
  });
  it('未应用筛选编辑器值不进入SQL，奇异schema/表/字段保持原名且旧模板仍无条件', async () => {
    await mount({ weird: true }); await click(zh.table.text006); await input(zh.table.text011, '尚未添加不能被偷用'); const io = commands.length;
    await click(text.entry); await click(templates.clearColumns); await choose('__proto__'); await choose('列`?\n名'); expect(sql()).toContain('SELECT `__proto__`, `列``?\n名` FROM `库``?名`.`表``?\n名`'); expect(sql()).not.toContain('WHERE'); expect(sql()).not.toContain('尚未添加'); await click(templates.close); expect(doc.querySelectorAll('input').find(node => node.getAttribute('aria-label') === zh.table.text011)?.value).toBe('尚未添加不能被偷用');
    await click(templates.entry); expect(doc.querySelector(`[aria-label="${templates.title}"]`)).not.toBeNull(); expect(doc.querySelector(`[aria-label="${templates.preview}"]`)?.textContent).toContain(templates.generatedComment); expect(doc.querySelector(`[aria-label="${templates.preview}"]`)?.textContent).not.toContain('WHERE'); expect(commands).toHaveLength(io);
  });
  it('4096字段继续每页50项，搜索不改变已选完整序列，视图也只生成SELECT', async () => {
    await mount({ wide: 4096, view: true }); const io = commands.filter(command => command !== 'settings.save'); await click(text.entry);
    const controls = () => doc.querySelectorAll('input').filter(node => node.getAttribute('aria-label')?.startsWith('模板字段 ')); expect(controls()).toHaveLength(50); expect(sql()).toContain('`field4095`'); const original = sql(); await click(templates.columnsNext); expect(controls()).toHaveLength(50); expect(sql()).toBe(original);
    await input(text.filterColumns, 'field4095'); expect(controls()).toHaveLength(1); expect(sql()).toBe(original); await click(templates.clearColumns); await choose('field4095'); expect(sql()).toContain('SELECT `field4095` FROM'); await click(templates.open); expect(opened[0].sql).toContain('`field4095`'); expect(commands.filter(command => command !== 'settings.save')).toEqual(io);
  });
  it('新模式字段选项ABA拒绝旧打开回调，100标签预算保原页而不自动开空白', async () => {
    await mount(); const original = store.getState().settings.tabs[0]; await act(async () => store.setState(state => ({ settings: { ...state.settings, tabs: [original, ...Array.from({ length: 99 }, (_, index) => ({ id: `q${index}`, kind: 'query' as const, title: `已有${index}`, connectionId: '连接' }))] } })));
    await click(text.entry); const open = oldCallback(button(templates.open)), clear = oldCallback(button(templates.clearColumns)); await act(async () => { clear(); open(); }); expect(opened).toEqual([]); await click(templates.resetColumns); await click(templates.open); expect(opened).toEqual([]); expect(doc.body.textContent).toContain(text.tabs); await click(templates.close); expect(store.getState().settings.tabs).toHaveLength(100);
  });
  it('已应用条件排队后同事件旧入口立即拒绝，不能在加载effect前把旧页当作新范围', async () => {
    await mount(); await click(zh.table.text006); await input(zh.table.text011, '9007199254740993'); const entry = oldCallback(button(text.entry)), form = doc.querySelectorAll('form').find(node => node.getAttribute('class') === 'filter-rule-form')!, submit = oldCallback(form, 'onSubmit'), reads = pages.length;
    await act(async () => { submit({ preventDefault() {} }); entry(); });
    expect(doc.querySelector('[data-table-filtered-select-dialog]')).toBeNull(); expect(opened).toEqual([]); expect(pages).toHaveLength(reads + 1);
    await click(text.entry); expect(sql()).toContain(' WHERE '); expect(sql()).toContain('UNSIGNED'); expect(sql()).not.toContain('OFFSET');
  });
  it('共用Dialog新模式的readScope props先换后还原也永久失效，不借原四模板分支复活', async () => {
    const { info } = await mount(), original = readScope(), other = { ...readScope(), filters: [] }, onOpen = vi.fn(() => true), onClose = vi.fn();
    const render = (scope: TableFilteredSelectScope) => root!.render(<Dialog info={info} limit={1000} readScope={scope} isCurrent={() => true} onOpen={onOpen} onClose={onClose}/>);
    await act(async () => render(original)); const open = oldCallback(button(templates.open)); await act(async () => render(other)); await act(async () => render(original));
    expect(button(templates.open).disabled).toBe(true); expect(doc.body.textContent).toContain(text.changed); await act(async () => open()); expect(onOpen).not.toHaveBeenCalled(); await click(templates.close); expect(onClose).toHaveBeenCalledOnce();
  });
});
