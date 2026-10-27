import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { FileImportConflictReport, FileImportKeyCatalog } from '../../src/shared/fileImportConflict';
import type { ImportPresetSnapshot } from '../../src/shared/importPresets';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const port = vi.hoisted(() => ({ invoke: vi.fn<(command: string, input: any) => Promise<any>>() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => <div role="grid"/> }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    if (name === 'option') { Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog: Dialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; port.invoke.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const catalog = (): FileImportKeyCatalog => ({ connectionId: 'c', database: 'db', table: 't', schemaHash: 'a'.repeat(64), keys: [{ name: 'PRIMARY', columns: ['id'], reliable: true }, { name: '前缀唯一键', columns: ['value'], reliable: false, reason: '不是完整列唯一键' }] });
const counts = { inserted: 1, matchedUpdates: 1, skippedExisting: 0, skippedMissing: 0 };
function report(input: any): FileImportConflictReport { return { version: 1, taskId: input.taskId, mode: input.conflict.mode, termination: 'completed', readRecords: 2, acknowledged: { ...counts }, committed: { ...counts }, currentBatch: 'none' }; }
async function mount(options: { keys?: () => Promise<FileImportKeyCatalog>; execute?: (input: any) => Promise<any>; presets?: boolean } = {}) {
  let saved: ImportPresetSnapshot = { generation: '00000000-0000-4000-8000-000000000000', revision: 0, entries: options.presets ? [{ id: '00000000-0000-4000-8000-000000000001', name: '原映射配置', configuration: { format: 'csv', encoding: 'utf8', columns: ['id', 'value'], mapping: { id: 'id', value: 'value' } }, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' }] : [] };
  port.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'metadata.table') return { database: 'db', name: 't', engine: 'InnoDB', columns: ['id', 'value', 'keep'].map(name => ({ name, type: 'text', nullable: false, generated: false })), indexes: [{ name: '伪造旧目录', unique: true, columns: ['keep'] }], editableKey: ['keep'], primaryKey: [], foreignKeys: [], ddl: '' };
    if (command === 'files.choose') return { token: 'file-token', name: 'data.' + input.format };
    if (command === 'files.preview') return { columns: ['id', 'value'], rows: [{ id: '1', value: '新值' }] };
    if (command === 'files.importKeys') return options.keys ? options.keys() : catalog();
    if (command === 'files.import') return options.execute ? options.execute(input) : { rows: 99, errors: [] };
    if (command === 'files.importPresets.list') return structuredClone(saved);
    if (command === 'files.importPresets.save') { saved = { ...saved, revision: saved.revision + 1, entries: saved.entries.map(entry => entry.id === input.id ? { ...entry, configuration: input.configuration } : entry) }; return structuredClone(saved); }
    if (command === 'connections.open' || command === 'query.cancel') return;
    throw Error('未授权端口：' + command);
  });
  store.setState({ connectionVersions: { c: 1 }, tasks: [] }); const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<Dialog mode="import" connectionId="c" database="db" table="t" onClose={() => {}}/>));
  await click(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!);
}
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function change(node: MemoryNode, value: string) { expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
function field(label: string) { const node = doc.querySelectorAll('select').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function start() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'primary')!; }
function requests(command: string) { return port.invoke.mock.calls.filter(([name]) => name === command).map(([, input]) => input); }
function result() { return doc.querySelectorAll('[role="status"]').find(node => node.getAttribute('aria-label') === '冲突处理执行结果'); }
function button(label: string) { const node = doc.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('真实React事件未找到'); return Reflect.get(node, key); }

it('默认只新增不读取匹配目录、不发送conflict，保留原导入行为', async () => {
  await mount(); await click(start()); expect(requests('files.importKeys')).toHaveLength(0); expect(requests('files.import')[0]).not.toHaveProperty('conflict'); expect(doc.querySelector('[class="success-box"]')).not.toBeNull();
});
it('非默认策略只信权威目录且必须明确选可靠键，按原列顺序发送selection', async () => {
  await mount(); await change(field('冲突处理'), 'upsert'); expect(requests('files.importKeys')).toHaveLength(1); expect(start().disabled).toBe(true);
  expect(field('匹配键').querySelectorAll('option').some(node => node.value === '伪造旧目录')).toBe(false); expect(field('匹配键').querySelectorAll('option').find(node => node.value === '前缀唯一键')!.disabled).toBe(true);
  await change(field('匹配键'), 'PRIMARY'); await click(start()); expect(requests('files.import')[0].conflict).toEqual({ mode: 'upsert', schemaHash: 'a'.repeat(64), key: { name: 'PRIMARY', columns: ['id'] } });
});
it('缺少新报告不能把兼容rows误称为已成功导入', async () => {
  await mount(); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); await click(start()); expect(doc.body.textContent).toContain('冲突处理结果未确认'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('新报告分别展示已确认处理和已确认提交，matchedUpdates不等同真实变化行数', async () => {
  await mount({ execute: async input => ({ rows: 999, errors: [], conflicts: report(input) }) }); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); await click(start()); expect(result()).toBeDefined(); expect(result()!.textContent).toContain('已确认处理'); expect(result()!.textContent).toContain('已确认提交'); expect(result()!.textContent).toContain('匹配更新命令（含未变化）'); expect(result()!.textContent).not.toContain('999'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('连接revisionABA使原目录迟到失效，不能复活策略或旧key', async () => {
  const held = deferred<FileImportKeyCatalog>(); await mount({ keys: () => held.promise }); await change(field('冲突处理'), 'update-existing');
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); held.resolve(catalog()); }); expect(field('冲突处理').value).toBe('insert'); expect(requests('files.import')).toHaveLength(0); expect(doc.body.textContent).not.toContain('不是完整列唯一键');
});
it('映射变化同步撤销旧启动闭包和策略，重新选择时缺键列不能更新', async () => {
  await mount(); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); const oldStart = props(start()).onClick, mapping = field('映射字段 id');
  await act(async () => { mapping.value = ''; mapping.dispatchEvent(new MemoryEvent('change')); oldStart(); });
  expect(requests('files.import')).toHaveLength(0); expect(field('冲突处理').value).toBe('insert');
  await change(field('冲突处理'), 'upsert'); expect(field('匹配键').querySelectorAll('option').find(node => node.value === 'PRIMARY')!.disabled).toBe(true); expect(start().disabled).toBe(true);
});
it('提交方式独立保留已选策略和key，执行同时冻结两项且运行中不能切换', async () => {
  const held = deferred<any>(); let input: any; await mount({ execute: async value => { input = value; return held.promise; } });
  await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); const reads = requests('files.importKeys').length;
  await change(field('导入提交方式'), 'atomic'); expect(field('冲突处理').value).toBe('upsert'); expect(field('匹配键').value).toBe('PRIMARY'); expect(requests('files.importKeys')).toHaveLength(reads);
  await click(start()); expect(input).toMatchObject({ transactionMode: 'atomic', conflict: { mode: 'upsert' } }); expect(field('冲突处理').disabled).toBe(true); expect(field('匹配键').disabled).toBe(true);
  await act(async () => held.resolve({ rows: 99, errors: [], conflicts: report(input) })); expect(result()).toBeDefined();
});
it('套用模板会重置冲突策略，保存模板不夹带写入策略而提交方式保持', async () => {
  await mount({ presets: true }); await change(field('导入提交方式'), 'atomic'); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY');
  await click(button('读取已存配置')); await change(field('选择导入配置'), '00000000-0000-4000-8000-000000000001'); await click(button('更新所选配置'));
  expect(requests('files.importPresets.save')[0].configuration).not.toHaveProperty('conflict'); expect(requests('files.importPresets.save')[0].configuration).not.toHaveProperty('transactionMode');
  await click(button('应用配置')); expect(field('冲突处理').value).toBe('insert'); expect(field('导入提交方式').value).toBe('atomic'); expect(requests('files.import')).toHaveLength(0);
});
it('非默认策略坏task或mode报告不能借兼容行数显示成功', async () => {
  await mount({ execute: async input => ({ rows: 999, errors: [], conflicts: { ...report(input), taskId: '其他任务', mode: 'skip-existing' } }) }); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); await click(start()); expect(result()!.textContent).toContain('冲突处理结果未确认'); expect(result()!.textContent).not.toContain('999'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('commit未知单独展示ack和committed与失败记录，原取消仍指向原task不提前释放busy', async () => {
  const held = deferred<any>(); let input: any; await mount({ execute: async value => { input = value; return held.promise; } }); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); await click(start());
  await click(button('取消任务')); expect(requests('query.cancel')).toEqual([{ taskId: input.taskId }]); expect(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!.disabled).toBe(true);
  await act(async () => held.resolve({ rows: 999, errors: [], conflicts: { ...report(input), termination: 'cancelled', readRecords: 3, committed: { inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 }, currentBatch: 'commit-unknown', failure: { stage: 'commit', message: '<img>原提交结果未知', record: 3 } } }));
  expect(result()!.textContent).toContain('原 COMMIT 结果未知'); expect(result()!.textContent).toContain('不能自动重放'); expect(result()!.textContent).toContain('第 3 条记录'); expect(doc.querySelectorAll('img')).toHaveLength(0); expect(result()!.textContent).not.toContain('999');
});
it('切SQL与重选文件撤销冲突策略，不把字段带进SQL任务', async () => {
  await mount(); await change(field('冲突处理'), 'skip-existing'); await change(field('匹配键'), 'PRIMARY');
  await change(doc.querySelectorAll('select')[0], 'sql'); expect(doc.querySelectorAll('select').some(node => node.getAttribute('aria-label') === '冲突处理')).toBe(false);
  await click(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!); await click(start()); expect(requests('files.import')[0]).not.toHaveProperty('conflict');
});
it('key、mode与同hash目录重新核验恢复同值后，旧开始闭包零投递且不污染反馈', async () => {
  await mount(); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY');
  for (const kind of ['key', 'mode', 'catalog']) {
    const oldStart = props(start()).onClick;
    if (kind === 'key') { await change(field('匹配键'), ''); await change(field('匹配键'), 'PRIMARY'); }
    else if (kind === 'mode') { await change(field('冲突处理'), 'insert'); await change(field('冲突处理'), 'upsert'); await change(field('匹配键'), 'PRIMARY'); }
    else { await click(button('重新读取匹配键')); await change(field('匹配键'), 'PRIMARY'); }
    await act(async () => oldStart()); expect(requests('files.import')).toHaveLength(0); expect(doc.querySelectorAll('[class="error-box"]')).toHaveLength(0); expect(field('冲突处理').value).toBe('upsert'); expect(field('匹配键').value).toBe('PRIMARY');
  }
  await click(start()); expect(requests('files.import')).toHaveLength(1);
});
