import { randomUUID } from 'node:crypto';
import type { CommandMap, DatabaseObject, SqliteConnectionProfile, TaskEvent } from '../shared/contracts';
import { SqliteDriverError, SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteDriverLimits, type SqliteProcessTransport, type SqliteValue } from '../engine/sqlite/protocol';
import { createSqliteProcess } from './sqliteProcess';
import { SqliteQuerySession } from './sqliteQuerySession';
import { sqliteTablePageSchema, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import { readSqliteTablePage, SqliteTableBrowseCancelled } from './sqliteTableBrowse';

interface Resource { transport: SqliteProcessTransport; driver?: SqliteDriverSession; }
interface Connection {
  id: string; profile?: SqliteConnectionProfile; closing: boolean; blocked: boolean; failure?: unknown;
  pending: Set<Promise<unknown>>; resources: Set<Resource>; closeWork?: Promise<void>;
}
interface Session {
  connection: Connection; profile: SqliteConnectionProfile; query: SqliteQuerySession; driver: SqliteDriverSession;
  pending?: Promise<unknown>; closing: boolean; closeWork?: Promise<void>;
}
interface QueryTask { kind: 'query'; session: Session; active?: Promise<unknown>; }
interface BrowseTask {
  kind: 'browse'; connection: Connection; cancelled: boolean; boundaryCancelled: boolean; cleaning: boolean;
  resource?: Resource; driver?: SqliteDriverSession; active?: Promise<unknown>; cancelWork?: Promise<void>;
  cleanupFailure?: unknown; cancelFailure?: unknown;
}
interface FinishedBrowseTask { kind: 'browse-finished'; active?: undefined; }
type Task = QueryTask | BrowseTask | FinishedBrowseTask;
export interface SqliteRuntimeOptions {
  emit: (event: TaskEvent) => void;
  resolveProfile: (id: string) => SqliteConnectionProfile | undefined;
  createTransport?: () => SqliteProcessTransport;
}

/** 显示字段和临时选择令牌不影响物理目标；路径、只读属性及锁等待设置均属于连接身份。 */
function sameTarget(left: SqliteConnectionProfile, right: unknown): boolean {
  const next = right as SqliteConnectionProfile | undefined;
  return next?.dialect === 'sqlite' && left.id === next.id && left.sqlite.filePath === next.sqlite?.filePath
    && left.sqlite.readOnly === next.sqlite.readOnly && left.sqlite.busyTimeoutMs === next.sqlite.busyTimeoutMs;
}
/** 多项收尾必须全部尝试，最后保留每一个准确失败原因。 */
function failures(results: PromiseSettledResult<unknown>[], message: string): void {
  const reasons = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
  if (reasons.length) throw new AggregateError(reasons, message);
}

/** 原工作区的SQLite路由终点；不实例化网络引擎，不重连或重放任何用户SQL。 */
export class SqliteRuntime {
  private readonly connections = new Map<string, Connection>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Task>();
  private stopping = false;
  private closeWork?: Promise<void>;
  private forceWork?: Promise<void>;

  constructor(private readonly options: SqliteRuntimeOptions) {}

  /** 命名空间归属永久有效，迟到或未知的SQLite编号也不能进入mysql2。 */
  ownsSession(id: string): boolean { return typeof id === 'string' && id.startsWith('sqlite:'); }
  /** 历史任务编号仍属于原路由，旧取消不会影响下一项任务。 */
  ownsTask(id: string): boolean { return this.tasks.has(id); }
  /** 已知、打开中及关闭失败的连接均保留在本路由。 */
  ownsConnection(id: string): boolean { return this.connections.has(id); }

  /** Main已完成路径授权；这里仍检查配置形状，不接受内存库、缺失路径或其它方言。 */
  private profile(value: unknown, id?: string): SqliteConnectionProfile {
    const profile = value as SqliteConnectionProfile | undefined;
    if (!profile || profile.dialect !== 'sqlite' || !profile.id || id !== undefined && profile.id !== id
      || !profile.sqlite || !profile.sqlite.filePath || profile.sqlite.filePath.includes('\0')
      || profile.pendingFiles?.includes('sqliteDatabase') || typeof profile.sqlite.readOnly !== 'boolean'
      || !Number.isInteger(profile.sqlite.busyTimeoutMs) || profile.sqlite.busyTimeoutMs < 0 || profile.sqlite.busyTimeoutMs > 5000) throw Error('SQLite缺少Main授权的有效数据库文件配置');
    return structuredClone(profile);
  }
  /** 创建连接屏障必须先于异步打开；已开始关闭的连接不能被新请求复活。 */
  private connection(id: string): Connection {
    if (this.stopping) throw Error('SQLite运行时正在退出，不能开始新操作');
    if (typeof id !== 'string' || !id) throw Error('SQLite连接编号无效');
    let connection = this.connections.get(id);
    if (!connection) { connection = { id, closing: false, blocked: false, pending: new Set(), resources: new Set() }; this.connections.set(id, connection); }
    if (connection.closing || connection.blocked) throw Error('SQLite连接正在关闭或资源尚未确认释放，请先显式断开连接，不能开始新操作', { cause: connection.failure });
    return connection;
  }
  /** 未确认资源永久保留隔离；迟到exit本身不解除，只有显式连接close或forceClose可以解除。 */
  private block(connection: Connection, reason: unknown): void { connection.blocked = true; connection.failure ??= reason; }
  /** 在投递前占用连接，完成后才解除；拒绝不会丢弃仍未退出的transport。 */
  private track<T>(connection: Connection, action: () => Promise<T>): Promise<T> {
    const work = (async () => action())(); connection.pending.add(work);
    void work.then(() => connection.pending.delete(work), () => connection.pending.delete(work)); return work;
  }
  /** 工厂产生的每个准确对象都登记到真实exit，打开失败也不能只清理Promise。 */
  private async driver(connection: Connection, profile: SqliteConnectionProfile, readOnly = profile.sqlite.readOnly, register?: (resource: Resource) => void): Promise<SqliteDriverSession> {
    const owned: { resource?: Resource } = {};
    try {
      const driver = await SqliteDriverSession.open(() => {
        const transport = (this.options.createTransport ?? createSqliteProcess)();
        const resource: Resource = { transport }; owned.resource = resource; connection.resources.add(resource);
        void transport.exited.then(() => connection.resources.delete(resource), () => {});
        register?.(resource);
        return transport;
      }, { path: profile.sqlite.filePath!, readOnly, busyTimeoutMs: profile.sqlite.busyTimeoutMs });
      // 并发open始终绑定各自工厂闭包中的原对象，不能依赖资源集合顺序或PID。
      if (!owned.resource || !connection.resources.has(owned.resource)) {
        await driver.close(); throw new SqliteDriverError('SQLite打开期间准确资源已退出', 'SQLITE_PROCESS_EXIT', null, 0, driver.isClosed);
      }
      owned.resource.driver = driver;
      if (connection.blocked) { await driver.close(); throw Error('SQLite并发打开期间已有资源退出未确认，本次不发布会话'); }
      return driver;
    } catch (reason) { if (owned.resource && connection.resources.has(owned.resource)) this.block(connection, reason); throw reason; }
  }

  /** 短读使用独立driver；关闭确认优先于返回结果，关闭失败保留句柄和失败事实。 */
  private async short<T>(connection: Connection, profile: SqliteConnectionProfile, action: (driver: SqliteDriverSession) => Promise<T>, readOnly = profile.sqlite.readOnly): Promise<T> {
    const driver = await this.driver(connection, profile, readOnly);
    let value!: T, failed = false, failure: unknown;
    try { value = await action(driver); }
    catch (reason) { failed = true; failure = reason; if (!driver.isUsable && !driver.isClosed) this.block(connection, reason); }
    try { await driver.close(); }
    catch (reason) { if (!driver.isClosed) this.block(connection, reason); if (failed) throw new AggregateError([failure, reason], 'SQLite原操作失败且原driver关闭未确认', { cause: failure }); throw reason; }
    if (failed) throw failure; return value;
  }
  /** 只允许main；不把数据库选择翻译成ATTACH或MySQL USE。 */
  private database(database: unknown): void {
    if (database !== undefined && database !== null && database !== 'main') throw Error('SQLite原工作区目前只支持main数据库');
  }
  /** 每次元数据读取重新解析Main可信路径，禁止复用用户事务或渲染传入的profile。 */
  private metadata(input: any, action: (driver: SqliteDriverSession) => Promise<unknown>): Promise<unknown> {
    this.database(input.database);
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    return this.track(connection, () => this.short(connection, profile, action, true));
  }
  /** 已有连接身份不能因外部配置变化而静默更换；活动标签持有创建时的完整快照。 */
  private assertTarget(connection: Connection, profile: SqliteConnectionProfile): void {
    if (connection.profile && !sameTarget(connection.profile, profile)) throw Error('SQLite连接配置已变化，请先显式关闭原连接，现有会话未重连');
    connection.profile ??= structuredClone(profile);
  }
  /** 元数据仅执行固定参数化SQL，并对目录大小施加明确上限。 */
  private async rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[] = [], maxRows = 10001): Promise<SqliteValue[][]> {
    const rows: SqliteValue[][] = [];
    const result = await driver.execute(sql, { parameters, maxRows, maxBytes: 16 * 1024 * 1024, onBatch: batch => { rows.push(...batch.rows); } });
    if (result.statements.some(statement => statement.truncated)) throw Error('SQLite元数据超过读取预算，请缩小范围');
    return rows;
  }
  /** 会话关闭屏障与连接关闭屏障均先检查，状态查询仍可显示失效事实。 */
  private session(id: string, allowClosing = false): Session {
    const session = this.sessions.get(id);
    if (!session) throw Error('SQLite原查询会话不存在或已经关闭，不会自动重连');
    if (!allowClosing && (this.stopping || session.closing || session.connection.closing || session.connection.blocked)) throw Error('SQLite原查询会话正在关闭或资源尚未确认释放，不能开始新操作', { cause: session.connection.failure });
    return session;
  }
  /** 每个物理会话只有一个操作；在适配器异步进入前也保留忙态屏障。 */
  private sessionOperation<T>(session: Session, action: () => Promise<T>): Promise<T> {
    if (session.pending) return Promise.reject(Error('SQLite原查询会话已有运行操作'));
    const work = this.track(session.connection, async () => {
      try { return await action(); }
      catch (reason) { if (!session.driver.isUsable && !session.driver.isClosed) this.block(session.connection, reason); throw reason; }
    }); session.pending = work;
    void work.then(() => { if (session.pending === work) session.pending = undefined; }, () => { if (session.pending === work) session.pending = undefined; }); return work;
  }

  /** 新的只读分页任务和查询任务共享编号墓碑，但绝不共享查询会话及其事务。 */
  private tablePage(source: unknown): Promise<SqliteTablePage> {
    const input = sqliteTablePageSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const task: BrowseTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); };
    void work.then(retire, retire); return work;
  }
  /** 终态且准确exit之后只保留编号墓碑；未确认资源仍由原任务和连接账本持有。 */
  private retireBrowse(taskId: string, task: BrowseTask): void {
    if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && this.tasks.get(taskId) === task) this.tasks.set(taskId, { kind: 'browse-finished' });
  }
  /** 每个异步边界都重读取消与连接屏障，迟到open/元数据/SELECT不能发布或启动后继读取。 */
  private browseCheck(task: BrowseTask): void {
    if (task.cancelled || task.connection.closing || this.stopping) { task.boundaryCancelled = true; throw new SqliteTableBrowseCancelled(); }
    if (task.connection.blocked) throw Error('SQLite连接仍有退出未确认资源，表浏览未继续', { cause: task.connection.failure });
  }
  /** 只读任务在原driver回滚并关闭、准确进程exit确认后才交付最终Page。 */
  private async browse(task: BrowseTask, input: SqliteTablePageInput, profile: SqliteConnectionProfile): Promise<SqliteTablePage> {
    let value: SqliteTablePage | undefined, failed = false, failure: unknown;
    try {
      this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: '正在读取SQLite只读分页快照' });
      this.browseCheck(task);
      task.driver = await this.driver(task.connection, profile, true, resource => {
        task.resource = resource;
        // 原Promise先拒绝而exit迟到时，直到真实exit才可解除任务对utility对象的重引用。
        void resource.transport.exited.then(() => this.retireBrowse(input.taskId, task), () => {});
      });
      this.browseCheck(task);
      value = await readSqliteTablePage(task.driver, input, { check: () => this.browseCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; } });
    } catch (reason) {
      failed = true; failure = reason;
      if (task.driver && !task.driver.isUsable && !task.driver.isClosed) this.block(task.connection, reason);
    }
    if (task.driver) {
      task.cleaning = true;
      try { await task.driver.close(); }
      catch (reason) {
        task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(task.connection, reason);
        failure = failed ? new AggregateError([failure, reason], 'SQLite表浏览失败且原driver关闭未确认', { cause: failure }) : reason; failed = true;
      }
    }
    if (!failed) try { this.browseCheck(task); } catch (reason) { failed = true; failure = reason; }
    if (task.resource && task.connection.resources.has(task.resource)) {
      const reason = Error('SQLite表浏览准确进程退出尚未确认，保留原句柄', { cause: failure });
      this.block(task.connection, reason); task.cleanupFailure = reason;
      failure = failed ? new AggregateError([failure, reason], 'SQLite表浏览未完成且原资源退出未确认', { cause: failure }) : reason; failed = true;
    }
    if (failed) {
      const nativeCancelled = failure instanceof SqliteDriverError && ['SQLITE_CANCELLED', 'SQLITE_CANCELLED_SESSION_CLOSED'].includes(failure.code);
      const openingCancelled = task.cancelled && failure instanceof SqliteDriverError && failure.sessionClosed && failure.code === 'SQLITE_PROCESS_EXIT';
      const cancelled = !task.cleanupFailure && !task.cancelFailure && (failure instanceof SqliteTableBrowseCancelled || task.boundaryCancelled || nativeCancelled || openingCancelled);
      // 取消终态先于原Promise拒绝送达Main；未确认exit必须保持failed，不能被取消意图粉饰。
      try { this.options.emit({ taskId: input.taskId, status: cancelled ? 'cancelled' : 'failed', progress: 0, message: cancelled ? 'SQLite表浏览已取消' : failure instanceof Error ? failure.message : 'SQLite表浏览失败' }); } catch { /* 保留原只读结果/资源事实，不因终态通知异常重试。 */ }
      throw failure;
    }
    try { this.options.emit({ taskId: input.taskId, status: 'completed', progress: 100, rows: value!.result.rows.length, message: 'SQLite只读分页读取完成' }); } catch { /* 数据及准确资源终态已确认，不重放查询。 */ }
    return value!;
  }
  /** 打开中没有driver时也只终止本任务准确transport，并等待其真实exit而非猜测PID。 */
  private async stopOpening(task: BrowseTask): Promise<void> {
    const resource = task.resource; if (!resource || !task.connection.resources.has(resource)) return;
    try { resource.transport.terminate(); } catch { /* 终止调用异常仍以真实exit为准。 */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([resource.transport.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite表浏览打开取消后进程exit尚未确认，保留准确句柄')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]);
    } finally { clearTimeout(timer); }
  }
  /** 取消意图先同步登记，随后取消原driver并等原任务rollback/close；历史编号不会影响后继读取。 */
  private cancelBrowse(task: BrowseTask): Promise<void> {
    if (task.cancelWork) return task.cancelWork;
    if (!task.active) { task.cancelled = true; return Promise.resolve(); }
    task.cancelled = true;
    const work = (async () => {
      try {
        if (task.driver) { if (!task.cleaning) await task.driver.cancel(); } else await this.stopOpening(task);
        await task.active?.catch(() => {});
        if (task.cleanupFailure) throw task.cleanupFailure;
        if (task.resource && task.connection.resources.has(task.resource)) throw Error('SQLite表浏览取消后仍有退出未确认资源');
      } catch (reason) {
        task.cancelFailure = reason;
        if (task.resource && task.connection.resources.has(task.resource)) this.block(task.connection, reason);
        throw reason;
      }
    })();
    task.cancelWork = work; void work.catch(() => { if (task.cancelWork === work) task.cancelWork = undefined; }); return work;
  }

  /** 仅列出已经接入原工作区的命令；其余命令在SQLite终点明确拒绝。 */
  async request(command: string, input: any): Promise<any> {
    switch (command) {
      case 'connections.test': {
        const profile = this.profile(input), connection = this.connection(profile.id);
        return this.track(connection, () => this.short(connection, profile, async driver => ({ version: driver.version, dialect: 'sqlite' as const })));
      }
      case 'connections.open': {
        const profile = this.profile(input.profile ?? this.options.resolveProfile(input.id), input.id), connection = this.connection(profile.id);
        this.assertTarget(connection, profile);
        return this.track(connection, async () => {
          const status = await this.short(connection, profile, async driver => ({ version: driver.version, dialect: 'sqlite' as const }));
          if (connection.closing || connection.blocked || this.stopping) throw Error('SQLite打开期间连接已关闭或资源退出未确认，本次不发布连接');
          return status;
        });
      }
      case '__connections.prepareSave': {
        const connection = this.connections.get(input.id), next = input.profile;
        if (!next || next.id !== input.id) throw Error('SQLite配置检查缺少有效目标配置');
        const changed = input.transportChanged || connection && (!connection.profile || !sameTarget(connection.profile, next));
        if (!connection || !changed) return;
        if (connection.closing || connection.blocked || connection.pending.size || connection.resources.size || [...this.sessions.values()].some(session => session.connection === connection)) throw Error('SQLite连接仍有打开的会话、运行操作或未确认资源；请先显式关闭标签并断开连接，现有任务未取消');
        this.connections.delete(input.id); return;
      }
      case 'connections.close': return this.closeConnection(input.id);
      case 'sessions.open': {
        this.database(input.database);
        const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
        this.assertTarget(connection, profile);
        return this.track(connection, async () => {
          const driver = await this.driver(connection, profile);
          if (connection.closing || connection.blocked || this.stopping) { await driver.close(); throw Error('SQLite打开期间连接已关闭或资源退出未确认，本次不发布会话'); }
          const sessionId = 'sqlite:' + randomUUID();
          const query = new SqliteQuerySession(profile.id, driver, this.options.emit, sessionId);
          this.sessions.set(sessionId, { connection, profile, query, driver, closing: false }); return { sessionId };
        });
      }
      case 'sessions.close': { const session = this.sessions.get(input.sessionId); if (session) await this.closeSession(session); return; }
      case 'query.sessionState': return this.session(input.sessionId, true).query.state();
      case 'query.completionState': return this.session(input.sessionId, true).query.completionState();
      case 'query.execute': {
        const session = this.session(input.sessionId);
        if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || this.tasks.has(input.taskId)) throw Error('SQLite任务编号无效或已经使用');
        const task: QueryTask = { kind: 'query', session }; this.tasks.set(input.taskId, task);
        const work = this.sessionOperation(session, () => session.query.execute(input as CommandMap['query.execute']['input'])); task.active = work;
        void work.then(() => { task.active = undefined; }, () => { task.active = undefined; }); return work;
      }
      case 'query.transaction': { const session = this.session(input.sessionId, input.action === 'rollback'); return this.sessionOperation(session, () => session.query.transaction(input)); }
      case 'query.cancel': {
        const task = this.tasks.get(input.taskId);
        if (task?.active && task.kind === 'browse') return this.cancelBrowse(task);
        if (task?.active && task.kind === 'query') try { await task.session.query.cancel(input.taskId); }
        catch (reason) { if (!task.session.driver.isUsable && !task.session.driver.isClosed) this.block(task.session.connection, reason); throw reason; }
        return;
      }
      case 'sqlite.tablePage': return this.tablePage(input);
      case 'metadata.databases': return this.metadata(input, async () => ['main']);
      case 'metadata.objects': return this.metadata(input, async driver => {
        const rows = await this.rows(driver, "SELECT name,type FROM main.sqlite_schema WHERE type IN ('table','view','trigger') AND substr(name,1,7) <> 'sqlite_' ORDER BY type,name LIMIT 10001");
        if (rows.length > 10000) throw Error('SQLite对象数量超过10000，请缩小范围');
        return rows.map(row => ({ name: row[0], kind: row[1] })) as DatabaseObject[];
      });
      case 'metadata.ddl': return this.metadata(input, async driver => {
        if (typeof input.name !== 'string' || !input.name || !['table', 'view', 'trigger'].includes(input.kind)) throw Error('SQLite对象定义类型或名称无效');
        const rows = await this.rows(driver, 'SELECT sql FROM main.sqlite_schema WHERE name = ? AND type = ? AND substr(name,1,7) <> ? LIMIT 1', [input.name, input.kind, 'sqlite_'], 1);
        if (!rows.length || typeof rows[0][0] !== 'string') throw Error('SQLite对象不存在或没有可读取定义'); return rows[0][0];
      });
      default: throw Error('SQLite尚未接入此功能：' + command);
    }
  }

  /** 显式关闭标签先取消准确任务，并等待原execute消费者终态，然后关闭原driver。 */
  private closeSession(session: Session): Promise<void> {
    if (session.closeWork) return session.closeWork;
    session.closing = true;
    const work = (async () => {
      const active = [...this.tasks.entries()].filter(([, task]) => task.kind === 'query' && task.session === session && task.active);
      const cancelled = await Promise.allSettled(active.map(([id]) => session.query.cancel(id)));
      await Promise.allSettled(session.pending ? [session.pending] : []);
      failures(cancelled, 'SQLite取消尚未确认，保留原会话');
      try { await session.query.close(); }
      catch (reason) { if (!session.driver.isClosed) this.block(session.connection, reason); throw reason; }
      this.sessions.delete(session.query.sessionId);
    })();
    session.closeWork = work; void work.catch(() => { if (session.closeWork === work) session.closeWork = undefined; }); return work;
  }
  /** 先阻新建，再取消并等原操作；未知句柄只能保持隔离，不能以kill冒充正常释放。 */
  private closeConnection(id: string): Promise<void> {
    const connection = this.connections.get(id); if (!connection) return Promise.resolve();
    if (connection.closeWork) return connection.closeWork;
    connection.closing = true;
    const work = (async () => {
      const browse = [...this.tasks.values()].filter((task): task is BrowseTask => task.kind === 'browse' && task.connection === connection && !!task.active);
      const browseDrivers = new Set(browse.map(task => task.driver));
      const cancelled = await Promise.allSettled([...browse.map(task => this.cancelBrowse(task)), ...[...connection.resources].filter(resource => resource.driver?.isBusy && !browseDrivers.has(resource.driver)).map(resource => resource.driver!.cancel())]);
      await Promise.allSettled([...connection.pending]);
      const closed = await Promise.allSettled([...this.sessions.values()].filter(session => session.connection === connection).map(session => this.closeSession(session)));
      const drivers = await Promise.allSettled([...connection.resources].filter(resource => resource.driver).map(resource => resource.driver!.close()));
      failures([...cancelled, ...closed, ...drivers], 'SQLite连接收尾未全部确认，保留准确资源');
      if (connection.resources.size) throw Error('SQLite仍有未确认退出的准确句柄，连接保持关闭屏障', { cause: connection.failure });
      this.connections.delete(id);
    })();
    connection.closeWork = work; void work.catch(() => { if (connection.closeWork === work) connection.closeWork = undefined; }); return work;
  }
  /** 普通退出不因一例失败中断其它连接收尾，失败后仍可显式重试。 */
  close(): Promise<void> {
    if (this.closeWork) return this.closeWork;
    this.stopping = true;
    const work = (async () => { const results: PromiseSettledResult<unknown>[] = []; for (const id of this.connections.keys()) results.push(...await Promise.allSettled([this.closeConnection(id)])); failures(results, 'SQLite退出仍有连接资源未确认'); })();
    this.closeWork = work; void work.catch(() => { if (this.closeWork === work) this.closeWork = undefined; }); return work;
  }
  /** 强退只终止自己登记的准确transport，必须等真实exit；不通过PID或进程名扩大范围。 */
  forceClose(): Promise<void> {
    if (this.forceWork) return this.forceWork;
    this.stopping = true;
    const work = (async () => {
      for (const task of this.tasks.values()) if (task.kind === 'browse' && task.active) task.cancelled = true;
      const resources = [...this.connections.values()].flatMap(connection => { connection.closing = true; return [...connection.resources]; });
      for (const resource of resources) try { resource.transport.terminate(); } catch { /* 仍等待真实exit，终止调用异常不能跳过其它句柄。 */ }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(resources.map(resource => resource.transport.exited)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite强退尚未确认全部进程退出，保留准确句柄')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]);
        await Promise.allSettled([...this.connections.values()].flatMap(connection => [...connection.pending]));
        if ([...this.connections.values()].some(connection => connection.resources.size)) throw Error('SQLite强退资源账本仍未清零');
        this.sessions.clear(); this.connections.clear();
      } finally { clearTimeout(timer); }
    })();
    this.forceWork = work; void work.catch(() => { if (this.forceWork === work) this.forceWork = undefined; }); return work;
  }
}
