import { act, StrictMode } from 'react';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import type { TableCreateConfirmationProps } from '../../src/renderer/components/TableCreateConfirmation';
import { tableCreateAcknowledgements, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
// 仅替换Monaco显示；React事件、状态、围栏、StrictMode和组件释放均运行生产组件。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="预览SQL" readOnly={readOnly} value={value}/> }));
let services: TableCreateServices;
vi.mock('../../src/renderer/tableCreateServices', () => ({ get tableCreateServices() { return services; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Component: typeof import('../../src/renderer/components/TableCreateConfirmation')['TableCreateConfirmation'], SchemaDialog: typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let listener: Parameters<TableCreateServices['subscribe']>[0] | undefined, props: TableCreateConfirmationProps, created: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, back: ReturnType<typeof vi.fn>;
const design = () => ({ database: 'db', name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [] });
const snapshot = (id = 's'): TableCreateGetOutput => ({ target: { connectionId: 'c', database: 'db' }, snapshotId: id, expiresAt: new Date(Date.now() + 120000).toISOString(), serverVersion: '8.4.11', warnings: [] });
const preview = (id = 'p'): TableCreatePreviewOutput => ({ target: { connectionId: 'c', database: 'db', table: 'new_table' }, previewToken: id, expiresAt: new Date(Date.now() + 110000).toISOString(), designDigest: 'a'.repeat(64), sql: 'CREATE TABLE `db`.`new_table` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,PRIMARY KEY (`id`)) ENGINE=INNODB;', requiredAcknowledgements: [...tableCreateAcknowledgements], warnings: [] });
/** 手工释放异步结果，不运行GUI或实际计时等待。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableCreateConfirmation: Component } = await import('../../src/renderer/components/TableCreateConfirmation'));
  ({ SchemaDialog } = await import('../../src/renderer/components/SchemaDialog')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); if (!node) throw Error('缺少按钮：' + label); return node; }
async function click(label: string, twice = false) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); if (twice) node.dispatchEvent(new MemoryEvent('click')); }); }
async function confirm(value = 'db.new_table') { const node = document.querySelector(`input[aria-label="${text.confirmation}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); for (const item of document.querySelectorAll('input[type="checkbox"]')) { item.checked = true; item.dispatchEvent(new MemoryEvent('click')); } }); }
async function mount(options: { get?: TableCreateServices['get']; preview?: TableCreateServices['preview']; strict?: boolean; schema?: boolean } = {}) {
  workspace.setState({ connectionVersions: { c: 1 } }); created = vi.fn(); close = vi.fn(); back = vi.fn();
  services = { get: vi.fn(options.get ?? (async () => snapshot())), preview: vi.fn(options.preview ?? (async () => preview())), apply: vi.fn(async () => ({ target: preview().target, ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, resourcesReleased: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  props = { connectionId: 'c', design: design(), onBack: back, onClose: close, onCreated: created, onDirtyChange: vi.fn() };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(options.schema ? <SchemaDialog connectionId="c" database="db" onClose={close} onApplied={vi.fn()} onCreated={created} onDirtyChange={props.onDirtyChange}/> : options.strict ? <StrictMode><Component {...props}/></StrictMode> : <Component {...props}/>));
}
describe('新建表真实ReactDOM的确认与生命周期（仅RAM）', () => {
  it('预览只读、准确名称和风险确认后双击仅一次，不携带SQL', async () => {
    await mount(); expect(services.apply).not.toHaveBeenCalled(); expect(document.querySelector('textarea')?.getAttribute('readonly')).not.toBeNull(); await confirm('db.new_table '); expect(button(text.apply).disabled).toBe(true);
    await confirm(); await click(text.apply, true); expect(services.apply).toHaveBeenCalledTimes(1); expect(vi.mocked(services.apply).mock.calls[0][0]).toEqual({ previewToken: 'p', confirmation: 'db.new_table', acknowledgements: [...tableCreateAcknowledgements], taskId: expect.any(String) }); expect(created).toHaveBeenCalledTimes(1); expect(button(text.apply).disabled).toBe(true); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('取消等待不提前解锁，不以控制响应恢复可提交状态', async () => {
    await mount(); await confirm(); const pending = deferred<Awaited<ReturnType<TableCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise); await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true);
    await act(async () => pending.reject(Error('合成结果未知'))); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.unknown); expect(services.apply).toHaveBeenCalledTimes(1); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('ACK后核失败与资源关闭失败分别显示事实，不恢复旧预览', async () => {
    await mount(); await confirm(); vi.mocked(services.apply).mockResolvedValueOnce({ target: preview().target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, resourcesReleased: true, warnings: [] }); await click(text.apply); expect(document.body.textContent).toContain(text.unverified); expect(created).toHaveBeenCalledTimes(1); expect(button(text.back).disabled).toBe(true);
  });
  it('关闭失败仍保留成功ACK，精确回调原目标而非称作未执行', async () => {
    await mount(); await confirm(); vi.mocked(services.apply).mockResolvedValueOnce({ target: preview().target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: false, warnings: [] }); await click(text.apply); expect(document.body.textContent).toContain(text.cleanup); expect(created.mock.calls[0]).toEqual([expect.objectContaining({ target: preview().target, ddlCompleted: true, resourcesReleased: false }), 1]);
  });
  it('RPC拒绝但任务进度已ACK仍刷新事实，不能抹掉DDL完成', async () => {
    await mount(); await confirm(); vi.mocked(services.apply).mockImplementationOnce(async input => { listener?.(input.taskId, { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); throw Error('合成关闭失败'); }); await click(text.apply); expect(created).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(text.cleanup); expect(button(text.apply).disabled).toBe(true);
  });
  it('来源连接ABA永久失效，不能回到旧值后执行', async () => { await mount(); await confirm(); await act(async () => { workspace.setState({ connectionVersions: { c: 2 } }); workspace.setState({ connectionVersions: { c: 1 } }); }); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.mismatch); expect(services.apply).not.toHaveBeenCalled(); });
  it('目标/草稿props变化不复活旧预览', async () => { await mount(); await confirm(); await act(async () => root!.render(<Component {...props} design={{ ...design(), name: 'other' }}/>)); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled(); });
  it('StrictMode旧准备迟到只释放旧能力，不删除已接受新预览', async () => {
    const first = deferred<TableCreateGetOutput>(); let calls = 0; await mount({ strict: true, get: async () => ++calls === 1 ? first.promise : snapshot('new') });
    await act(async () => first.resolve(snapshot('old'))); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'old' }); expect(services.release).not.toHaveBeenCalledWith({ snapshotId: 'new' }); await confirm(); expect(button(text.apply).disabled).toBe(false);
  });
  it('返回草稿必须等令牌释放完成，释放失败不能离开', async () => {
    await mount(); const wait = deferred<void>(); vi.mocked(services.release).mockReturnValueOnce(wait.promise); await click(text.back); expect(back).not.toHaveBeenCalled(); expect(button(text.close).disabled).toBe(true); await act(async () => wait.reject(Error('合成释放失败'))); expect(back).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled();
  });
  it('执行后卸载的ACK回调仍只通知原目标，不能操作新页面', async () => {
    await mount(); await confirm(); const pending = deferred<Awaited<ReturnType<TableCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise); await click(text.apply); await act(async () => root!.unmount()); root = undefined;
    await act(async () => pending.resolve({ target: preview().target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] })); expect(created).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  });
  it('原SchemaDialog新建阶段仍提供原字段/索引表单，草稿未确认不发请求', async () => {
    await mount({ schema: true }); expect(services.get).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('索引'); expect(document.querySelectorAll('input').some(node => node.value === 'bigint unsigned')).toBe(true);
  });
  it('真实SchemaDialog的原表单草稿进入专用确认，不带originalName或可编辑SQL', async () => {
    await mount({ schema: true }); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false); const name = document.querySelectorAll('input')[0]; await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); }); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    await click(zh.schema.text049); expect(services.get).toHaveBeenCalledTimes(1); expect(services.preview).toHaveBeenCalledTimes(1); const request = vi.mocked(services.preview).mock.calls[0][0]; expect(request.design.name).toBe('new_table'); expect(Object.hasOwn(request.design, 'originalName')).toBe(false); expect(request.design.columns[0].type).toBe('bigint unsigned'); expect(request).not.toHaveProperty('sql'); expect(document.querySelector('textarea')?.getAttribute('readonly')).not.toBeNull();
  });
  it('关闭释放期间换目标，迟到释放不能关闭或返回新目标草稿', async () => {
    await mount(); const wait = deferred<void>(); vi.mocked(services.release).mockReturnValueOnce(wait.promise); await click(text.close);
    await act(async () => root!.render(<Component {...props} design={{ ...design(), name: 'other' }}/>)); await act(async () => wait.resolve()); expect(close).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
  });
  it('执行等待中连接ABA，已ACK事实不刷新改过来源的页面', async () => {
    await mount(); await confirm(); const pending = deferred<Awaited<ReturnType<TableCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise); await click(text.apply);
    await act(async () => { workspace.setState({ connectionVersions: { c: 2 } }); workspace.setState({ connectionVersions: { c: 1 } }); });
    await act(async () => pending.resolve({ target: preview().target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] })); expect(created).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.mismatch);
  });
});
