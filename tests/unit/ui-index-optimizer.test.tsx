import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import type { IndexPatchServices } from '../../src/renderer/components/IndexPatchDialog';
import { indexPatchZh as text } from '../../src/renderer/locales/indexPatches.zh-CN';
import { IndexOptimizerIntent, hasIndexOptimizerPatch, makeIndexOptimizerAlter } from '../../src/renderer/indexOptimizer';
import { indexAcknowledgementLabel, validateIndexDrafts } from '../../src/renderer/indexPatches';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

// 仅替换Monaco视图端口；真实React组件、确认和任务生命周期保持生产实现。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="只读SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/IndexPatchDialog')['IndexPatchDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  // RAM窗口复用Node原生计时器，只补TTL调度端口，不改变时间或到期断言。
  Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    // 补原DOM属性反射，不模拟系统输入或数据库响应。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (key === 'value' && name === 'option') node.value = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ IndexPatchDialog: Dialog } = await import('../../src/renderer/components/IndexPatchDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

const baseAcks = ['ddl-implicit-commit', 'external-ddl-window'];
/** 准确普通索引来源；红反例只用既有注释草稿，避免依赖尚未实现的新属性。 */
function snapshot(id = 'index-source'): TableIndexGetOutput {
  return { target: { connectionId: 'RAM索引', database: 'db', table: 't' }, snapshotId: id, ddlHash: '原索引定义摘要', expiresAt: new Date(Date.now() + 300000).toISOString(), writable: true,
    capabilities: { dialect: 'mysql', serverVersion: '8.4.11', renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 }, incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, warnings: [],
    columns: [{ columnRef: 'id-ref', name: 'id', typeSql: 'INT', nullable: false, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '整数无前缀' } }],
    indexes: [{ indexRef: 'idx-ref', name: 'idx_id', rawSql: 'KEY `idx_id` (`id`)', kind: 'ordinary', editableDefinition: { kind: 'ordinary', name: 'idx_id', method: 'BTREE', keyParts: [{ columnRef: 'id-ref', direction: 'asc' }], comment: '' }, unsupportedReasons: [], access: { drop: { allowed: true, reasons: [] }, rename: { allowed: true, reasons: [] }, replace: { allowed: true, reasons: [] } } }],
  };
}
/** 独立RAM服务只记录调用，无IPC、SQL执行或隐式数据写入。 */
async function mount(initial = snapshot(), acknowledgements = baseAcks) {
  let next = initial, version = 1, sequence = 0;
  const get = vi.fn(async (_input: Parameters<IndexPatchServices['get']>[0]) => next);
  const preview = vi.fn(async (_input: Parameters<IndexPatchServices['preview']>[0]): Promise<TableIndexPreviewOutput> => ({ target: next.target, ddlHash: next.ddlHash, previewToken: 'index-plan-' + (++sequence), expiresAt: next.expiresAt, sql: '服务器固定索引预览；此文本不执行', changes: [], warnings: [], requiredAcknowledgements: [...acknowledgements], concurrencyPolicy: 'recheck-before-ddl' }));
  const apply = vi.fn(async (_input: Parameters<IndexPatchServices['apply']>[0]) => ({ ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] as string[] }));
  const release = vi.fn(async (_input: Parameters<IndexPatchServices['release']>[0]) => {}), cancel = vi.fn(async (_input: { taskId: string }) => {});
  const callbacks = { onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), onApplied: vi.fn(), beforeApply: vi.fn(), onExecutionUncertain: vi.fn() };
  const services: IndexPatchServices = { get, preview, apply, release, cancel }, confirm = vi.fn(() => true); (window as any).confirm = confirm;
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = () => root!.render(<Dialog target={initial.target} targetVersion={version} services={services} {...callbacks}/>);
  await act(async () => render());
  return { initial, get, preview, apply, release, cancel, callbacks, confirm, next(value: TableIndexGetOutput) { next = value; }, async version(value: number) { version = value; await act(async () => render()); } };
}
/** 使用真实DOM中文标签，并保留旧React事件以检验同步守卫。 */
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
function callback(node: MemoryNode, event = 'onClick'): Function { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件'); return (node as any)[key][event]; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function ack(label: string) { const node = document.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function setAck(label: string, checked: boolean) { await act(async () => callback(ack(label), 'onChange')({ target: { checked } })); }
async function ordinaryDraft() { await click(text.edit); await act(async () => callback(document.querySelector(`textarea[aria-label="${text.comment}"]`)!, 'onChange')({ target: { value: '保留本批索引草稿' } })); await click(text.rowSave); }
async function prepared() { const f = await mount(); await ordinaryDraft(); await click(text.preview); await setAck(text.ackImplicit, true); await setAck(text.ackWindow, true); return f; }
/** 同一份可见性投影独立于旧重建模型；不可见原索引可没有editableDefinition。 */
function optimizerSnapshot(visible = true, id = 'optimizer-source'): TableIndexGetOutput {
  const source = snapshot(id), index = source.indexes[0]; index.optimizer = { visible, access: { allowed: true, reasons: [] } };
  if (!visible) { delete index.editableDefinition; index.unsupportedReasons = ['原解析器不支持不可见后缀']; index.rawSql += ' /*!80000 INVISIBLE */'; for (const access of Object.values(index.access)) access.allowed = false; }
  return source;
}
const optimizerAcks = [...baseAcks, 'index-optimizer-change'];
function optimizerToggle() { return document.querySelector(`input[aria-label="${text.optimizerToggle}"]`); }
async function optimizerDraft(visible: boolean) { await click(text.optimizerEntry); await act(async () => callback(optimizerToggle()!, 'onChange')({ target: { checked: visible } })); await click(text.rowSave); }
async function allOptimizerAcks() { for (const label of [text.ackImplicit, text.ackWindow, text.ackOptimizer]) await setAck(label, true); }
/** 真实延迟服务可在取消后晚回；不修改生产时钟、不用等待延时推进。 */
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('索引原确认生命周期红反例', () => {
  it('同一预览取消一个风险确认后，已勾齐时的旧apply不能投递', async () => {
    const f = await prepared(), old = callback(button(text.apply)); await setAck(text.ackWindow, false); await act(async () => old());
    expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(ack(text.ackWindow).checked).toBe(false); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('旧确认框不能用旧Set恢复当前取消的另一风险确认', async () => {
    const f = await prepared(), old = callback(ack(text.ackImplicit), 'onChange'); await setAck(text.ackWindow, false); await act(async () => old({ target: { checked: true } }));
    expect(ack(text.ackWindow).checked).toBe(false); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it.each(['close', 'read'] as const)('初始空render旧%s在后继草稿出现后仍须确认，取消不得释放或丢稿', async kind => {
    const f = await mount(), old = callback(button(kind === 'close' ? text.close : text.read)); await ordinaryDraft(); f.confirm.mockReturnValueOnce(false); await act(async () => old());
    expect(f.confirm).toHaveBeenCalledOnce(); expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('丢稿确认回调同步重入已勾齐apply时，不消费预览也不投递DDL', async () => {
    const f = await prepared(), old = callback(button(text.apply)); f.confirm.mockImplementationOnce(() => { old(); return false; }); await click(text.close);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(false); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')).not.toBeNull();
  });
});

describe('索引优化器独立模型与来源意图', () => {
  it.each([true, false])('原visible=%s恢复不留差异，专属权限不借旧重建模型', visible => {
    const source = optimizerSnapshot(visible), index = source.indexes[0];
    expect(makeIndexOptimizerAlter(index, visible)).toBeNull();
    const patch = { op: 'alter' as const, indexRef: 'idx-ref', changes: { optimizerVisible: !visible } };
    expect(makeIndexOptimizerAlter(index, !visible)).toEqual(patch); expect(validateIndexDrafts(source, [patch])).toEqual([patch]); expect(hasIndexOptimizerPatch([patch])).toBe(true); expect(indexAcknowledgementLabel('index-optimizer-change')).toBe(text.ackOptimizer);
  });
  it('缺投影、只读和非布尔不能根据普通索引权限猜可修改状态', () => {
    const source = snapshot(), index = source.indexes[0]; expect(() => makeIndexOptimizerAlter(index, false)).toThrow(text.optimizerReadonly);
    index.optimizer = { visible: true, access: { allowed: false, reasons: ['MySQL 5.7 不支持本属性'] } }; expect(() => makeIndexOptimizerAlter(index, false)).toThrow('5.7');
    index.optimizer.access.allowed = true; expect(() => makeIndexOptimizerAlter(index, undefined as never)).toThrow(); expect(() => makeIndexOptimizerAlter(index, 'false' as never)).toThrow();
    expect(() => validateIndexDrafts(source, [{ op: 'alter', indexRef: 'idx-ref', changes: { optimizerVisible: true } }])).toThrow(text.noChange);
  });
  it('新建删除重命名和其它属性均不能混入，也不能用原型引用代替实际索引', () => {
    const source = optimizerSnapshot(), patch = { op: 'alter' as const, indexRef: 'idx-ref', changes: { optimizerVisible: false } };
    for (const extra of [{ op: 'drop' as const, indexRef: 'other' }, { op: 'add' as const, clientKey: 'new', definition: source.indexes[0].editableDefinition! }, { op: 'alter' as const, indexRef: 'other', changes: { name: 'renamed' } }]) expect(() => validateIndexDrafts(source, [patch, extra])).toThrow();
    expect(() => validateIndexDrafts(source, [{ ...patch, changes: { ...patch.changes, comment: '不混批' } }])).toThrow(); expect(() => validateIndexDrafts(source, [{ ...patch, indexRef: '__proto__' }])).toThrow(text.missing);
    expect(() => validateIndexDrafts(source, [{ ...patch, changes: { optimizerVisible: undefined } }])).toThrow();
  });
  it.each(['value', 'projection', 'access', 'indexes', 'columns', 'raw', 'id', 'hash', 'target', 'expiry'] as const)('%s漂移被观察后永久失效，同值恢复不能复活原意图', kind => {
    const source = optimizerSnapshot(), index = source.indexes[0], intent = new IndexOptimizerIntent(source, index), original = { projection: index.optimizer!, access: index.optimizer!.access, indexes: source.indexes, columns: source.columns, raw: index.rawSql, id: source.snapshotId, hash: source.ddlHash, target: source.target.table, expiry: source.expiresAt };
    expect(intent.current(source)).toBe(true);
    if (kind === 'value') index.optimizer!.visible = false; if (kind === 'projection') index.optimizer = { ...index.optimizer! }; if (kind === 'access') index.optimizer!.access = { ...index.optimizer!.access }; if (kind === 'indexes') source.indexes = [...source.indexes]; if (kind === 'columns') source.columns = [...source.columns]; if (kind === 'raw') index.rawSql += ' COMMENT x'; if (kind === 'id') source.snapshotId = 'changed'; if (kind === 'hash') source.ddlHash = 'changed'; if (kind === 'target') source.target.table = 'changed'; if (kind === 'expiry') source.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(intent.current(source)).toBe(false);
    index.optimizer = original.projection; index.optimizer.visible = true; index.optimizer.access = original.access; source.indexes = original.indexes; source.columns = original.columns; index.rawSql = original.raw; source.snapshotId = original.id; source.ddlHash = original.hash; source.target.table = original.target; source.expiresAt = original.expiry;
    expect(intent.current(source)).toBe(false); expect(new IndexOptimizerIntent(source, index).current(source)).toBe(true);
  });
});

describe('索引优化器真实React闭环与事件守卫', () => {
  it.each([true, false])('原visible=%s显示准确状态，恢复消差异，只提交一次单属性和三确认', async visible => {
    const f = await mount(optimizerSnapshot(visible), optimizerAcks); expect(f.get.mock.calls[0][0]).toMatchObject({ includeOptimizerFacts: true }); await click(text.optimizerEntry); expect(optimizerToggle()!.checked).toBe(visible);
    await act(async () => callback(optimizerToggle()!, 'onChange')({ target: { checked: !visible } })); await click(text.optimizerRestore); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
    await optimizerDraft(!visible); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ op: 'alter', indexRef: 'idx-ref', changes: { optimizerVisible: !visible } }]); expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true'); await setAck(text.ackImplicit, true); await setAck(text.ackWindow, true); expect(button(text.apply).disabled).toBe(true); await setAck(text.ackOptimizer, true);
    const apply = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => apply()); await act(async () => { apply(); apply(); }); await act(async () => apply()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0].acknowledgements).toEqual(optimizerAcks); expect(f.callbacks.onApplied).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'unknown', 'readonly'] as const)('%s不猜false且不能从旧按钮绕过权限', async kind => {
    const source = optimizerSnapshot(); if (kind === 'missing') delete source.indexes[0].optimizer; if (kind === 'unknown') delete (source.indexes[0].optimizer as any).visible; if (kind === 'readonly') source.indexes[0].optimizer!.access = { allowed: false, reasons: ['MySQL 5.7 不支持本属性'] };
    const f = await mount(source, optimizerAcks); expect(button(text.optimizerEntry).disabled).toBe(true); await act(async () => callback(button(text.optimizerEntry))()); expect(optimizerToggle()).toBeNull(); expect(f.preview).not.toHaveBeenCalled(); if (kind === 'readonly') expect(document.body.textContent).toContain('5.7'); else expect(document.body.textContent).toContain(text.optimizerUnknown);
  });
  it('MariaDB明确说明反向IGNORED语义，普通草稿保留且拒绝混批', async () => {
    const source = optimizerSnapshot(); source.capabilities!.dialect = 'mariadb'; source.capabilities!.serverVersion = '11.4.10-MariaDB'; const f = await mount(source, optimizerAcks), oldOptimizer = callback(button(text.optimizerEntry)); await ordinaryDraft(); await act(async () => oldOptimizer()); expect(optimizerToggle()).toBeNull(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); await click(text.undo); await click(text.optimizerEntry); expect(document.body.textContent).toContain(text.optimizerMaria); expect(document.body.textContent).toContain(text.optimizerScope);
    const oldAdd = callback(button(text.add)); await act(async () => callback(optimizerToggle()!, 'onChange')({ target: { checked: false } })); await click(text.rowSave); await act(async () => oldAdd()); expect(document.querySelector(`textarea[aria-label="${text.comment}"]`)).toBeNull(); await click(text.preview); expect(f.preview.mock.calls[0][0].patches).toEqual([{ op: 'alter', indexRef: 'idx-ref', changes: { optimizerVisible: false } }]);
  });
  it('旧编辑器checkbox和保存不能改后继输入，保存后选回原值移除差异', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await click(text.optimizerEntry); const oldToggle = callback(optimizerToggle()!, 'onChange'), oldSave = callback(button(text.rowSave)); await act(async () => oldToggle({ target: { checked: false } })); await act(async () => oldSave()); expect(optimizerToggle()).not.toBeNull(); await click(text.rowSave); await click(text.optimizerEntry); await click(text.optimizerRestore); await act(async () => oldToggle({ target: { checked: false } })); expect(optimizerToggle()!.checked).toBe(true); await click(text.rowSave); expect(button(text.preview).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled();
  });
  it('来源先漂移再恢复不授权，显式重读才可继续，旧行和旧撤销不能接管', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks), oldEntry = callback(button(text.optimizerEntry)), projection = f.initial.indexes[0].optimizer!; projection.visible = false; await act(async () => oldEntry()); projection.visible = true; await act(async () => oldEntry()); expect(optimizerToggle()).toBeNull(); expect(document.body.textContent).toContain(text.optimizerStale);
    f.next(optimizerSnapshot(true, 'new')); await click(text.read); await act(async () => oldEntry()); expect(optimizerToggle()).toBeNull(); await optimizerDraft(false); const oldUndo = callback(button(text.undo)); await click(text.undo); await optimizerDraft(false); await act(async () => oldUndo()); await click(text.preview); expect(f.preview).toHaveBeenCalledOnce();
  });
  it('目标版本ABA和卸载后不能恢复旧控件', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await click(text.optimizerEntry); const toggle = callback(optimizerToggle()!, 'onChange'); await f.version(2); await f.version(1); await act(async () => toggle({ target: { checked: false } })); expect(optimizerToggle()!.disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled(); await act(async () => root!.unmount()); root = undefined; await act(async () => toggle({ target: { checked: false } })); expect(f.apply).not.toHaveBeenCalled();
  });
  it('已打开编辑器的快照到期后不能保存，也不因到期文本恢复重新授权', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await click(text.optimizerEntry); const change = callback(optimizerToggle()!, 'onChange'), save = callback(button(text.rowSave)), expires = f.initial.expiresAt; f.initial.expiresAt = new Date(Date.now() - 1).toISOString(); await act(async () => change({ target: { checked: false } })); f.initial.expiresAt = expires; await act(async () => { change({ target: { checked: false } }); save(); }); expect(f.preview).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.optimizerStale);
  });
  it.each(optimizerAcks)('回包缺少%s确认时释放token而非展示可执行计划', async missing => {
    const f = await mount(optimizerSnapshot(), optimizerAcks.filter(id => id !== missing)); await optimizerDraft(false); await click(text.preview); expect(f.release).toHaveBeenCalledWith({ previewToken: 'index-plan-1' }); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.optimizerStale);
  });
  it('取消ACK先回仍等待原preview，晚token只释放一次且不应用', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks), wait = gate<TableIndexPreviewOutput>(); f.preview.mockImplementationOnce(() => wait.promise); await optimizerDraft(false); await click(text.preview); await click(text.cancel); expect(button(text.read).disabled).toBe(true); expect(f.cancel).toHaveBeenCalledOnce();
    await act(async () => wait.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'late', expiresAt: f.initial.expiresAt, sql: '迟到计划', changes: [], warnings: [], requiredAcknowledgements: optimizerAcks, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late' }); expect(f.apply).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(false);
  });
  it('迟到preview遇同值新投影仍释放，不能追认新来源', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks), wait = gate<TableIndexPreviewOutput>(); f.preview.mockImplementationOnce(() => wait.promise); await optimizerDraft(false); await click(text.preview); f.initial.indexes[0].optimizer = { ...f.initial.indexes[0].optimizer! };
    await act(async () => wait.resolve({ target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'late-source', expiresAt: f.initial.expiresAt, sql: '迟到计划', changes: [], warnings: [], requiredAcknowledgements: optimizerAcks, concurrencyPolicy: 'recheck-before-ddl' })); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-source' }); expect(f.apply).not.toHaveBeenCalled();
  });
  it('未知确认和同对象预览正文变化均不能被旧确认或apply授权', async () => {
    const f = await mount(optimizerSnapshot(), [...optimizerAcks, 'future-optimizer-risk']); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); expect(button(text.apply).disabled).toBe(true); await act(async () => callback(button(text.apply))()); expect(f.apply).not.toHaveBeenCalled();
    await click(text.back); const plan: TableIndexPreviewOutput = { target: f.initial.target, ddlHash: f.initial.ddlHash, previewToken: 'tamper-plan', expiresAt: f.initial.expiresAt, sql: '原固定SQL', changes: [], warnings: [], requiredAcknowledgements: optimizerAcks, concurrencyPolicy: 'recheck-before-ddl' }; f.preview.mockResolvedValueOnce(plan); await click(text.preview); await allOptimizerAcks(); const apply = callback(button(text.apply)); plan.sql = '后继SQL'; await act(async () => apply()); plan.sql = '原固定SQL'; await act(async () => apply()); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.optimizerStale);
  });
  it('ACK取消再同值恢复的ABA不复活旧apply，beforeApply变更来源也不投递', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); const old = callback(button(text.apply)); await setAck(text.ackOptimizer, false); await setAck(text.ackOptimizer, true); await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled();
    const current = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { f.initial.indexes[0].optimizer = { ...f.initial.indexes[0].optimizer! }; }); await act(async () => current()); await act(async () => current()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.notSent);
  });
  it('父草稿守卫拒绝不丢草稿，不标未发送为未知也不重放', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); f.callbacks.beforeApply.mockImplementationOnce(() => { throw Error('用户取消数据草稿离开'); }); const apply = callback(button(text.apply)); await act(async () => apply()); await act(async () => apply()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(f.release).not.toHaveBeenCalled();
  });
  it('丢稿确认期间重入read/close/checkbox均不更改原预览和确认', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); const read = callback(button(text.read)), close = callback(button(text.close)), change = callback(ack(text.ackOptimizer), 'onChange'); f.confirm.mockImplementationOnce(() => { read(); close(); change({ target: { checked: false } }); return false; }); await click(text.read); expect(f.confirm).toHaveBeenCalledOnce(); expect(f.get).toHaveBeenCalledOnce(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(ack(text.ackOptimizer).checked).toBe(true); expect(f.release).not.toHaveBeenCalled();
  });
  it('DDL完成但后核失败保留事实且不重试，关闭使用最新未知结果提示', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks), oldClose = callback(button(text.close)); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); f.apply.mockResolvedValueOnce({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] }); const apply = callback(button(text.apply)); await act(async () => apply()); await act(async () => apply()); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.verificationFailed); f.confirm.mockReturnValueOnce(false); await act(async () => oldClose()); expect(f.confirm).toHaveBeenCalledWith(text.closeUnknown); expect(f.callbacks.onClose).not.toHaveBeenCalled();
  });
  it('apply取消先确认不提前解锁，原请求完成后的旧apply不会自动重放', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks), wait = gate<Awaited<ReturnType<IndexPatchServices['apply']>>>(); await optimizerDraft(false); await click(text.preview); await allOptimizerAcks(); f.apply.mockImplementationOnce(() => wait.promise); const apply = callback(button(text.apply)); await act(async () => apply()); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(button(text.read).disabled).toBe(true); await act(async () => apply()); expect(f.apply).toHaveBeenCalledOnce();
    await act(async () => wait.resolve({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] })); expect(f.callbacks.onApplied).toHaveBeenCalledOnce(); expect(button(text.read).disabled).toBe(false); await act(async () => apply()); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('释放失败不清责任集合，重读第二次只重试清理并取得明确新快照', async () => {
    const f = await mount(optimizerSnapshot(), optimizerAcks); await optimizerDraft(false); await click(text.preview); f.release.mockRejectedValueOnce(Error('临时释放失败')); await click(text.read); expect(f.get).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain('临时释放失败'); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); f.next(optimizerSnapshot(true, 'fresh-after-release')); await click(text.read); expect(f.get).toHaveBeenCalledTimes(2); expect(f.release.mock.calls.filter(([value]) => value.previewToken === 'index-plan-1')).toHaveLength(2); expect(f.apply).not.toHaveBeenCalled();
  });
});
