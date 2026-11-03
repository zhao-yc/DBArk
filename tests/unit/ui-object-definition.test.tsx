import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { ObjectDefinitionSource } from '../../src/renderer/components/ObjectDefinitionDialog';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { objectDefinitionZh as text } from '../../src/renderer/locales/objectDefinition.zh-CN';
import type { ObjectDefinitionInput, ObjectDefinitionOutput } from '../../src/shared/objectDefinition';

const ports = vi.hoisted(() => ({ invoke: vi.fn(), analyze: vi.fn(), workers: [] as { terminate: ReturnType<typeof vi.fn> }[] }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value }: { value: string }) => <pre aria-label="只读原定义">{value}</pre> }));
vi.mock('../../src/renderer/completion.worker?worker', () => ({ default: class { constructor() { throw Error('SQLite不能加载MySQL线程'); } } }));
vi.mock('../../src/renderer/sqliteLocalReferences.worker?worker', () => ({ default: class {
  onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; onmessageerror = null; terminate = vi.fn();
  constructor() { ports.workers.push(this); queueMicrotask(() => this.onmessage?.({ data: { type: 'dbark-sqlite-local-references-ready', version: 1 } })); }
  postMessage(input: { source: string; offset: number }) { queueMicrotask(() => this.onmessage?.({ data: { id: 1, result: ports.analyze(input.source, input.offset) } })); }
} }));
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ObjectDefinitionDialog')['ObjectDefinitionDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key,value) => { set(key,value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ useWorkspace } = await import('../../src/renderer/store')); ({ createRoot } = await import('react-dom/client')); ({ ObjectDefinitionDialog: Dialog } = await import('../../src/renderer/components/ObjectDefinitionDialog'));
});
beforeEach(() => { ports.invoke.mockReset(); ports.analyze.mockReset().mockImplementation(analyzeSqlitePhysicalObject); ports.workers.length = 0; Object.assign(window,{ dbark: { invoke: ports.invoke } }); useWorkspace.setState({ activeJobs: {} }); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; useWorkspace.setState({ activeJobs: {} }); vi.restoreAllMocks(); });
afterAll(() => { for (const [key,value] of globals) if (value) Object.defineProperty(globalThis,key,value); else Reflect.deleteProperty(globalThis,key); });

/** 产品React、Reader、客户端和回包校验均实际运行；内存DOM不冒充真实布局或系统输入。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let current = true, changed: (() => void) | undefined;
  const source: ObjectDefinitionSource = { id: '本例弹窗', tabId: 'query', connectionName: '原连接', source: 'SELECT s.id FROM subject s', offset: 8, dialect: 'sqlite', scope: { connectionId: 'file', connectionVersion: 0, database: 'main' }, current: () => current, watch: listener => { changed = listener; return () => { if (changed === listener) changed = undefined; }; } };
  const read = deferred<ObjectDefinitionOutput>(), cancel = deferred<void>(); let request: ObjectDefinitionInput | undefined;
  ports.invoke.mockImplementation((command: string, input: ObjectDefinitionInput) => {
    if (command === 'query.objectDefinition') { request = input; return read.promise; }
    if (command === 'query.cancel') return cancel.promise;
    if (command === 'settings.save') return Promise.resolve(); throw Error('本例不允许额外调用：' + command);
  });
  const output = () => ({ request: request!, database: 'main', name: 'subject', kind: 'table' as const, temporary: false, ddl: 'CREATE TABLE subject(id INTEGER)' });
  return { source, read, cancel, output, invalidate: () => { current = false; changed?.(); }, changed: () => changed?.() };
}
async function mount(source: ObjectDefinitionSource, closed: () => void, strict = false) {
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as unknown as HTMLElement);
  await act(async () => root!.render(strict ? <StrictMode><Dialog source={source} onClose={closed}/></StrictMode> : <Dialog source={source} onClose={closed}/>));
}
async function close() { const node = document.querySelectorAll('button').find(node => node.textContent === text.close); expect(node).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => node!.dispatchEvent(new MemoryEvent('click'))); }
const reads = () => ports.invoke.mock.calls.filter(call => call[0] === 'query.objectDefinition');
const definition = () => document.querySelectorAll('pre').find(node => node.getAttribute('aria-label') === '只读原定义');

it('严格模式试挂载不重复开始，明确打开只读取一次完整原定义', async () => {
  const f = fixture(), closed = vi.fn(); await mount(f.source,closed,true); expect(reads()).toHaveLength(1);
  await act(async () => { f.read.resolve(f.output()); }); expect(definition()?.textContent).toBe('CREATE TABLE subject(id INTEGER)');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('main'); expect(ports.workers).toHaveLength(1); expect(ports.workers[0].terminate).toHaveBeenCalledOnce();
  await close(); expect(closed).toHaveBeenCalledOnce(); expect(useWorkspace.getState().activeJobs.query).not.toBe(true);
});
it('来源失效不无限刷新，关闭等待原读取和取消ACK两种终态', async () => {
  const f = fixture(), closed = vi.fn(), error = vi.spyOn(console,'error'); await mount(f.source,closed); expect(reads()).toHaveLength(1);
  await act(async () => { f.invalidate(); f.changed(); f.changed(); }); expect(ports.invoke.mock.calls.filter(call => call[0] === 'query.cancel')).toHaveLength(1);
  await close(); await act(async () => { f.cancel.resolve(); }); expect(closed).not.toHaveBeenCalled(); expect(useWorkspace.getState().activeJobs.query).toBe(true);
  await act(async () => { f.read.resolve(f.output()); }); expect(closed).toHaveBeenCalledOnce(); expect(definition()).toBeUndefined(); expect(useWorkspace.getState().activeJobs.query).not.toBe(true);
  expect(error.mock.calls.flat().join(' ')).not.toContain('Maximum update depth');
});
it('换来源props不会沿旧闭包发布已返回的定义', async () => {
  const f = fixture(), closed = vi.fn(); await mount(f.source,closed); expect(reads()).toHaveLength(1);
  await act(async () => root!.render(<Dialog source={{ ...f.source,id: '继任来源' }} onClose={closed}/>));
  await act(async () => { f.read.resolve(f.output()); f.cancel.resolve(); }); expect(definition()).toBeUndefined(); expect(reads()).toHaveLength(1);
});
