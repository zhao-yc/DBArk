import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ColumnPatch, TableColumnGetOutput, TableColumnPreviewOutput, TableColumnView } from '../../src/shared/tableColumnPatches';
import { ColumnAutoIncrementIntent, columnAcknowledgementLabel, makeColumnAlter, validateColumnDrafts } from '../../src/renderer/columnPatches';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import type { ColumnPatchServices } from '../../src/renderer/components/ColumnPatchDialog';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

// 只替换Monaco渲染端口；组件、草稿校验、来源lease、确认与执行生命周期均运行生产实现。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="只读SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ColumnPatchDialog')['ColumnPatchDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    // 仅补HTML属性反射和受控select所需选项端口，不模拟布局、系统输入或服务器。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (key === 'value' && name === 'option') node.value = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ColumnPatchDialog: Dialog } = await import('../../src/renderer/components/ColumnPatchDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

const required = ['ddl-implicit-commit', 'external-ddl-window', 'column-auto-increment-copy'];
/** 服务快照只提供显式投影；整数、主键等形似条件不代替自增access授权。 */
function snapshot(enabled = false, id = 'auto-snapshot'): TableColumnGetOutput {
  const access = () => Object.fromEntries(['name', 'type', 'nullable', 'default', 'comment', 'position', 'onUpdate'].map(key => [key, { editable: true }])) as TableColumnView['access'];
  return { target: { connectionId: 'RAM自增', database: 'db', table: 't' }, snapshotId: id, ddlHash: '原定义摘要', expiresAt: new Date(Date.now() + 300000).toISOString(), warnings: [], capabilities: { dialect: 'mysql', serverVersion: '8.4.11', maxDecimalScale: 30 }, columns: [
    { columnRef: 'id-ref', name: 'id', ordinal: 0, typeSql: 'INT', nullable: false, default: { kind: 'none' }, onUpdate: null, comment: '保留注释', rawDefinition: '`id` INT NOT NULL' + (enabled ? ' AUTO_INCREMENT' : ''), access: access(), autoIncrement: { enabled, access: { editable: true } } },
    { columnRef: 'other-ref', name: 'other', ordinal: 1, typeSql: 'INT', nullable: false, default: { kind: 'none' }, onUpdate: null, comment: '', rawDefinition: '`other` INT NOT NULL', access: access() },
  ] };
}
/** 所有服务为独立RAM观察端；无数据库、真实SQL执行或隐式IPC。 */
async function mount(initial = snapshot(), acknowledgements = required, initialRead?: Promise<TableColumnGetOutput>) {
  let next = initial, version = 1, sequence = 0;
  const get = vi.fn(async () => next); if (initialRead) get.mockImplementationOnce(() => initialRead);
  const preview = vi.fn(async (_input: Parameters<ColumnPatchServices['preview']>[0]): Promise<TableColumnPreviewOutput> => ({ target: next.target, ddlHash: next.ddlHash, previewToken: 'auto-plan-' + (++sequence), expiresAt: next.expiresAt, sql: '服务端固定自增预览；此文本不执行', changes: [], warnings: ['服务器可能复制表'], requiredAcknowledgements: [...acknowledgements], concurrencyPolicy: 'recheck-before-ddl' }));
  const apply = vi.fn(async (_input: Parameters<ColumnPatchServices['apply']>[0]) => ({ ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] as string[] })), release = vi.fn(async (_input: Parameters<ColumnPatchServices['release']>[0]) => {}), cancel = vi.fn(async (_input: { taskId: string }) => {});
  const callbacks = { onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), onApplied: vi.fn(), beforeApply: vi.fn(), onExecutionUncertain: vi.fn() };
  const services: ColumnPatchServices = { get, preview, apply, release, cancel }, confirm = vi.fn(() => true); (window as any).confirm = confirm;
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = () => root!.render(<Dialog target={initial.target} targetVersion={version} services={services} {...callbacks}/>);
  await act(async () => render());
  return { initial, get, preview, apply, release, cancel, callbacks, confirm, next(value: TableColumnGetOutput) { next = value; }, async version(value: number) { version = value; await act(async () => render()); } };
}
/** 通过稳定中文标签操作真实DOM，不依赖内部编辑状态或原型属性。 */
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function toggleNode() { return document.querySelector(`input[aria-label="${text.autoIncrementToggle}"]`); }
async function toggle() { const node = toggleNode(); expect(node).not.toBeNull(); expect(node!.disabled).toBe(false); await act(async () => { node!.checked = !node!.checked; node!.dispatchEvent(new MemoryEvent('click')); }); }
async function edit() { await click('id · INT'); }
async function draft() { await edit(); await toggle(); await click(text.rowSave); }
/** 捕获真实React旧事件，专门验证disabled属性以外的同步身份门。 */
function callback(node: MemoryNode, event = 'onClick'): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件'); return (node as any)[key][event]; }
async function acknowledge(label: string) { const node = document.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent === label); expect(node, label).toBeDefined(); await act(async () => { node!.checked = true; node!.dispatchEvent(new MemoryEvent('click')); }); }
async function allAcks() { for (const label of [text.ackImplicit, text.ackWindow, text.ackAutoIncrementCopy]) await acknowledge(label); }
/** deferred精确控制迟到返回与取消收尾，不用sleep或写入重试掩盖竞态。 */
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('列自增独立纯草稿和授权', () => {
  it('原七项access全部只读仍可按专属授权改变布尔，恢复原值不生成补丁', () => {
    const source = snapshot(), column = source.columns[0]; for (const permission of Object.values(column.access)) permission.editable = false;
    const patch: ColumnPatch = { kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } };
    expect(makeColumnAlter(column, { autoIncrement: false })).toBeNull(); expect(makeColumnAlter(column, patch.changes)).toEqual(patch); expect(validateColumnDrafts(source.columns, [patch], 30)).toEqual([patch]);
    column.autoIncrement!.enabled = true; expect(makeColumnAlter(column, { autoIncrement: true })).toBeNull(); expect(makeColumnAlter(column, { autoIncrement: false })).toMatchObject({ changes: { autoIncrement: false } });
    expect(Object.keys(column.access)).not.toContain('autoIncrement'); expect(columnAcknowledgementLabel('column-auto-increment-copy')).toBe(text.ackAutoIncrementCopy);
  });
  it('缺投影、未知enabled、无明确权限、原型键和混合属性不能借普通权限开放', () => {
    const column = snapshot().columns[0]; delete column.autoIncrement; expect(() => makeColumnAlter(column, { autoIncrement: false })).toThrow(text.autoIncrementReadonly);
    column.autoIncrement = { enabled: false, access: { editable: false, reason: '缺少完整支持索引' } }; expect(() => makeColumnAlter(column, { autoIncrement: true })).toThrow('缺少完整支持索引');
    column.autoIncrement.access.editable = true; expect(() => makeColumnAlter(column, { autoIncrement: undefined })).toThrow(); expect(() => makeColumnAlter(column, { autoIncrement: true, nullable: false })).toThrow(text.autoIncrementMixed);
    expect(() => makeColumnAlter(column, { autoIncrement: true, default: { kind: 'none' } })).toThrow(text.autoIncrementMixed); expect(columnAcknowledgementLabel('__proto__')).toBeUndefined();
  });
  it('不能与其它列、位置、排序规则或新增删除混批，也不接受相同原值的假差异', () => {
    const source = snapshot(), change: ColumnPatch = { kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } };
    for (const extra of [{ kind: 'drop', columnRef: 'other-ref' }, { kind: 'alter', columnRef: 'other-ref', changes: { comment: '原草稿' } }, { kind: 'alter', columnRef: 'id-ref', changes: { position: { kind: 'first' } } }] as ColumnPatch[]) expect(() => validateColumnDrafts(source.columns, [change, extra], 30)).toThrow();
    expect(() => validateColumnDrafts(source.columns, [{ ...change, changes: { autoIncrement: false } }], 30)).toThrow(text.noChange);
    expect(() => makeColumnAlter(source.columns[0], { autoIncrement: true, collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } })).toThrow(text.autoIncrementMixed);
  });
  it.each(['enabled', 'projection', 'access', 'raw', 'columns', 'columnRef', 'snapshotId', 'expires'] as const)('%s漂移即永久撤销意图，同对象恢复原值不能复活', kind => {
    const source = snapshot(), column = source.columns[0], intent = new ColumnAutoIncrementIntent(source, column), old = { columns: source.columns, projection: column.autoIncrement, access: column.autoIncrement!.access, raw: column.rawDefinition, ref: column.columnRef, id: source.snapshotId, expires: source.expiresAt };
    expect(intent.current(source)).toBe(true);
    if (kind === 'enabled') column.autoIncrement!.enabled = true;
    if (kind === 'projection') column.autoIncrement = { ...column.autoIncrement! };
    if (kind === 'access') column.autoIncrement!.access = { ...column.autoIncrement!.access };
    if (kind === 'raw') column.rawDefinition += ' COMMENT x';
    if (kind === 'columns') source.columns = source.columns.slice();
    if (kind === 'columnRef') column.columnRef = 'other';
    if (kind === 'snapshotId') source.snapshotId = 'other';
    if (kind === 'expires') source.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(intent.current(source)).toBe(false); source.columns = old.columns; column.autoIncrement = old.projection; column.autoIncrement!.enabled = false; column.autoIncrement!.access = old.access; column.rawDefinition = old.raw; column.columnRef = old.ref; source.snapshotId = old.id; source.expiresAt = old.expires;
    expect(intent.current(source)).toBe(false); expect(new ColumnAutoIncrementIntent(source, column).current(source)).toBe(true);
  });
});

