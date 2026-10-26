import { randomUUID } from 'node:crypto';
import { tableFilteredDeleteConfirmation } from '../../src/shared/tableFilteredDelete';
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tableFilteredDeleteZh as text } from '../../src/renderer/locales/tableFilteredDelete.zh-CN';
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
let commands: string[], pages: any[], opened: any[], requests: Array<{command:string;input:any}>; let pendingPreview:any; let lastPreview:any;
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

/** 初始化与服务器任务均为RAM端口；正式入口、scope与刷新逻辑使用真实TableTab。 */
async function mount(options: { wide?: number; view?: boolean; weird?: boolean } = {}) {
  commands = []; pages = []; opened = []; requests=[]; pendingPreview=undefined; lastPreview=undefined;
  const database = options.weird ? '库`?名' : 'db', name = options.weird ? '表`?\n名' : 'items';
  const info: TableInfo = { database, name, objectKind: options.view ? 'view' : 'table', engine: options.view ? '' : 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'label', 'amount', 'note', ...(options.weird ? ['__proto__', '列`?\n名'] : [])].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,12)' : 'TEXT', nullable: name !== 'id', defaultValue: null, extra: '', generated: false, comment: '' })) };
  if (options.wide) info.columns = [info.columns[0], ...Array.from({ length: options.wide - 1 }, (_, i) => ({ ...info.columns[1], name: `field${i + 1}` }))];
  const source = Object.fromEntries(info.columns.map(column => [column.name, column.name === 'id' ? '9007199254740993' : column.name === 'amount' ? '9007199254740993.123456789012' : column.name === 'label' ? 'Alpha' : '原值']));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command); requests.push({command,input:structuredClone(input)});
    if(command==='table.filteredDelete.preview'){lastPreview={operation:'delete',previewToken:randomUUID(),target:{connectionId:input.connectionId,database:input.database,table:input.table},rows:777,shownRows:1,sql:'DELETE FROM sampled_old_row;',sampleOmitted:true,expiresAt:new Date(Date.now()+60000).toISOString(),definitionDigest:'a'.repeat(64),scopeDigest:'b'.repeat(64),timeZone:'SYSTEM',warnings:[]};return pendingPreview?pendingPreview.promise:lastPreview;}
    if(command==='table.filteredDelete.apply')return {operation:'delete',target:lastPreview.target,rows:lastPreview.rows,outcome:'committed',commitAcknowledged:true};
    if(command==='table.filteredDelete.release')return;
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

/** 只通过正式字段输入、确认和按钮，不修改TableTab内部state。 */
/** 读取原label/htmlFor关联；不为夹具给产品添加重复可访问名称。 */
async function confirmDelete(){const node=doc.querySelectorAll('textarea').find(node=>node.getAttribute('aria-label')===text.confirmation)!;await act(async()=>{node.value=tableFilteredDeleteConfirmation(lastPreview);node.dispatchEvent(new MemoryEvent('input'));});const check=doc.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===text.acknowledge)!;await act(async()=>{check.checked=true;check.dispatchEvent(new MemoryEvent('click'));});}
describe('跨页服务器删除实际TableTab正式入口与刷新RAM',()=>{
  it('第二页完整OR嵌套/停用/多排序进入preview；只确认777全量行，关闭收尾后刷新原第二页',async()=>{
    await mount();await applyScope();await click(zh.common.pageNext);const before=pages.length,original=structuredClone(grid.rows);await click(text.entry);expect(requests.filter(item=>item.command==='table.filteredDelete.preview')).toHaveLength(0);await click(text.preview);
    const captured=requests.find(item=>item.command==='table.filteredDelete.preview')!.input;expect(captured).toMatchObject({...readScope()});expect(Object.hasOwn(captured,'page')).toBe(false);expect(Object.hasOwn(captured,'pageSize')).toBe(false);expect(grid.rows).toEqual(original);expect(pages).toHaveLength(before);await confirmDelete();await click(text.apply);expect(requests.filter(item=>item.command==='table.filteredDelete.apply')).toHaveLength(1);expect(pages).toHaveLength(before);await click(text.close);expect(pages).toHaveLength(before+1);expect(pages.at(-1)).toMatchObject({...readScope(),page:2});
  });
  it('父页有待提交草稿时入口禁用，旧按钮也不能丢稿/预览；原当前页批量路径仍独立',async()=>{
    await mount();const old=oldCallback(button(text.entry));await act(async()=>grid.props.onRowsChange(grid.rows.map(row=>({...row,data:{...row.data,note:'本地未提交'}}))));expect(button(text.entry).disabled).toBe(true);await act(async()=>old());expect(requests.some(item=>item.command==='table.filteredDelete.preview'||item.command==='table.filteredDelete.apply')).toBe(false);expect(grid.rows[0].data.note).toBe('本地未提交');
  });
  it('取消窗口不刷新、不改变父行和勾选，不发送preview或apply',async()=>{
    await mount();await act(async()=>grid.props.onSelectedRowsChange(new Set([grid.rows[0].id])));const original=structuredClone(grid.rows),selected=[...grid.props.selectedRows],before=pages.length;await click(text.entry);await click(text.close);expect(grid.rows).toEqual(original);expect([...grid.props.selectedRows]).toEqual(selected);expect(pages).toHaveLength(before);expect(requests.some(item=>item.command.startsWith('table.filteredDelete.'))).toBe(false);
  });
  it('连接/活动标签ABA撤销原preview，迟到token仅释放，不重新匹配或刷新',async()=>{
    await mount();let resolve!:(value:any)=>void;pendingPreview={promise:new Promise(yes=>{resolve=yes;})};await click(text.entry);await click(text.preview);const before=pages.length;await act(async()=>{store.setState(state=>({settings:{...state.settings,activeTabId:'其它'}}));store.setState(state=>({settings:{...state.settings,activeTabId:'表页'}}));});await act(async()=>resolve(lastPreview));expect(button(text.apply).disabled).toBe(true);expect(requests.filter(item=>item.command==='table.filteredDelete.release').map(item=>item.input)).toEqual([{connectionId:'连接',previewToken:lastPreview.previewToken}]);expect(requests.some(item=>item.command==='table.filteredDelete.apply')).toBe(false);await click(text.close);expect(pages).toHaveLength(before);
  });
});
