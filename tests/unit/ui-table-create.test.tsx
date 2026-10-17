import { act, StrictMode } from 'react';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import type { TableCreateConfirmationProps } from '../../src/renderer/components/TableCreateConfirmation';
import { tableCreateAcknowledgements, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
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
/** 只给实际ReactDOM提供服务器事实，不从产品生成器制造预期SQL。 */
const encodingCatalog = () => ({ candidates: [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }, { charset: 'latin1', collation: 'latin1_bin' }], digest: 'b'.repeat(64), warnings: [], reasons: [] });
async function selectEncoding(label: string, value: string) { const node = document.querySelector(`select[aria-label="${label}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function mountEncoding() {
  await mount({ get: async input => ({ ...snapshot(), ...(input.includeEncodings ? { encodings: encodingCatalog() } : {}) }), preview: async input => ({ ...preview(), ...(input.design.collation ? { encoding: { selection: { charset: input.design.charset, collation: input.design.collation }, catalogDigest: 'b'.repeat(64) } } : {}) }) });
  await click(text.encodingChoose);
}
async function choosePair() { await selectEncoding(text.charset, 'utf8mb4'); await selectEncoding(text.collation, 'utf8mb4_bin'); await click(text.preview); }

describe('新建表配对选择的真实ReactDOM（仅RAM）', () => {
  it('确认阶段仅列实际同字符集规则，未选完整配对没有预览或执行能力', async () => {
    await mountEncoding(); expect(services.get).toHaveBeenLastCalledWith(expect.objectContaining({ includeEncodings: true }), expect.any(Function)); expect(button(text.apply).disabled).toBe(true); await selectEncoding(text.charset, 'utf8mb4');
    const select = document.querySelector(`select[aria-label="${text.collation}"]`)!; expect(select.querySelectorAll('option').map(node => node.value)).toEqual(['', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci']); expect(button(text.preview).disabled).toBe(true);
    await selectEncoding(text.collation, 'utf8mb4_bin'); await click(text.preview); expect(services.preview).toHaveBeenLastCalledWith(expect.objectContaining({ design: expect.objectContaining({ charset: 'utf8mb4', collation: 'utf8mb4_bin' }) }), expect.any(Function)); await confirm(); await click(text.apply, true); expect(services.apply).toHaveBeenCalledTimes(1); expect(vi.mocked(services.apply).mock.calls[0][0]).not.toHaveProperty('collation');
  });
  it('切换字符集清空规则、旧预览和风险确认，原能力仍完整释放', async () => {
    await mountEncoding(); await choosePair(); await confirm(); expect(button(text.apply).disabled).toBe(false); await selectEncoding(text.charset, 'latin1'); expect(button(text.apply).disabled).toBe(true); expect(document.querySelector(`select[aria-label="${text.collation}"]`)!.value).toBe(''); expect(document.querySelector('textarea')).toBeNull(); await click(text.back); expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.release).toHaveBeenCalledWith({ snapshotId: 's' }); expect(back).toHaveBeenCalledTimes(1);
  });
  it('重读目录摘要变化清空选择，不将旧选项自动迁移到新目录', async () => {
    await mountEncoding(); vi.mocked(services.get).mockResolvedValueOnce({ ...snapshot(), encodings: { ...encodingCatalog(), digest: 'c'.repeat(64) } }); await choosePair(); expect(document.body.textContent).toContain(text.encodingStale); expect(button(text.apply).disabled).toBe(true); expect(document.querySelector(`select[aria-label="${text.charset}"]`)!.value).toBe('');
  });
  it('伪造或不匹配配对响应释放预览，不提供执行按钮能力', async () => {
    await mountEncoding(); vi.mocked(services.preview).mockResolvedValueOnce({ ...preview('wrong'), encoding: { selection: { charset: 'latin1', collation: 'latin1_bin' }, catalogDigest: 'b'.repeat(64) } }); await choosePair(); expect(services.release).toHaveBeenCalledWith({ previewToken: 'wrong' }); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.response);
  });
  it('元数据拒读仅使显式配对不可用，可主动回到原草稿行为', async () => {
    await mountEncoding(); await click(text.encodingUseLegacy); vi.mocked(services.get).mockResolvedValueOnce({ ...snapshot(), encodings: { candidates: [], warnings: [], reasons: ['合成目录拒读'] } }); await click(text.encodingChoose); expect(document.body.textContent).toContain('合成目录拒读'); expect(button(text.apply).disabled).toBe(true); await click(text.encodingUseLegacy); expect(vi.mocked(services.preview).mock.calls.at(-1)![0].design).not.toHaveProperty('collation'); expect(document.body.textContent).toContain(text.encodingLegacy);
  });
  it('显式配对预览迟到且连接ABA时只释放，不能复活旧能力', async () => {
    await mountEncoding(); const wait = deferred<TableCreatePreviewOutput>(); vi.mocked(services.preview).mockReturnValueOnce(wait.promise); await selectEncoding(text.charset, 'utf8mb4'); await selectEncoding(text.collation, 'utf8mb4_bin'); await click(text.preview);
    await act(async () => { workspace.setState({ connectionVersions: { c: 2 } }); workspace.setState({ connectionVersions: { c: 1 } }); wait.resolve({ ...preview('late'), encoding: { selection: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, catalogDigest: 'b'.repeat(64) } }); }); expect(services.release).toHaveBeenCalledWith({ previewToken: 'late' }); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('新模式准备先等待原能力释放，释放失败不读新目录', async () => {
    await mount(); const wait = deferred<void>(); vi.mocked(services.release).mockReturnValueOnce(wait.promise); await click(text.encodingChoose); expect(services.get).toHaveBeenCalledTimes(1); await act(async () => wait.reject(Error('合成释放失败'))); expect(services.get).toHaveBeenCalledTimes(1); expect(button(text.apply).disabled).toBe(true);
  });
});

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
  it('执行后卸载使父租约结束，迟到ACK不回调或重放', async () => {
    await mount(); await confirm(); const pending = deferred<Awaited<ReturnType<TableCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise); await click(text.apply); await act(async () => root!.unmount()); root = undefined;
    await act(async () => pending.resolve({ target: preview().target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] })); expect(created).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(services.apply).toHaveBeenCalledTimes(1);
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


describe('文字NULL默认值的真实设计器（仅RAM）', () => {
  it.each([true, false])('原NULL语义保留，文字NULL选择%s后预览精确区分字符串与空值', async asLiteral => {
    await mount({ schema: true });
    const name = document.querySelector('input')!;
    await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); });
    const input = document.querySelector('input[aria-label="' + formatText(zh.schema.text022, 1) + '"]')!;
    await act(async () => { input.value = 'NULL'; input.dispatchEvent(new MemoryEvent('input')); });
    const literal = document.querySelector('input[aria-label="第1个字段：文字 NULL"]');
    expect(literal).not.toBeNull();
    await act(async () => { literal!.checked = true; literal!.dispatchEvent(new MemoryEvent('click')); });
    if (!asLiteral) await act(async () => { literal!.checked = false; literal!.dispatchEvent(new MemoryEvent('click')); });
    await click(zh.schema.text049);
    expect(vi.mocked(services.preview).mock.calls.at(-1)![0].design.columns[0].defaultValue).toBe(asLiteral ? 'NULL' : null);
  });
});

/** 服务适配器也必须活读同一父租约；open等待不构成发送旧目标get的授权。 */
it.each([true, false])('真实get适配器open等待结束后父租约有效=%s', async validAfterOpen => {
  await mount(); const actual = await vi.importActual<typeof import('../../src/renderer/tableCreateServices')>('../../src/renderer/tableCreateServices');
  const wait = deferred<void>(); let valid = true; const requests: string[] = [];
  (window as any).dbark = { invoke: vi.fn(async (command: string) => { requests.push(command); if (command === 'connections.open') return wait.promise; if (command === 'schema.tableCreate.get') return snapshot(); throw Error('RAM禁止其它IPC'); }) };
  services.get = actual.tableCreateServices.get;
  // 创建新确认实例，固定接纳此父guard；初次mount的合成能力已由卸载释放。
  await act(async () => root!.unmount()); root = undefined;
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<Component {...props} isParentCurrent={() => valid}/>));
  expect(requests).toEqual(['connections.open']);
  await act(async () => { valid = validAfterOpen; wait.resolve(); });
  expect(requests.filter(command => command === 'schema.tableCreate.get')).toHaveLength(validAfterOpen ? 1 : 0);
  expect(services.apply).not.toHaveBeenCalled();
  delete (window as any).dbark;
});
