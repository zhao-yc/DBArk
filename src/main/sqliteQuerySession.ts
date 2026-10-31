import { randomUUID } from 'node:crypto';
import type { CellValue, CommandMap, DataRow, QueryOutcome, QueryResult, TaskEvent } from '../shared/contracts';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteDriverLimits, type SqliteCancellation, type SqliteStatementResult, type SqliteValue } from '../engine/sqlite/protocol';
import { currentSqliteStatement } from '../engine/sqlite/currentStatement';
import { sqliteExplainSource } from '../engine/sqlite/explainSource';
import { buildSqliteExplainPlan } from '../shared/sqliteExplain';

type ExecuteInput = CommandMap['query.execute']['input'];
type ExplainInput = CommandMap['query.explain']['input'];
interface RunOptions { single: boolean; sourceRange?: { start: number; end: number }; explainView?: 'tree' | 'table'; }
type SessionState = CommandMap['query.sessionState']['output'];
type TransactionInput = CommandMap['query.transaction']['input'];
export type SqliteCompletionState = Omit<CompletionSessionState, 'dialect'> & { dialect: 'sqlite' };
const resultLimit = 200;
interface Execution { readonly taskId: string; readonly results: QueryResult[]; readonly started: number; rows: number; }

/** 旧结果合同用字符串承载SQLite数值原文，不把64位整数、负零或Infinity转成JSON数字。 */
export function sqliteWorkspaceValue(value: SqliteValue): CellValue {
  if (value === null || typeof value === 'string') return value;
  return value.type === 'binary' ? { ...value } : value.value;
}

/** 将已授权并打开的真实物理连接适配到原查询页合同；不读取文件路径或创建替代编辑器。 */
export class SqliteQuerySession {
  readonly sessionId: string;
  private active?: Execution;
  private transactionCommand = false;
  private closing?: Promise<void>;
  private terminalNotificationFailed = false;

  constructor(readonly connectionId: string, private readonly driver: SqliteDriverSession, private readonly emit: (event: TaskEvent) => void, sessionId: string = randomUUID()) {
    if (!connectionId || !sessionId || !driver.isUsable || driver.isBusy) throw Error('SQLite查询会话必须绑定已就绪的准确物理连接');
    this.sessionId = sessionId;
  }

  /** busy仅表示原连接当前状态，未知/失效不能被转换成无事务。 */
  state(): SessionState {
    const broken = !this.driver.isUsable;
    return { transactionOpen: this.driver.transaction === true, transactionKnown: !broken && !this.driver.isBusy && !this.active && !this.transactionCommand && this.driver.transaction !== null, broken };
  }
  /** 通知侧通道失效不改变原生执行事实；Main可读取此标记并要求明确重开，不能自动重放。 */
  get notificationFailed(): boolean { return this.terminalNotificationFailed; }
  /** SQLite主命名空间固定main；不伪造MySQL sql_mode或将其交给MySQL补全分析器。 */
  completionState(): SqliteCompletionState {
    const { broken } = this.state(), busy = !!this.active || this.transactionCommand || this.driver.isBusy;
    return { database: broken ? undefined : 'main', databaseKnown: !broken && !busy, dialect: 'sqlite', serverVersion: this.driver.version, broken, busy };
  }
  private available(sessionId: string, explicitRollback = false): void {
    if (sessionId !== this.sessionId || this.closing || !this.driver.isUsable) throw Error('SQLite原查询会话已关闭或失效，不会自动重连或重放');
    if (this.terminalNotificationFailed && !explicitRollback) throw Error('SQLite执行终态已取得，但界面通知失败；请先核对结果再明确重开会话，不会自动重放');
    if (this.active || this.transactionCommand || this.driver.isBusy) throw Error('SQLite原查询会话已有运行操作');
  }

