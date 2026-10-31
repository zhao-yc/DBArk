import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import { buildSqliteTableCreate, type SqliteTableCreateOutcome, type SqliteTableCreatePreviewOutput } from '../../src/shared/sqliteTableCreate';
import { sqliteTableCreateZh as text } from '../../src/renderer/locales/sqliteTableCreate.zh-CN';
import type { SqliteTableCreateServices } from '../../src/renderer/components/SqliteTableCreateDialog';

const { request, nextId } = vi.hoisted(() => ({ request: vi.fn(), nextId: { value: 0 } }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request, uid: () => 'sqlite-create-ui-' + ++nextId.value }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
let originalWorkspace: ReturnType<typeof useWorkspace.getState>;
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Component: typeof import('../../src/renderer/components/SqliteTableCreateDialog')['SqliteTableCreateDialog'];
const created = vi.fn(), closed = vi.fn(), dirty = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') Object.defineProperty(node, 'type', { configurable: true, get: () => node.attributes.get('type') ?? 'text', set: value => node.attributes.set('type', value) });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  // 真实store注册window生命周期，必须在内存文档安装后加载，不能靠缺失浏览器全局跳过组件断言。
  ({ useWorkspace } = await import('../../src/renderer/store')); originalWorkspace = useWorkspace.getState();
  ({ createRoot } = await import('react-dom/client')); ({ SqliteTableCreateDialog: Component } = await import('../../src/renderer/components/SqliteTableCreateDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(originalWorkspace, true); request.mockReset(); created.mockReset(); closed.mockReset(); dirty.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 真实组件、真实store与共享schema；只替换IPC端口，不创建进程或文件。 */
function fixture(readOnly = false) {
  const profile: SqliteConnectionProfile = { id: 'create-connection', name: '合成SQLite文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\synthetic\\create.sqlite', readOnly, busyTimeoutMs: 1000 } };
  useWorkspace.setState({ connections: [profile], connectionVersions: { [profile.id]: 4 }, activeJobs: {} });
  const preview: ReturnType<typeof vi.fn<SqliteTableCreateServices['preview']>> = vi.fn<SqliteTableCreateServices['preview']>(async (input): Promise<SqliteTableCreatePreviewOutput> => ({ previewId: 'preview-' + preview.mock.calls.length, target: { connectionId: input.connectionId, database: 'main', table: input.design.name }, confirmation: 'main.' + input.design.name, expiresAt: new Date(Date.now() + 60000).toISOString(), sql: buildSqliteTableCreate(input.design).sql, warnings: ['合成只读预览提示'] }));
  const apply = vi.fn<SqliteTableCreateServices['apply']>(async () => outcome(preview.mock.results.at(-1) ? await preview.mock.results.at(-1)!.value : undefined));
  const release = vi.fn<SqliteTableCreateServices['release']>(async () => {}), cancel = vi.fn<SqliteTableCreateServices['cancel']>(async () => undefined);
  const services: SqliteTableCreateServices = { preview, apply, release, cancel };
  return { profile, preview, apply, release, cancel, services };
}
type Fixture = ReturnType<typeof fixture>;
/** 返回完整事实，避免用MySQL隐式DDL回执或简化布尔值冒充SQLite提交。 */
function outcome(preview: SqliteTableCreatePreviewOutput | undefined, kind: SqliteTableCreateOutcome['outcome'] = 'committed'): SqliteTableCreateOutcome {
  if (!preview) throw Error('测试必须先取得真实预览目标'); const target = preview.target;
  return { operationId: 'operation-1', target, outcome: kind, definitionVerified: kind === 'committed', message: '合成' + kind, fact: { operationId: 'operation-1', target, phase: kind, requestedStatements: preview.sql.length, completedStatements: kind === 'not-sent' ? 0 : preview.sql.length, commitMayHaveBeenSent: ['committed', 'unknown'].includes(kind), commitAcknowledged: kind === 'committed', rollbackAcknowledged: kind === 'rolled-back' } };
}
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }
function control(label: string) { const node = document.querySelector('[aria-label="' + label + '"]'); expect(node, label).toBeDefined(); return node!; }
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label || value.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const node = control(label); expect(node.disabled, label).toBe(false); await act(async () => props(node).onChange({ target: { value } })); }
async function check(label: string, checked: boolean) { const node = control(label); expect(node.disabled, label).toBe(false); await act(async () => props(node).onChange({ target: { checked } })); }
async function render(f: Fixture, patch: Partial<ComponentProps<typeof Component>> = {}) {
  if (!root) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); }
  await act(async () => root!.render(<Component connectionId={f.profile.id} database="main" services={f.services} onCreated={created} onClose={closed} onDirtyChange={dirty} {...patch}/>));
}
async function prepare(f: Fixture, name = '新表🚢') { await input(text.name, name); await click(text.preview); expect(f.preview).toHaveBeenCalledOnce(); return await f.preview.mock.results[0].value; }
async function confirm(f: Fixture) { const preview = await f.preview.mock.results.at(-1)!.value; await input(text.confirmation, preview.confirmation); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

it('挂载与本地设计零IPC，默认id INTEGER非空主键；明确预览完整SQL仍不执行', async () => {
  const f = fixture(); await render(f); expect(control(text.columnName(1)).value).toBe('id'); expect(control(text.declaredType(1)).value).toBe('INTEGER'); expect(control(text.nullable(1)).checked).toBe(false); expect(control(text.primaryColumn(1)).checked).toBe(true); expect(control(text.autoIncrement).checked).toBe(false);
  expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  const preview = await prepare(f); expect(f.preview.mock.calls[0][0]).toEqual({ connectionId: f.profile.id, database: 'main', taskId: expect.any(String), design: { name: '新表🚢', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }], primaryKey: ['id'], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false } });
  expect(control(text.sql).textContent).toContain(preview.sql[0]); expect(document.querySelectorAll('pre')).toHaveLength(1); expect(document.body.textContent).toContain('合成只读预览提示'); expect(f.apply).not.toHaveBeenCalled(); expect(dirty).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true);
});

