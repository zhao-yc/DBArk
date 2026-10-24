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
const headed = { columns: ['id', '内容'], rows: [{ id: '第二条', 内容: '后续数据' }] };
const positional = { columns: ['第1列', '第2列'], rows: [{ 第1列: '第一条', 第2列: '首条原文\n保留' }, { 第1列: '第二条', 第2列: '后续数据' }] };
/** 只以RAM端口提供原文件样本，不执行真实文件或数据库读写。 */
async function mount(options: { mode?: 'import' | 'export'; preview?: (input: any) => Promise<any>; choose?: () => Promise<any> } = {}) {
  port.invoke.mockReset().mockImplementation(async (command, input) => {
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

describe('无标题CSV导入正式表单（真实React RAM）', () => {
  it('默认有标题兼容旧请求；关闭后保留文件、首条数据和完整手动映射，false原样进入预览与执行', async () => {
    await mount(); expect(named(text.label, 'input').checked).toBe(true); await click(picker()); expect(requests('files.preview')[0]).not.toHaveProperty('csvHasHeader');
    await header(false); expect(requests('files.choose')).toHaveLength(1); expect(requests('files.preview').at(-1)).toEqual({ fileToken: 'current-file', format: 'csv', encoding: 'utf8', csvDelimiter: ',', csvHasHeader: false });
    expect(doc.body.textContent).toContain(text.noHeaderHint); expect(named('映射字段 第1列', 'select').value).toBe(''); expect(named('映射字段 第2列', 'select').value).toBe(''); expect(port.grid.rows[0]).toEqual(positional.rows[0]);
    await click(execute()); expect(requests('files.import')).toHaveLength(0); await change(named('映射字段 第1列', 'select'), 'id'); await change(named('映射字段 第2列', 'select'), '内容'); await click(execute());
    expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0]).toMatchObject({ csvHasHeader: false, csvDelimiter: ',', mapping: { 第1列: 'id', 第2列: '内容' }, fileToken: 'current-file' });
  });
  it('同事件栈标题切换先撤销ready，ABA后旧执行和旧映射回调也不能恢复权限', async () => {
    await mount(); await click(picker()); const oldExecute = props(execute()).onClick, oldMapping = props(named('映射字段 内容', 'select')).onChange, toggle = props(named(text.label, 'input')).onChange;
    await act(async () => { toggle({ target: { checked: false } }); oldExecute(); }); expect(requests('files.import')).toHaveLength(0);
    await header(true); await act(async () => { oldExecute(); oldMapping({ target: { value: 'id' } }); }); expect(requests('files.import')).toHaveLength(0); expect(named('映射字段 内容', 'select').value).toBe('内容');
    await click(execute()); expect(requests('files.import')).toHaveLength(1); expect(requests('files.import')[0]).not.toHaveProperty('csvHasHeader');
  });
  it.each([false, true])('标题A→B→A丢弃迟到旧预览成功/失败（首轮失败=%s）', async failFirst => {
    const first = deferred<any>(), second = deferred<any>(), third = deferred<any>(); let count = 0; await mount({ preview: () => [first, second, third][count++].promise }); await click(picker()); await header(false); await header(true);
    expect(requests('files.preview')).toHaveLength(3); expect(execute().disabled).toBe(true); await act(async () => third.resolve(headed)); await change(named('映射字段 内容', 'select'), '第1列');
    await act(async () => { if (failFirst) { first.reject(Error('旧标题失败')); second.resolve(positional); } else { first.resolve({ columns: ['旧标题'], rows: [] }); second.reject(Error('旧无标题失败')); } });
    expect(named('映射字段 内容', 'select').value).toBe('第1列'); expect(doc.body.textContent).not.toContain('旧标题失败'); expect(doc.body.textContent).not.toContain('旧无标题失败'); expect(port.grid.rows).toEqual(headed.rows);
  });
  it.each([false, true])('header ABA不接纳旧文件选择成功/失败（失败=%s）', async fail => {
    const pending = deferred<any>(); await mount({ choose: () => pending.promise }); const oldChoose = props(picker()).onClick; await click(picker()); await header(false); await header(true);
    await act(async () => { if (fail) pending.reject(Error('旧文件选择失败')); else pending.resolve({ token: 'old-file', name: '旧文件.csv' }); oldChoose(); });
    expect(requests('files.choose')).toHaveLength(1); expect(requests('files.preview')).toHaveLength(0); expect(doc.body.textContent).not.toContain('旧文件选择失败'); expect(doc.body.textContent).not.toContain('旧文件.csv'); expect(execute().disabled).toBe(true);
  });
  it('JSON/SQL及导出不显示选项，也不发送csvHasHeader（包括undefined）', async () => {
    await mount(); await header(false); const format = doc.querySelectorAll('select')[0]; await change(format, 'json'); expect(doc.querySelector(`input[aria-label="${text.label}"]`)).toBeNull(); await click(picker()); await click(execute());
    for (const input of [...requests('files.preview'), ...requests('files.import')]) expect(input).not.toHaveProperty('csvHasHeader');
    await change(format, 'sql'); await click(picker()); await click(execute()); expect(requests('files.import').at(-1)).not.toHaveProperty('csvHasHeader');
    await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; await mount({ mode: 'export' }); expect(doc.querySelector(`input[aria-label="${text.label}"]`)).toBeNull(); await click(picker()); await click(execute()); expect(requests('files.export')[0]).not.toHaveProperty('csvHasHeader');
  });
});