describe('列自增真实ColumnPatchDialog RAM闭环', () => {
  it.each([false, true])('原enabled=%s，切换和恢复不留patch，再次选择只发送单布尔及全部风险确认', async enabled => {
    const f = await mount(snapshot(enabled)), before = structuredClone(f.initial); await edit(); expect(toggleNode()!.checked).toBe(enabled); expect(document.body.textContent).toContain(enabled ? text.autoIncrementEnabled : text.autoIncrementDisabled);
    expect(document.body.textContent).toContain(text.autoIncrementSession); expect(document.body.textContent).toContain('排他锁'); await toggle(); await toggle(); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
    await draft(); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: !enabled } }]); expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true');
    await acknowledge(text.ackImplicit); await acknowledge(text.ackWindow); expect(button(text.apply).disabled).toBe(true); await acknowledge(text.ackAutoIncrementCopy); const apply = callback(button(text.apply)); await act(async () => { apply(); apply(); }); await act(async () => apply());
    expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0]).toMatchObject({ previewToken: 'auto-plan-1', acknowledgements: required }); expect(f.initial).toEqual(before); expect(f.callbacks.onApplied).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'readonly', 'unknownEnabled'] as const)('%s不把状态猜成false或自动授予整数列权限', async kind => {
    const source = snapshot(); if (kind === 'missing') delete source.columns[0].autoIncrement; if (kind === 'readonly') source.columns[0].autoIncrement!.access = { editable: false, reason: '该列缺少支持索引' }; if (kind === 'unknownEnabled') delete (source.columns[0].autoIncrement as any).enabled;
    const f = await mount(source); await edit(); if (kind === 'readonly') { expect(toggleNode()!.disabled).toBe(true); expect(document.body.textContent).toContain('该列缺少支持索引'); await act(async () => callback(toggleNode()!, 'onChange')({ target: { checked: true } })); }
    else { expect(toggleNode()).toBeNull(); expect(document.body.textContent).toContain(text.autoIncrementUnknown); }
    expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
  it('已有普通草稿不被自增入口清除，旧普通控件不能覆写刚选择的自增', async () => {
    const f = await mount(); await edit(); const ordinary = document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.modify + ' ' + text.comment)!, old = callback(ordinary, 'onChange');
    await toggle(); await act(async () => old({ target: { checked: true } })); await click(text.rowSave); await click(text.add); expect(document.body.textContent).toContain(text.autoIncrementMixed); await click(text.drop); expect(f.confirm).not.toHaveBeenCalled(); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } }]);
    await click(text.back); await click(text.undo); await edit(); const current = document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.modify + ' ' + text.comment)!; await act(async () => { current.checked = true; current.dispatchEvent(new MemoryEvent('click')); }); await act(async () => callback(document.querySelector(`textarea[aria-label="${text.comment}"]`)!, 'onChange')({ target: { value: '保留普通草稿' } })); await click(text.rowSave); await edit(); expect(toggleNode()!.disabled).toBe(true); await act(async () => callback(toggleNode()!, 'onChange')({ target: { checked: true } })); expect(document.body.textContent).toContain(text.autoIncrementMixed); await click(text.back); await click(text.preview); expect(f.preview.mock.calls.at(-1)![0].patches).toEqual([{ kind: 'alter', columnRef: 'id-ref', changes: { comment: '保留普通草稿' } }]);
  });
  it('旧行checkbox/保存不能改后继编辑器，已存差异恢复原值后移除补丁', async () => {
    const f = await mount(); await edit(); const oldToggle = callback(toggleNode()!, 'onChange'); await toggle(); const oldSave = callback(button(text.rowSave)); await click(text.rowSave); await edit(); await toggle(); await act(async () => { oldToggle({ target: { checked: true } }); oldSave(); }); expect(toggleNode()!.checked).toBe(false); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false); expect(f.preview).not.toHaveBeenCalled();
  });
  it.each(['projection', 'value', 'access', 'expiry'] as const)('%s编辑中变化再恢复，读取时lease不重新授权', async kind => {
    const f = await mount(); await edit(); const change = callback(toggleNode()!, 'onChange'), column = f.initial.columns[0], oldProjection = column.autoIncrement!, oldAccess = oldProjection.access, expires = f.initial.expiresAt;
    if (kind === 'projection') column.autoIncrement = { ...oldProjection }; if (kind === 'value') oldProjection.enabled = true; if (kind === 'access') oldProjection.access = { ...oldAccess }; if (kind === 'expiry') f.initial.expiresAt = new Date(Date.now() - 1).toISOString();
    await act(async () => change({ target: { checked: true } })); column.autoIncrement = oldProjection; oldProjection.enabled = false; oldProjection.access = oldAccess; f.initial.expiresAt = expires; await act(async () => change({ target: { checked: true } })); expect(f.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.autoIncrementStale);
  });
  it('旧快照行按钮、连接版本ABA以及卸载后的事件均不能恢复编辑授权', async () => {
    const f = await mount(), oldEdit = callback(button('id · INT')); await draft(); const oldPreview = callback(button(text.preview)); f.next(snapshot(false, 'new-snapshot')); await click(text.read); await act(async () => { oldEdit(); oldPreview(); }); expect(toggleNode()).toBeNull(); expect(f.preview).not.toHaveBeenCalled();
    await edit(); const oldToggle = callback(toggleNode()!, 'onChange'); await f.version(2); await f.version(1); await act(async () => oldToggle({ target: { checked: true } })); expect(toggleNode()!.disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled(); await act(async () => root!.unmount()); root = undefined; await act(async () => oldToggle({ target: { checked: true } })); expect(f.apply).not.toHaveBeenCalled();
  });
  it('重读的二次丢稿确认取消不丢草稿，也不调用新的get或释放原snapshot', async () => {
    const f = await mount(); await draft(); f.confirm.mockReturnValueOnce(false); await click(text.read); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } }]);
  });
  it.each(required)('缺少%s确认必须释放计划，不提供可执行预览', async missing => {
    const f = await mount(snapshot(), required.filter(value => value !== missing)); await draft(); await click(text.preview); expect(f.release).toHaveBeenCalledWith({ previewToken: 'auto-plan-1' }); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.autoIncrementStale);
  });
  it('未知确认沿原拒绝规则，旧ACK和旧apply不能转移到下一份计划', async () => {
    const f = await mount(snapshot(), [...required, 'future-auto-risk']); await draft(); await click(text.preview); await allAcks(); expect(button(text.apply).disabled).toBe(true); await act(async () => callback(button(text.apply))()); expect(f.apply).not.toHaveBeenCalled();
    const oldAck = callback(document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackAutoIncrementCopy)!, 'onChange'); await click(text.back); await click(text.preview); await act(async () => oldAck({ target: { checked: true } })); expect(document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackAutoIncrementCopy)!.checked).toBe(false);
  });
  it('迟到预览中原投影漂移或请求已取消，token被释放且不会应用', async () => {
    const f = await mount(), waiting = gate<TableColumnPreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await draft(); await click(text.preview); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce(); expect(button(text.read).disabled).toBe(true);
    await act(async () => waiting.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'late-cancelled', expiresAt: f.initial.expiresAt, sql: '迟到不可执行', changes: [], warnings: [], requiredAcknowledgements: required, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-cancelled' }); expect(f.apply).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(false);
  });
  it('预览等待时投影换成同值对象，晚回包也不能以相同值追认来源', async () => {
    const f = await mount(), waiting = gate<TableColumnPreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await draft(); await click(text.preview); f.initial.columns[0].autoIncrement = { ...f.initial.columns[0].autoIncrement! };
    await act(async () => waiting.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'late-source', expiresAt: f.initial.expiresAt, sql: '迟到不可执行', changes: [], warnings: [], requiredAcknowledgements: required, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-source' }); expect(document.body.textContent).toContain(text.autoIncrementStale); expect(f.apply).not.toHaveBeenCalled();
  });
  it('beforeApply重新检查期间投影变化则未发送，旧apply不能再次尝试；服务器错误也不重放', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const original = f.initial.columns[0].autoIncrement!, old = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { f.initial.columns[0].autoIncrement = { ...original }; }); await act(async () => old()); f.initial.columns[0].autoIncrement = original; await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent);
    f.next(snapshot(false, 'retry-snapshot')); await click(text.read); await draft(); await click(text.preview); await allAcks(); f.apply.mockRejectedValueOnce(Error('服务器返回未知状态')); const retry = callback(button(text.apply)); await act(async () => retry()); await act(async () => retry()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onExecutionUncertain).toHaveBeenCalledOnce();
  });
  it('首次编辑前已经观察到的原值变化不能靠恢复值重新取得授权，明确重读才可继续', async () => {
    const f = await mount(), column = f.initial.columns[0]; column.autoIncrement!.enabled = true; await edit(); expect(toggleNode()).toBeNull(); column.autoIncrement!.enabled = false; await edit(); expect(toggleNode()).toBeNull(); expect(document.body.textContent).toContain(text.autoIncrementStale);
    f.next(snapshot(false, 'explicit-new-read')); await click(text.read); await draft(); await click(text.preview); expect(f.preview).toHaveBeenCalledOnce(); expect(f.preview.mock.calls[0][0].snapshotId).toBe('explicit-new-read');
  });
  it('旧返回和旧撤销不能关闭后继编辑器或删除同列的新自增草稿', async () => {
    const f = await mount(); await draft(); const oldUndo = callback(button(text.undo)); await edit(); const oldBack = callback(button(text.back)); await toggle(); await click(text.rowSave); await draft(); await edit();
    await act(async () => { oldUndo(); oldBack(); }); expect(toggleNode()!.checked).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); await click(text.rowSave); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } }]);
  });
  it('beforeApply同步重入旧apply不使当前调用失效，也绝不生成第二次投递', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const old = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { old(); }); await act(async () => old()); await act(async () => old());
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.succeeded);
  });
  it('父数据草稿守卫取消保留结构草稿和原快照，不发送且不把未发送误报为执行未知', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const old = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { throw Error('同目标存在未提交数据草稿，用户已取消'); }); await act(async () => old()); await act(async () => old());
    expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(f.callbacks.onApplied).not.toHaveBeenCalled(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent); expect(document.body.textContent).toContain('同目标存在未提交数据草稿，用户已取消');
    f.confirm.mockReturnValueOnce(false); await click(text.read); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('beforeApply同步触发取消时未发送DDL，消费后的旧apply也不能补发', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const old = callback(button(text.apply)), cancel = callback(button(text.cancel)); f.callbacks.beforeApply.mockImplementationOnce(() => { cancel(); }); await act(async () => old()); await act(async () => old());
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent);
  });
  it('同一预览取消一项风险确认后，原已勾齐状态的旧执行回调不能投递', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const oldApply = callback(button(text.apply));
    const implicit = document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackImplicit)!;
    await act(async () => { implicit.checked = false; implicit.dispatchEvent(new MemoryEvent('click')); }); expect(button(text.apply).disabled).toBe(true);
    await act(async () => oldApply()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('同一预览的旧确认框回调不能从旧Set恢复用户随后取消的其它确认', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks();
    const oldRisk = callback(document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackAutoIncrementCopy)!, 'onChange');
    const implicit = document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackImplicit)!;
    await act(async () => { implicit.checked = false; implicit.dispatchEvent(new MemoryEvent('click')); });
    await act(async () => oldRisk({ target: { checked: true } }));
    expect(document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackImplicit)!.checked).toBe(false); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it('初始空界面的旧重新读取回调也必须确认后继自增草稿，取消不释放或重读', async () => {
    const source = snapshot(), first = gate<TableColumnGetOutput>(), f = await mount(source, required, first.promise), oldRead = callback(button(text.read));
    await act(async () => first.resolve(source)); await draft(); f.get.mockClear(); f.confirm.mockReturnValueOnce(false); await act(async () => oldRead());
    expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.get).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.preview).disabled).toBe(false);
  });
  it('初始空界面的旧关闭回调也必须确认后继自增草稿，取消不关闭或释放', async () => {
    const source = snapshot(), first = gate<TableColumnGetOutput>(), f = await mount(source, required, first.promise), oldClose = callback(button(text.close));
    await act(async () => first.resolve(source)); await draft(); f.get.mockClear(); f.confirm.mockReturnValueOnce(false); await act(async () => oldClose());
    expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.get).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.preview).disabled).toBe(false);
  });
  it('同一预览ACK取消后恢复相同集合，旧执行仍撤销，只有最新执行回调可提交', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const oldApply = callback(button(text.apply));
    const implicit = document.querySelectorAll('input').find(node => node.parentNode?.textContent === text.ackImplicit)!;
    await act(async () => { implicit.checked = false; implicit.dispatchEvent(new MemoryEvent('click')); }); await acknowledge(text.ackImplicit); expect(button(text.apply).disabled).toBe(false);
    await act(async () => oldApply()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); await click(text.apply); expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0].acknowledgements).toEqual(expect.arrayContaining(required));
  });
  it.each(['read', 'close'] as const)('%s确认期间同步重入读和关闭，只消费外层一次授权', async operation => {
    const f = await mount(); await draft(); const read = callback(button(text.read)), close = callback(button(text.close)); f.get.mockClear(); f.next(snapshot(false, 'after-discard-confirmation'));
    f.confirm.mockImplementationOnce(() => { read(); close(); return true; }); await act(async () => (operation === 'read' ? read() : close()));
    expect(f.confirm).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledWith({ snapshotId: f.initial.snapshotId }); expect(f.get).toHaveBeenCalledTimes(operation === 'read' ? 1 : 0); expect(f.callbacks.onClose).toHaveBeenCalledTimes(operation === 'close' ? 1 : 0);
  });
  it.each(['read', 'close'] as const)('%s确认同意期间出现后继编辑器，旧同意不能放弃新草稿', async operation => {
    const f = await mount(); await draft(); const action = callback(button(operation === 'read' ? text.read : text.close)), reopen = callback(button('id · INT')); f.get.mockClear();
    f.confirm.mockImplementationOnce(() => { reopen(); return true; }); await act(async () => action());
    expect(f.confirm).toHaveBeenCalledOnce(); expect(f.get).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(toggleNode()!.checked).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('执行前保存的旧关闭回调也使用最新未知执行提示，取消保留草稿和回执', async () => {
    const f = await mount(), oldClose = callback(button(text.close)); await draft(); await click(text.preview); await allAcks(); f.apply.mockRejectedValueOnce(Error('服务器终态未知')); await click(text.apply);
    f.confirm.mockReturnValueOnce(false); await act(async () => oldClose()); expect(f.confirm).toHaveBeenCalledWith(text.closeUnknown); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.unknown);
  });
  it('丢稿确认回调同步调用当前apply后取消，不得发送DDL或消费当前预览', async () => {
    const f = await mount(); await draft(); await click(text.preview); await allAcks(); const currentApply = callback(button(text.apply)), sql = document.querySelector('pre[aria-label="只读SQL测试端口"]')!.textContent;
    // 此处仅复现RAM确认端口同步重入，不声称真实浏览器模态事件循环已验证。
    f.confirm.mockImplementationOnce(() => { currentApply(); return false; }); await click(text.close);
    expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.callbacks.onApplied).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')!.textContent).toBe(sql); expect(button(text.apply).disabled).toBe(false); expect(f.preview).toHaveBeenCalledOnce();
  });
  it('DDL完成但核验失败保留执行事实，不能因错误提示再发同一令牌', async () => {
    const f = await mount(); f.apply.mockResolvedValueOnce({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] }); await draft(); await click(text.preview); await allAcks(); const old = callback(button(text.apply)); await click(text.apply); await act(async () => old()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledWith(expect.objectContaining({ definitionVerified: false })); expect(document.body.textContent).toContain(text.verificationFailed); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