it('字段typed默认值、排序规则、复合主键、索引方向与有序外键完整送真实预览合同', async () => {
  const f = fixture(); await render(f); await input(text.name, 'child'); await click(text.addColumn); await input(text.columnName(2), 'code'); await check(text.nullable(2), false); await check(text.primaryColumn(2), true); await input(text.defaultKind(2), 'text'); await input(text.defaultValue(2), "默认\0🚢'值"); await input(text.collation(2), 'NOCASE');
  await click(text.up(text.primary + ' code')); await check(text.strict, true); await check(text.withoutRowid, true);
  await click(text.addIndex); await input(text.indexName(1), 'idx_child'); await check(text.unique(1), true); await click(text.addIndexColumn(1)); await input(text.indexColumn(1, 2), 'code'); await input(text.indexOrder(1, 2), 'desc'); await click(text.up(text.indexColumn(1, 2)));
  await click(text.addForeignKey); await input(text.referenceTable(1), 'parent'); await input(text.referenceColumn(1, 1), 'parent_id'); await click(text.addForeignColumn(1)); await input(text.foreignColumn(1, 2), 'code'); await input(text.referenceColumn(1, 2), 'parent_code'); await input(text.onDelete(1), 'CASCADE'); await input(text.onUpdate(1), 'RESTRICT'); await check(text.deferred(1), true); await click(text.up(text.foreignColumn(1, 2))); await click(text.preview);
  expect(f.preview).toHaveBeenCalledOnce(); const design = f.preview.mock.calls[0][0].design;
  expect(design.columns[1]).toEqual({ name: 'code', declaredType: 'TEXT', nullable: false, default: { kind: 'text', value: "默认\0🚢'值" }, collation: 'NOCASE' }); expect(design.primaryKey).toEqual(['code', 'id']); expect(design.strict).toBe(true); expect(design.withoutRowid).toBe(true);
  expect(design.indexes).toEqual([{ name: 'idx_child', unique: true, columns: [{ name: 'code', order: 'desc' }, { name: 'id', order: 'asc' }] }]);
  expect(design.foreignKeys).toEqual([{ name: 'fk_1', columns: ['code', 'id'], referencedTable: 'parent', referencedColumns: ['parent_code', 'parent_id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT', deferred: true }]); expect(f.apply).not.toHaveBeenCalled();
});

it('准确确认后单次提交；同步双击不重放，成功一次回调并清dirty，核验/清理提示不改成功事实', async () => {
  const f = fixture(); await render(f); const preview = await prepare(f); const pending = deferred<SqliteTableCreateOutcome>(); f.apply.mockReturnValueOnce(pending.promise); await input(text.confirmation, 'main.错误表'); expect(button(text.apply).disabled).toBe(true); await confirm(f);
  const target = button(text.apply); await act(async () => { target.dispatchEvent(new MemoryEvent('click')); target.dispatchEvent(new MemoryEvent('click')); }); expect(f.apply).toHaveBeenCalledExactlyOnceWith({ previewId: preview.previewId, confirmation: preview.confirmation, taskId: expect.any(String) }); expect(created).not.toHaveBeenCalled();
  const committed = { ...outcome(preview), definitionVerified: false, cleanupWarning: true }; await act(async () => pending.resolve(committed)); expect(created).toHaveBeenCalledExactlyOnceWith(committed, 4); expect(document.body.textContent).toContain(text.committed); expect(button(text.apply).disabled).toBe(true); expect(button(text.preview).disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(false); expect(Object.values(useWorkspace.getState().activeJobs).some(Boolean)).toBe(false);
});

it('只读连接仍能设计并取得真实预览，创建入口禁用且旧事件调用也不能提交', async () => {
  const f = fixture(true); await render(f); await prepare(f); await confirm(f); expect(document.body.textContent).toContain(text.readonly); expect(button(text.apply).disabled).toBe(true);
  await act(async () => props(button(text.apply)).onClick()); expect(f.apply).not.toHaveBeenCalled();
});

it('设计改动同步撤销旧SQL和确认、释放准确preview；旧字段/旧提交闭包不能修改后继草稿', async () => {
  const f = fixture(); await render(f); const preview = await prepare(f); await confirm(f); const oldApply = props(button(text.apply)).onClick, oldName = props(control(text.name)).onChange;
  await input(text.name, '第二表'); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); expect(document.querySelectorAll('pre')).toHaveLength(0);
  await act(async () => { oldApply(); oldName({ target: { value: '旧闭包偷换' } }); }); expect(control(text.name).value).toBe('第二表'); expect(f.apply).not.toHaveBeenCalled();
  await click(text.preview); expect(f.preview).toHaveBeenCalledTimes(2); expect(control(text.confirmation).value).toBe('');
});

it.each(['profile', 'version'] as const)('同步store %s ABA永久撤销旧预览和提交资格', async kind => {
  const f = fixture(); await render(f); const preview = await prepare(f); await confirm(f); const oldApply = props(button(text.apply)).onClick;
  await act(async () => { if (kind === 'profile') { useWorkspace.setState({ connections: [{ ...f.profile, name: '短暂替换' }] }); useWorkspace.setState({ connections: [f.profile] }); } else { useWorkspace.setState({ connectionVersions: { [f.profile.id]: 5 } }); useWorkspace.setState({ connectionVersions: { [f.profile.id]: 4 } }); } });
  expect(button(text.preview).disabled).toBe(true); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); await act(async () => oldApply()); expect(f.apply).not.toHaveBeenCalled(); expect(control(text.name).value).toBe('新表🚢'); expect(dirty).toHaveBeenLastCalledWith(true);
});