  /** 原查询执行使用同一TaskEvent/QueryOutcome，所有不支持的选项均在首条SQL投递前拒绝。 */
  async execute(input: ExecuteInput): Promise<QueryOutcome> {
    this.available(input.sessionId);
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || typeof input.sql !== 'string' || Buffer.byteLength(input.sql) > sqliteDriverLimits.sqlBytes || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > sqliteDriverLimits.rows) throw Error('SQLite查询请求或结果预算无效');
    if (input.continueOnError === true || input.collectWarnings === true) throw Error('SQLite遇错继续和MySQL警告采集尚未接入，本次没有发送SQL');
    const selected = input.currentStatement === undefined ? undefined : currentSqliteStatement(input.sql, input.currentStatement.offset);
    if (input.currentStatement !== undefined && !selected) throw Error('SQLite光标位置没有可执行的当前语句，本次没有发送SQL');
    return this.run(input, selected?.sql ?? input.sql, { single: !!selected, ...(selected ? { sourceRange: { start: selected.start, end: selected.end } } : {}) });
  }

  /** 仅在原物理会话执行EQP包装，不执行原DML；只读会话仍由原authorizer拒绝其写目标授权。 */
  async explain(input: ExplainInput): Promise<QueryOutcome> {
    this.available(input.sessionId);
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || typeof input.sql !== 'string' || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 || input.format !== undefined && input.format !== 'auto' && input.format !== 'text') throw Error('SQLite执行计划请求或结果预算无效');
    const source = sqliteExplainSource(input.sql);
    return this.run({ ...input, maxRows: Math.min(input.maxRows, 1000) }, source.sql, { single: true, sourceRange: source.sourceRange, explainView: input.format === 'text' ? 'table' : 'tree' });
  }

  /** 查询与计划共用同一active任务、ACK、预算、原生终态和通知失效保护，不能绕开会话忙态或重放。 */
  private async run(input: Pick<ExecuteInput, 'taskId' | 'maxRows'>, sql: string, options: RunOptions): Promise<QueryOutcome> {
    const operation: Execution = { taskId: input.taskId, results: [], started: performance.now(), rows: 0 };
    let resultLimitReached = false;
    this.active = operation;
    const event = (patch: Omit<Partial<TaskEvent>, 'taskId'>) => {
      if (this.active !== operation) throw Error('SQLite原查询任务已失效，停止发布结果');
      this.emit({ taskId: operation.taskId, status: 'running', progress: 0, message: '正在执行SQLite查询', ...patch });
    };
    // 完整终态通过原Promise交付，通知异常不能把已确认提交改成失败，或覆盖原取消/事务事实。
    const terminalEvent = (patch: Omit<Partial<TaskEvent>, 'taskId'>) => {
      try { event(patch); } catch { this.terminalNotificationFailed = true; }
    };
    const complete = (facts: readonly Readonly<SqliteStatementResult>[]): QueryResult[] => {
      if (facts.length > operation.results.length) throw Error('SQLite完整结果与原语句不匹配');
      return facts.map((fact, index) => {
        const source = operation.results[index];
        if (fact.index !== index) throw Error('SQLite完整结果顺序无效');
        const changed = BigInt(fact.changes);
        if (changed > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('SQLite语句已执行，但变更量超过现有结果合同；请核对数据库，不要重复执行');
        return { ...source, ...(!source.columns.length || changed > 0n ? { affectedRows: Number(changed) } : {}), truncated: source.truncated || fact.truncated, elapsedMs: performance.now() - operation.started };
      });
    };
    try {
      event({ executionDatabase: { state: 'known', database: 'main' } });
      const outcome = await this.driver.execute(sql, {
        maxRows: input.maxRows, batchRows: 200, maxBytes: 16 * 1024 * 1024,
        // 空绑定数组显式启用原worker的原生单完整语句复核；词法定位错误也不能偷偷step第二句。
        ...(options.single ? { parameters: [] } : {}),
        onStatement: statement => {
          if (statement.index !== operation.results.length) throw Error('SQLite结果集顺序与原任务不匹配');
          if (statement.index >= resultLimit) { resultLimitReached = true; throw Error('SQLite结果集数量超过200，后续语句尚未执行'); }
          // SQLite列可逐行改变存储类型，不能把声明亲和性伪装成结果中每个单元格的真实类型。
          const columns = statement.columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' }));
          const result: QueryResult = { columns, rows: [], truncated: false, elapsedMs: 0, statement: statement.sql.slice(0, 32768) };
          operation.results.push(result);
          event({ resultIndex: statement.index, columns, executionSql: statement.sql });
        },
        onBatch: batch => {
          const result = operation.results[batch.index]; if (!result) throw Error('SQLite结果行缺少原始列定义');
          const accepted: DataRow[] = [];
          for (const values of batch.rows) {
            if (values.length !== result.columns.length) throw Error('SQLite结果列数与原批次不匹配');
            if (operation.rows >= input.maxRows) { result.truncated = true; continue; }
            accepted.push(Object.fromEntries(values.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)]))); operation.rows++;
          }
          result.rows.push(...accepted);
          if (accepted.length) event({ resultIndex: batch.index, batch: accepted, rows: operation.rows });
        },
      });
      if (!outcome.statements.length) throw Error('SQLite脚本中没有可执行语句');
      const results = complete(outcome.statements);
      // 即使原表受行预算截断，也交共享builder显式降级为不完整表格；只有原生成功才附计划。
      const sqliteExplain = options.explainView && results.length === 1 ? buildSqliteExplainPlan(results[0], this.driver.version, options.explainView) : undefined;
      terminalEvent({ status: 'completed', progress: 100, rows: operation.rows, message: 'SQLite查询执行完成' });
      return { results, elapsedMs: performance.now() - operation.started, transactionOpen: outcome.transaction, ...(sqliteExplain ? { sqliteExplain } : {}) };
    } catch (reason) {
      const cancelled = reason instanceof SqliteDriverError && ['SQLITE_CANCELLED', 'SQLITE_CANCELLED_SESSION_CLOSED'].includes(reason.code);
      const message = options.explainView && this.driver.readOnly && reason instanceof SqliteDriverError && reason.code === 'SQLITE_NATIVE_23'
        ? 'SQLite执行计划被原只读会话的原生权限检查拒绝；本次未执行原SQL，也未绕过写权限'
        : reason instanceof Error ? reason.message : 'SQLite查询失败';
      terminalEvent({ status: cancelled ? 'cancelled' : 'failed', progress: 0, message });
      // 只返回原生确认完成的前序结果；失败语句的部分流式行不能冒充完整结果。
      if (reason instanceof SqliteDriverError && !cancelled && !reason.sessionClosed && (reason.code.startsWith('SQLITE_NATIVE_') || options.single && reason.code === 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT' || resultLimitReached && reason.code === 'SQLITE_CONSUMER_FAILED')) {
        if (reason.completedResults.length !== reason.completedStatements) throw Error('SQLite失败回执缺少前序完整结果，不能发布成功摘要');
        return { results: complete(reason.completedResults), elapsedMs: performance.now() - operation.started, transactionOpen: reason.transaction ?? undefined, failure: { statementOrdinal: reason.completedStatements + 1, statementsCompleted: reason.completedStatements, message, ...(options.sourceRange ? { sourceRange: { ...options.sourceRange } } : {}) } };
      }
      throw reason;
    } finally { if (this.active === operation) this.active = undefined; }
  }

  /** 事务控制只允许固定三个动作；COMMIT失败保留真实事务位，不自动补发ROLLBACK。 */
  async transaction(input: TransactionInput): Promise<void> {
    // 通知失败后仍允许用户明确回滚原事务；不放行BEGIN、COMMIT或新的用户SQL。
    this.available(input.sessionId, input.action === 'rollback');
    const commands = { begin: 'BEGIN', commit: 'COMMIT', rollback: 'ROLLBACK' };
    if (!Object.hasOwn(commands, input.action)) throw Error('SQLite事务动作无效');
    const sql = commands[input.action];
    this.transactionCommand = true;
    try { await this.driver.execute(sql); } finally { this.transactionCommand = false; }
  }
  /** 只取消本会话仍持有的准确task；旧编号不能取消后继任务或其它标签。 */
  async cancel(taskId: string): Promise<SqliteCancellation | undefined> {
    const operation = this.active;
    if (!operation || operation.taskId !== taskId) return;
    return this.driver.cancel();
  }
  /** 关闭仍遵守原消费者终态和正常退出握手；失败保留原driver，调用方可准确重试收尾。 */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.active || this.transactionCommand) return Promise.reject(Error('SQLite原会话仍有运行操作，请先取消并等待原执行结束'));
    const work = this.driver.close(); this.closing = work;
    void work.catch(() => { if (this.closing === work) this.closing = undefined; });
    return work;
  }
}
