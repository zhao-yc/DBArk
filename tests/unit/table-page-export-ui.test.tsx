import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { tablePageExportZh as text } from '../../src/renderer/locales/tablePageExport.zh-CN';
import { tableRowTransferZh as transferText } from '../../src/renderer/locales/tableRowTransfer.zh-CN';
import { resultInsertZh as insertText } from '../../src/renderer/locales/resultInsert.zh-CN';
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
let commands: string[], previews: any[], pages: any[], exports: any[], insertPreviews: any[], insertApplies: any[];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let restoreNavigationMenuPort = () => {};
beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
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
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flush(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 所有IPC都在RAM内响应；未知命令立即失败，绝不连接服务器或真实数据库。 */
async function mount(overrides: Record<string, (input: any) => Promise<any>> = {}) {
  commands = []; previews = []; pages = []; exports = []; insertPreviews = []; insertApplies = [];
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: '', columns: ['id', 'note', 'num', 'doc', 'bin'].map(name => ({ name, type: name === 'num' ? 'decimal(65,30)' : name === 'doc' ? 'json' : name === 'bin' ? 'blob' : 'text', nullable: name !== 'id' && name !== 'num', defaultValue: null, extra: name === 'id' ? 'auto_increment' : '', generated: false, comment: '' })) };
  const source = [1, 2, 3].map(id => ({ id: String(id), note: id === 2 ? null : '原' + id, num: '0.00000000000000000000001', doc: '{"n":900719925474099312345,"x":-0}', bin: { type: 'binary', base64: 'AP8=' } }));
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push(command);
    if (overrides[command]) return overrides[command](input);
    if (['settings.save', 'connections.open', 'query.cancel', 'table.copySourceRelease'].includes(command)) return;
    if (command === 'table.preferences.get') return { version: 1, columns: ['bin', 'id', 'num', 'note', 'doc'].map(name => ({ name, hidden: name === 'doc' })) };
    if (command === 'files.choose') return { token: 'RAM文件', name: '本页.json' };
    if (command === 'files.exportResult') { exports.push(structuredClone(input)); return { rows: input.result.rows.length }; }
    if (command === 'metadata.databases') return ['target_db'];
    if (command === 'metadata.objects') return [{ name: 'dest', kind: 'table' }];
    if (command === 'metadata.table') return input.connectionId === '目标' ? { ...info, database: 'target_db', name: 'dest' } : info;
    if (command === 'result.insertPreview') {
      insertPreviews.push(structuredClone(input));
      return { previewToken: '11111111-1111-4111-8111-111111111111', target: { connectionId: input.connectionId, database: input.database, table: input.table }, rows: input.data.rows.length, mapping: input.mapping, shownRows: input.data.rows.length, sql: 'INSERT INTO `target_db`.`dest` VALUES (...)', expiresAt: new Date(Date.now() + 120000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: input.data.truncated, timeZone: input.timeZone, warnings: [] };
    }
    if (command === 'result.insertApply') { insertApplies.push(structuredClone(input)); return { target: { connectionId: '目标', database: 'target_db', table: 'dest' }, rows: insertPreviews.at(-1).data.rows.length, outcome: 'committed', commitAcknowledged: true }; }
    if (command === 'result.insertRelease') return;
    if (command === 'table.presets.list') return { revision: 0, source: 'absent', bindingToken: 'ram-only', entries: [] };
    if (command === 'table.page') { pages.push(structuredClone(input)); return { page: input.page, pageSize: input.pageSize, hasMore: false, rows: structuredClone(source), columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(info) }; }
    if (command === 'table.preview') { previews.push(structuredClone(input)); return { sql: '仅RAM预览', warnings: [] }; }
    throw Error('禁止额外IO：' + command);
  } };
  const tab = { id: '表页', kind: 'table' as const, connectionId: '连接', database: 'db', table: 'items', title: '合成表' };
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: tab.id, tabs: [tab] }, connections: ['连接', '目标'].map(id => ({ id, name: id === '连接' ? '合成离线' : '独立目标连接', group: '', color: '', dialect: 'mysql' as const, host: 'offline.invalid', port: 1, user: 'ram' })), connectionVersions: { 连接: 1, 目标: 1 }, activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} });
  const noop = () => {}, container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<TableTab tab={tab} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop} />));
  expect(grid.rows).toHaveLength(3); return info;
}
function button(name: string) { let node: MemoryNode | undefined; act(() => { node = navigationMenuRamButton(document.body, name); }); expect(node, '缺少按钮：' + name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 通过真实网格回调勾选，倒序Set不能改变文件中的显示顺序。 */
async function select(indices: number[]) { await act(async () => grid.props.onSelectedRowsChange(new Set(indices.map(index => grid.rows[index].id)))); }
function dialog(title: string) { return document.querySelector(`[aria-label="${title}"]`); }
/** 只取得旧按钮闭包，反证迟到事件不能导出后来选择。 */
function callback(node: MemoryNode): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (node as any)[key].onClick; }

/** 真实受控输入与选择事件，不绕过目标目录、字段映射或写入确认。 */
async function transferField(label: string, value: string, tag = 'select'): Promise<void> {
  const node = document.querySelector(`${tag}[aria-label="${label}"]`); expect(node, label).not.toBeNull(); expect(node!.disabled).toBe(false);
  await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent(tag === 'select' ? 'change' : 'input')); });
}
async function prepareTransfer(): Promise<void> {
  await transferField(insertText.connection, '目标'); await click(insertText.databases);
  await transferField(insertText.database, 'target_db'); await click(insertText.tables);
  await transferField(insertText.table, 'dest'); await click(insertText.metadata);
}