it('props/父租约ABA不复活；非法foo数据库不改main且不发请求', async () => {
  const f = fixture(); let current = true; const parent = () => current; await render(f, { isParentCurrent: parent }); await input(text.name, '保留草稿'); current = false; await render(f, { isParentCurrent: parent }); current = true; await render(f, { isParentCurrent: parent }); expect(button(text.preview).disabled).toBe(true); expect(control(text.name).value).toBe('保留草稿');
  await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; await render(f, { database: 'foo' }); expect(document.body.textContent).toContain('/ foo'); expect(button(text.preview).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled();
});

it('预览迟到失去来源只释放原能力，不发布SQL或自动创建', async () => {
  const f = fixture(), pending = deferred<SqliteTableCreatePreviewOutput>(); f.preview.mockReturnValueOnce(pending.promise); await render(f); await input(text.name, 'late'); await click(text.preview); const inputValue = f.preview.mock.calls[0][0];
  await act(async () => useWorkspace.setState({ connectionVersions: { [f.profile.id]: 9 } })); const preview: SqliteTableCreatePreviewOutput = { previewId: 'late-preview', target: { connectionId: f.profile.id, database: 'main', table: 'late' }, confirmation: 'main.late', expiresAt: new Date(Date.now() + 60000).toISOString(), sql: buildSqliteTableCreate(inputValue.design).sql, warnings: [] }; await act(async () => pending.resolve(preview));
  expect(f.release).toHaveBeenCalledWith({ previewId: 'late-preview' }); expect(document.querySelectorAll('pre')).toHaveLength(0); expect(f.apply).not.toHaveBeenCalled(); expect(created).not.toHaveBeenCalled(); expect(control(text.name).value).toBe('late');
});

it('取消ACK先返回不能提前解锁，原预览晚回只释放，不自动应用', async () => {
  const f = fixture(), pending = deferred<SqliteTableCreatePreviewOutput>(); f.preview.mockReturnValueOnce(pending.promise); await render(f); await input(text.name, 'cancelled'); await click(text.preview); await click(text.stop); expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.preview.mock.calls[0][0].taskId); expect(button(text.close).disabled).toBe(true);
  const preview: SqliteTableCreatePreviewOutput = { previewId: 'cancel-preview', target: { connectionId: f.profile.id, database: 'main', table: 'cancelled' }, confirmation: 'main.cancelled', expiresAt: new Date(Date.now() + 60000).toISOString(), sql: ['CREATE TABLE main.cancelled (id INTEGER)'], warnings: [] }; await act(async () => pending.resolve(preview)); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); expect(button(text.close).disabled).toBe(false); expect(document.querySelectorAll('pre')).toHaveLength(0); expect(f.apply).not.toHaveBeenCalled();
});

