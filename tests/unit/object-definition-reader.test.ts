import { describe, expect, it, vi } from 'vitest';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import type { ObjectDefinitionInput, ObjectDefinitionOutput } from '../../src/shared/objectDefinition';
import type { PhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
import { ObjectDefinitionReader, type ObjectDefinitionView } from '../../src/renderer/objectDefinitionReader';
import { objectDefinitionZh as text } from '../../src/renderer/locales/objectDefinition.zh-CN';

/** 显式控制原请求和取消ACK两个独立终态，不用计时器推测异步动作已经结束。 */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const source = 'SELECT * FROM target';
const physical: PhysicalObjectAnalysis = { status: 'ready', target: { start: 14, end: 20 }, object: { table: 'target', tableRange: { start: 14, end: 20 } } };

/** 端口只返回内存快照；测试不创建真实Worker、不接触数据库、系统输入或全局工作区。 */
function fixture(options: { dialect?: 'mysql' | 'mariadb' | 'sqlite'; session?: boolean; holdRead?: boolean; holdCancel?: boolean; holdWorker?: boolean } = {}) {
  const dialect = options.dialect ?? 'mysql', session = options.session !== false;
  const state: CompletionSessionState = { databaseKnown: true, database: dialect === 'sqlite' ? 'main' : 'actual_database', dialect, serverVersion: dialect === 'sqlite' ? '3.50.0' : '8.0.36', objectsRevision: 3, ansiQuotes: false, noBackslashEscapes: true, busy: false, broken: false };
  const scope = { connectionId: '原查询连接', connectionVersion: 4, database: '旧标签库', ...(session ? { sessionId: '原查询会话' } : {}) };
  let alive = true, owns = true;
  const backend = deferred<ObjectDefinitionOutput>(), acknowledgement = deferred<unknown>(), workerReply = deferred<PhysicalObjectAnalysis>();
  const readSeen = deferred<void>(), cancelSeen = deferred<void>(), workerSeen = deferred<void>();
  const views: ObjectDefinitionView[] = [];
  const lease = { owns: vi.fn(() => owns), release: vi.fn(() => { owns = false; }) };
  const facts = { dialect, version: state.serverVersion! };
  const output = (request: ObjectDefinitionInput): ObjectDefinitionOutput => ({ request: { ...request }, database: request.database ?? (dialect === 'sqlite' && session ? 'temp' : 'main'), name: request.table, kind: dialect === 'sqlite' ? 'view' : 'table', temporary: dialect === 'sqlite' && session && !request.database, ddl: dialect === 'sqlite' ? 'CREATE VIEW target AS SELECT 1' : 'CREATE TABLE target(id INT)', ...(session ? { revision: 3 } : {}) });
  const worker = {
    object: vi.fn(async (_source: string, _offset: number, _mode: unknown, signal: AbortSignal, _caps: unknown): Promise<PhysicalObjectAnalysis> => {
      workerSeen.resolve();
      if (!options.holdWorker) return physical;
      signal.addEventListener('abort', () => workerReply.resolve({ status: 'blocked', reason: 'cancelled' }), { once: true });
      return workerReply.promise;
    }),
    dispose: vi.fn(),
  };
  const ports = {
    source, offset: 16, dialect, scope,
    current: vi.fn(() => alive), acquire: vi.fn(() => lease), facts: vi.fn(() => facts),
    state: vi.fn(async (_id: string) => ({ ...state })), create: vi.fn(() => worker),
    read: vi.fn(async (input: ObjectDefinitionInput) => { readSeen.resolve(); return options.holdRead ? backend.promise : output(input); }),
    cancel: vi.fn(async (_taskId: string) => { cancelSeen.resolve(); return options.holdCancel ? acknowledgement.promise : undefined; }),
    id: vi.fn(() => '唯一编号'), changed: vi.fn((view: ObjectDefinitionView) => { views.push(view); }), cleanup: vi.fn(),
  };
  const reader = new ObjectDefinitionReader(ports);
  return { reader, ports, state, facts, lease, worker, views, backend, acknowledgement, workerReply, readSeen, cancelSeen, workerSeen, output, alive: (value: boolean) => { alive = value; }, owns: (value: boolean) => { owns = value; }, last: () => views.at(-1)! };
}

describe('显式对象定义读取控制器', () => {
  it('原会话模式和可靠默认库优先旧标签库，能力只取原session事实', async () => {
    const f = fixture(); await f.reader.start();
    expect(f.worker.object).toHaveBeenCalledWith(source, 16, { ansiQuotes: false, noBackslashEscapes: true }, expect.any(AbortSignal), { lateralDerivedTables: true, windowFunctions: true, insertRowAliases: true });
    expect(f.ports.read).toHaveBeenCalledExactlyOnceWith({ connectionId: '原查询连接', sessionId: '原查询会话', database: 'actual_database', table: 'target', taskId: 'object-definition:唯一编号' });
    expect(f.ports.state.mock.calls.every(([id]) => id === '原查询会话')).toBe(true);
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.lease.release).toHaveBeenCalledOnce(); expect(f.last().output?.database).toBe('actual_database');
  });
  it.each([
    ['mysql', 'mariadb', true], ['mariadb', 'mysql', true],
    ['mysql', 'mariadb', false], ['mariadb', 'mysql', false],
  ] as const)('配置%s与实际%s兼容（session=%s），能力采用实际家族和版本', async (configured, actual, session) => {
    const f = fixture({ dialect: configured, session });
    const version = actual === 'mariadb' ? '11.4.1-MariaDB' : '8.0.36';
    f.state.dialect = actual; f.state.serverVersion = version; f.facts.dialect = actual; f.facts.version = version;
    await f.reader.start();
    expect(f.ports.read).toHaveBeenCalledOnce(); expect(f.last().error).toBe(''); expect(f.last().output).toBeDefined();
    expect(f.worker.object.mock.calls[0][4]).toEqual({ lateralDerivedTables: actual === 'mysql', windowFunctions: true, insertRowAliases: actual === 'mysql' });
  });
  it('SQLite与网络协议仍严格隔离，不借另一方服务器状态创建分析线程', async () => {
    const sqlite = fixture({ dialect: 'sqlite' }); sqlite.state.dialect = 'mysql'; await sqlite.reader.start();
    expect(sqlite.ports.create).not.toHaveBeenCalled(); expect(sqlite.last().error).toBe(text.context);
    const network = fixture({ dialect: 'mysql', session: false }); network.facts.dialect = 'sqlite'; await network.reader.start();
    expect(network.ports.create).not.toHaveBeenCalled(); expect(network.last().error).toBe(text.context);
  });
  it('物理限定库优先原会话默认库，读取目标只来自原查询scope', async () => {
    const f = fixture();
    f.ports.source = 'SELECT * FROM chosen.target'; f.ports.offset = 23;
    const selected: PhysicalObjectAnalysis = { status: 'ready', target: { start: 21, end: 27 }, object: { table: 'target', database: 'chosen', tableRange: { start: 21, end: 27 }, databaseRange: { start: 14, end: 20 } } };
    f.worker.object.mockResolvedValue(selected);
    // 捕获来源发生在构造时，因此为限定名建立自己的原查询实例。
    const reader = new ObjectDefinitionReader(f.ports); await reader.start();
    expect(f.ports.read.mock.calls[0][0].database).toBe('chosen');
    expect(f.ports.read.mock.calls[0][0].connectionId).toBe('原查询连接');
  });
  it('SQLite未限定schema不套用scope库，交原会话按TEMP优先确认视图', async () => {
    const f = fixture({ dialect: 'sqlite' }); await f.reader.start();
    expect(f.ports.read.mock.calls[0][0]).not.toHaveProperty('database');
    expect(f.last().output).toMatchObject({ database: 'temp', temporary: true, kind: 'view' });
    expect(f.worker.object.mock.calls[0][2]).toEqual({});
  });
  it('无session按保存连接事实派生能力，模式保持未知且不创建用户会话', async () => {
    const f = fixture({ session: false }); await f.reader.start();
    expect(f.ports.state).not.toHaveBeenCalled(); expect(f.ports.read.mock.calls[0][0]).not.toHaveProperty('sessionId');
    expect(f.ports.read.mock.calls[0][0].database).toBe('旧标签库');
    expect(f.worker.object.mock.calls[0][2]).toEqual({}); expect(f.worker.object.mock.calls[0][4]).toMatchObject({ insertRowAliases: true });
  });
  it.each(['busy', 'broken', 'mode'] as const)('会话%s状态不猜模式或建立解析线程', async kind => {
    const f = fixture(); if (kind === 'mode') f.state.ansiQuotes = undefined; else f.state[kind] = true;
    await f.reader.start(); expect(f.ports.create).not.toHaveBeenCalled(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.context);
  });
  it('未知默认库不回退旧标签库；无session未知scope库也不投递读取', async () => {
    for (const session of [true, false]) {
      const f = fixture({ session }); f.state.databaseKnown = false;
      const ports = { ...f.ports, scope: { ...f.ports.scope, databaseUnknown: true } };
      await new ObjectDefinitionReader(ports).start(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.context);
    }
  });
  it('解析后先释放独占线程，再核session变化，旧分析不进入后端', async () => {
    const f = fixture({ holdWorker: true }); const pending = f.reader.start(); await f.workerSeen.promise;
    f.state.objectsRevision = 4; f.workerReply.resolve(physical); await pending;
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.stale);
  });
  it('定义读取后session代次变化，晚回包不显示', async () => {
    const f = fixture({ holdRead: true }); const pending = f.reader.start(); await f.readSeen.promise;
    f.state.objectsRevision = 4; f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await pending;
    expect(f.last().output).toBeUndefined(); expect(f.last().error).toBe(text.stale);
  });
  it('源码模型变化后即使current恢复也保留墓碑，晚定义不显示', async () => {
    const f = fixture({ holdRead: true }); const pending = f.reader.start(); await f.readSeen.promise;
    f.alive(false); f.reader.observe(); f.alive(true); f.reader.activate();
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await pending;
    expect(f.ports.cancel).toHaveBeenCalledExactlyOnceWith('object-definition:唯一编号'); expect(f.last().output).toBeUndefined(); expect(f.last().error).toBe(text.stale);
    await f.reader.start(); expect(f.ports.read).toHaveBeenCalledOnce();
  });
  it('取消ACK先到仍等原读取Promise，期间不归还busy租约', async () => {
    const f = fixture({ holdRead: true, holdCancel: true }); const pending = f.reader.start(); await f.readSeen.promise;
    const stopped = f.reader.stop(); await f.cancelSeen.promise; f.acknowledgement.resolve(undefined);
    await Promise.resolve(); expect(f.lease.release).not.toHaveBeenCalled(); expect(f.last()).toMatchObject({ busy: true, stopping: true });
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await Promise.all([pending, stopped]);
    expect(f.lease.release).toHaveBeenCalledOnce(); expect(f.last()).toMatchObject({ busy: false, stopping: false, error: text.cancelled }); expect(f.last().output).toBeUndefined();
  });
  it('原读取先到仍等取消ACK，重复停止仅取消自己的同一编号一次', async () => {
    const f = fixture({ holdRead: true, holdCancel: true }); const pending = f.reader.start(); await f.readSeen.promise;
    const stop = f.reader.stop(); void f.reader.stop(); await f.cancelSeen.promise;
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0]));
    await Promise.resolve(); await Promise.resolve(); expect(f.lease.release).not.toHaveBeenCalled();
    f.acknowledgement.resolve(undefined); await Promise.all([pending, stop]); expect(f.ports.cancel).toHaveBeenCalledOnce(); expect(f.last().output).toBeUndefined();
  });
  it('取消失败走cleanup且仍等原读取，不泄露错误或自动重试', async () => {
    const f = fixture({ holdRead: true, holdCancel: true }); const pending = f.reader.start(); await f.readSeen.promise;
    const stopped = f.reader.stop(); await f.cancelSeen.promise; f.acknowledgement.reject(Error('敏感取消失败SQL'));
    await Promise.resolve(); await Promise.resolve(); expect(f.lease.release).not.toHaveBeenCalled();
    f.backend.reject(Error('敏感读取失败SQL')); await Promise.all([pending, stopped]);
    expect(f.ports.cleanup).toHaveBeenCalledOnce(); expect(f.last().error).toBe(text.cancelled); await f.reader.start(); expect(f.ports.read).toHaveBeenCalledOnce();
  });
  it('租约短暂交给继任者后不能ABA复活，旧owner释放不影响继任busy', async () => {
    const f = fixture({ holdRead: true }); let owner = '原';
    f.lease.owns.mockImplementation(() => owner === '原'); f.lease.release.mockImplementation(() => { if (owner === '原') owner = ''; });
    const pending = f.reader.start(); await f.readSeen.promise; owner = '继任'; f.reader.observe(); owner = '原'; f.reader.observe(); owner = '继任';
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await pending;
    expect(owner).toBe('继任'); expect(f.last().output).toBeUndefined(); expect(f.last().error).toBe(text.stale);
  });
  it('卸载撤销changed发布，原读取和ACK终态前继续保留租约', async () => {
    const f = fixture({ holdRead: true, holdCancel: true }); const pending = f.reader.start(); await f.readSeen.promise;
    f.reader.dispose(); const count = f.views.length; await f.cancelSeen.promise;
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await Promise.resolve(); expect(f.lease.release).not.toHaveBeenCalled();
    f.acknowledgement.resolve(undefined); await pending;
    expect(f.views).toHaveLength(count); expect(f.lease.release).toHaveBeenCalledOnce();
  });
  it('解析期间卸载立即停止专属worker，不发送backend取消；strict activate不重跑', async () => {
    const f = fixture({ holdWorker: true }); const pending = f.reader.start(); await f.workerSeen.promise;
    f.reader.dispose(); f.reader.activate(); await pending; await f.reader.start();
    expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.ports.cancel).not.toHaveBeenCalled(); expect(f.ports.create).toHaveBeenCalledOnce();
  });
  it('同帧双击和acquire同步observe只分配一个owner', async () => {
    const f = fixture(); f.ports.acquire.mockImplementation(() => { f.reader.observe(); return f.lease; });
    const first = f.reader.start(), second = f.reader.start(); expect(first).toBe(second); await first;
    expect(f.ports.acquire).toHaveBeenCalledOnce(); expect(f.ports.create).toHaveBeenCalledOnce(); expect(f.ports.read).toHaveBeenCalledOnce();
  });
  it('回包错目标整份拒绝，错误文字不会带入SQL或原始异常', async () => {
    const f = fixture(); f.ports.read.mockImplementation(async input => ({ ...f.output(input), name: '另一个表' }));
    await f.reader.start(); expect(f.last().output).toBeUndefined(); expect(f.last().error).toBe(text.invalid);
    const failed = fixture(); failed.ports.read.mockRejectedValue(Error('SELECT 密码 FROM secret')); await failed.reader.start(); expect(failed.last().error).toBe(text.failed);
  });
  it('无会话facts短暂变化被observe永久撤销，不把旧能力用于晚读取', async () => {
    const f = fixture({ session: false, holdWorker: true }); const pending = f.reader.start(); await f.workerSeen.promise;
    f.facts.version = '8.0.10'; f.reader.observe(); f.facts.version = '8.0.36'; f.reader.observe(); await pending;
    expect(f.ports.read).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.stale);
  });
  it('等待原session缓存时切到另一连接再切回，也不建立晚worker', async () => {
    const f = fixture(), cache = deferred<CompletionSessionState>(); f.ports.state.mockReturnValue(cache.promise);
    const pending = f.reader.start(); await Promise.resolve();
    f.ports.scope.connectionId = '树选择的另一个连接'; f.reader.observe(); f.ports.scope.connectionId = '原查询连接'; f.reader.observe();
    cache.resolve({ ...f.state }); await pending;
    expect(f.ports.create).not.toHaveBeenCalled(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.stale);
  });
  it('source即使恢复原文也不能复活旧模型，关闭后不重放', async () => {
    const f = fixture({ holdRead: true }), pending = f.reader.start(); await f.readSeen.promise;
    f.ports.source = 'SELECT * FROM other'; f.reader.observe(); f.ports.source = source; f.reader.activate();
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await pending;
    expect(f.last().output).toBeUndefined(); expect(f.last().error).toBe(text.stale);
  });
  it('acquire失败不清除别人的busy，也不创建worker或发送取消', async () => {
    const f = fixture(); f.ports.acquire.mockImplementation(() => { throw Error('其它操作持有租约'); }); await f.reader.start();
    expect(f.last().error).toBe(text.busy); expect(f.lease.release).not.toHaveBeenCalled(); expect(f.ports.create).not.toHaveBeenCalled(); expect(f.ports.cancel).not.toHaveBeenCalled();
  });
  it('准备阶段同帧取消不发送尚不存在的任务，仍只结算原owner', async () => {
    const f = fixture(); const pending = f.reader.start(), stopped = f.reader.stop(); await Promise.all([pending, stopped]);
    expect(f.ports.acquire).not.toHaveBeenCalled(); expect(f.ports.read).not.toHaveBeenCalled(); expect(f.ports.cancel).not.toHaveBeenCalled(); expect(f.last().error).toBe(text.cancelled);
  });
  it('失效来源重复observe保持幂等，避免每次render引发新的等价view', async () => {
    const f = fixture({ holdRead: true }), pending = f.reader.start(); await f.readSeen.promise;
    f.alive(false); f.reader.observe(); const count = f.ports.changed.mock.calls.length;
    for (let index = 0; index < 20; index++) f.reader.observe();
    expect(f.ports.changed).toHaveBeenCalledTimes(count); expect(f.last()).toEqual({ busy: true, stopping: true, error: text.stale });
    f.backend.resolve(f.output(f.ports.read.mock.calls[0][0])); await pending;
    const terminalCount = f.ports.changed.mock.calls.length;
    for (let index = 0; index < 20; index++) f.reader.observe();
    expect(f.ports.changed).toHaveBeenCalledTimes(terminalCount); expect(f.ports.cancel).toHaveBeenCalledOnce();
  });
});
