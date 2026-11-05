import { randomUUID } from 'node:crypto';
import type {
  ConnectionProfile,
  PostgresConnectionProfile,
  QueryOutcome,
  QueryResult,
  TaskEvent,
} from '../../shared/contracts';
import { connectionTransportChanged } from '../../shared/connectionProfile';
import { queryFailureMessage } from '../../shared/queryFailure';
import { validateQueryParameters, type QueryParameter } from '../../shared/queryParameters';
import {
  firstPostgresStatement,
  currentPostgresStatement,
  postgresIdentifier,
} from '../../shared/postgresSql';
import { PostgresConnection } from './connection';
import { PostgresTableWorkspace } from './tableWorkspace';
import { PostgresCreateTableWorkspace, postgresCreateSchemas } from './createTable';
import { readPostgresCompletion } from './completion';
import { readPostgresStructure } from './relationStructure';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../shared/postgresCompletion';
interface Session {
  id: string;
  connectionId: string;
  managed: PostgresConnection;
  pending?: Promise<unknown>;
  completion?: Promise<PostgresCompletionResult>;
  closing?: Promise<void>;
}
interface Task {
  id: string;
  session: Session;
  cancelled: boolean;
  sent: boolean;
  cancel?: Promise<void>;
  terminal: boolean;
}
interface Lease {
  managed: PostgresConnection;
  done: Promise<void>;
  finish(): void;
  failed: boolean;
  protectedFromAbort: boolean;
}
type Input = Record<string, any>;
/** PostgreSQL独立网络执行账本，共用utility隔离进程及TaskEvent，不进入mysql2或其SQL生成器。 */
export class PostgresEngine {
  private readonly completionReads = new Map<string, number>();
  private readonly creations = new PostgresCreateTableWorkspace();
  private readonly tables = new PostgresTableWorkspace();
  private readonly profiles = new Map<string, PostgresConnectionProfile>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Task>();
  private readonly completedTasks = new Set<string>();
  private readonly leases = new Set<Lease>();
  private readonly closing = new Set<string>();
  private stopping = false;
  constructor(private readonly emit: (event: TaskEvent) => void) {}
  ownsTask(id: string) {
    return this.tasks.has(id) || this.completedTasks.has(id);
  }
  /** 只按Main注入的方言或已登记准确身份路由，不根据SQL文本猜驱动。 */
  accepts(input: Input): boolean {
    return (
      input.dialect === 'postgresql' ||
      [input.profile, input.sourceProfile, input.targetProfile].some((p) => p?.dialect === 'postgresql') ||
      [input.id, input.connectionId, input.source?.connectionId, input.target?.connectionId].some(
        (id) => this.profiles.has(id) || this.tables.connectionIds().includes(id) || this.creations.connectionIds().includes(id) || [...this.leases].some((l) => l.managed.profile.id === id),
      ) ||
      this.sessions.has(input.sessionId) ||
      this.ownsTask(input.taskId)
    );
  }
  private profile(id: string): PostgresConnectionProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw Error('PostgreSQL连接尚未打开，请重新连接');
    return profile;
  }
  /** 在连接首个await前登记原资源；关闭失败保留账本，不能再次建连掩盖未收尾连接。 */
  private async use<T>(
    profile: PostgresConnectionProfile,
    database: string | undefined,
    action: (managed: PostgresConnection) => Promise<T>,
    retain = false,
    control = false,
    writing = false,
  ): Promise<T> {
    if (
      !control &&
      (this.stopping ||
        this.closing.has(profile.id) ||
        [...this.leases].some((l) => l.managed.profile.id === profile.id && l.failed))
    )
      throw Error('PostgreSQL连接正在关闭或仍有未确认资源');
    const managed = new PostgresConnection(profile, database || profile.database || 'postgres');
    let finish!: () => void;
    const lease: Lease = {
      managed,
      done: new Promise<void>((yes) => {
        finish = yes;
      }),
      finish: () => finish(),
      failed: false,
      protectedFromAbort: control || writing,
    };
    this.leases.add(lease);
    let kept = false;
    try {
      await managed.open();
      if (!control && (this.stopping || this.closing.has(profile.id))) throw Error('PostgreSQL连接已取消');
      const result = await action(managed);
      kept = retain;
      return result;
    } catch (reason) {
      throw managed.error(reason);
    } finally {
      try {
        if (!kept) await managed.close();
        this.leases.delete(lease);
      } catch (reason) {
        lease.failed = true;
        throw managed.error(reason);
      } finally {
        lease.finish();
      }
    }
  }
  private async session<T>(id: string, action: (session: Session) => Promise<T>, managesCompletion = false): Promise<T> {
    const session = this.sessions.get(id);
    if (!session || session.managed.broken) throw Error('PostgreSQL会话已失效，请核对写入结果后重新连接');
    if (this.stopping || this.closing.has(session.connectionId) || session.pending || session.closing) {
      throw Error('PostgreSQL会话仍有在途操作或正在关闭');
    }
    const pending = Promise.resolve().then(async () => {
      // 用户操作先占位，原目录读取真实收尾后才允许新的用户 SQL 上线。
      if (!managesCompletion && session.completion) await session.completion.catch(() => {});
      if (this.stopping || this.closing.has(session.connectionId) || session.closing || session.managed.broken)
        throw Error('PostgreSQL会话正在关闭或已失效');
      return action(session);
    });
    session.pending = pending;
    try {
      return await pending;
    } finally {
      if (session.pending === pending) session.pending = undefined;
    }
  }

  /** 关闭意图先阻止后继SQL，等待原操作和取消一起终结后再结束物理连接。 */
  private closeSession(session: Session): Promise<void> {
    if (session.closing) return session.closing;
    const close = Promise.resolve().then(async () => {
      const tasks = [...this.tasks.values()].filter(task => task.session === session && !task.terminal);
      await Promise.all(tasks.map(task => this.cancel(task)));
      await session.pending?.catch(() => {});
      await session.completion?.catch(() => {});
      await session.managed.close();
      this.sessions.delete(session.id);
    });
    session.closing = close;
    void close.catch(() => { if (session.closing === close) session.closing = undefined; });
    return close;
  }

  /** 原会话目录读取只在空闲时进入，失败事务和在途操作保持原样。 */
  private async completeSession(input: PostgresCompletionInput): Promise<PostgresCompletionResult> {
    const session = this.sessions.get(input.sessionId!);
    if (!session || session.connectionId !== input.connectionId || session.managed.database !== input.database ||
        session.managed.broken || session.closing || this.stopping || this.closing.has(input.connectionId))
      throw Error('PostgreSQL补全的原会话已变化');
    const state = session.managed.state();
    if (session.pending || session.completion || !state.transactionKnown) return { items: [], incomplete: false, deferred: 'busy' };
    if (state.transactionOpen) return { items: [], incomplete: false, deferred: 'transaction' };
    const pending = Promise.resolve().then(() => readPostgresCompletion(session.managed, input, true));
    session.completion = pending;
    try {
      return await pending;
    } finally {
      if (session.completion === pending) session.completion = undefined;
    }
  }

  /** 结果取消使用独立同身份连接请求原backend，ACK之后仍等原查询ReadyForQuery；不取消后继查询。 */
  private cancel(task: Task): Promise<void> {
    if (task.terminal) return Promise.resolve();
    if (task.cancel) return task.cancel;
    task.cancelled = true;
    // 尚在等待补全的任务没有后端 SQL，取消只能撤销自己的投递。
    if (!task.sent) return Promise.resolve();
    const original = task.session.managed;
    task.cancel = (async () => {
      const pid = original.processId,
        backendStart = original.backendStart;
      if (!pid || !backendStart) throw Error('PostgreSQL原backend身份未知，取消未投递');
      await this.use(
        original.profile,
        original.database,
        async (managed) => {
          if (task.terminal || original.broken) return;
          const result = await managed.query(
            'SELECT pg_catalog.pg_cancel_backend(pid) FROM pg_catalog.pg_stat_activity ' +
              'WHERE pid = $1 AND extract(epoch FROM backend_start)::text = $2',
            [pid, backendStart],
            { rows: 1, bytes: 1024 },
          );
          if (result.rows[0]?.c0 !== 't' && !task.terminal) throw Error('PostgreSQL原查询取消未确认');
        },
        false,
        true,
      );
    })();
    return task.cancel;
  }
  /** 显式断开先等准确在途终态，再正常关闭全部会话；失败保留原对象供核对或重试。 */
  private async closeConnection(id: string): Promise<void> {
    if (this.closing.has(id)) throw Error('PostgreSQL连接正在关闭');
    this.closing.add(id);
    try {
      const leases = [...this.leases].filter((l) => l.managed.profile.id === id);
      for (const lease of leases) if (!lease.failed && !lease.protectedFromAbort) lease.managed.abort();
      const sessions = [...this.sessions.values()].filter(session => session.connectionId === id);
      await Promise.all(sessions.map(session => this.closeSession(session)));
      await Promise.all(leases.map(lease => lease.done));
      for (const lease of leases) {
        await lease.managed.close();
        this.leases.delete(lease);
      }
      this.tables.clear(id);
      this.creations.clear(id);
      this.profiles.delete(id);
    } finally {
      this.closing.delete(id);
    }
  }
  /** 修改配置检查所有会话及建连租约，名称／颜色更新不撤销原连接。 */
  prepareSave(input: Input): void {
    const next = input.profile as ConnectionProfile,
      old = this.profiles.get(input.id);
    if (!next || next.id !== input.id) throw Error('PostgreSQL连接配置身份无效');
    const changed =
      input.transportChanged ||
      (old && connectionTransportChanged(old, next, { preserveMissingSecrets: false }));
    if (
      changed &&
      ([...this.sessions.values()].some((s) => s.connectionId === input.id) ||
        [...this.leases].some((l) => l.managed.profile.id === input.id))
    )
      throw Error('该PostgreSQL连接仍有会话或未确认资源，请先关闭标签并显式断开');
    if (changed) {
      this.tables.clear(input.id);
      this.creations.clear(input.id);
      this.profiles.delete(input.id);
    }
  }
  async closeAll(): Promise<void> {
    this.stopping = true;
    try {
      for (const id of new Set([
        ...this.profiles.keys(),
        ...this.tables.connectionIds(),
        ...this.creations.connectionIds(),
        ...[...this.leases].map((l) => l.managed.profile.id),
        ...[...this.sessions.values()].map((s) => s.connectionId),
      ]))
        await this.closeConnection(id);
    } finally {
      this.stopping = false;
    }
  }
  /** 原脚本逐句执行，精确保留已完成结果；首错停止、取消或断线均不自动回滚和重放。 */
  private async execute(session: Session, input: Input): Promise<QueryOutcome> {
    if (!input.taskId || this.ownsTask(input.taskId) || this.tasks.size >= 8192)
      throw Error('PostgreSQL任务编号已使用或登记已满');
    if (input.continueOnError || input.collectWarnings)
      throw Error('PostgreSQL尚未实现遇错继续或MySQL诊断采集');
    const task: Task = { id: input.taskId, session, cancelled: false, sent: false, terminal: false };
    this.tasks.set(task.id, task);
    const started = performance.now(),
      results: QueryResult[] = [],
      budget = { rows: input.maxRows, bytes: 16 * 1024 * 1024 };
    let offset = 0,
      count = 0,
      failure: QueryOutcome['failure'];
    this.emit({ taskId: task.id, status: 'running', progress: 0, message: '正在执行PostgreSQL脚本' });
    try {
      // 先登记可取消任务，再等待已占用原会话的目录读取。
      if (session.completion) await session.completion.catch(() => {});
      if (task.cancelled) throw Error('PostgreSQL任务在等待补全时已取消，未发送用户 SQL');
      if (this.stopping || this.closing.has(session.connectionId) || session.closing || session.managed.broken)
        throw Error('PostgreSQL会话正在关闭或已失效，未发送用户 SQL');
      const source = String(input.sql);
      let selected = input.currentStatement
        ? currentPostgresStatement(source, input.currentStatement.offset, session.managed.standardStrings)
        : undefined;
      while (true) {
        if (task.cancelled) throw Error('PostgreSQL任务已取消，已执行语句未重放');
        const part =
          selected ?? firstPostgresStatement(source.slice(offset), session.managed.standardStrings);
        if (!part) break;
        if (++count > 1000) throw Error('PostgreSQL脚本最多1000条语句');
        if (part.keyword === 'COPY')
          throw Error('PostgreSQL COPY数据流需专用导入导出接口，当前SQL执行未发送此语句');
        const statementOffset = selected ? 0 : offset;
        this.emit({
          taskId: task.id,
          status: 'running',
          progress: 0,
          message: '正在执行PostgreSQL第' + count + '条语句',
          executionSql: part.sql,
          executionDatabase: { state: 'known', database: session.managed.database },
        });
        let parameters: unknown[] | undefined;
        if (input.parameters) {
          const values = input.parameters as QueryParameter[];
          validateQueryParameters(values);
          const max = part.parameters.at(-1) ?? 0;
          if (max !== values.length || part.parameters.some((n, i) => n !== i + 1))
            throw Error('PostgreSQL参数必须连续使用$1至$N，名称为p1至pN');
          parameters = values.map((p, i) => {
            if (p.name !== 'p' + (i + 1)) throw Error('PostgreSQL参数顺序或名称已变化');
            if (p.type === 'null') return null;
            if (p.type === 'binary') return Buffer.from(p.value!, 'hex');
            return p.value!;
          });
          if (firstPostgresStatement(source.slice(part.end + 1), session.managed.standardStrings))
            throw Error('PostgreSQL参数查询一次只能执行一条语句');
        }
        task.sent = true;
        const index = results.length,
          result = await session.managed.query(part.sql, parameters, budget, (batch, columns) =>
            this.emit({
              taskId: task.id,
              status: 'running',
              progress: 0,
              message: '正在读取PostgreSQL结果',
              resultIndex: index,
              columns,
              batch,
            }),
          );
        results.push(result);
        if (selected) break;
        offset = statementOffset + part.end + 1;
        if (offset >= source.length) break;
      }
    } catch (reason) {
      failure = {
        statementOrdinal: results.length + 1,
        statementsCompleted: results.length,
        message: queryFailureMessage(results.length, session.managed.error(reason).message),
      };
    } finally {
      task.terminal = true;
      try {
        if (task.cancel) await task.cancel;
      } catch {
        /* 取消请求单独返回错误；原SQL仍以自己的服务器回执为准。 */
      } finally {
        // 终态只保留有限的编号，已关闭会话的认证信息不被任务历史持有。
        this.tasks.delete(task.id);
        this.completedTasks.add(task.id);
        if (this.completedTasks.size > 8192) {
          const oldest = this.completedTasks.values().next().value;
          if (oldest !== undefined) this.completedTasks.delete(oldest);
        }
      }
    }
    this.emit({
      taskId: task.id,
      status: failure ? (task.cancelled ? 'cancelled' : 'failed') : 'completed',
      progress: 100,
      message: failure ? failure.message : 'PostgreSQL执行完成',
    });
    return {
      results,
      elapsedMs: performance.now() - started,
      transactionOpen: session.managed.state().transactionOpen,
      ...(failure ? { failure } : {}),
    };
  }
  /** 仅实现PostgreSQL拥有的真实命令；其余能力明确拒绝，绝不降级为MySQL SQL。 */
  async handle(command: string, input: Input): Promise<any> {
    switch (command) {
      case 'postgres.completion': {
        if (input.sessionId) return this.completeSession(input as PostgresCompletionInput);
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId) throw Error('缺少可信的 PostgreSQL 补全连接');
        const count = this.completionReads.get(profile.id) ?? 0;
        if (count >= 3) throw Error('该 PostgreSQL 连接的目录读取正忙');
        this.completionReads.set(profile.id, count + 1);
        try {
          return await this.use(profile, input.database, connection => readPostgresCompletion(connection, input as Parameters<typeof readPostgresCompletion>[1]));
        } finally {
          const remaining = (this.completionReads.get(profile.id) ?? 1) - 1;
          if (remaining) this.completionReads.set(profile.id, remaining);
          else this.completionReads.delete(profile.id);
        }
      }
      case 'postgres.createTable.schemas':
      case 'postgres.createTable.preview':
      case 'postgres.createTable.apply': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId || !input.owner ||
            !Number.isSafeInteger(input.connectionRevision)) throw Error('缺少可信的 PostgreSQL 建表连接和原文档');
        const connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing = false) =>
          this.use(profile, input.database, action, false, false, writing);
        if (command === 'postgres.createTable.schemas') return connect(postgresCreateSchemas);
        if (command === 'postgres.createTable.preview') return this.creations.prepare(input as Parameters<PostgresCreateTableWorkspace['prepare']>[0], connect);
        return this.creations.apply(input as Parameters<PostgresCreateTableWorkspace['apply']>[0], connect);
      }
      case 'postgres.structure.read': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId) throw Error('缺少可信的PostgreSQL结构连接');
        return this.use(profile, input.database, connection => readPostgresStructure(connection, input.table));
      }
      case 'postgres.table.page':
      case 'postgres.table.apply': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId || !input.owner ||
            !Number.isSafeInteger(input.connectionRevision)) throw Error('缺少可信的PostgreSQL表页连接及原文档');
        const connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing = false) =>
          this.use(profile, input.database, action, false, false, writing);
        return command === 'postgres.table.page' ? this.tables.page(input as Parameters<PostgresTableWorkspace['page']>[0], connect) : this.tables.apply(input as Parameters<PostgresTableWorkspace['apply']>[0], connect);
      }
      case 'postgres.table.preview':
        if (this.stopping || this.closing.has(input.connectionId)) throw Error('PostgreSQL连接正在关闭');
        return this.tables.preview(input as Parameters<PostgresTableWorkspace['preview']>[0]);
      case 'postgres.table.release':
        return this.tables.release(input as Parameters<PostgresTableWorkspace['release']>[0]);
      case 'connections.test':
        return this.use(input as PostgresConnectionProfile, undefined, async (m) => ({
          version: m.version,
          dialect: 'postgresql',
          connectionId: m.processId,
        }));
      case 'connections.open': {
        const profile = input.profile as PostgresConnectionProfile;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.id)
          throw Error('Main未提供准确PostgreSQL配置');
        return this.use(profile, undefined, async (m) => {
          this.profiles.set(profile.id, profile);
          return { version: m.version, dialect: 'postgresql', connectionId: m.processId };
        });
      }
      case 'connections.close':
        return this.closeConnection(input.id);
      case 'sessions.open':
        return this.use(
          this.profile(input.connectionId),
          input.database,
          async (managed) => {
            const id = 'postgres-session-' + randomUUID();
            this.sessions.set(id, { id, connectionId: input.connectionId, managed });
            return { sessionId: id };
          },
          true,
        );
      case 'sessions.close': {
        const session = this.sessions.get(input.sessionId);
        if (session) await this.closeSession(session);
        return;
      }
      case 'query.cancel': {
        const task = this.tasks.get(input.taskId);
        if (task) await this.cancel(task);
        return;
      }
      case 'query.sessionState': {
        const s = this.sessions.get(input.sessionId);
        if (!s) throw Error('PostgreSQL会话不存在');
        const state = s.managed.state();
        if (s.completion) return { ...state, transactionOpen: false, transactionFailed: false,
          transactionKnown: !s.pending && !s.closing && !state.broken };
        return { ...state, transactionKnown: !s.pending && !s.closing && state.transactionKnown };
      }
      case 'query.parameterNames':
        return this.session(input.sessionId, async (s) => {
          const part = firstPostgresStatement(input.sql, s.managed.standardStrings);
          if (!part || firstPostgresStatement(input.sql.slice(part.end + 1), s.managed.standardStrings))
            throw Error('PostgreSQL位置参数一次只识别一条语句');
          if (part.parameters.some((n, i) => n !== i + 1)) throw Error('PostgreSQL位置参数必须从$1连续编号');
          return {
            names: part.parameters.map((n) => 'p' + n),
            warnings: ['PostgreSQL使用$1、$2等位置参数，对应p1、p2；参数值不会拼接SQL。'],
            maxDecimalScale: 38,
            allowTimeEndpointFraction: false,
            ansiQuotes: true,
            noBackslashEscapes: true,
          };
        });
      case 'query.execute':
      case 'query.executeParameterized':
        return this.session(input.sessionId, (s) => this.execute(s, input), true);
      case 'query.transaction':
        return this.session(input.sessionId, async (s) => {
          if (input.action === 'commit' && s.managed.state().transactionFailed)
            throw Error('PostgreSQL事务已失败，请明确回滚');
          await s.managed.query(
            input.action === 'begin' ? 'BEGIN' : input.action === 'commit' ? 'COMMIT' : 'ROLLBACK',
            undefined,
            { rows: 0, bytes: 65536 },
          );
        });
      case 'metadata.databases':
        return this.use(this.profile(input.connectionId), undefined, async (m) =>
          (
            await m.query(
              "SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname,'CONNECT') ORDER BY datname",
              undefined,
              { rows: 10000, bytes: 4 * 1024 * 1024 },
            )
          ).rows.map((r) => r.c0),
        );
      case 'metadata.objects':
        return this.use(this.profile(input.connectionId), input.database, async (m) =>
          (
            await m.query(
              "SELECT n.nspname,c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND has_schema_privilege(n.oid,'USAGE') ORDER BY n.nspname,c.relname",
              undefined,
              { rows: 10000, bytes: 4 * 1024 * 1024 },
            )
          ).rows.map((r) => ({
            name: postgresIdentifier(String(r.c0)) + '.' + postgresIdentifier(String(r.c1)),
            kind: ['v', 'm'].includes(String(r.c2)) ? 'view' : 'table',
          })),
        );
      default:
        throw Error('PostgreSQL此项能力尚未实现：' + command + '；未向MySQL驱动发送请求');
    }
  }
}