describe('表页勾选记录跨库复制真实React接线', () => {
  it('开门零请求、显式目录/时区/映射后单次提交；原选择、原页和隐藏字段保持', async () => {
    await mount(); expect(button(transferText.entry).disabled).toBe(true); await select([2, 0]);
    const before = [...commands], originalRows = grid.rows, originalSelection = grid.props.selectedRows;
    await click(transferText.entry); expect(dialog(transferText.title)).not.toBeNull(); expect(commands).toEqual(before);
    expect(grid.rows).toBe(originalRows); expect(grid.props.selectedRows).toBe(originalSelection); expect(grid.props.selectedRows.size).toBe(2);
    expect(document.querySelector(`[aria-label="${insertText.timeZone}"]`)!.value).toBe('');
    await prepareTransfer(); await click(insertText.preview); expect(insertPreviews).toHaveLength(0); expect(document.body.textContent).toContain(insertText.timeZoneInvalid);
    await transferField(insertText.timeZone, '+08:00', 'input'); await click(insertText.preview);
    expect(insertPreviews).toHaveLength(1); const input = insertPreviews[0];
    expect(input.connectionId).toBe('目标'); expect(input.timeZone).toBe('+08:00'); expect(input.data.columns.map((column: any) => column.key)).toEqual(['bin', 'id', 'num', 'note']);
    expect(input.data.rows.map((row: any) => row.id)).toEqual(['1', '3']); expect(input.data.rows[0].bin).toEqual({ type: 'binary', base64: 'AP8=' }); expect(input.data.rows[0].num).toBe('0.00000000000000000000001');
    expect(JSON.stringify(input.data)).not.toContain('900719925474099312345');
    await transferField(insertText.confirmation, 'target_db.dest', 'textarea');
    const acknowledgement = document.querySelector(`[aria-label="${insertText.acknowledge}"]`)!;
    await act(async () => { acknowledgement.checked = true; acknowledgement.dispatchEvent(new MemoryEvent('click')); });
    await click(insertText.apply); expect(insertApplies).toHaveLength(1); expect(insertApplies[0].connectionId).toBe('目标');
    expect(document.body.textContent).toContain(insertText.committed(2)); expect(grid.rows).toBe(originalRows); expect(grid.props.selectedRows).toBe(originalSelection);
    await click(insertText.close); expect(dialog(transferText.title)).toBeNull(); expect(pages).toHaveLength(1); expect(previews).toEqual([]); expect(store.getState().activeJobs['表页']).toBe(false);
  });
  it('旧勾选/草稿不能开门，勾选ABA后旧来源永久失效，保留原输入', async () => {
    await mount(); await select([0]); const old = callback(button(transferText.entry)); await select([1]); await act(async () => old()); expect(dialog(transferText.title)).toBeNull();
    await click(transferText.entry); await select([0]); await select([1]);
    expect(document.body.textContent).toContain(insertText.stale); expect(button(insertText.databases).disabled).toBe(true); await click(insertText.close);
    await act(async () => grid.props.onRowsChange(grid.rows.map((row, index) => index ? row : { ...row, data: { ...row.data, note: '保持源草稿' } })));
    expect(button(transferText.entry).disabled).toBe(true); await act(async () => old()); expect(dialog(transferText.title)).toBeNull(); expect(grid.rows[0].data.note).toBe('保持源草稿'); expect(insertApplies).toEqual([]);
  });
  it('连接/标签切走再回也撤销旧来源，关闭不重查原页或清选择', async () => {
    await mount(); await select([0, 1]); await click(transferText.entry); const original = store.getState().settings;
    await act(async () => { store.setState({ settings: { ...original, activeTabId: '其它标签' } }); store.setState({ settings: original }); });
    expect(document.body.textContent).toContain(insertText.stale); await click(insertText.close);
    expect(grid.props.selectedRows.size).toBe(2); expect(pages).toHaveLength(1); expect(insertPreviews).toEqual([]); expect(insertApplies).toEqual([]);
  });
  it('自身目录读取保持来源；外来同true忙态夺取后旧释放不能清后继作业', async () => {
    let resolve!: (value: string[]) => void; const pending = new Promise<string[]>(yes => { resolve = yes; });
    await mount({ 'metadata.databases': async () => pending }); await select([0]); await click(transferText.entry); await transferField(insertText.connection, '目标'); await click(insertText.databases);
    expect(store.getState().activeJobs['表页']).toBe(true);
    await act(async () => store.getState().setBusy('表页', true));
    await act(async () => resolve(['target_db'])); expect(store.getState().activeJobs['表页']).toBe(true); expect(document.body.textContent).toContain(insertText.stale);
    await click(insertText.close); expect(insertApplies).toEqual([]); await act(async () => store.getState().setBusy('表页', false));
  });
  it('关闭等待原预览和取消ACK；迟到预览精确释放且不自动写入', async () => {
    let finishPreview!: (value: any) => void, finishCancel!: () => void, captured: any;
    const pendingPreview = new Promise<any>(resolve => { finishPreview = resolve; }), pendingCancel = new Promise<void>(resolve => { finishCancel = resolve; });
    await mount({ 'result.insertPreview': async input => { captured = input; return pendingPreview; }, 'query.cancel': async () => pendingCancel });
    await select([0]); await click(transferText.entry); await prepareTransfer(); await transferField(insertText.timeZone, '+08:00', 'input'); await click(insertText.preview);
    expect(captured).toBeDefined(); await click(insertText.close); expect(dialog(transferText.title)).not.toBeNull(); expect(document.body.textContent).toContain(insertText.closing);
    await act(async () => finishPreview({ previewToken: '22222222-2222-4222-8222-222222222222', target: { connectionId: captured.connectionId, database: captured.database, table: captured.table }, rows: captured.data.rows.length, mapping: captured.mapping, shownRows: 1, sql: '有限样本', expiresAt: new Date(Date.now() + 120000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: false, timeZone: captured.timeZone, warnings: [] }));
    expect(dialog(transferText.title)).not.toBeNull(); await act(async () => finishCancel());
    expect(dialog(transferText.title)).toBeNull(); expect(commands.filter(command => command === 'result.insertRelease')).toHaveLength(1); expect(insertApplies).toEqual([]); expect(grid.props.selectedRows.size).toBe(1); expect(store.getState().activeJobs['表页']).toBe(false);
  });
  it('额外模态窗口不能成为复制来源窗口，移除后旧预览权限不复活', async () => {
    await mount(); await select([0]); await click(transferText.entry); await transferField(insertText.connection, '目标');
    const foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog'); document.body.appendChild(foreign);
    await click(insertText.databases); expect(document.body.textContent).toContain(insertText.stale); expect(commands).not.toContain('metadata.databases');
    document.body.removeChild(foreign); expect(button(insertText.databases).disabled).toBe(true); await click(insertText.close); expect(insertApplies).toEqual([]);
  });
});

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
