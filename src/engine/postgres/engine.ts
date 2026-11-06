import { postgresSequenceTargets, postgresSequenceVisibleSql, readPostgresSequence } from './sequence';
import { randomUUID } from 'node:crypto';
import type {
  ConnectionProfile,
  DatabaseObject,
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
import { PostgresTableWorkspace, type PostgresTableImportRequest } from './tableWorkspace';
import { PostgresCreateTableWorkspace, postgresCreateSchemas } from './createTable';
import { readPostgresCompletion } from './completion';
import { readPostgresStructure } from './relationStructure';
import { readPostgresRoutine, readPostgresRoutineCatalog, readPostgresRoutineOwnerTargets } from './routine';
import { readPostgresDependencies, readPostgresRoutineDependencies } from './dependencies';
import { PostgresStructureEditWorkspace } from './structureEdit';
import { matchesPostgresColumnPlan, postgresColumnPlan, type PostgresColumnPreviewInput } from '../../shared/postgresColumnEdit';
import { matchesCreatedPostgresIndex, postgresIndexPlan, type PostgresIndexPreviewInput } from '../../shared/postgresIndexEdit';
import { matchesCreatedPostgresKey, postgresKeyPlan, type PostgresKeyPreviewInput } from '../../shared/postgresKeyEdit';
import { preparePostgresForeignEdit, readPostgresForeignTargets } from './foreignKeyEdit';
import type { PostgresForeignPreviewInput } from '../../shared/postgresForeignKeyEdit';
import { preparePostgresCheckEdit } from './checkEdit';
import type { PostgresCheckPreviewInput } from '../../shared/postgresCheckEdit';
import { exportPostgresTable, type PostgresTableExportRequest } from './tableExport';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../shared/postgresCompletion';
import { parsePostgresAnalyze, parsePostgresExplain, postgresAnalyzeSql, postgresExplainSql } from '../../shared/postgresExplain';
import { explainLimits } from '../../shared/explain';
interface Session {
  id: string;
  connectionId: string;
  managed: PostgresConnection;
  pending?: Promise<unknown>;
  completion?: Promise<PostgresCompletionResult>;
  analysis?: { token: string; sql: string; expiresAt: number };
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
interface TransferTask {
  connectionId: string;
  cancelled: boolean;
  publishing: boolean;
  connection?: PostgresConnection;
  done?: Promise<unknown>;
}
type Input = Record<string, any>;
/** PostgreSQL独立网络执行账本，共用utility隔离进程及TaskEvent，不进入mysql2或其SQL生成器。 */
export class PostgresEngine {
  private readonly completionReads = new Map<string, number>();
  private readonly creations = new PostgresCreateTableWorkspace();
  private readonly columnEdits = new PostgresStructureEditWorkspace('字段', ({ output }, input: PostgresColumnPreviewInput) => {
    const { connectionId, database, table, editStamp, changes } = input;
    const plan = postgresColumnPlan(output, { connectionId, database, table, editStamp, changes });
    return { ...plan, verify: final => matchesPostgresColumnPlan(final.output.columns, plan.columns) };
  });
  private readonly indexEdits = new PostgresStructureEditWorkspace('索引', ({ output, indexIds }, input: PostgresIndexPreviewInput) => {
    const { connectionId, database, table, editStamp, changes } = input;
    const plan = postgresIndexPlan(output, { connectionId, database, table, editStamp, changes });
    const originals = new Set(indexIds.values());
    return { ...plan, ...(output.kind === 'm' ? {
      // 同 schema DDL 只锁原物化视图及其结构，支持目录核对后的整批索引提交。
      materializedGuard: 'ALTER MATERIALIZED VIEW ' + plan.table + ' SET SCHEMA ' + postgresIdentifier(output.schema),
    } : {}), verify: final => final.output.indexes.length === plan.indexes.size && final.output.indexes.every(index => {
      const expected = plan.indexes.get(index.name);
      const oid = final.indexIds.get(index.name)!;
      // 同名替换和锁内名称重用都不能通过原索引身份核对。
      if (expected?.original) return oid === indexIds.get(expected.original.name);
      return !!expected?.created && !originals.has(oid) && matchesCreatedPostgresIndex(index, expected.created);
    }) };
  });
  private readonly keyEdits = new PostgresStructureEditWorkspace('键约束', ({ output, keyIds, indexIds }, input: PostgresKeyPreviewInput) => {
    const { connectionId, database, table, editStamp, changes } = input;
    const plan = postgresKeyPlan(output, { connectionId, database, table, editStamp, changes });
    const originalKeys = new Set(keyIds.values()), originalIndexes = new Set(indexIds.values());
    const backing = new Map(output.indexes.map(index => [index.constraint, indexIds.get(index.name)]));
    return { ...plan, verify: final => {
      const keys = final.output.constraints.filter(key => key.kind === 'p' || key.kind === 'u');
      const indexes = new Map(final.output.indexes.map(index => [index.constraint, index]));
      return keys.length === plan.keys.size &&
        final.output.columns.every(column => !plan.requiredNotNull.has(column.name) || !column.nullable) &&
        keys.every(key => {
          const expected = plan.keys.get(key.name), index = indexes.get(key.name);
          if (!expected || !index) return false;
          const oid = final.keyIds.get(key.name)!, indexOid = final.indexIds.get(index.name)!;
          // 重命名应保留原约束及其索引；同名新建必须使用新身份。
          if (expected.original) return oid === keyIds.get(expected.original.name) && indexOid === backing.get(expected.original.name);
          return !!expected.created && !originalKeys.has(oid) && !originalIndexes.has(indexOid) &&
            matchesCreatedPostgresKey(key, index, expected.created);
        });
    } };
  });
  private readonly foreignEdits = new PostgresStructureEditWorkspace<PostgresForeignPreviewInput>('外键', preparePostgresForeignEdit);
  private readonly checkEdits = new PostgresStructureEditWorkspace<PostgresCheckPreviewInput>('CHECK 约束', preparePostgresCheckEdit);
  private readonly tables = new PostgresTableWorkspace();
  private readonly profiles = new Map<string, PostgresConnectionProfile>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Task>();
  private readonly transfers = new Map<string, TransferTask>();
  private readonly completedTasks = new Set<string>();
  private readonly leases = new Set<Lease>();
  private readonly closing = new Set<string>();
  private stopping = false;
  constructor(private readonly emit: (event: TaskEvent) => void) {}
  ownsTask(id: string) {
    return this.tasks.has(id) || this.transfers.has(id) || this.completedTasks.has(id);
  }
  /** 只按Main注入的方言或已登记准确身份路由，不根据SQL文本猜驱动。 */
  accepts(input: Input): boolean {
    return (
      input.dialect === 'postgresql' ||
      [input.profile, input.sourceProfile, input.targetProfile].some((p) => p?.dialect === 'postgresql') ||
      [input.id, input.connectionId, input.source?.connectionId, input.target?.connectionId].some(
        (id) => [...this.transfers.values()].some(task => task.connectionId === id) || this.profiles.has(id) || this.tables.connectionIds().includes(id) || this.creations.connectionIds().includes(id) ||
          this.columnEdits.connectionIds().includes(id) || this.indexEdits.connectionIds().includes(id) || this.keyEdits.connectionIds().includes(id) || this.foreignEdits.connectionIds().includes(id) || this.checkEdits.connectionIds().includes(id) || [...this.leases].some((l) => l.managed.profile.id === id),
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
  private async session<T>(id: string, action: (session: Session) => Promise<T>, managesCompletion = false, claimAnalysis = false): Promise<T> {
    const session = this.sessions.get(id);
    if (!session || session.managed.broken) throw Error('PostgreSQL会话已失效，请核对写入结果后重新连接');
    if (this.stopping || this.closing.has(session.connectionId) || session.pending || session.closing) {
      throw Error('PostgreSQL会话仍有在途操作或正在关闭');
    }
    if (!claimAnalysis) session.analysis = undefined;
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
  /** 文件发布或事务提交前接受取消，只终止任务的独占连接。 */
  private cancelTransfer(task: TransferTask) {
    if (task.publishing || task.cancelled) return;
    task.cancelled = true;
    task.connection?.abort();
  }

  /** 只保留终态任务编号，避免迟到的取消被分发给其他驱动。 */
  private rememberCompleted(taskId: string) {
    this.completedTasks.add(taskId);
    if (this.completedTasks.size > 8192) {
      const oldest = this.completedTasks.values().next().value;
      if (oldest !== undefined) this.completedTasks.delete(oldest);
    }
  }

  /** 在第一个等待之前登记文件任务，只有原子替换成功才报告已保存。 */
  private async exportTable(input: PostgresTableExportRequest, profile: PostgresConnectionProfile) {
    if (this.stopping || this.closing.has(profile.id) || this.ownsTask(input.taskId) || this.transfers.size >= 32)
      throw Error('PostgreSQL 导出任务已存在、连接关闭中或已达并发上限');
    const task: TransferTask = { connectionId: profile.id, cancelled: false, publishing: false };
    const check = () => { if (task.cancelled) throw Error('PostgreSQL 导出已取消'); };
    this.transfers.set(input.taskId, task);
    const done = task.done = exportPostgresTable(this.tables, input,
      action => this.use(profile, input.database, async managed => {
        task.connection = managed;
        check();
        return action(managed);
      }), check, () => { task.publishing = true; },
      rows => this.emit({ taskId: input.taskId, status: 'running', progress: 50, message: 'PostgreSQL 导出已读取 ' + rows + ' 行' }));
    try {
      const result = await done;
      this.emit({ taskId: input.taskId, status: 'completed', progress: 100, message: 'PostgreSQL 导出文件已保存，共 ' + result.rows + ' 行' });
      return result;
    } catch (reason) {
      this.emit({ taskId: input.taskId, status: task.cancelled ? 'cancelled' : 'failed', progress: 0,
        message: task.cancelled ? 'PostgreSQL 导出已取消' : 'PostgreSQL 导出未正常完成，请核对所选文件' });
      throw reason;
    } finally {
      this.transfers.delete(input.taskId);
      this.rememberCompleted(input.taskId);
    }
  }

  /** 导入和导出共用独占任务登记，提交开始后始终等待原事务终态。 */
  private async importTable(input: PostgresTableImportRequest, profile: PostgresConnectionProfile) {
    if (this.stopping || this.closing.has(profile.id) || this.ownsTask(input.taskId) || this.transfers.size >= 32)
      throw Error('PostgreSQL 导入任务已存在、连接关闭中或已达并发上限');
    const task: TransferTask = { connectionId: profile.id, cancelled: false, publishing: false };
    const check = () => { if (task.cancelled) throw Error('PostgreSQL 导入已取消'); };
    this.transfers.set(input.taskId, task);
    const done = task.done = this.tables.importData(input, action => this.use(profile, input.database, async managed => {
      task.connection = managed;
      check();
      return action(managed);
    }, false, false, true), check, () => { task.publishing = true; });
    try {
      const result = await done;
      const committed = result.outcome === 'committed';
      this.emit({ taskId: input.taskId, status: committed ? 'completed' : task.cancelled && result.outcome !== 'unknown' ? 'cancelled' : 'failed',
        progress: committed ? 100 : 0, ...(committed ? { rows: result.affected } : {}),
        message: committed ? 'PostgreSQL 已确认导入提交' : 'PostgreSQL 导入未确认提交，请在原窗口核对回执' });
      return result;
    } finally {
      this.transfers.delete(input.taskId);
      this.rememberCompleted(input.taskId);
    }
  }

  /** 显式断开先等准确在途终态，再正常关闭全部会话；失败保留原对象供核对或重试。 */
  private async closeConnection(id: string): Promise<void> {
    if (this.closing.has(id)) throw Error('PostgreSQL连接正在关闭');
    this.closing.add(id);
    try {
      const transfers = [...this.transfers.values()].filter(task => task.connectionId === id);
      for (const task of transfers) this.cancelTransfer(task);
      const leases = [...this.leases].filter((l) => l.managed.profile.id === id);
      for (const lease of leases) if (!lease.failed && !lease.protectedFromAbort) lease.managed.abort();
      const sessions = [...this.sessions.values()].filter(session => session.connectionId === id);
      await Promise.all(sessions.map(session => this.closeSession(session)));
      await Promise.all(leases.map(lease => lease.done));
      for (const lease of leases) {
        await lease.managed.close();
        this.leases.delete(lease);
      }
      await Promise.allSettled(transfers.map(task => task.done));
      this.tables.clear(id);
      this.creations.clear(id);
      this.columnEdits.clear(id);
      this.indexEdits.clear(id);
      this.keyEdits.clear(id);
      this.foreignEdits.clear(id);
      this.checkEdits.clear(id);
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
        [...this.leases].some((l) => l.managed.profile.id === input.id) ||
        [...this.transfers.values()].some(task => task.connectionId === input.id))
    )
      throw Error('该PostgreSQL连接仍有会话或未确认资源，请先关闭标签并显式断开');
    if (changed) {
      this.tables.clear(input.id);
      this.creations.clear(input.id);
      this.columnEdits.clear(input.id);
      this.indexEdits.clear(input.id);
      this.keyEdits.clear(input.id);
      this.foreignEdits.clear(input.id);
      this.checkEdits.clear(input.id);
      this.profiles.delete(input.id);
    }
  }
  async closeAll(): Promise<void> {
    this.stopping = true;
    try {
      for (const id of new Set([
        ...this.profiles.keys(),
        ...[...this.transfers.values()].map(task => task.connectionId),
        ...this.tables.connectionIds(),
        ...this.creations.connectionIds(),
        ...this.columnEdits.connectionIds(),
        ...this.indexEdits.connectionIds(),
        ...this.keyEdits.connectionIds(),
        ...this.foreignEdits.connectionIds(),
        ...this.checkEdits.connectionIds(),
        ...[...this.leases].map((l) => l.managed.profile.id),
        ...[...this.sessions.values()].map((s) => s.connectionId),
      ]))
        await this.closeConnection(id);
    } finally {
      this.stopping = false;
    }
  }
  /** 读取原会话的估算计划，服务器解析门保证只发送单条 EXPLAIN。 */
  private async explain(task: Task, input: Input): Promise<{ result: QueryResult; plan: NonNullable<QueryOutcome['explain']> }> {
    const connection = task.session.managed;
    if (!Number.isInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 ||
        ![undefined, 'auto', 'text'].includes(input.format)) throw Error('PostgreSQL执行计划参数无效');
    if (connection.state().transactionFailed) throw Error('PostgreSQL事务已失败，请先明确回滚');
    const format = input.format === 'text' ? 'text' : 'json';
    const { sql, generic } = postgresExplainSql(input.sql, { standardStrings: connection.standardStrings,
      version: connection.version, format: input.format ?? 'auto', offset: input.currentStatement?.offset });
    task.sent = true;
    // 通用计划不能绑定空值，否则优化器可能折叠条件。先由同一会话 Parse 原字节，再无值读取。
    if (generic) {
      await connection.query(sql, undefined, { rows: 0, bytes: 0 }, undefined, 'parse');
      if (task.cancelled) throw Error('PostgreSQL执行计划已取消');
    }
    const result = await connection.query(sql, undefined,
      { rows: format === 'json' ? 1 : Math.min(input.maxRows, explainLimits.textRows), bytes: explainLimits.jsonBytes },
      undefined, generic ? undefined : 'extended');
    if (task.cancelled) throw Error('PostgreSQL执行计划已取消');
    const raw = this.planOutput(result);
    const plan = parsePostgresExplain(raw, connection.version, format, result.truncated);
    if (generic) plan.warnings.unshift('使用通用估算计划，位置参数未绑定具体值');
    return { result, plan };
  }

  /** 只接受服务端确认的单列计划；超限时保留实际命令回执与截断标记。 */
  private planOutput(result: QueryResult): string {
    if (result.postgresCommand !== 'EXPLAIN' || result.columns.length !== 1 ||
        !result.rows.length && !result.truncated || result.rows.some(row => typeof row.c0 !== 'string'))
      throw Error('PostgreSQL未返回完整的执行计划');
    return result.rows.map(row => row.c0).join('\n');
  }

  /** 计划和脚本共用原会话排队、取消及终态，用户脚本仍按原文逐句执行。 */
  private async execute(session: Session, input: Input, estimate = false, analysisSql?: string): Promise<QueryOutcome> {
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
      failure: QueryOutcome['failure'],
      explain: QueryOutcome['explain'],
      analysis: QueryOutcome['analysis'];
    this.emit({ taskId: task.id, status: 'running', progress: 0, message: analysisSql ? '正在实际执行分析'
      : estimate ? '正在读取PostgreSQL估算计划' : '正在执行PostgreSQL脚本' });
    try {
      // 先登记可取消任务，再等待已占用原会话的目录读取。
      if (session.completion) await session.completion.catch(() => {});
      if (task.cancelled) throw Error('PostgreSQL任务在等待补全时已取消，未发送用户 SQL');
      if (this.stopping || this.closing.has(session.connectionId) || session.closing || session.managed.broken)
        throw Error('PostgreSQL会话正在关闭或已失效，未发送用户 SQL');
      const source = String(input.sql);
      const selected = !estimate && input.currentStatement
        ? currentPostgresStatement(source, input.currentStatement.offset, session.managed.standardStrings)
        : undefined;
      if (estimate) {
        const { result, plan } = await this.explain(task, input);
        results.push(result);
        explain = plan;
      }
      if (analysisSql) {
        if (session.managed.state().transactionFailed) throw Error('PostgreSQL事务已失败，请先明确回滚');
        task.sent = true;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: '已投递PostgreSQL实际执行分析',
          executionSql: analysisSql, executionDatabase: { state: 'known', database: session.managed.database } });
        const result = await session.managed.query(analysisSql, undefined, { rows: 1, bytes: explainLimits.jsonBytes }, undefined, 'extended');
        // 即使取消与回包交叉，也保留服务器已确认的实际执行结果。
        results.push(result);
        analysis = parsePostgresAnalyze(this.planOutput(result), session.managed.version, result.truncated);
      }
      while (!estimate && !analysisSql) {
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
        this.rememberCompleted(task.id);
      }
    }
    this.emit({
      taskId: task.id,
      status: failure ? (task.cancelled ? 'cancelled' : 'failed') : 'completed',
      progress: 100,
      message: failure ? failure.message : estimate ? 'PostgreSQL估算计划读取完成' : 'PostgreSQL执行完成',
    });
    return {
      results,
      elapsedMs: performance.now() - started,
      transactionOpen: session.managed.state().transactionOpen,
      ...(explain ? { explain } : {}),
      ...(analysis ? { analysis } : {}),
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
      case 'postgres.createTable.apply':
      case 'postgres.createTable.copy.preview':
      case 'postgres.createTable.copy.apply':
      case 'postgres.createView.preview':
      case 'postgres.createView.apply':
      case 'postgres.editView.preview':
      case 'postgres.editView.apply':
      case 'postgres.viewManage.preview':
      case 'postgres.viewManage.apply':
      case 'postgres.materializedRefresh.preview':
      case 'postgres.materializedRefresh.apply':
      case 'postgres.sequence.preview':
      case 'postgres.routine.create.preview':
      case 'postgres.routine.create.apply':
      case 'postgres.routine.manage.preview':
      case 'postgres.routine.manage.apply':
      case 'postgres.sequence.manage.preview':
      case 'postgres.sequence.manage.apply':
      case 'postgres.sequence.apply': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId || !input.owner ||
            !Number.isSafeInteger(input.connectionRevision)) throw Error('缺少可信的 PostgreSQL 建表连接和原文档');
        const connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing = false) =>
          this.use(profile, input.database, action, false, false, writing);
        if (command === 'postgres.createTable.schemas') return connect(postgresCreateSchemas);
        if (command === 'postgres.createTable.preview') return this.creations.prepare(input as Parameters<PostgresCreateTableWorkspace['prepare']>[0], connect);
        if (command === 'postgres.createTable.copy.preview') {
          const { profile: _profile, ...draft } = input;
          return this.creations.prepareTableCopy(draft as Parameters<PostgresCreateTableWorkspace['prepareTableCopy']>[0], connect);
        }
        if (command === 'postgres.createTable.copy.apply' && input.confirmed !== true)
          throw Error('请明确确认 PostgreSQL 表复制');
        if (command === 'postgres.createView.preview') return this.creations.prepareView(input as Parameters<PostgresCreateTableWorkspace['prepareView']>[0], connect);
        if (command === 'postgres.editView.preview') return this.creations.prepareViewEdit(input as Parameters<PostgresCreateTableWorkspace['prepareViewEdit']>[0], connect);
        if (command === 'postgres.viewManage.preview') return this.creations.prepareViewManage(input as Parameters<PostgresCreateTableWorkspace['prepareViewManage']>[0], connect);
        if (command === 'postgres.materializedRefresh.preview') return this.creations.prepareMaterializedRefresh(input as Parameters<PostgresCreateTableWorkspace['prepareMaterializedRefresh']>[0], connect);
        if (command === 'postgres.sequence.preview') return this.creations.prepareSequence(input as Parameters<PostgresCreateTableWorkspace['prepareSequence']>[0], connect);
        if (command === 'postgres.sequence.manage.preview' || command === 'postgres.routine.create.preview' || command === 'postgres.routine.manage.preview') {
          const { profile: _profile, ...draft } = input;
          if (command === 'postgres.routine.create.preview') return this.creations.prepareRoutine(draft as Parameters<PostgresCreateTableWorkspace['prepareRoutine']>[0], connect);
          if (command === 'postgres.routine.manage.preview') return this.creations.prepareRoutineManage(draft as Parameters<PostgresCreateTableWorkspace['prepareRoutineManage']>[0], connect);
          return this.creations.prepareSequenceManage(draft as Parameters<PostgresCreateTableWorkspace['prepareSequenceManage']>[0], connect);
        }
        return this.creations.apply(input as Parameters<PostgresCreateTableWorkspace['apply']>[0], connect,
          command === 'postgres.createTable.copy.apply' ? 'tableCopy' : command === 'postgres.routine.manage.apply' ? 'routineManage' : command === 'postgres.routine.create.apply' ? 'routineCreate' : command === 'postgres.sequence.manage.apply' ? 'sequenceManage' : command === 'postgres.sequence.apply' ? 'sequence' : command === 'postgres.materializedRefresh.apply' ? 'materializedRefresh' : command === 'postgres.viewManage.apply' ? 'viewManage' : command === 'postgres.editView.apply' ? 'viewEdit' : command === 'postgres.createView.apply' ? 'view' : 'table');
      }
      case 'postgres.sequence.read':
      case 'postgres.sequence.targets':
      case 'postgres.routine.read':
      case 'postgres.routine.dependencies':
      case 'postgres.routine.ownerTargets':
      case 'postgres.structure.dependencies':
      case 'postgres.structure.read': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId) throw Error('缺少可信的PostgreSQL结构连接');
        if (command === 'postgres.sequence.read') return this.use(profile, input.database,
          async connection => (await readPostgresSequence(connection, input.table)).info);
        if (command === 'postgres.sequence.targets') return this.use(profile, input.database, async connection => {
          const original = await readPostgresSequence(connection, input.table);
          if (original.info.stamp !== input.stamp) throw Error('原序列已变化，请刷新详情后继续');
          return postgresSequenceTargets(connection, original, input.kind, input.search);
        });
        if (command === 'postgres.structure.dependencies')
          return this.use(profile, input.database, connection => readPostgresDependencies(connection, input.table));
        if (command === 'postgres.routine.dependencies')
          return this.use(profile, input.database, connection => readPostgresRoutineDependencies(connection, {
            connectionId: input.connectionId, database: input.database, kind: input.kind, name: input.name, stamp: input.stamp,
          }));
        if (command === 'postgres.routine.ownerTargets')
          return this.use(profile, input.database, connection => readPostgresRoutineOwnerTargets(connection, {
            connectionId: input.connectionId, database: input.database, kind: input.kind, name: input.name,
            stamp: input.stamp, search: input.search,
          }));
        if (command === 'postgres.routine.read')
          return this.use(profile, input.database, connection => readPostgresRoutine(connection, {
            connectionId: input.connectionId, database: input.database, kind: input.kind, name: input.name,
          }));
        return this.use(profile, input.database, connection => readPostgresStructure(connection, input.table));
      }
      case 'postgres.columnEdit.preview':
      case 'postgres.columnEdit.apply':
      case 'postgres.indexEdit.preview':
      case 'postgres.indexEdit.apply':
      case 'postgres.keyEdit.preview':
      case 'postgres.keyEdit.apply':
      case 'postgres.foreignEdit.targets':
      case 'postgres.foreignEdit.preview':
      case 'postgres.foreignEdit.apply':
      case 'postgres.checkEdit.preview':
      case 'postgres.checkEdit.apply': {
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId || !input.owner ||
            !Number.isSafeInteger(input.connectionRevision)) throw Error('缺少可信的 PostgreSQL 结构编辑来源');
        const connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing = false) =>
          this.use(profile, input.database, action, false, false, writing);
        if (command === 'postgres.foreignEdit.targets')
          return connect(connection => readPostgresForeignTargets(connection, input.search));
        if (command === 'postgres.foreignEdit.preview')
          return this.foreignEdits.preview(input as Parameters<PostgresStructureEditWorkspace<PostgresForeignPreviewInput>['preview']>[0], connect);
        if (command === 'postgres.checkEdit.preview')
          return this.checkEdits.preview(input as Parameters<PostgresStructureEditWorkspace<PostgresCheckPreviewInput>['preview']>[0], connect);
        if (command === 'postgres.columnEdit.preview')
          return this.columnEdits.preview(input as Parameters<PostgresStructureEditWorkspace<PostgresColumnPreviewInput>['preview']>[0], connect);
        if (command === 'postgres.indexEdit.preview')
          return this.indexEdits.preview(input as Parameters<PostgresStructureEditWorkspace<PostgresIndexPreviewInput>['preview']>[0], connect);
        if (command === 'postgres.keyEdit.preview')
          return this.keyEdits.preview(input as Parameters<PostgresStructureEditWorkspace<PostgresKeyPreviewInput>['preview']>[0], connect);
        const workspace = command === 'postgres.columnEdit.apply' ? this.columnEdits :
          command === 'postgres.indexEdit.apply' ? this.indexEdits :
          command === 'postgres.keyEdit.apply' ? this.keyEdits :
          command === 'postgres.foreignEdit.apply' ? this.foreignEdits : this.checkEdits;
        return workspace.apply(input as Parameters<typeof workspace.apply>[0], connect);
      }
      case 'postgres.table.related':
      case 'postgres.table.page':
      case 'postgres.table.draft.restoreVerified':
      case 'postgres.table.values':
      case 'postgres.table.statistics':
      case 'postgres.table.histogram':
      case 'postgres.table.references':
      case 'postgres.table.apply':
      case 'postgres.table.filteredUpdate':
      case 'postgres.table.filteredDelete':
      case 'postgres.table.import':
      case 'postgres.table.export': {
        if (command === 'postgres.table.related' && input.operation === 'close')
          return this.tables.closeRelated(input as Parameters<PostgresTableWorkspace['closeRelated']>[0]);
        const profile = input.profile as PostgresConnectionProfile | undefined;
        if (profile?.dialect !== 'postgresql' || profile.id !== input.connectionId || !input.owner ||
            !Number.isSafeInteger(input.connectionRevision)) throw Error('缺少可信的PostgreSQL表页连接及原文档');
        const connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing = false) =>
          this.use(profile, input.database, action, false, false, writing);
        if (command === 'postgres.table.draft.restoreVerified')
          return this.tables.restoreDraft(input as Parameters<PostgresTableWorkspace['restoreDraft']>[0], connect);
        if (command === 'postgres.table.related') return input.operation === 'edit'
          ? this.tables.relatedEdit(input as Parameters<PostgresTableWorkspace['relatedEdit']>[0], connect)
          : this.tables.relatedPage(input as Parameters<PostgresTableWorkspace['relatedPage']>[0], connect);
        if (command === 'postgres.table.export') return this.exportTable(input as PostgresTableExportRequest, profile);
        if (command === 'postgres.table.import') return this.importTable(input as PostgresTableImportRequest, profile);
        if (command === 'postgres.table.references') return this.tables.references(input as Parameters<PostgresTableWorkspace['references']>[0], connect);
        if (command === 'postgres.table.values') return this.tables.values(input as Parameters<PostgresTableWorkspace['values']>[0], connect);
        if (command === 'postgres.table.statistics') return this.tables.statistics(input as Parameters<PostgresTableWorkspace['statistics']>[0], connect);
        if (command === 'postgres.table.histogram') return this.tables.histogram(input as Parameters<PostgresTableWorkspace['histogram']>[0], connect);
        if (command === 'postgres.table.filteredUpdate') return this.tables.previewFilteredUpdate(input as Parameters<PostgresTableWorkspace['previewFilteredUpdate']>[0], connect);
        if (command === 'postgres.table.filteredDelete') return this.tables.previewFilteredDelete(input as Parameters<PostgresTableWorkspace['previewFilteredDelete']>[0], connect);
        return command === 'postgres.table.page' ? this.tables.page(input as Parameters<PostgresTableWorkspace['page']>[0], connect) : this.tables.apply(input as Parameters<PostgresTableWorkspace['apply']>[0], connect);
      }
      case 'postgres.table.preview':
        if (this.stopping || this.closing.has(input.connectionId)) throw Error('PostgreSQL连接正在关闭');
        return this.tables.preview(input as Parameters<PostgresTableWorkspace['preview']>[0]);
      case 'postgres.table.draft.capture':
        return this.tables.captureDraft(input as Parameters<PostgresTableWorkspace['captureDraft']>[0]);
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
        const transfer = this.transfers.get(input.taskId);
        if (transfer) { this.cancelTransfer(transfer); return; }
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
      case 'postgres.explain':
        return this.session(input.sessionId, (s) => this.execute(s, input, command === 'postgres.explain'), true);
      case 'postgres.analyzePreview':
        return this.session(input.sessionId, async s => {
          if (s.managed.state().transactionFailed) throw Error('PostgreSQL事务已失败，请先明确回滚');
          const { source, sql } = postgresAnalyzeSql(input.sql, s.managed.standardStrings, input.currentStatement?.offset);
          const token = randomUUID();
          s.analysis = { token, sql, expiresAt: Date.now() + 120000 };
          return { source, token };
        });
      case 'postgres.analyze':
        return this.session(input.sessionId, s => {
          const permit = s.analysis;
          if (!permit || permit.token !== input.token || input.acknowledged !== true || permit.expiresAt <= Date.now())
            throw Error('PostgreSQL实际分析确认已失效，请重新预览');
          s.analysis = undefined;
          return this.execute(s, input, false, permit.sql);
        }, true, true);
      case 'postgres.analyzeDiscard': {
        const s = this.sessions.get(input.sessionId);
        // 取消仅撤销原令牌，不影响同会话较新的预览或在途 SQL。
        if (s?.analysis && s.analysis.token === input.token) s.analysis = undefined;
        return;
      }
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
        return this.use(this.profile(input.connectionId), input.database, async m => {
          const result = await m.query(
              `SELECT n.nspname,c.relname,c.relkind FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
               WHERE (CASE WHEN c.relkind = 'S' THEN c.relpersistence IN ('p','u') AND n.nspname !~ '^pg_'
                    AND (${postgresSequenceVisibleSql}) ELSE c.relkind IN ('r','p','v','m','f') END)
                 AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
                 AND has_schema_privilege(n.oid,'USAGE') ORDER BY n.nspname,c.relname`,
              undefined,
              { rows: 10000, bytes: 4 * 1024 * 1024 },
          );
          const relations: DatabaseObject[] = result.rows.map(r => ({
            name: postgresIdentifier(String(r.c0)) + '.' + postgresIdentifier(String(r.c1)),
            kind: r.c2 === 'S' ? 'sequence' : ['v', 'm'].includes(String(r.c2)) ? 'view' : 'table',
          }));
          return [...relations, ...await readPostgresRoutineCatalog(m)];
        });
      default:
        throw Error('PostgreSQL此项能力尚未实现：' + command + '；未向MySQL驱动发送请求');
    }
  }
}
