import { fileImportTransactionZh as transactionText } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { randomUUID } from 'node:crypto';
import type { ImportPresetConfiguration, ImportPresetSnapshot } from '../../src/shared/importPresets';
import { importPresetsZh as presetText } from '../../src/renderer/locales/importPresets.zh-CN';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

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
function requests(command: string) { return port.invoke.mock.calls.filter(([name]) => name === command).map(([, input]) => input); }

function namedButton(label: string) { const node = doc.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
const config = (): ImportPresetConfiguration => ({ format: 'csv', encoding: 'utf8', csvDelimiter: ',', csvHasHeader: false, columns: ['第1列', '第2列'], mapping: { 第1列: 'id', 第2列: '内容' } });
function installPreset(value = config()) { const id = randomUUID(), time = '2026-10-24T00:00:00.000Z'; savedSnapshot.entries = [{ id, name: '常用 导入', configuration: value, createdAt: time, updatedAt: time }]; return id; }
async function selectPreset(id: string) { await click(namedButton(presetText.read)); await change(named(presetText.choose, 'select'), id); }

function strategy() { return named(transactionText.label, 'select'); }
describe('CSV/JSON文件导入提交方式（真实React RAM，无DB/文件写入）', () => {
  it('默认每500行提交且显式发送batch，预览不携带执行策略', async () => {
    await mount(); expect(strategy().value).toBe('batch'); expect(strategy().querySelectorAll('option').map(node => node.value)).toEqual(['batch', 'atomic']); expect(doc.body.textContent).toContain(transactionText.batchHint); await click(picker()); await click(execute());
    expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0]).toMatchObject({ format: 'csv', transactionMode: 'batch' }); expect(requests('files.preview')[0]).not.toHaveProperty('transactionMode');
  });
  it.each(['csv', 'json'] as const)('%s整文件策略保留文件/就绪映射，不重读预览，显式发送atomic', async format => {
    await mount(); if (format === 'json') await change(doc.querySelectorAll('select')[0], 'json'); await click(picker()); await change(named('映射字段 内容', 'select'), '第1列'); const rows = port.grid.rows, previews = requests('files.preview').length, metadata = requests('metadata.table').length;
    await change(strategy(), 'atomic'); expect(named('映射字段 内容', 'select').value).toBe('第1列'); expect(port.grid.rows).toBe(rows); expect(requests('files.preview')).toHaveLength(previews); expect(requests('metadata.table')).toHaveLength(metadata); expect(doc.body.textContent).toContain(transactionText.atomicHint); expect(doc.body.textContent).toContain(transactionText.unknown); expect(strategy().getAttribute('title')).toBe(transactionText.presetHint);
    expect(requests('files.import')).toHaveLength(0); await click(execute()); expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0]).toMatchObject({ fileToken: 'current-file', format, transactionMode: 'atomic', mapping: { id: 'id', 内容: '第1列' } });
    if (format === 'json') { expect(requests('files.import')[0]).not.toHaveProperty('csvDelimiter'); expect(requests('files.import')[0]).not.toHaveProperty('csvHasHeader'); }
  });
  it('策略同事件栈撤销旧执行，batch→atomic→batch后旧闭包也不能提交', async () => {
    await mount(); await click(picker()); const oldStart = props(execute()).onClick, oldChange = props(strategy()).onChange; await act(async () => { oldChange({ target: { value: 'atomic' } }); oldStart(); }); expect(requests('files.import')).toHaveLength(0);
    await change(strategy(), 'batch'); await act(async () => { oldStart(); oldChange({ target: { value: 'atomic' } }); }); expect(requests('files.import')).toHaveLength(0); expect(strategy().value).toBe('batch'); await click(execute()); expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0].transactionMode).toBe('batch');
  });
  it('运行中禁止切换，已排队的旧策略回调不能改变原任务', async () => {
    await mount(); await click(picker()); await change(strategy(), 'atomic'); const oldChange = props(strategy()).onChange, held = deferred<any>(), original = port.invoke.getMockImplementation()!; port.invoke.mockImplementation((command, input) => command === 'files.import' ? held.promise : original(command, input));
    await click(execute()); expect(strategy().disabled).toBe(true); await act(async () => oldChange({ target: { value: 'batch' } })); expect(strategy().value).toBe('atomic'); expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0].transactionMode).toBe('atomic'); await act(async () => held.resolve({ rows: 1, errors: [] }));
  });
  it('本地配置请求busy也禁止切换，旧回调不能改变待选策略', async () => {
    await mount(); const oldChange = props(strategy()).onChange, held = deferred<ImportPresetSnapshot>(), original = port.invoke.getMockImplementation()!; port.invoke.mockImplementation((command, input) => command === 'files.importPresets.list' ? held.promise : original(command, input)); await click(namedButton(presetText.read)); expect(strategy().disabled).toBe(true);
    await act(async () => oldChange({ target: { value: 'atomic' } })); expect(strategy().value).toBe('batch'); await act(async () => held.resolve(structuredClone(savedSnapshot))); expect(strategy().disabled).toBe(false); expect(requests('files.import')).toHaveLength(0);
  });
  it('应用和保存导入模板不改变或保存本次策略', async () => {
    await mount(); const id = installPreset(); await click(picker()); await change(strategy(), 'atomic'); await selectPreset(id); await click(namedButton(presetText.apply)); expect(strategy().value).toBe('atomic'); expect(named('映射字段 第1列', 'select').value).toBe('id');
    await click(namedButton(presetText.update)); expect(requests('files.importPresets.save')).toHaveLength(1); expect(requests('files.importPresets.save')[0].configuration).not.toHaveProperty('transactionMode'); expect(requests('files.import')).toHaveLength(0); await click(execute()); expect(requests('files.import')[0].transactionMode).toBe('atomic');
  });
  it('SQL导入及导出没有策略控件，也不发送transactionMode自有字段', async () => {
    await mount(); await change(strategy(), 'atomic'); await change(doc.querySelectorAll('select')[0], 'sql'); expect(doc.querySelector(`select[aria-label="${transactionText.label}"]`)).toBeNull(); await click(picker()); await click(execute()); expect(requests('files.import')[0]).toMatchObject({ format: 'sql' }); expect(requests('files.import')[0]).not.toHaveProperty('transactionMode');
    await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; await mount({ mode: 'export' }); expect(doc.querySelector(`select[aria-label="${transactionText.label}"]`)).toBeNull(); await click(picker()); await click(execute()); expect(requests('files.export')[0]).not.toHaveProperty('transactionMode');
  });
});
