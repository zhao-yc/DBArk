import { installNavigationMenuRamPort, navigationMenuRamButton, navigationMenuObservedMutationPort } from '../helpers/navigationMenuRamPort';
let restoreNavigationMenuPort: () => void = () => {};
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { ResultExportData, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { ResultInsertPreviewInput, ResultInsertPreviewOutput, ResultInsertProgress } from '../../src/shared/resultInsert';
import { ResultInsertSourceIntent } from '../../src/renderer/resultInsertUi';
import { resultInsertZh as text } from '../../src/renderer/locales/resultInsert.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { ResultInsertServices } from '../../src/renderer/components/ResultInsertDialog';
const grid = vi.hoisted(() => ({ props: null as any }));
/** 仅用无布局网格端口接收父组件公开props；排序、筛选、选择、源租约和store均为生产实现。 */
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid(props: any) { grid.props = props; return <div role="grid"/>; } }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ResultInsertDialog')['ResultInsertDialog'], QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'MutationObserver', 'Element'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const observers = new Set<(records?: unknown[]) => void>();
const data = (): ResultExportData => ({ columns: [{ key: 'id', name: 'id' }, { key: 'amount', name: 'amount' }, { key: 'a', name: '重复标题' }, { key: 'b', name: '重复标题' }, { key: 'bytes', name: 'bytes' }], rows: [0, 1, 2].map(index => ({ id: String(9007199254740993n + BigInt(index)), amount: '9007199254740993.123456789012', a: index ? 'line\nbreak' : '', b: '2026-10-24 00:00:00.123456', bytes: { type: 'binary', base64: 'AP8=' } })), truncated: true });
const info = (): TableInfo => ({ database: 'db', name: 'dest', objectKind: 'table', engine: 'InnoDB', columns: ['id', 'amount', 'note', 'bytes', 'generated'].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,12)' : name === 'bytes' ? 'BLOB' : 'TEXT', nullable: true, defaultValue: null, extra: '', generated: name === 'generated', comment: '' })), primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], ddl: '' });
const output = (input: ResultInsertPreviewInput): ResultInsertPreviewOutput => ({ previewToken: randomUUID(), target: { connectionId: input.connectionId, database: input.database, table: input.table }, rows: input.data.rows.length, mapping: input.mapping, shownRows: input.data.rows.length, sql: 'INSERT INTO `db`.`dest` (...) VALUES (...);', expiresAt: new Date(Date.now() + 60_000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: input.data.truncated, timeZone: input.timeZone, warnings: ['仅RAM回执，非数据库验收'] });
const fact = (patch: Partial<ResultInsertProgress> = {}): ResultInsertProgress => ({ phase: 'inserting', rows: 0, totalRows: 3, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'not-sent', ...patch });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  doc = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(doc); (doc as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: () => true }); const create = doc.createElement.bind(doc);
  /** 只补标准input/option/select布尔与选中反射，不注入产品状态。 */
  doc.createElement = name => {
    const node = create(name); if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    if (name === 'option') { Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  Object.defineProperty(globalThis, 'Element', { value: MemoryNode, configurable: true }); Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: navigationMenuObservedMutationPort(observers) });
  ({ createRoot } = await import('react-dom/client')); ({ ResultInsertDialog: Dialog } = await import('../../src/renderer/components/ResultInsertDialog')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; if ((window as any).dbark) await flush(); delete (window as any).dbark; doc.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function seed() { store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: 'source', tabs: [{ id: 'source', kind: 'query', connectionId: 'source', title: '原查询', sql: 'SELECT 保留原稿', databaseContext: { state: 'known', database: null } }] }, connections: ['source', 'target'].map(id => ({ id, name: id === 'source' ? '原连接' : '目标连接', group: '', color: '', dialect: 'mysql' as const, host: 'offline.invalid', port: 1, user: 'ram' })), connectionVersions: { source: 1, target: 1 }, activeJobs: {}, dirtyTabs: {}, tasks: [], notice: undefined }); }