it('原apply先终结仍等待准确取消ACK；COMMIT成功保持事实，停止不能撤销且不重试', async () => {
  const f = fixture(); await render(f); const preview = await prepare(f); await confirm(f); const applied = deferred<SqliteTableCreateOutcome>(), cancelled = deferred<unknown>(); f.apply.mockReturnValueOnce(applied.promise); f.cancel.mockReturnValueOnce(cancelled.promise); await click(text.apply); await click(text.stop);
  await act(async () => applied.resolve(outcome(preview))); expect(created).toHaveBeenCalledOnce(); expect(button(text.close).disabled).toBe(true); expect(Object.values(useWorkspace.getState().activeJobs).some(Boolean)).toBe(true);
  await act(async () => cancelled.resolve(undefined)); expect(button(text.close).disabled).toBe(false); expect(Object.values(useWorkspace.getState().activeJobs).some(Boolean)).toBe(false); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.committed);
});

it.each(['rolled-back', 'not-sent', 'unknown'] as const)('%s保留本地设计；未知结果锁原批次，明确回滚/未发可重新预览', async kind => {
  const f = fixture(); await render(f); const preview = await prepare(f); f.apply.mockResolvedValueOnce(outcome(preview, kind)); await confirm(f); await click(text.apply);
  expect(created).not.toHaveBeenCalled(); expect(control(text.name).value).toBe('新表🚢'); expect(dirty).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true); expect(button(text.preview).disabled).toBe(kind === 'unknown');
  if (kind === 'unknown') { expect(document.body.textContent).toContain(text.unknown); await act(async () => props(button(text.preview)).onClick()); expect(f.preview).toHaveBeenCalledOnce(); }
});

it('apply抛错不能当作未发，保留草稿并锁原批次，不自动重放', async () => {
  const f = fixture(); await render(f); await prepare(f); f.apply.mockRejectedValueOnce(Error('合成回包中断')); await confirm(f); await click(text.apply); expect(document.body.textContent).toContain(text.unknown); expect(control(text.name).value).toBe('新表🚢'); expect(button(text.preview).disabled).toBe(true); expect(f.apply).toHaveBeenCalledOnce(); expect(created).not.toHaveBeenCalled();
});

