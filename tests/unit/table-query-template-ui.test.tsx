import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableQueryTemplateZh as text } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';
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
let TableTab: typeof import('../../src/renderer/components/TableTab')['TableTab'], Dialog: typeof import('../../src/renderer/components/TableQueryTemplateDialog')['TableQueryTemplateDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
let commands: string[], previews: any[], pages: any[], opened: any[], navigations: number;
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
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
  ({ createRoot } = await import('react-dom/client')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ TableQueryTemplateDialog: Dialog } = await import('../../src/renderer/components/TableQueryTemplateDialog')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flush(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 所有IPC都在RAM内响应；未知命令立即失败，绝不连接服务器或真实数据库。 */
async function mount() {
  commands = []; previews = []; pages = []; opened = []; navigations = 0;
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
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === name || node.textContent === name); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 通过原生select端口选择模板，生产组件负责生成和确认，不改SQL模型。 */
async function kind(value: string) { const field = document.querySelector(`[aria-label="${text.kind}"]`)!; await act(async () => { field.value = value; field.dispatchEvent(new MemoryEvent('change')); }); }
function preview() { return document.querySelector(`[aria-label="${text.preview}"]`)?.textContent ?? ''; }
function dialog() { return document.querySelector(`[aria-label="${text.title}"]`); }
/** 取得旧React按钮闭包，检查选项变化和失效窗口不能创建新标签。 */
function callback(node: MemoryNode, event: 'onClick' | 'onChange' = 'onClick'): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('没有真实React事件'); return (node as any)[key][event]; }
/** 用明确中文aria定位字段，列名可包含引号或原型同名，不拼进CSS选择器。 */
function checkbox(name: string) { const node = document.querySelectorAll('input').find(input => input.getAttribute('aria-label') === text.chooseColumn(name)); expect(node, '缺少字段：' + name).toBeDefined(); return node!; }
/** 使用真实React复选事件；只补浏览器原生勾选动作，不写组件内部状态。 */
async function choose(name: string) { const node = checkbox(name); expect(node.disabled).toBe(false); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
/** 使用输入事件搜索字段，搜索是否影响SQL由生产预览独立证明。 */
async function search(value: string) { const input = document.querySelector(`[aria-label="${text.filterColumns}"]`)!; await act(async () => { input.value = value; input.dispatchEvent(new MemoryEvent('input')); }); }
/** 合成宽表元数据不读取服务器；原表页数据端口和草稿仍使用原生产组件。 */
function widen(info: TableInfo, count: number): void { info.columns = [info.columns[0], ...Array.from({ length: count - 1 }, (_, index) => ({ ...info.columns[1], name: 'field' + (index + 1) }))]; }
/** 只统计模板字段控件，不把原表页或搜索输入计作候选字段。 */
function columnControls() { return document.querySelector(`[aria-label="${text.columns}"]`)?.querySelectorAll('input').filter(node => node.type === 'checkbox') ?? []; }

describe('真实TableTab生成SQL并打开独立查询RAM', () => {
  it('预览不查询，旧类型回调无效；生成INSERT保留原表草稿、明确库及独立来源', async () => {
    await mount(); const originalTab = store.getState().settings.tabs[0];
    await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '原表未提交草稿' } })));
    const count = pages.length, before = structuredClone(grid.rows); await click(text.entry); expect(dialog()).not.toBeNull(); expect(preview()).toContain('LIMIT 1000;'); const stale = callback(button(text.open));
    await kind('INSERT'); expect(preview()).toContain('INSERT INTO `db`.`items`'); expect(preview()).not.toContain('原表未提交草稿'); expect(preview()).not.toContain('`id`'); await act(async () => stale()); expect(opened).toEqual([]);
    const current = callback(button(text.open)); await click(text.open); await act(async () => current());
    expect(opened).toHaveLength(1); expect(opened[0]).toMatchObject({ kind: 'query', connectionId: '连接', database: 'db', databaseContext: { state: 'known', database: 'db' }, title: 'items · INSERT' }); expect(opened[0].sql).toContain(':value_1'); expect(opened[0]).not.toHaveProperty('sourceBinding'); expect(opened[0]).not.toHaveProperty('fileSourceBinding');
    expect(store.getState().settings.tabs).toHaveLength(2); expect(store.getState().settings.tabs[0]).toBe(originalTab); expect(grid.rows).toEqual(before); expect(pages).toHaveLength(count); expect(previews).toEqual([]); expect(commands.some(command => /query\.execute|table\.apply/.test(command))).toBe(false); expect(navigations).toBeGreaterThanOrEqual(2);
  });
  it('视图或缺少可靠键只给明确错误，SELECT仍可预览，不生成危险写SQL', async () => {
    const info = await mount(); info.objectKind = 'view'; await click(text.entry); expect(preview()).toContain('SELECT'); await kind('DELETE'); expect(preview()).toBe(''); expect(document.body.textContent).toContain(text.readonly); expect(button(text.open).disabled).toBe(true); await click(text.close);
    info.objectKind = 'table'; info.editableKey = []; await click(text.entry); await kind('UPDATE'); expect(document.body.textContent).toContain(text.key); expect(button(text.open).disabled).toBe(true); expect(opened).toEqual([]); expect(previews).toEqual([]);
  });
  it('结构或结果上限漂移后保持失效，恢复同值也不能复活原预览', async () => {
    const info = await mount(); await click(text.entry); const old = callback(button(text.open)); info.columns[1].type = 'longtext'; await click(text.open); expect(document.body.textContent).toContain(text.changed); expect(opened).toEqual([]);
    info.columns[1].type = 'text'; await act(async () => old()); expect(opened).toEqual([]); await click(text.close);
    await click(text.entry); await act(async () => store.getState().updateSettings({ resultLimit: 50 })); await click(text.open); expect(opened).toEqual([]); await act(async () => store.getState().updateSettings({ resultLimit: 1000 })); await act(async () => callback(button(text.open))()); expect(opened).toEqual([]);
  });
  it('标签达到预算时在模板窗口显示错误，原表及查询列表不被改动', async () => {
    await mount(); const original = store.getState().settings.tabs[0]; await act(async () => store.setState(state => ({ settings: { ...state.settings, tabs: [original, ...Array.from({ length: 99 }, (_, index) => ({ id: 'q' + index, kind: 'query' as const, connectionId: '连接', title: '已有查询' + index }))] } })));
    await click(text.entry); await click(text.open); expect(dialog()).not.toBeNull(); expect(document.body.textContent).toContain(text.tabs); expect(opened).toEqual([]); expect(store.getState().settings.tabs).toHaveLength(100); await click(text.close);
  });
  it('实际SELECT字段勾选与上下移动传到独立查询，预览、新标签完全一致且原草稿不变', async () => {
    await mount(); await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '保留草稿' } })));
    const originalRows = structuredClone(grid.rows), originalPages = pages.length;
    await click(text.entry); await click(text.clearColumns); expect(button(text.open).disabled).toBe(true); expect(document.body.textContent).toContain(text.fieldRequired);
    await choose('note'); await choose('num'); await click(text.moveColumnUp('num'));
    expect(preview()).toBe(text.generatedComment + '\nSELECT\n  `num`,\n  `note`\nFROM `db`.`items`\nLIMIT 1000;');
    await click(text.moveColumnDown('num')); expect(preview()).toContain('`note`,\n  `num`'); await click(text.moveColumnUp('num'));
    const reviewed = preview(); await click(text.open);
    expect(opened).toHaveLength(1); expect(opened[0].sql).toBe(reviewed); expect(opened[0]).not.toHaveProperty('sourceBinding'); expect(opened[0]).not.toHaveProperty('sessionId');
    expect(store.getState().settings.tabs).toHaveLength(2); expect(grid.rows).toEqual(originalRows); expect(pages).toHaveLength(originalPages); expect(previews).toEqual([]); expect(commands.some(command => /query\.execute|table\.apply/.test(command))).toBe(false);
  });
  it('实际UPDATE按所选顺序编号值参数，键仅在WHERE中保留，生成列及自增列不可选', async () => {
    const info = await mount(); info.columns[3].generated = true; info.columns[4].extra = 'STORED GENERATED';
    await click(text.entry); await kind('UPDATE');
    expect(columnControls().map(node => node.getAttribute('aria-label'))).toEqual([text.chooseColumn('note'), text.chooseColumn('num')]);
    await click(text.clearColumns); expect(button(text.open).disabled).toBe(true); expect(document.body.textContent).toContain(text.noUpdates);
    await choose('note'); await choose('num'); await click(text.moveColumnUp('num'));
    const reviewed = preview(); expect(reviewed).toBe(text.generatedComment + '\nUPDATE `db`.`items`\nSET\n  `num` = :value_1,\n  `note` = :value_2\nWHERE\n  `id` = :key_1\nLIMIT 1;');
    expect(document.body.textContent).toContain(text.parameters(3)); await click(text.open); expect(opened[0].sql).toBe(reviewed); expect(previews).toEqual([]); expect(commands.some(command => /query\.execute|table\.apply/.test(command))).toBe(false);
  });
  it('切类型恢复各自默认字段，DELETE没有选列，显式清空INSERT只生成默认值草稿', async () => {
    await mount(); await click(text.entry); await click(text.clearColumns); await choose('num'); await kind('INSERT');
    expect(columnControls().map(node => node.getAttribute('aria-label'))).toEqual(['note', 'num', 'doc', 'bin'].map(text.chooseColumn)); expect(columnControls().every(node => node.checked)).toBe(true);
    await click(text.clearColumns); expect(preview()).toContain('INSERT INTO `db`.`items` () VALUES ();'); expect(document.body.textContent).toContain(text.insertColumnsHint); expect(button(text.open).disabled).toBe(false);
    await kind('DELETE'); expect(columnControls()).toEqual([]); expect(document.querySelector(`[aria-label="${text.columns}"]`)).toBeNull(); expect(preview()).toContain('WHERE\n  `id` = :key_1\nLIMIT 1;');
    await kind('SELECT'); expect(columnControls()).toHaveLength(5); expect(columnControls().every(node => node.checked)).toBe(true);
    await kind('INSERT'); await click(text.clearColumns); const reviewed = preview(); await click(text.open); expect(opened[0].sql).toBe(reviewed); expect(opened[0].sql).not.toContain(':value_'); expect(commands.some(command => /query\.execute|table\.apply/.test(command))).toBe(false);
  });
  it('4096字段只渲染每页50个控件，搜索不丢隐含选列，清空后可精确选择末列', async () => {
    const info = await mount(); widen(info, 4096); const count = pages.length; await click(text.entry);
    expect(columnControls()).toHaveLength(50); expect(document.body.textContent).toContain(text.columnsPage(1, 82)); const originalSql = preview(); expect(originalSql).toContain('`field4095`');
    await click(text.columnsNext); expect(columnControls()).toHaveLength(50); expect(columnControls()[0].getAttribute('aria-label')).toBe(text.chooseColumn('field50')); expect(preview()).toBe(originalSql);
    await search('field4095'); expect(columnControls()).toHaveLength(1); expect(checkbox('field4095').checked).toBe(true); expect(preview()).toBe(originalSql); expect(button(text.columnsNext).disabled).toBe(true);
    await click(text.clearColumns); expect(columnControls()).toHaveLength(1); expect(checkbox('field4095').checked).toBe(false); expect(button(text.open).disabled).toBe(true); await choose('field4095');
    const reviewed = preview(); expect(reviewed).toBe(text.generatedComment + '\nSELECT\n  `field4095`\nFROM `db`.`items`\nLIMIT 1000;'); await click(text.open); expect(opened[0].sql).toBe(reviewed); expect(pages).toHaveLength(count);
  });
  it('宽表写模板预算超出仍可通过字段列表精简，而不是禁止进入选择', async () => {
    const info = await mount(); widen(info, 250); await click(text.entry); await kind('INSERT'); expect(button(text.open).disabled).toBe(true); expect(document.body.textContent).toContain(text.budget); expect(columnControls()).toHaveLength(50);
    await click(text.clearColumns); await search('field249'); await choose('field249'); expect(preview()).toContain('`field249` = :value_1;'); expect(preview()).not.toContain(':value_2');
    const reviewed = preview(); await click(text.open); expect(opened[0].sql).toBe(reviewed); expect(opened[0].title).toBe('items · INSERT');
  });
  it.each(['kind', 'choose', 'move', 'search', 'page'] as const)('%s同轮变化立即拒绝旧打开与旧选列/排序/搜索/分页操作', async change => {
    const info = await mount(); widen(info, 60); await click(text.entry); const initialSql = preview();
    const oldOpen = callback(button(text.open)), oldReset = callback(button(text.resetColumns)), oldClear = callback(button(text.clearColumns)), oldMove = callback(button(text.moveColumnUp('field1'))), oldPage = callback(button(text.columnsNext));
    const oldChoose = callback(checkbox('id'), 'onChange'), oldKind = callback(document.querySelector(`[aria-label="${text.kind}"]`)!, 'onChange'), oldSearch = callback(document.querySelector(`[aria-label="${text.filterColumns}"]`)!, 'onChange');
    await act(async () => {
      if (change === 'kind') oldKind({ target: { value: 'INSERT' } });
      if (change === 'choose') oldChoose({ target: { checked: false } });
      if (change === 'move') oldMove();
      if (change === 'search') oldSearch({ target: { value: 'field59' } });
      if (change === 'page') oldPage();
      oldOpen(); oldReset(); oldClear(); oldMove(); oldPage(); oldChoose({ target: { checked: false } }); oldKind({ target: { value: 'DELETE' } }); oldSearch({ target: { value: '不存在' } });
    });
    expect(opened).toEqual([]); const reviewed = preview();
    if (change === 'kind') { expect(reviewed).toContain('INSERT INTO'); expect(reviewed).not.toContain('`id`'); }
    if (change === 'choose') { expect(reviewed).toContain('SELECT'); expect(reviewed).not.toContain('`id`'); }
    if (change === 'move') expect(reviewed).toContain('SELECT\n  `field1`,\n  `id`');
    if (change === 'search') { expect(columnControls()).toHaveLength(1); expect(checkbox('field59').checked).toBe(true); expect(reviewed).toBe(initialSql); }
    if (change === 'page') { expect(columnControls()).toHaveLength(10); expect(document.body.textContent).toContain(text.columnsPage(2, 2)); expect(reviewed).toBe(initialSql); }
    await act(async () => { oldOpen(); oldReset(); oldClear(); }); expect(preview()).toBe(reviewed); expect(opened).toEqual([]);
    await click(text.open); expect(opened).toHaveLength(1); expect(opened[0].sql).toBe(reviewed);
  });
  it.each(['activeTab', 'connectionVersion', 'resultLimit'] as const)('实际TableTab的%s同轮ABA同步撤销模板，选列不重新授权旧来源', async change => {
    await mount(); await click(text.entry); await click(text.clearColumns); await choose('note'); const oldOpen = callback(button(text.open));
    await act(async () => {
      if (change === 'activeTab') { store.setState(state => ({ settings: { ...state.settings, activeTabId: '其它页' } })); store.setState(state => ({ settings: { ...state.settings, activeTabId: '表页' } })); }
      if (change === 'connectionVersion') { store.setState({ connectionVersions: { 连接: 2 } }); store.setState({ connectionVersions: { 连接: 1 } }); }
      if (change === 'resultLimit') { store.setState(state => ({ settings: { ...state.settings, resultLimit: 5 } })); store.setState(state => ({ settings: { ...state.settings, resultLimit: 1000 } })); }
      oldOpen();
    });
    expect(opened).toEqual([]); expect(document.body.textContent).toContain(text.changed); await act(async () => oldOpen()); expect(opened).toEqual([]); await click(text.close);
  });
  it.each(['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const)('真实弹窗%s默认或恢复默认仍仅用两参数打开', async value => {
    const info = await mount(), onOpen = vi.fn(() => true); await act(async () => root!.render(<Dialog info={info} limit={1000} isCurrent={() => true} onOpen={onOpen} onClose={() => {}}/>)); await kind(value);
    if (value !== 'DELETE') { await click(text.clearColumns); await click(text.resetColumns); }
    const reviewed = preview(); await click(text.open); expect(onOpen.mock.calls).toEqual([[reviewed, value]]);
  });
  it('真实弹窗显式选列给冻结第三参数，原型同名列和反引号顺序不变', async () => {
    const info = await mount(); info.columns[1].name = '__proto__'; info.columns[2].name = '列`名'; const onOpen = vi.fn(() => true);
    await act(async () => root!.render(<Dialog info={info} limit={1000} isCurrent={() => true} onOpen={onOpen} onClose={() => {}}/>)); await click(text.clearColumns); await choose('__proto__'); await choose('列`名'); await click(text.moveColumnUp('列`名'));
    const reviewed = preview(); expect(reviewed).toContain('SELECT\n  `列``名`,\n  `__proto__`'); await click(text.open);
    expect(onOpen.mock.calls).toEqual([[reviewed, 'SELECT', { columns: ['列`名', '__proto__'] }]]); const options = (onOpen.mock.calls[0] as unknown[])[2] as { columns: string[] };
    expect(() => options.columns.push('id')).toThrow(); expect(() => { options.columns = ['id']; }).toThrow(); expect(options.columns).toEqual(['列`名', '__proto__']);
  });
});
