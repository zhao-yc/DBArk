import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import { tableCreateRequiredAcknowledgements, type TableCreateDraft, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { tableCreateGeneratedMessages } from '../../src/shared/tableCreateGenerated';
import { tableCreateGeneratedZh as generatedText } from '../../src/renderer/locales/tableCreateGenerated.zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreateOnUpdateZh as timeText } from '../../src/renderer/locales/tableCreateOnUpdate.zh-CN';
import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

// 只替换Monaco绘制及服务端口；表单、行身份、共享校验、确认与资源围栏均为实际React组件。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="只读CREATE预览" readOnly={readOnly} value={value}/> }));
let services: TableCreateServices;
vi.mock('../../src/renderer/tableCreateServices', () => ({ get tableCreateServices() { return services; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SchemaDialog: typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let close: ReturnType<typeof vi.fn>, created: ReturnType<typeof vi.fn>;
const expires = () => new Date(Date.now() + 120000).toISOString();
const snapshot = (id = 's'): TableCreateGetOutput => ({ target: { connectionId: 'c', database: 'db' }, snapshotId: id, expiresAt: expires(), serverVersion: '8.4.11', warnings: [], generatedAccess: { editable: true } });
const preview = (design: TableCreateDraft, id = 'p'): TableCreatePreviewOutput => ({ target: { connectionId: 'c', database: 'db', table: design.name }, previewToken: id, expiresAt: expires(), designDigest: 'a'.repeat(64), sql: 'CREATE TABLE `db`.`new_table` (...);', warnings: [], requiredAcknowledgements: tableCreateRequiredAcknowledgements(design) });
/** 可控Promise只在RAM内决定何时终态，不延长实际产品时钟。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  // 仅补ReactDOM所需select/checkbox/disabled反射；不模拟数据库或浏览器输入法。
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as unknown as { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as unknown as { selected: boolean }).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SchemaDialog } = await import('../../src/renderer/components/SchemaDialog')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 生产组件只接合成服务端口；进入确认前应没有任何get/preview/apply。 */
async function mount() {
  workspace.setState({ connectionVersions: { c: 1 } }); close = vi.fn(); created = vi.fn();
  services = { get: vi.fn(async () => snapshot()), preview: vi.fn(async input => preview(input.design)), apply: vi.fn(async () => ({ target: { connectionId: 'c', database: 'db', table: 'new_table' }, ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, resourcesReleased: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: () => () => {} };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<SchemaDialog connectionId="c" database="db" onClose={close} onApplied={() => {}} onCreated={created}/>));
  const name = document.querySelector('input')!; await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); });
}
function button(label: string) { const value = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); if (!value) throw Error('缺少实际按钮：' + label); return value; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function edit(label: string, value: string) { const node = document.querySelector(`input[aria-label="${label}"]`) ?? document.querySelector(`textarea[aria-label="${label}"]`); expect(node, label).not.toBeNull(); expect(node!.disabled).toBe(false); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function select(label: string, value: string) { const node = document.querySelector(`select[aria-label="${label}"]`)!; expect(node, label).not.toBeNull(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
/** 分页签计数属于原UI文案，按实际按钮前缀定位，不修改原卡片或字段契约。 */
async function tab(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent.startsWith(label)); if (!node) throw Error('缺少结构页签'); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function field(label: string, value: string) { const node = document.querySelectorAll('label').find(item => item.textContent === label)?.querySelector('input'); expect(node, label).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
/** 访问真实React安装的原闭包，以覆盖DOM替换后旧事件不能认领新行。 */
function callback(node: any, name = 'onChange'): (event?: any) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key || typeof node[key][name] !== 'function') throw Error('缺少真实React事件'); return node[key][name]; }
async function add(name: string, type: string, ordinal: number) { await click(zh.schema.text027); await edit(formatText(zh.schema.text018, ordinal), name); await edit(formatText(zh.schema.text019, ordinal), type); }
async function generated(storage: 'VIRTUAL' | 'STORED' = 'VIRTUAL') { await add('qty', 'bigint', 2); await add('price', 'decimal(20,6)', 3); await add('total', 'decimal(30,6)', 4); await select(generatedText.mode(4), storage); await edit(generatedText.expression(4), 'qty * price'); }
async function acknowledge(labels = [text.ackDdl, text.ackCreate, generatedText.ack]) { for (const label of labels) { const node = document.querySelectorAll('label').find(item => item.textContent === label)?.querySelector('input'); expect(node, label).not.toBeNull(); await act(async () => { node!.checked = true; node!.dispatchEvent(new MemoryEvent('click')); }); } }
const lastDesign = () => vi.mocked(services.preview).mock.calls.at(-1)![0].design;

describe('新建表生成列真实表单与确认（仅RAM）', () => {
  it.each(['VIRTUAL', 'STORED'] as const)('%s选择、候选、只读预览及第三确认，一次apply不携SQL', async storage => {
    await mount(); await generated(storage);
    const references = document.querySelector(`div[aria-label="${generatedText.references(4)}"]`)!;
    expect(references.textContent).toContain('qty'); expect(references.textContent).toContain('price'); expect(references.textContent).not.toContain('id');
    for (const label of [formatText(zh.schema.text020, 4), formatText(zh.schema.text021, 4), formatText(zh.schema.text022, 4), timeText.label(4)]) expect(document.querySelector(`[aria-label="${label}"]`)!.disabled).toBe(true);
    expect(services.get).not.toHaveBeenCalled(); await click(zh.schema.text049);
    expect(services.get).toHaveBeenCalledWith(expect.objectContaining({ includeGeneratedFacts: true }), expect.any(Function));
    expect(lastDesign().columns[3]).toMatchObject({ generated: { storage, expression: 'qty * price' }, nullable: true, autoIncrement: false });
    expect(Object.hasOwn(lastDesign().columns[3], 'defaultValue')).toBe(false); expect(Object.hasOwn(lastDesign().columns[3], 'onUpdate')).toBe(false);
    expect(document.querySelector('textarea[aria-label="只读CREATE预览"]')!.getAttribute('readonly')).not.toBeNull(); expect(document.body.textContent).toContain('qty * price'); expect(services.apply).not.toHaveBeenCalled();
    await edit(text.confirmation, 'db.new_table'); await acknowledge([text.ackDdl, text.ackCreate]); expect(button(text.apply).disabled).toBe(true); await acknowledge([generatedText.ack]);
    const apply = callback(button(text.apply), 'onClick'); await act(async () => { apply(); apply(); });
    expect(services.apply).toHaveBeenCalledTimes(1); expect(vi.mocked(services.apply).mock.calls[0][0]).toEqual({ previewToken: 'p', confirmation: 'db.new_table', acknowledgements: tableCreateRequiredAcknowledgements(lastDesign()), taskId: expect.any(String) }); expect(created).toHaveBeenCalledOnce();
  });
  it('切回普通保留SQL NULL、文字NULL及空字符串默认，旧普通属性回调不能污染生成列', async () => {
    await mount(); await add('value', 'varchar(255)', 2); await edit(formatText(zh.schema.text022, 2), 'NULL');
    const oldDefault = callback(document.querySelector(`input[aria-label="${formatText(zh.schema.text022, 2)}"]`));
    await select(generatedText.mode(2), 'VIRTUAL'); await edit(generatedText.expression(2), '2.00'); await act(async () => oldDefault({ target: { value: 'malicious' } }));
    await select(generatedText.mode(2), 'ordinary'); expect(document.querySelector(`input[aria-label="${formatText(zh.schema.text022, 2)}"]`)!.getAttribute('placeholder')).toBe('NULL');
    await click(zh.schema.text049); expect(lastDesign().columns[1].defaultValue).toBeNull(); expect(lastDesign().columns[1]).not.toHaveProperty('generated'); await click(text.back);
    const literal = document.querySelector(`input[aria-label="${formatText(zh.schema.literalNullLabel, 2)}"]`)!; await act(async () => { literal.checked = true; literal.dispatchEvent(new MemoryEvent('click')); });
    await select(generatedText.mode(2), 'STORED'); await select(generatedText.mode(2), 'ordinary'); await click(zh.schema.text049); expect(lastDesign().columns[1].defaultValue).toBe('NULL'); await click(text.back);
    const empty = document.querySelector(`input[aria-label="${formatText(zh.schema.emptyStringDefaultLabel, 2)}"]`)!; await act(async () => { empty.checked = true; empty.dispatchEvent(new MemoryEvent('click')); });
    await select(generatedText.mode(2), 'VIRTUAL'); await select(generatedText.mode(2), 'ordinary'); await click(zh.schema.text049); expect(lastDesign().columns[1].defaultValue).toBe('');
  });
  it('可放多个生成列于不同位置，重排后引用前提失效且不重写表达式', async () => {
    await mount(); await generated(); await add('tax', 'decimal(30,6)', 5); await select(generatedText.mode(5), 'STORED'); await edit(generatedText.expression(5), 'price * 0.10');
    await click(orderText.upLabel(5)); await click(zh.schema.text049);
    expect(lastDesign().columns.map(value => value.name)).toEqual(['id', 'qty', 'price', 'tax', 'total']); expect(lastDesign().columns.filter(value => value.generated)).toHaveLength(2); await click(text.back);
    await click(orderText.upLabel(4)); await click(zh.schema.text049); expect(services.get).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(tableCreateGeneratedMessages.references);
    expect(document.querySelector(`textarea[aria-label="${generatedText.expression(3)}"]`)!.value).toBe('price * 0.10');
  });
  it.each(['rename', 'delete', 'chain', 'self', 'division', 'float'] as const)('%s不发送准备或自动修正草稿', async kind => {
    await mount(); await generated();
    if (kind === 'rename') await edit(formatText(zh.schema.text018, 2), 'changed');
    if (kind === 'delete') await click(formatText(zh.schema.text026, 2));
    if (kind === 'chain') { await select(generatedText.mode(3), 'VIRTUAL'); await edit(generatedText.expression(3), 'qty * 2'); }
    if (kind === 'self') await edit(generatedText.expression(4), 'total + 1');
    if (kind === 'division') await edit(generatedText.expression(4), 'qty / price');
    if (kind === 'float') await edit(formatText(zh.schema.text019, 4), 'float');
    await click(zh.schema.text049); expect(services.get).not.toHaveBeenCalled(); expect(services.preview).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled(); expect(document.querySelector('textarea[aria-label="只读CREATE预览"]')).toBeNull();
  });
  it('普通主键保留；把原主键改生成列时拒绝而不悄悄移除键', async () => {
    await mount(); await generated(); await click(zh.schema.text049); expect(lastDesign().indexes).toEqual([{ name: 'PRIMARY', unique: true, columns: ['id'] }]); await click(text.back);
    await select(generatedText.mode(1), 'VIRTUAL'); await edit(generatedText.expression(1), '1'); await click(zh.schema.text049); expect(services.get).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(tableCreateGeneratedMessages.keys);
  });
  it('生成旁列不禁普通组合索引和外键，生成列自身加入键时保留错误草稿', async () => {
    await mount(); await generated(); await tab(zh.common.indexes); await edit(formatText(zh.schema.text034, 1), 'id, qty');
    await tab(zh.common.foreignKeys); await click(zh.schema.text045);
    for (const [label, value] of [[zh.schema.text037, 'fk_qty'], [zh.schema.text038, 'qty'], [zh.schema.text039, 'external_db'], [zh.schema.text040, 'parent'], [zh.schema.text041, 'id']]) await field(label, value);
    await click(zh.schema.text049); expect(lastDesign().indexes).toEqual([{ name: 'PRIMARY', unique: true, columns: ['id', 'qty'] }]); expect(lastDesign().foreignKeys).toEqual([{ name: 'fk_qty', columns: ['qty'], referencedDatabase: 'external_db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }]);
    await click(text.back); await tab(zh.common.indexes); await edit(formatText(zh.schema.text034, 1), 'id, total'); await click(zh.schema.text049); expect(services.preview).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(tableCreateGeneratedMessages.keys); expect(document.querySelector(`input[aria-label="${formatText(zh.schema.text034, 1)}"]`)!.value).toBe('id, total');
  });
  it('重复空白草稿不会使候选渲染崩溃，旧表达式与旧重排回调不能认领新列', async () => {
    await mount(); await generated(); const oldExpression = callback(document.querySelector(`textarea[aria-label="${generatedText.expression(4)}"]`));
    await click(orderText.upLabel(4)); await act(async () => oldExpression({ target: { value: '999' } })); expect(document.querySelector(`textarea[aria-label="${generatedText.expression(3)}"]`)!.value).toBe('qty * price');
    await click(zh.schema.text027); await click(zh.schema.text027); expect(document.body.textContent).toContain(generatedText.invalid); expect(services.get).not.toHaveBeenCalled();
  });
});

describe('新表生成列实际能力与异步围栏（仅RAM）', () => {
  it.each([undefined, { editable: false, reason: '合成权限未知' }])('缺省或拒绝能力不预览，返回保留表达式', async access => {
    await mount(); await generated(); vi.mocked(services.get).mockResolvedValueOnce({ ...snapshot(), generatedAccess: access }); await click(zh.schema.text049);
    expect(services.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(access?.reason ?? generatedText.capability); await click(text.back); expect(services.release).toHaveBeenCalledWith({ snapshotId: 's' }); expect(document.querySelector(`textarea[aria-label="${generatedText.expression(4)}"]`)!.value).toBe('qty * price');
  });
  it.each(['missing', 'duplicate', 'extra'] as const)('%s风险集合拒绝并释放准确令牌', async kind => {
    await mount(); await generated(); vi.mocked(services.preview).mockImplementationOnce(async input => { const value = preview(input.design, 'bad'); value.requiredAcknowledgements = kind === 'missing' ? value.requiredAcknowledgements.slice(0, 2) : kind === 'duplicate' ? [...value.requiredAcknowledgements.slice(0, 2), value.requiredAcknowledgements[0]] : [...value.requiredAcknowledgements, 'unexpected']; return value; });
    await click(zh.schema.text049); expect(services.release).toHaveBeenCalledWith({ previewToken: 'bad' }); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('已接收预览的风险集合被改写后旧确认回调不能发送apply', async () => {
    await mount(); await generated(); let receipt!: TableCreatePreviewOutput;
    vi.mocked(services.preview).mockImplementationOnce(async input => receipt = preview(input.design)); await click(zh.schema.text049); await edit(text.confirmation, 'db.new_table'); await acknowledge();
    const originalApply = callback(button(text.apply), 'onClick'); receipt.requiredAcknowledgements = [...receipt.requiredAcknowledgements, 'tampered']; await act(async () => originalApply()); expect(services.apply).not.toHaveBeenCalled();
  });
  it('原get迟到且连接ABA永久失效，只释放自己的快照', async () => {
    await mount(); await generated(); const pending = deferred<TableCreateGetOutput>(); vi.mocked(services.get).mockReturnValueOnce(pending.promise); await click(zh.schema.text049);
    await act(async () => { workspace.setState({ connectionVersions: { c: 2 } }); workspace.setState({ connectionVersions: { c: 1 } }); pending.resolve(snapshot('late')); });
    expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late' }); expect(services.preview).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true);
  });
  it('取消ACK不提前解锁原preview，关闭需等终态，返回后旧表达式回调不复活', async () => {
    await mount(); await generated(); const old = callback(document.querySelector(`textarea[aria-label="${generatedText.expression(4)}"]`)), pending = deferred<TableCreatePreviewOutput>(); let draft!: TableCreateDraft;
    vi.mocked(services.preview).mockImplementationOnce(input => { draft = input.design; return pending.promise; }); await click(zh.schema.text049); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(services.cancel).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(preview(draft))); await click(text.back); await act(async () => old({ target: { value: '777' } })); expect(document.querySelector(`textarea[aria-label="${generatedText.expression(4)}"]`)!.value).toBe('qty * price');
  });
  it('卸载后迟到preview仅释放原能力，不回调或发送apply', async () => {
    await mount(); await generated(); const pending = deferred<TableCreatePreviewOutput>(); let draft!: TableCreateDraft;
    vi.mocked(services.preview).mockImplementationOnce(input => { draft = input.design; return pending.promise; }); await click(zh.schema.text049);
    await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve(preview(draft, 'late-preview')));
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'late-preview' }); expect(services.release).toHaveBeenCalledWith({ snapshotId: 's' }); expect(services.apply).not.toHaveBeenCalled(); expect(created).not.toHaveBeenCalled();
  });
  it('创建结果未知仅一次提交，保留核对提示且不能返回重放', async () => {
    await mount(); await generated(); await click(zh.schema.text049); await edit(text.confirmation, 'db.new_table'); await acknowledge(); const pending = deferred<Awaited<ReturnType<TableCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true); await act(async () => pending.reject(Error('合成响应未知')));
    expect(document.body.textContent).toContain(text.unknown); expect(button(text.apply).disabled).toBe(true); expect(button(text.back).disabled).toBe(true); expect(services.apply).toHaveBeenCalledTimes(1);
  });
});