async function mountDialog(overrides: Partial<ResultInsertServices> = {}) {
  seed(); const listeners = new Set<(event: TaskEvent) => void>(), source = data(), intent = new ResultInsertSourceIntent(source, false, randomUUID(), () => true);
  const preview = vi.fn(async (input: ResultInsertPreviewInput) => output(input)), apply = vi.fn(async (input: Parameters<ResultInsertServices['apply']>[0]) => ({ target: { connectionId: input.connectionId, database: 'db', table: 'dest' }, rows: 3, outcome: 'committed' as const, commitAcknowledged: true as const })), release = vi.fn(async (_input: Parameters<ResultInsertServices['release']>[0]) => undefined), cancel = vi.fn(async (_id: string) => undefined);
  const services: ResultInsertServices = { open: vi.fn(async () => undefined), databases: vi.fn(async () => ['db']), objects: vi.fn(async () => [{ name: 'dest', kind: 'table' as const }, { name: 'excluded_view', kind: 'view' as const }]), metadata: vi.fn(async () => info()), preview, apply, release, cancel, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, ...overrides };
  const onActivity = vi.fn(), onClose = vi.fn(), onCommitted = vi.fn(), onCleanupError = vi.fn(), host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<Dialog intent={intent} initialConnectionId="target" services={services} onActivity={onActivity} onClose={onClose} onCommitted={onCommitted} onCleanupError={onCleanupError}/>));
  return { source, intent, services, preview, apply, release, cancel, onActivity, onClose, onCommitted, onCleanupError, async emit(value: ResultInsertProgress) { const input = (services.apply as typeof apply).mock.calls[0]?.[0]; expect(input).toBeDefined(); await act(async () => { for (const listener of listeners) listener({ taskId: input.taskId, status: 'running', progress: 60, message: 'RAM阶段', resultInsert: value }); }); } };
}
function button(label: string): MemoryNode { const node = (navigationMenuRamButton(doc, label) ?? doc.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label || node.textContent === label || label === zh.query.text010 && node.textContent.startsWith(label))); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function field(label: string, tag = 'input') { const node = doc.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function select(label: string, value: string) { const node = field(label, 'select'); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function input(label: string, value: string, tag = 'input') { const node = field(label, tag); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function acknowledge() { await input(text.confirmation, 'db.dest', 'textarea'); const node = field(text.acknowledge); await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }
async function targetReady() { await click(text.databases); await select(text.database, 'db'); await click(text.tables); expect(field(text.table, 'select').querySelectorAll('option').map(node => node.value)).toEqual(['', 'dest']); await select(text.table, 'dest'); await click(text.metadata); }
function callback(node: MemoryNode): () => void { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少实际React回调'); return Reflect.get(node, key).onClick; }

describe('结果插入独立Dialog真实React RAM（无网络/SQL/文件/剪贴板）', () => {
  it('打开零读取，目录分层明确选择，重复标题按位置/key区分且生成列不映射', async () => {
    const f = await mountDialog(); expect(f.services.open).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.truncated); await targetReady();
    expect(field(text.mappingColumn('id'), 'select').value).toBe('id'); expect(field(text.mappingColumn('a'), 'select').value).toBe(''); expect(field(text.mappingColumn('b'), 'select').value).toBe(''); expect(doc.body.textContent).toContain(text.sourceColumn(3, '重复标题', 'a')); expect(doc.body.textContent).toContain(text.sourceColumn(4, '重复标题', 'b'));
    expect(field(text.mappingColumn('id'), 'select').querySelectorAll('option').some(node => node.value === 'generated')).toBe(false); await select(text.mappingColumn('a'), 'note'); expect(field(text.mappingColumn('b'), 'select').querySelectorAll('option').find(node => node.value === 'note')!.disabled).toBe(true); await click(text.preview); expect(f.preview.mock.calls[0][0].mapping).toEqual([{ source: 'id', target: 'id' }, { source: 'amount', target: 'amount' }, { source: 'a', target: 'note' }, { source: 'bytes', target: 'bytes' }]); expect(f.apply).not.toHaveBeenCalled();
  });
  it('完整源冻结和时区原样送预览，完整确认+ack后一次apply只发token，不重传数据', async () => {
    const f = await mountDialog(); const saved = structuredClone(f.source); f.source.rows[2].amount = '0'; await targetReady(); await input(text.timeZone, '+08:00'); await click(text.preview); const request = f.preview.mock.calls[0][0]; expect(request.data).toEqual(saved); expect(request.timeZone).toBe('+08:00'); expect(button(text.apply).disabled).toBe(true); await acknowledge(); const apply = callback(button(text.apply)); await act(async () => { apply(); apply(); });
    expect(f.apply).toHaveBeenCalledOnce(); const applied = f.apply.mock.calls[0][0]; expect(Object.keys(applied).sort()).toEqual(['acknowledged', 'confirmation', 'connectionId', 'previewToken', 'taskId']); expect(applied.confirmation).toBe('db.dest'); expect(f.onCommitted).toHaveBeenCalledOnce(); expect(doc.body.textContent).toContain(text.committed(3));
  });
  it('无效时区在任何预览请求前明确拒绝，保留原映射供修正', async () => {
    const f = await mountDialog(); await targetReady(); await input(text.timeZone, '+14:01'); await click(text.preview); expect(f.preview).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.timeZoneInvalid); expect(field(text.mappingColumn('id'), 'select').value).toBe('id');
  });
  it('目标和时区ABA撤销旧preview，旧确认/打开回调不能使用原token', async () => {
    const f = await mountDialog(); await targetReady(); await click(text.preview); await acknowledge(); const old = callback(button(text.apply)), token = f.preview.mock.results[0]; await input(text.timeZone, '+08:00'); await input(text.timeZone, '+00:00'); await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true); expect(f.release).toHaveBeenCalledOnce(); expect(token.type).toBe('return');
  });
  it.each(['ack-first', 'preview-first'] as const)('预览取消%s同时等待原读取与原cancel，迟到token精确release后才关闭', async order => {
    const pending = deferred<ResultInsertPreviewOutput>(), ack = deferred<unknown>(), run = vi.fn((_input: ResultInsertPreviewInput) => pending.promise), stop = vi.fn(() => ack.promise), f = await mountDialog({ preview: run, cancel: stop }); await targetReady(); await click(text.preview); await click(text.cancel); await click(text.close); const result = output(run.mock.calls[0][0]);
    if (order === 'ack-first') await act(async () => ack.resolve(undefined)); else await act(async () => pending.resolve(result)); expect(f.onClose).not.toHaveBeenCalled();
    if (order === 'ack-first') await act(async () => pending.resolve(result)); else await act(async () => ack.resolve(undefined)); expect(stop).toHaveBeenCalledOnce(); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledExactlyOnceWith({ connectionId: 'target', previewToken: result.previewToken }); expect(f.onActivity.mock.calls.at(-1)).toEqual([-1]);
  });
  it('目标配置更改/恢复清目录和预览，不自动重连、重试或领回旧token', async () => {
    const f = await mountDialog(); await targetReady(); await click(text.preview); const opens = (f.services.open as any).mock.calls.length; await act(async () => { store.setState({ connectionVersions: { source: 1, target: 2 } }); store.setState({ connectionVersions: { source: 1, target: 1 } }); }); expect(f.release).toHaveBeenCalledOnce(); expect(field(text.database, 'select').value).toBe(''); expect(button(text.apply).disabled).toBe(true); expect(f.services.open).toHaveBeenCalledTimes(opens); expect(doc.body.textContent).toContain(text.targetChanged);
  });
  it('COMMIT可能发送后禁取消，晚到已确认提交即使IPC收尾reject仍保提交事实', async () => {
    const pending = deferred<any>(), run = vi.fn((_input: Parameters<ResultInsertServices['apply']>[0]) => pending.promise), f = await mountDialog({ apply: run }); await targetReady(); await click(text.preview); await acknowledge(); await click(text.apply); await f.emit(fact({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, phase: 'committing', outcome: 'unknown' })); expect(button(text.cancel).disabled).toBe(true); await f.emit(fact({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, phase: 'releasing', rows: 3, outcome: 'committed' })); expect(doc.body.textContent).toContain(text.committed(3)); expect(f.onCommitted).not.toHaveBeenCalled(); await act(async () => pending.reject(Error('晚到清理失败'))); expect(f.onCommitted).toHaveBeenCalledOnce(); expect(doc.body.textContent).toContain(text.committedCleanup); expect(f.cancel).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledOnce();
  });
  it('无明确回滚ACK的写入失败显示未知且旧preview永不重放', async () => {
    const f = await mountDialog({ apply: vi.fn(async () => { throw Error('连接中断'); }) }); await targetReady(); await click(text.preview); await acknowledge(); await click(text.apply); expect(doc.body.textContent).toContain(text.unknown); expect(button(text.apply).disabled).toBe(true); expect(button(text.preview).disabled).toBe(true); expect(f.onCommitted).not.toHaveBeenCalled(); await click(text.close); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('明确受保护回滚ACK才报告rolled-back，apply原Promise/取消ACK仍必须双终态', async () => {
    const pending = deferred<any>(), ack = deferred<unknown>(), run = vi.fn((_input: Parameters<ResultInsertServices['apply']>[0]) => pending.promise), f = await mountDialog({ apply: run, cancel: vi.fn(() => ack.promise) }); await targetReady(); await click(text.preview); await acknowledge(); await click(text.apply); await click(text.cancel); await f.emit(fact({ dmlMayHaveBeenSent: true, rollbackAcknowledged: true, transactionProtected: true, phase: 'finished', outcome: 'rolled-back' })); await click(text.close); await act(async () => pending.reject(Error('实际回滚终结'))); expect(f.onClose).not.toHaveBeenCalled(); await act(async () => ack.resolve(undefined)); expect(f.onClose).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledOnce(); expect(f.onCommitted).not.toHaveBeenCalled();
  });
  it('来源失效永久撤销；关闭等待中的已确认成功仍通知原owner', async () => {
    const pending = deferred<any>(), run = vi.fn((_input: Parameters<ResultInsertServices['apply']>[0]) => pending.promise), f = await mountDialog({ apply: run }); await targetReady(); await click(text.preview); await acknowledge(); await click(text.apply); await f.emit(fact({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, phase: 'committing', outcome: 'unknown' })); await act(async () => f.intent.invalidate()); await click(text.close); expect(f.onClose).not.toHaveBeenCalled(); await act(async () => pending.resolve({ target: { connectionId: 'target', database: 'db', table: 'dest' }, rows: 3, outcome: 'committed', commitAcknowledged: true })); expect(f.onCommitted).toHaveBeenCalledOnce(); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.cancel).not.toHaveBeenCalled();
  });
  it('外来模态出现后即使移除仍不能接纳旧预览，准确原token必须释放', async () => {
    const f = await mountDialog(); await targetReady(); await click(text.preview); await acknowledge(); const oldApply = callback(button(text.apply)), foreign = doc.createElement('div'); foreign.setAttribute('role', 'dialog');
    await act(async () => { doc.body.appendChild(foreign); for (const observer of [...observers]) observer([{ addedNodes: [foreign] }]); });
    await act(async () => { doc.body.removeChild(foreign); for (const observer of [...observers]) observer([]); oldApply(); });
    expect(f.intent.current()).toBe(false); expect(f.apply).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.stale); await click(text.close); expect(f.release).toHaveBeenCalledOnce(); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('卸载不丢原任务晚到提交ACK，原RPC收尾前不提前退订或解锁', async () => {
    const pending = deferred<any>(), run = vi.fn((_input: Parameters<ResultInsertServices['apply']>[0]) => pending.promise), f = await mountDialog({ apply: run }); await targetReady(); await click(text.preview); await acknowledge(); await click(text.apply);
    await f.emit(fact({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, phase: 'committing', outcome: 'unknown' })); await act(async () => root!.unmount()); root = undefined;
    expect(f.onActivity.mock.calls.at(-1)).toEqual([1]); await f.emit(fact({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, rows: 3, totalRows: 3, phase: 'releasing', outcome: 'committed' }));
    await act(async () => pending.reject(Error('卸载后的晚到收尾失败'))); expect(f.onCommitted).toHaveBeenCalledExactlyOnceWith({ target: { connectionId: 'target', database: 'db', table: 'dest' }, rows: 3, outcome: 'committed', commitAcknowledged: true }); expect(f.onActivity.mock.calls.at(-1)).toEqual([-1]); expect(f.cancel).not.toHaveBeenCalled();
  });
});

describe('QueryTab正式入口完整结果快照RAM（原查询仅初始化执行一次）', () => {
  async function mountQuery() {
    seed(); const calls: { command: string; input: any }[] = [], events = new Set<(event: TaskEvent) => void>(), source = data();
    const result = { ...source, columns: source.columns.map(column => ({ ...column, type: column.key === 'id' ? 'BIGINT' : column.key === 'amount' ? 'DECIMAL' : column.key === 'bytes' ? 'BLOB' : 'TEXT' })), statement: 'SELECT 保留原稿', elapsedMs: 1 };
    (window as any).dbark = { onMenu: () => () => {}, onTask: (listener: (event: TaskEvent) => void) => { events.add(listener); return () => events.delete(listener); }, invoke: async (command: string, input: any) => {
      calls.push({ command, input }); if (['settings.save', 'connections.open', 'sessions.close', 'result.insertRelease', 'query.cancel'].includes(command)) return; if (command === 'sessions.open') return { sessionId: 'original-session' }; if (command === 'query.completionState') return { databaseKnown: true, database: null, temporaryObjects: [] }; if (command === 'query.execute') return { results: [result], elapsedMs: 1, transactionOpen: false };
      if (command === 'metadata.databases') return ['db']; if (command === 'metadata.objects') return [{ name: 'dest', kind: 'table' }]; if (command === 'metadata.table') return info(); if (command === 'result.insertPreview') return output(input); if (command === 'result.insertApply') return { target: { connectionId: input.connectionId, database: 'db', table: 'dest' }, rows: 1, outcome: 'committed', commitAcknowledged: true }; throw Error('禁止其它IO：' + command);
    } };
    function Harness() { const tabs = store(state => state.settings.tabs); return <>{tabs.map(tab => <QueryTab key={tab.id} tab={tab} onHistory={() => {}}/>)}</>; }
    const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<Harness/>)); await click(zh.query.text010); return { calls, result };
  }
  it('当前排序/筛选后的勾选typed行进入独立用途，目录/预览不重发原SQL且父选择/原稿保留', async () => {
    const f = await mountQuery(); await act(async () => grid.props.onSortChange([{ column: 'id', direction: 'DESC' }])); const beforeFilter = grid.props;
    await act(async () => beforeFilter.onFilterCell({ index: 0, row: beforeFilter.rows[0], column: beforeFilter.columns[0] }, 'ne')); await click(filterText.apply); expect(grid.props.rows.map((row: any) => row.id)).toEqual(['9007199254740994', '9007199254740993']);
    await act(async () => grid.props.onSelectionChange({ scope: grid.props.selectionScope, columns: grid.props.columns, rows: grid.props.rows, indices: new Set([1]) })); const original = store.getState().settings.tabs[0], rows = grid.props.rows, binding = grid.props.selectionScope, count = f.calls.length;
    await click(text.selected); expect(f.calls).toHaveLength(count); await targetReady(); await click(text.preview); const preview = f.calls.find(call => call.command === 'result.insertPreview')!.input; expect(preview.data.rows.map((row: any) => row.id)).toEqual(['9007199254740993']); expect(preview.data.rows[0].amount).toBe('9007199254740993.123456789012'); expect(preview.data.rows[0].bytes).toEqual({ type: 'binary', base64: 'AP8=' });
    expect(f.calls.filter(call => call.command === 'query.execute')).toHaveLength(1); await click(text.close); expect(store.getState().settings.tabs[0]).toBe(original); expect(grid.props.rows).toBe(rows); expect(grid.props.selectionScope).toBe(binding); expect(button(text.selected).disabled).toBe(false);
  });
  it('源连接修订/标签ABA撤销原预览，换回原值仍不能确认写入', async () => {
    const f = await mountQuery(); await click(text.open); await targetReady(); await click(text.preview); await act(async () => { store.setState({ connectionVersions: { source: 2, target: 1 } }); store.setState({ connectionVersions: { source: 1, target: 1 } }); }); expect(button(text.apply).disabled).toBe(true); expect(doc.body.textContent).toContain(text.stale); expect(f.calls.some(call => call.command === 'result.insertApply')).toBe(false); await click(text.close); expect(f.calls.filter(call => call.command === 'query.execute')).toHaveLength(1);
  });
});
