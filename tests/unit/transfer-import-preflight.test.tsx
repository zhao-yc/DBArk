import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { importPreflightZh as text } from '../../src/renderer/locales/importPreflight.zh-CN';
import { fileImportConflictZh as conflictText } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import type { FileImportPreflightInput, FileImportPreflightReport } from '../../src/shared/fileImportPreflight';

const port = vi.hoisted(() => ({ invoke: vi.fn<(command: string, input?: any) => Promise<any>>() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => <div role="grid"/> }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout }); const create = doc.createElement.bind(doc);
  // 仅补标准select/disabled反射；预览、预检控制器和表单使用产品实现。
  doc.createElement = name => {
    const node = create(name);
    if (name === 'option') {
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
      let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } });
    }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog: Dialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function requests(command: string) { return port.invoke.mock.calls.filter(([name]) => name === command).map(([, input]) => input); }
function button(label: string) { const node = doc.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
function execute() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'primary')!; }
function picker() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!; }
function props(node: MemoryNode): Record<string, any> { return Reflect.get(node, Object.keys(node).find(key => key.startsWith('__reactProps$'))!); }
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function report(input: FileImportPreflightInput, errors = false): FileImportPreflightReport {
  return { taskId: input.taskId, target: { connectionId: input.connectionId, database: input.database, table: input.table }, format: input.format, encoding: input.encoding,
    checkedRecords: 25, validRecords: errors ? 24 : 25, invalidRecords: errors ? 1 : 0, issueCount: errors ? 1 : 0,
    issues: errors ? [{ record: 25, source: 'id', target: 'id', code: 'invalid-value', message: '' }] : [], complete: true, truncated: false, termination: 'complete', sourceFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64), sourceBytes: 200, warnings: [] };
}
/** IPC只提供RAM响应；本组验证真实表单生命周期，不外推原生文件或数据库验收。 */
async function mount(options: { run?: (input: FileImportPreflightInput) => Promise<FileImportPreflightReport>; chooseReport?: () => Promise<any>; catalog?: () => Promise<any> } = {}) {
  const close = vi.fn();
  port.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'files.importPresets.list') return { generation: '00000000-0000-4000-8000-000000000000', revision: 0, entries: [] };
    if (command === 'metadata.table') return { database: 'db', name: 't', engine: 'InnoDB', columns: [{ name: 'id', type: 'bigint', nullable: false, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
    if (command === 'files.choose') return input.purpose === 'export' && options.chooseReport ? options.chooseReport() : { token: input.purpose === 'export' ? 'report-file' : 'source-file', name: 'test.' + input.format };
    if (command === 'files.preview') return { columns: ['id', 'ignored'], rows: [{ id: '1', ignored: '未映射值' }] };
    if (command === 'files.preflight') return options.run ? options.run(input) : report(input);
    if (command === 'files.importKeys' && options.catalog) return options.catalog();
    if (command === 'files.import') return { rows: 25, errors: [] };
    if (command === 'files.exportResult') return { rows: input.result.rows.length };
    if (command === 'query.cancel' || command === 'connections.open') return;
    throw Error('禁止其他IPC：' + command);
  });
  store.setState({ connectionVersions: { c: 1 }, tasks: [] }); const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<Dialog mode="import" connectionId="c" database="db" table="t" onClose={close}/>)); await click(picker()); return close;
}
describe('整文件预检真实导入表单接线（RAM）', () => {
  it('连接版本ABA在React重渲染前也不能用旧按钮派发预检', async () => {
    await mount(); const oldRun = props(button(text.run)).onClick;
    await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); oldRun(); });
    expect(requests('files.preflight')).toHaveLength(0); expect(picker().disabled).toBe(false);
  });
  it('冲突键目录迟到只更新匹配选项，不撤销原文件预检或吞掉报告', async () => {
    const pending = deferred<FileImportPreflightReport>(), catalog = deferred<any>(); await mount({ run: () => pending.promise, catalog: () => catalog.promise });
    const mode = doc.querySelectorAll('select').find(node => node.getAttribute('aria-label') === conflictText.mode)!;
    await act(async () => { mode.value = 'upsert'; mode.dispatchEvent(new MemoryEvent('change')); }); expect(requests('files.importKeys')).toHaveLength(1);
    await click(button(text.run));
    await act(async () => catalog.resolve({ connectionId: 'c', database: 'db', table: 't', schemaHash: 'c'.repeat(64), keys: [] }));
    expect(picker().disabled).toBe(true); await act(async () => pending.resolve(report(requests('files.preflight')[0])));
    expect(doc.body.textContent).toContain(text.passed); expect(requests('files.preflight')).toHaveLength(1); expect(requests('files.import')).toHaveLength(0);
  });
  it('显式只读预检不触发导入，排除未映射列，通过后仍需点击开始导入', async () => {
    await mount(); expect(requests('files.preflight')).toHaveLength(0); await click(button(text.run));
    expect(requests('files.preflight')).toHaveLength(1); expect(requests('files.preflight')[0].mapping).toEqual({ id: 'id' }); expect(requests('files.import')).toHaveLength(0);
    expect(doc.body.textContent).toContain(text.passed); expect(execute().disabled).toBe(false); await click(execute()); expect(requests('files.import')).toHaveLength(1);
  });
  it('第25条异常阻止原导入入口，修改映射使旧报告失效', async () => {
    await mount({ run: async input => report(input, true) }); await click(button(text.run)); expect(execute().disabled).toBe(true);
    await act(async () => { props(execute()).onClick(); }); expect(requests('files.import')).toHaveLength(0);
    const mapping = doc.querySelectorAll('select').find(node => node.getAttribute('aria-label') === '映射字段 id')!;
    await act(async () => { mapping.value = ''; mapping.dispatchEvent(new MemoryEvent('change')); }); expect(doc.body.textContent).not.toContain(text.complete);
  });
  it('取消请求终结不能提前解锁表单和关闭，原预检终态后才释放', async () => {
    const pending = deferred<FileImportPreflightReport>(); const close = await mount({ run: () => pending.promise }); await click(button(text.run)); const oldExecute = props(execute()).onClick;
    expect(picker().disabled).toBe(true); await act(async () => { oldExecute(); }); expect(requests('files.import')).toHaveLength(0);
    await click(button(text.cancel)); expect(requests('query.cancel')).toHaveLength(1); expect(picker().disabled).toBe(true);
    const closeButton = doc.querySelectorAll('footer button').find(node => node.textContent === '关闭') ?? button('关闭'); await act(async () => { props(closeButton).onClick(); }); expect(close).not.toHaveBeenCalled();
    await act(async () => pending.resolve(report(requests('files.preflight')[0]))); expect(picker().disabled).toBe(false); expect(doc.body.textContent).not.toContain(text.passed);
  });
  it('连接版本ABA拒绝原报告且等待原任务终态', async () => {
    const pending = deferred<FileImportPreflightReport>(); await mount({ run: () => pending.promise }); await click(button(text.run));
    await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); }); expect(picker().disabled).toBe(true);
    await click(button(text.cancel)); expect(requests('query.cancel')).toHaveLength(1); expect(picker().disabled).toBe(true);
    await act(async () => pending.resolve(report(requests('files.preflight')[0]))); expect(doc.body.textContent).not.toContain(text.passed); expect(picker().disabled).toBe(false);
  });
  it('报告保存选择迟到且连接失效，不得写出旧报告', async () => {
    const choice = deferred<any>(); await mount({ chooseReport: () => choice.promise }); await click(button(text.run)); await click(button(text.export)); expect(picker().disabled).toBe(true);
    await act(async () => store.setState({ connectionVersions: { c: 2 } })); await act(async () => choice.resolve({ token: 'late-report', name: 'late.json' })); expect(requests('files.exportResult')).toHaveLength(0); expect(picker().disabled).toBe(false);
  });
});