it('关闭明确放弃才释放预览并退出；释放失败保留窗口，不能清掉后续草稿', async () => {
  const f = fixture(); await render(f); const preview = await prepare(f); await click(text.close); expect(closed).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.discard); await click(text.keep); expect(control(text.name).value).toBe('新表🚢');
  f.release.mockRejectedValueOnce(Error('合成释放失败')); await click(text.close); await click(text.discardClose); expect(closed).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('合成释放失败');
  await click(text.discardClose); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); expect(closed).toHaveBeenCalledOnce();
});

it('卸载后的预览能力仍准确释放，不回调创建或把迟到SQL带进后继窗口', async () => {
  const f = fixture(), pending = deferred<SqliteTableCreatePreviewOutput>(); f.preview.mockReturnValueOnce(pending.promise); await render(f); await input(text.name, 'old'); await click(text.preview); await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
  const preview: SqliteTableCreatePreviewOutput = { previewId: 'unmounted-preview', target: { connectionId: f.profile.id, database: 'main', table: 'old' }, confirmation: 'main.old', expiresAt: new Date(Date.now() + 60000).toISOString(), sql: ['CREATE TABLE old(id INTEGER)'], warnings: [] }; await render(f); await act(async () => pending.resolve(preview)); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); expect(control(text.name).value).toBe(''); expect(created).not.toHaveBeenCalled(); expect(document.querySelectorAll('pre')).toHaveLength(0);
});

it('非法typed默认值/STRICT类型/组合主键不发预览，不静默删除用户设计', async () => {
  const f = fixture(); await render(f); await input(text.name, 'invalid'); await input(text.defaultKind(1), 'integer'); await input(text.defaultValue(1), '9223372036854775808'); await click(text.preview); expect(f.preview).not.toHaveBeenCalled(); expect(control(text.defaultValue(1)).value).toBe('9223372036854775808'); expect(document.body.textContent).toContain(text.designInvalid);
  await input(text.defaultKind(1), 'none'); await input(text.declaredType(1), 'VARCHAR(255)'); await check(text.strict, true); await click(text.preview); expect(f.preview).not.toHaveBeenCalled();
});

it('异步关闭释放等待中props换源后，旧关闭不能清除后继窗口或dirty', async () => {
  const f = fixture(); await render(f); await prepare(f); const release = deferred<void>(); f.release.mockReturnValueOnce(release.promise); await click(text.close); await click(text.discardClose); expect(closed).not.toHaveBeenCalled();
  await render(f, { database: 'foo' }); await act(async () => release.resolve()); expect(closed).not.toHaveBeenCalled(); expect(control(text.name).value).toBe('新表🚢'); expect(dirty).toHaveBeenLastCalledWith(true);
});

it('他人接管相同busy编号后旧finally不释放他人的租约，迟到预览仅释放', async () => {
  const f = fixture(), pending = deferred<SqliteTableCreatePreviewOutput>(); f.preview.mockReturnValueOnce(pending.promise); await render(f); await input(text.name, 'lease'); await click(text.preview);
  const key = Object.keys(useWorkspace.getState().activeJobs).find(key => useWorkspace.getState().activeJobs[key])!; expect(key).toMatch(/^sqlite-table-create:/);
  await act(async () => useWorkspace.getState().setBusy(key, true));
  const preview: SqliteTableCreatePreviewOutput = { previewId: 'lease-preview', target: { connectionId: f.profile.id, database: 'main', table: 'lease' }, confirmation: 'main.lease', expiresAt: new Date(Date.now() + 60000).toISOString(), sql: ['CREATE TABLE lease(id INTEGER)'], warnings: [] }; await act(async () => pending.resolve(preview));
  expect(useWorkspace.getState().activeJobs[key]).toBe(true); expect(f.release).toHaveBeenCalledWith({ previewId: preview.previewId }); expect(document.querySelectorAll('pre')).toHaveLength(0); expect(f.apply).not.toHaveBeenCalled();
});
