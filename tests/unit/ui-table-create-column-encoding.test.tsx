import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import { tableCreateRequiredAcknowledgements, type TableCreateDraft, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { tableCreateColumnEncodingZh as columnText } from '../../src/renderer/locales/tableCreateColumnEncoding.zh-CN';
import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';
import { tableCreateGeneratedZh as generatedText } from '../../src/renderer/locales/tableCreateGenerated.zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

// 只替换Monaco绘制和服务端口；真实表单事件、候选读回、释放、行身份、确认和回执校验全部运行。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="只读CREATE预览" value={value} readOnly={readOnly}/> }));
let services: TableCreateServices;
vi.mock('../../src/renderer/tableCreateServices', () => ({ get tableCreateServices() { return services; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SchemaDialog: typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'], Confirmation: typeof import('../../src/renderer/components/TableCreateConfirmation')['TableCreateConfirmation'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let close: ReturnType<typeof vi.fn>, created: ReturnType<typeof vi.fn>, back: ReturnType<typeof vi.fn>;
const catalog = () => ({ digest: 'a'.repeat(64), candidates: [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, { charset: 'latin1', collation: 'latin1_bin' }], reasons: [], warnings: [] });
const expires = () => new Date(Date.now() + 120000).toISOString();
const draft = (): TableCreateDraft => ({ database: 'db', name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }, { name: 'note', type: 'varchar(40)', nullable: true, autoIncrement: false, comment: '', collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } }, { name: 'latin', type: 'text', nullable: true, autoIncrement: false, comment: '', collation: { charset: 'latin1', collation: 'latin1_bin' } }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [] });
const snapshot = (id: string): TableCreateGetOutput => ({ target: { connectionId: 'c', database: 'db' }, snapshotId: id, expiresAt: expires(), serverVersion: '8.4.11', warnings: [], encodings: catalog(), generatedAccess: { editable: true } });
/** 合成端口仅回显协议选择；断言另核预定名字/顺序/完整配对，不用此端口证明实际SQL生成。 */
const receipt = (design: TableCreateDraft): TableCreatePreviewOutput => ({ target: { connectionId: 'c', database: 'db', table: design.name }, previewToken: 'p', expiresAt: expires(), sql: 'CREATE TABLE `db`.`new_table` (...);', designDigest: 'b'.repeat(64), warnings: [], requiredAcknowledgements: tableCreateRequiredAcknowledgements(design), ...(design.columns.some(column => column.collation) ? { columnEncodings: { catalogDigest: catalog().digest, selections: design.columns.flatMap((column, ordinal) => column.collation ? [{ ordinal, name: column.name, ...column.collation }] : []) } } : {}), ...(design.collation ? { encoding: { catalogDigest: catalog().digest, selection: { charset: design.charset, collation: design.collation } } } : {}) });
/** RAM异步端口，不执行真实时间等待或数据库。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as unknown as { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as unknown as { selected: boolean }).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SchemaDialog } = await import('../../src/renderer/components/SchemaDialog')); ({ TableCreateConfirmation: Confirmation } = await import('../../src/renderer/components/TableCreateConfirmation')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 生产组件使用原服务契约；默认没有目录读取或任何DDL调用。 */
async function mount(options: { confirmation?: boolean; expectedDigest?: string; get?: TableCreateServices['get']; preview?: TableCreateServices['preview'] } = {}) {
  workspace.setState({ connectionVersions: { c: 1 } }); close = vi.fn(); created = vi.fn(); back = vi.fn(); let sequence = 0;
  services = { get: vi.fn(options.get ?? (async () => snapshot('s' + ++sequence))), preview: vi.fn(options.preview ?? (async input => receipt(input.design))), apply: vi.fn(async () => ({ target: { connectionId: 'c', database: 'db', table: 'new_table' }, ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, resourcesReleased: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: () => () => {} };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(options.confirmation ? <Confirmation connectionId="c" design={draft()} columnEncodingCatalogDigest={options.expectedDigest} onBack={back} onClose={close} onCreated={created}/> : <SchemaDialog connectionId="c" database="db" onClose={close} onApplied={() => {}} onCreated={created}/>));
  if (!options.confirmation) { const node = document.querySelector('input')!; await act(async () => { node.value = 'new_table'; node.dispatchEvent(new MemoryEvent('input')); }); }
}
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label || value.getAttribute('aria-label') === label); if (!node) throw Error('缺少实际按钮：' + label); return node; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function edit(label: string, value: string) { const node = document.querySelector(`input[aria-label="${label}"]`) ?? document.querySelector(`textarea[aria-label="${label}"]`); expect(node, label).not.toBeNull(); expect(node!.disabled).toBe(false); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function select(label: string, value: string) { const node = document.querySelector(`select[aria-label="${label}"]`)!; expect(node, label).not.toBeNull(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
/** 调用真实已安装回调，只用于证明旧行/旧关闭事件的失效围栏。 */
function callback(node: any, name = 'onChange'): (event?: any) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少实际React回调'); return node[key][name]; }
async function add(name: string, type: string, position: number) { await click(zh.schema.text027); await edit(formatText(zh.schema.text018, position), name); await edit(formatText(zh.schema.text019, position), type); }
async function choose(position: number, charset: string, collation: string) { await select(columnText.mode(position), 'explicit'); await select(columnText.charset(position), charset); await select(columnText.collation(position), collation); }
async function columns() { await add('note', 'varchar(40)', 2); await add('latin', 'text', 3); await click(columnText.read); await choose(2, 'utf8mb4', 'utf8mb4_bin'); await choose(3, 'latin1', 'latin1_bin'); }
async function confirm() { await edit(text.confirmation, 'db.new_table'); for (const label of [text.ackDdl, text.ackCreate]) { const node = document.querySelectorAll('label').find(value => value.textContent === label)!.querySelector('input')!; await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); } }
const lastDesign = () => vi.mocked(services.preview).mock.calls.at(-1)![0].design;

describe('新建表字段编码真实React入口（仅RAM）', () => {
  it('实际目录先释放候选快照再选配对，重排保留完整属性，确认重新get且一次apply', async () => {
    await mount(); await columns(); expect(services.get).toHaveBeenCalledTimes(1); expect(services.release).toHaveBeenCalledWith({ snapshotId: 's1' }); expect(services.preview).not.toHaveBeenCalled();
    const selector = document.querySelector(`select[aria-label="${columnText.collation(2)}"]`)!; expect(selector.querySelectorAll('option').map(value => value.value)).toEqual(['', 'utf8mb4_bin', 'utf8mb4_general_ci']);
    await edit(formatText(zh.schema.text022, 2), 'NULL'); await click(orderText.upLabel(3)); await click(zh.schema.text049);
    expect(services.get).toHaveBeenCalledTimes(2); expect(vi.mocked(services.get).mock.calls.every(([input]) => input.includeEncodings === true)).toBe(true);
    expect(lastDesign().columns.map(column => column.name)).toEqual(['id', 'latin', 'note']); expect(lastDesign().columns[1].collation).toEqual({ charset: 'latin1', collation: 'latin1_bin' }); expect(lastDesign().columns[2]).toMatchObject({ defaultValue: null, collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } });
    expect(document.body.textContent).toContain('latin1 / latin1_bin'); expect(document.querySelector('textarea[aria-label="只读CREATE预览"]')!.getAttribute('readonly')).not.toBeNull(); expect(services.apply).not.toHaveBeenCalled(); await confirm(); const apply = callback(button(text.apply), 'onClick'); await act(async () => { apply(); apply(); }); expect(services.apply).toHaveBeenCalledTimes(1); expect(vi.mocked(services.apply).mock.calls[0][0]).not.toHaveProperty('sql'); expect(created).toHaveBeenCalledOnce();
  });
  it.each(['bigint', 'varbinary(40)', 'JSON', 'datetime(6)'])('改成%s保留显式配对并提示，清除后真正省略新键', async type => {
    await mount(); await columns(); await edit(formatText(zh.schema.text019, 2), type); expect(document.body.textContent).toContain(columnText.incompatible); expect(document.body.textContent).toContain('utf8mb4 / utf8mb4_bin'); await click(zh.schema.text049); expect(services.preview).not.toHaveBeenCalled();
    await click(columnText.clear(2)); await click(columnText.clear(3)); await click(zh.schema.text049); expect(Object.hasOwn(lastDesign().columns[1], 'collation')).toBe(false); expect(Object.hasOwn(lastDesign().columns[2], 'collation')).toBe(false); expect(vi.mocked(services.get).mock.calls.at(-1)![0]).not.toHaveProperty('includeEncodings');
  });
  it('生成模式不静默丢配对，生成模式清除后切回普通不复活，原默认仍保留', async () => {
    await mount(); await columns(); await edit(formatText(zh.schema.text022, 2), '原默认'); await select(generatedText.mode(2), 'VIRTUAL'); expect(document.body.textContent).toContain(columnText.incompatible); await click(columnText.clear(2)); await select(generatedText.mode(2), 'ordinary'); expect(document.querySelector(`select[aria-label="${columnText.mode(2)}"]`)!.value).toBe('inherit'); expect(document.querySelector(`input[aria-label="${formatText(zh.schema.text022, 2)}"]`)!.value).toBe('原默认'); await click(zh.schema.text049); expect(Object.hasOwn(lastDesign().columns[1], 'collation')).toBe(false);
  });
  it('无目录仅关闭显式编码，继承普通创建仍原路径；读取未开始不凭空给出配对', async () => {
    await mount({ get: async () => ({ ...snapshot('s'), encodings: undefined }) }); await add('note', 'varchar(40)', 2);
    expect(document.querySelector(`select[aria-label="${columnText.mode(2)}"]`)!.querySelectorAll('option').find(value => value.value === 'explicit')!.disabled).toBe(true);
    await click(columnText.read); expect(services.release).toHaveBeenCalledWith({ snapshotId: 's' }); expect(document.body.textContent).toContain(columnText.unavailable); await click(zh.schema.text049); expect(lastDesign().columns[1]).not.toHaveProperty('collation'); expect(vi.mocked(services.get).mock.calls.at(-1)![0]).not.toHaveProperty('includeEncodings');
  });
  it('重排后的旧配对闭包不能写错行；目录摘要变化不自动接受旧选择', async () => {
    await mount(); await columns(); const old = callback(document.querySelector(`select[aria-label="${columnText.collation(2)}"]`)); await click(orderText.upLabel(3)); await act(async () => old({ target: { value: 'utf8mb4_general_ci' } })); expect(document.querySelector(`select[aria-label="${columnText.collation(3)}"]`)!.value).toBe('utf8mb4_bin');
    vi.mocked(services.get).mockResolvedValueOnce({ ...snapshot('new'), encodings: { ...catalog(), digest: 'c'.repeat(64) } }); await click(columnText.reread); await click(zh.schema.text049); expect(services.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(columnText.stale);
  });
});

describe('新表字段编码确认与异步资源（仅RAM）', () => {
  it.each(['missing', 'digest', 'order', 'ordinal', 'name', 'charset', 'collation', 'duplicate', 'extra'])('%s回执释放准确token且不可执行', async kind => {
    await mount({ confirmation: true, preview: async input => { const value = receipt(input.design), selected = value.columnEncodings!; if (kind === 'missing') delete value.columnEncodings; if (kind === 'digest') selected.catalogDigest = 'f'.repeat(64); if (kind === 'order') selected.selections.reverse(); if (kind === 'ordinal') selected.selections[0].ordinal = 0; if (kind === 'name') selected.selections[0].name = 'another'; if (kind === 'charset') selected.selections[0].charset = 'latin1'; if (kind === 'collation') selected.selections[0].collation = 'utf8mb4_general_ci'; if (kind === 'duplicate') selected.selections[1] = { ...selected.selections[0] }; if (kind === 'extra') selected.selections.push({ ...selected.selections[0] }); return value; } });
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(document.body.textContent).toContain(columnText.response); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('正式目录漂移拒绝预览；表级显式模式关闭也必须为列配对读取实际目录', async () => {
    await mount({ confirmation: true, expectedDigest: 'f'.repeat(64) }); expect(services.get).toHaveBeenCalledWith(expect.objectContaining({ includeEncodings: true }), expect.any(Function)); expect(services.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(columnText.stale);
  });
  it('列和表级配对共存各自独立；切表配对撤销旧风险确认但列配对不改变', async () => {
    await mount({ confirmation: true }); await click(text.encodingChoose); await select(text.charset, 'utf8mb4'); await select(text.collation, 'utf8mb4_general_ci'); await click(text.preview); expect(lastDesign().collation).toBe('utf8mb4_general_ci'); expect(lastDesign().columns[1].collation?.collation).toBe('utf8mb4_bin'); expect(lastDesign().columns[2].collation?.collation).toBe('latin1_bin'); await confirm(); await select(text.collation, 'utf8mb4_bin'); expect(button(text.apply).disabled).toBe(true); expect(document.querySelector('textarea[aria-label="只读CREATE预览"]')).toBeNull();
  });
  it('读取取消ACK不解锁，连接ABA迟到get只释放原快照，旧关闭不能提前离开', async () => {
    const pending = deferred<TableCreateGetOutput>(); await mount({ get: async () => pending.promise }); const oldClose = callback(button(zh.common.cancel), 'onClick'); await click(columnText.read); await click(columnText.cancel); expect(services.cancel).toHaveBeenCalledOnce(); await act(async () => oldClose()); expect(close).not.toHaveBeenCalled();
    await act(async () => { workspace.setState({ connectionVersions: { c: 2 } }); workspace.setState({ connectionVersions: { c: 1 } }); pending.resolve(snapshot('late')); }); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late' }); expect(services.preview).not.toHaveBeenCalled(); expect(document.querySelectorAll('option').filter(value => value.value === 'explicit').every(value => value.disabled)).toBe(true);
  });
  it('释放失败不发布候选，关闭必须重试原释放且等真实终态', async () => {
    await mount(); vi.mocked(services.release).mockRejectedValueOnce(Error(columnText.release)); await click(columnText.read); expect(document.body.textContent).toContain(columnText.release); expect(services.release).toHaveBeenCalledTimes(1);
    const pending = deferred<void>(); vi.mocked(services.release).mockReturnValueOnce(pending.promise); await click(zh.common.cancel); expect(close).not.toHaveBeenCalled(); expect(button(zh.common.cancel).disabled).toBe(true); await act(async () => pending.resolve()); expect(close).toHaveBeenCalledOnce(); expect(services.release).toHaveBeenCalledTimes(2);
  });
  it('卸载前未完成的目录get晚到时只释放，不发布或回调', async () => {
    const pending = deferred<TableCreateGetOutput>(); await mount({ get: async () => pending.promise }); await click(columnText.read); await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve(snapshot('late-unmount'))); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late-unmount' }); expect(services.preview).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
});
