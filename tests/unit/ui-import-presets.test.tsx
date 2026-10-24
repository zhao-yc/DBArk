import { randomUUID } from 'node:crypto';
import type { ImportPresetConfiguration, ImportPresetSnapshot } from '../../src/shared/importPresets';
import { importPresetsZh as presetText } from '../../src/renderer/locales/importPresets.zh-CN';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { csvImportHeaderZh as text } from '../../src/renderer/locales/csvImportHeader.zh-CN';

const port = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _input?: any): Promise<any> => undefined), grid: null as any }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
// 只替换无布局网格和无关Excel用途，表单、预览协调器和映射均使用生产实现。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid(props: any) { port.grid = props; return <div role="grid"/>; } }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout }); const create = doc.createElement.bind(doc);
  /** 内存DOM仅补标准属性反射；不修改产品ref、状态或执行守卫。 */
  doc.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    if (name === 'option') { Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog: Dialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let savedSnapshot: ImportPresetSnapshot;
const headed = { columns: ['id', '内容'], rows: [{ id: '第二条', 内容: '后续数据' }] };
const positional = { columns: ['第1列', '第2列'], rows: [{ 第1列: '第一条', 第2列: '首条原文\n保留' }, { 第1列: '第二条', 第2列: '后续数据' }] };
/** 只以RAM端口提供原文件样本，不执行真实文件或数据库读写。 */
async function mount(options: { mode?: 'import' | 'export'; preview?: (input: any) => Promise<any>; choose?: () => Promise<any> } = {}) {
  savedSnapshot = { generation: randomUUID(), revision: 0, entries: [] };
  port.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'files.importPresets.list') return structuredClone(savedSnapshot);
    if (command === 'files.importPresets.save') { const now = '2026-10-24T00:00:00.000Z', id = input.id ?? randomUUID(); savedSnapshot = { ...savedSnapshot, revision: savedSnapshot.revision + 1, entries: [...savedSnapshot.entries.filter(entry => entry.id !== id), { id, name: input.name, configuration: input.configuration, createdAt: now, updatedAt: now }] }; return structuredClone(savedSnapshot); }
    if (command === 'files.importPresets.delete') { savedSnapshot = { ...savedSnapshot, revision: savedSnapshot.revision + 1, entries: savedSnapshot.entries.filter(entry => entry.id !== input.id) }; return structuredClone(savedSnapshot); }
    if (command === 'metadata.table') return { database: 'db', name: 't', engine: 'InnoDB', columns: ['id', '内容', '第1列'].map(name => ({ name, type: 'text', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
    if (command === 'files.choose') return options.choose ? options.choose() : { token: 'current-file', name: 't.' + input.format };
    if (command === 'files.preview') return options.preview ? options.preview(input) : input.csvHasHeader === false ? positional : headed;
    if (command === 'files.import') return { rows: input.csvHasHeader === false ? 2 : 1, errors: [] };
    if (command === 'files.exportColumns') return { target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: 'catalog', expiresAt: new Date(Date.now() + 120000).toISOString(), columns: [{ name: 'id', type: 'text' }] };
    if (['connections.open', 'files.releaseExportColumns', 'query.cancel'].includes(command)) return;
    if (command === 'files.export') return { rows: 1 };
    throw Error('禁止其它IPC：' + command);
  });
  store.setState({ connectionVersions: { c: 1 }, tasks: [] }); const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<Dialog mode={options.mode ?? 'import'} connectionId="c" database="db" table="t" onClose={vi.fn()}/>));
}
function named(label: string, tag: string) { const node = doc.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function execute() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'primary')!; }
function picker() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!; }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('未找到真实React事件'); return Reflect.get(node, key); }
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function change(node: MemoryNode, value: string) { expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function header(value: boolean) { const node = named(text.label, 'input'); expect(node.disabled).toBe(false); await act(async () => { node.checked = value; node.dispatchEvent(new MemoryEvent('click')); }); }
function requests(command: string) { return port.invoke.mock.calls.filter(([name]) => name === command).map(([, input]) => input); }

function namedButton(label: string) { const node = doc.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function name(value: string) { const node = named(presetText.name, 'input'); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
const config = (): ImportPresetConfiguration => ({ format: 'csv', encoding: 'utf8', csvDelimiter: ',', csvHasHeader: false, columns: ['第1列', '第2列'], mapping: { 第1列: 'id', 第2列: '内容' } });
function installPreset(value = config()) { const id = randomUUID(), time = '2026-10-24T00:00:00.000Z'; savedSnapshot.entries = [{ id, name: '常用 导入', configuration: value, createdAt: time, updatedAt: time }]; return id; }
async function selectPreset(id: string) { await click(namedButton(presetText.read)); await change(named(presetText.choose, 'select'), id); }

describe('导入配置正式TransferDialog流程（真实React RAM，零实际写入）', () => {
  it('首帧显式读取沿协调器原状态生效，选择配置后应用入口可用', async () => {
    await mount(); const id = installPreset(); await click(namedButton(presetText.read)); expect(requests('files.importPresets.list')).toHaveLength(1); await change(named(presetText.choose, 'select'), id); expect(namedButton(presetText.apply).disabled).toBe(false);
  });
  it.each(['manual', 'preset'] as const)('取消文件选择保留%s原文件/完整映射及套用提示，不重新预览或读取metadata', async kind => {
    const pending = deferred<any>(); let choices = 0; await mount({ choose: async () => ++choices === 1 ? { token: 'original-file', name: 'original.csv' } : pending.promise }); const id = installPreset(); await click(picker());
    if (kind === 'preset') { await selectPreset(id); await click(namedButton(presetText.apply)); } else { await change(named('映射字段 内容', 'select'), '第1列'); }
    const columns = kind === 'preset' ? ['第1列', '第2列'] : ['id', '内容'], mapping = columns.map(column => named('映射字段 ' + column, 'select').value), rows = port.grid.rows, previews = requests('files.preview').length, metadata = requests('metadata.table').length;
    await click(picker()); expect(columns.map(column => named('映射字段 ' + column, 'select').value)).toEqual(mapping); expect(port.grid.rows).toBe(rows);
    await act(async () => pending.resolve(null)); expect(columns.map(column => named('映射字段 ' + column, 'select').value)).toEqual(mapping); expect(port.grid.rows).toBe(rows); expect(requests('files.preview')).toHaveLength(previews); expect(requests('metadata.table')).toHaveLength(metadata); expect(picker().textContent).toContain('original.csv'); expect(execute().disabled).toBe(false); expect(requests('files.import')).toHaveLength(0);
    if (kind === 'preset') { expect(doc.body.textContent).toContain(presetText.applied); expect(named(presetText.choose, 'select').value).toBe(id); }
  });
  it('打开不新增IPC；当前完整配置显式保存白名单，重新应用刷新metadata且不自动导入', async () => {
    await mount(); expect(requests('files.importPresets.list')).toHaveLength(0); await click(picker()); await header(false); await change(named('映射字段 第1列', 'select'), 'id'); await change(named('映射字段 第2列', 'select'), '内容');
    await click(namedButton(presetText.read)); await name('常用 导入'); await click(namedButton(presetText.create)); expect(requests('files.importPresets.save')).toHaveLength(1); const saved = requests('files.importPresets.save')[0];
    expect(saved.configuration).toEqual(config()); expect(Object.keys(saved.configuration).sort()).toEqual(['columns', 'csvDelimiter', 'csvHasHeader', 'encoding', 'format', 'mapping']); expect(JSON.stringify(saved)).not.toMatch(/fileToken|connectionId|database|首条原文|current-file/);
    await header(true); const metadata = requests('metadata.table').length; await click(namedButton(presetText.apply)); expect(requests('metadata.table')).toHaveLength(metadata + 1); expect(named(text.label, 'input').checked).toBe(false); expect(named('映射字段 第1列', 'select').value).toBe('id'); expect(named('映射字段 第2列', 'select').value).toBe('内容'); expect(doc.body.textContent).toContain(presetText.applied); expect(requests('files.import')).toHaveLength(0);
    await click(execute()); expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0]).toMatchObject({ csvHasHeader: false, mapping: { 第1列: 'id', 第2列: '内容' } });
  });
  it('坏文件整份拒绝并禁导入；换文件保所选模板但不继承映射，再明确应用才恢复', async () => {
    let chosen = 0; await mount({ choose: async () => ({ token: ++chosen === 1 ? 'bad' : 'good', name: 'fixture.csv' }), preview: async input => input.csvHasHeader === false ? input.fileToken === 'bad' ? { columns: ['第1列', '第2列', '第3列'], rows: [{ 第1列: '坏', 第2列: '', 第3列: '' }] } : positional : headed }); const id = installPreset();
    await click(picker()); await selectPreset(id); await click(namedButton(presetText.apply)); expect(doc.body.textContent).toContain(presetText.incompatible); expect(execute().disabled).toBe(true); expect(requests('files.import')).toHaveLength(0);
    await click(picker()); expect(named(presetText.choose, 'select').value).toBe(id); expect(named('映射字段 第1列', 'select').value).toBe(''); expect(named('映射字段 第2列', 'select').value).toBe('');
    await click(namedButton(presetText.apply)); expect(named('映射字段 第1列', 'select').value).toBe('id'); expect(named('映射字段 第2列', 'select').value).toBe('内容'); expect(requests('files.import')).toHaveLength(0);
  });
  it('相同选项重套亦换代，旧开始/应用闭包在来源ABA后不能领新映射', async () => {
    await mount(); const id = installPreset(); await click(picker()); await selectPreset(id); await click(namedButton(presetText.apply)); const oldStart = props(execute()).onClick, oldApply = props(namedButton(presetText.apply)).onClick, before = requests('metadata.table').length;
    await click(namedButton(presetText.apply)); expect(requests('metadata.table')).toHaveLength(before + 1); await act(async () => { oldStart(); oldApply(); }); expect(requests('files.import')).toHaveLength(0); expect(requests('metadata.table')).toHaveLength(before + 1);
    await header(true); await header(false); await act(async () => oldStart()); expect(requests('files.import')).toHaveLength(0); expect(named('映射字段 第1列', 'select').value).toBe('');
  });
  it('本地保存原调用结束前不能关闭，CAS失败只提示显式刷新，不自动覆盖', async () => {
    await mount(); const id = installPreset(); await click(picker()); await selectPreset(id); await click(namedButton(presetText.apply)); const held = deferred<any>(), original = port.invoke.getMockImplementation()!; port.invoke.mockImplementation((command, input) => command === 'files.importPresets.save' ? held.promise : original(command, input));
    await click(namedButton(presetText.update)); expect(named(text.label, 'input').disabled).toBe(true); expect(namedButton(presetText.refresh).disabled).toBe(true); expect(doc.querySelectorAll('button').find(node => node.textContent === '关闭')!.disabled).toBe(true);
    await act(async () => held.reject(Error('修订冲突'))); expect(doc.body.textContent).toContain(presetText.refreshRequired); expect(requests('files.importPresets.save')).toHaveLength(1); expect(requests('files.importPresets.list')).toHaveLength(1); expect(namedButton(presetText.update).disabled).toBe(true);
    await click(namedButton(presetText.refresh)); expect(namedButton(presetText.update).disabled).toBe(false); expect(requests('files.importPresets.save')).toHaveLength(1);
  });
});
