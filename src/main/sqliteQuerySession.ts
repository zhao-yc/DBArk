import { randomUUID } from 'node:crypto';
import type { CellValue, CommandMap, DataRow, QueryOutcome, QueryResult, TaskEvent } from '../shared/contracts';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import { SqliteDriverError, type SqliteDriverSession, type SqliteExecuteOptions } from '../engine/sqlite/session';
import { sqliteDriverLimits, type SqliteCancellation, type SqliteStatementResult, type SqliteValue } from '../engine/sqlite/protocol';
import { currentSqliteStatement, sqliteStatementRanges } from '../engine/sqlite/currentStatement';
import { sqliteExplainSource } from '../engine/sqlite/explainSource';
import { buildSqliteExplainPlan } from '../shared/sqliteExplain';
import { sqliteNamedParameterNames, sqliteParameterInfo } from '../engine/sqlite/parameters';
import { validateSqliteQueryParameters } from '../shared/sqliteQueryParameters';
import { validSqliteStatementTimeout } from '../shared/sqliteStatementTimeout';
import { validQueryResultTitle } from '../shared/queryResultTitle';
import { queryScriptReportSummary } from '../shared/queryContinueOnError';
import type { SqlStatementRange } from '../shared/sqlScriptScanner';
import { continueSqliteScript } from './sqliteContinueOnError';

type ExecuteInput = CommandMap['query.execute']['input'];
type ExplainInput = CommandMap['query.explain']['input'];
type ParameterInput = CommandMap['query.executeParameterized']['input'];
interface RunOptions { single: boolean; sourceRange?: { start: number; end: number }; explainView?: 'tree' | 'table'; namedParameters?: Record<string, SqliteValue>; parameterRanges?: { start: number; end: number }[]; continueRanges?: SqlStatementRange[]; }
type SessionState = CommandMap['query.sessionState']['output'];
type TransactionInput = CommandMap['query.transaction']['input'];
export type SqliteCompletionState = Omit<CompletionSessionState, 'dialect'> & { dialect: 'sqlite' };
const resultLimit = 200, queryBytes = 16 * 1024 * 1024;
interface Execution { readonly taskId: string; readonly results: QueryResult[]; readonly started: number; rows: number; cancelled: boolean; }

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
  private objectsRevision = 0;
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
  completionState(pending = false): SqliteCompletionState {
    const { broken } = this.state(), busy = pending || !!this.active || this.transactionCommand || this.driver.isBusy;
    return { database: broken ? undefined : 'main', databaseKnown: !broken && !busy, dialect: 'sqlite', serverVersion: this.driver.version, objectsRevision: this.objectsRevision, broken, busy };
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
    if (input.collectWarnings === true) throw Error('SQLite 不支持 MySQL 警告采集，本次未发送 SQL');
    const selected = input.currentStatement === undefined ? undefined : currentSqliteStatement(input.sql, input.currentStatement.offset);
    if (input.currentStatement !== undefined && !selected) throw Error('SQLite光标位置没有可执行的当前语句，本次没有发送SQL');
    const continueRanges = !selected && input.continueOnError === true ? sqliteStatementRanges(input.sql) : undefined;
    return this.run(input, selected?.sql ?? input.sql, { single: !!selected, continueRanges,
      ...(selected ? { sourceRange: { start: selected.start, end: selected.end } } : {}) });
  }

  /** 仅在原物理会话执行EQP包装，不执行原DML；只读会话仍由原authorizer拒绝其写目标授权。 */
  async explain(input: ExplainInput): Promise<QueryOutcome> {
    this.available(input.sessionId);
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || typeof input.sql !== 'string' || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 || input.format !== undefined && input.format !== 'auto' && input.format !== 'text') throw Error('SQLite执行计划请求或结果预算无效');
    const source = sqliteExplainSource(input.sql);
    return this.run({ ...input, maxRows: Math.min(input.maxRows, 1000) }, source.sql, { single: true, sourceRange: source.sourceRange, explainView: input.format === 'text' ? 'table' : 'tree' });
  }

  /** 编译检查占用原会话，但不执行用户 SQL 或推进对象修订。 */
  async syntaxCheck(input: CommandMap['sqlite.syntaxCheck']['input']): Promise<CommandMap['sqlite.syntaxCheck']['output']> {
    this.available(input.sessionId);
    const operation: Execution = {taskId: input.taskId, results: [], started: performance.now(), rows: 0, cancelled: false};
    this.active = operation;
    try { return await this.driver.syntaxCheck(input.sql); }
    finally { if (this.active === operation) this.active = undefined; }
  }

  /** 参数识别只用SQLite完整词法与原会话身份；不prepare用户模板、不建立任务或读取MySQL模式。 */
  parameterNames(input: CommandMap['query.parameterNames']['input']): CommandMap['query.parameterNames']['output'] {
    this.available(input.sessionId);
    return sqliteParameterInfo(input.sql);
  }

  /** 全组值及完整脚本先验证，再原生绑定；所有前序结果及事务均归原物理会话，不重放部分写入。 */
  async executeParameterized(input: ParameterInput): Promise<QueryOutcome> {
    this.available(input.sessionId);
    if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000) throw Error('SQLite参数查询请求或结果预算无效');
    if (input.collectWarnings === true) throw Error('SQLite 参数查询不支持 MySQL 警告采集，本次未发送 SQL');
    const names = sqliteNamedParameterNames(input.sql), values = validateSqliteQueryParameters(input.parameters);
    if (values.size !== names.length || names.some(name => !values.has(name))) throw Error('SQLite参数必须准确覆盖模板全部名称，不接受缺少或额外的参数');
    const namedParameters: Record<string, SqliteValue> = Object.create(null);
    for (const name of names) namedParameters[':' + name] = values.get(name)!;
    const ranges = sqliteStatementRanges(input.sql);
    const parameterRanges = ranges.map(range => ({start: range.start, end: range.end}));
    return this.run(input, input.sql, {single: false, namedParameters, parameterRanges,
      ...(input.continueOnError === true ? {continueRanges: ranges} : {})});
  }

  /** 查询与计划共用同一active任务、ACK、预算、原生终态和通知失效保护，不能绕开会话忙态或重放。 */
  private async run(input: Pick<ExecuteInput, 'taskId' | 'maxRows' | 'sqliteStatementTimeoutMs'>, sql: string, options: RunOptions): Promise<QueryOutcome> {
    // 任何明确执行均撤销此前目录建议，即使它最终报错或回滚；目录短读本身不推进此修订。
    const {continueRanges} = options, {sqliteStatementTimeoutMs: statementTimeoutMs} = input;
    if (statementTimeoutMs !== undefined && !validSqliteStatementTimeout(statementTimeoutMs)) throw Error('SQLite 语句超时设置无效');
    if (continueRanges && !continueRanges.length) throw Error('SQLite 脚本中没有可执行语句');
    if (this.objectsRevision >= Number.MAX_SAFE_INTEGER) throw Error('SQLite会话目录修订已达上限，请明确重开会话');
    this.objectsRevision++;
    const operation: Execution = { taskId: input.taskId, results: [], started: performance.now(), rows: 0, cancelled: false };
    const titles: (string | null)[] = [];
    /** 只回传已完成的结果名称，失败语句的流式表头不能泄漏到下一条结果。 */
    function displayTitles(completed: number): Pick<QueryOutcome, 'resultTitles'> {
      const resultTitles = titles.slice(0, completed);
      return resultTitles.some(Boolean) ? { resultTitles } : {};
    }
    let resultLimitReached = false, retainedBytes = 0;
    this.active = operation;
    const event = (patch: Omit<Partial<TaskEvent>, 'taskId'>) => {
      if (this.active !== operation) throw Error('SQLite原查询任务已失效，停止发布结果');
      this.emit({ taskId: operation.taskId, status: 'running', progress: 0, message: '正在执行SQLite查询', ...patch });
    };
    // 完整终态通过原Promise交付，通知异常不能把已确认提交改成失败，或覆盖原取消/事务事实。
    const terminalEvent = (patch: Omit<Partial<TaskEvent>, 'taskId'>) => {
      try { event(patch); } catch { this.terminalNotificationFailed = true; }
    };
    const complete = (facts: readonly Readonly<SqliteStatementResult>[], ordinals?: number[]): Pick<QueryOutcome, 'results' | 'sqliteResultReceipts'> => {
      if (facts.length > operation.results.length) throw Error('SQLite完整结果与原语句不匹配');
      const receipts: NonNullable<QueryOutcome['sqliteResultReceipts']> = [];
      // 当前语句投递的是原文片段。选区及普通脚本的偏移相对各自完整载荷。
      const base = options.sourceRange?.start ?? 0;
      const results = facts.map((fact, index) => {
        const source = operation.results[index];
        if (fact.index !== index) throw Error('SQLite完整结果顺序无效');
        const changed = BigInt(fact.changes);
        if (changed > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('SQLite语句已执行，但变更量超过现有结果合同；请核对数据库，不要重复执行');
        if (fact.queryReceipt) {
          const {producedRows, sourceRange} = fact.queryReceipt;
          receipts.push({...(ordinals ? {statementOrdinal: ordinals[index]} : {}), producedRows, changedRows: Number(changed), sourceRange: {start: base + sourceRange.start, end: base + sourceRange.end}});
        }
        return { ...source, ...(!source.columns.length || changed > 0n ? { affectedRows: Number(changed) } : {}), truncated: source.truncated || fact.truncated,
          elapsedMs: fact.queryReceipt?.elapsedMs ?? performance.now() - operation.started };
      });
      return {results, ...(receipts.length && receipts.length === results.length ? {sqliteResultReceipts: receipts} : {})};
    };
    const onStatement: NonNullable<SqliteExecuteOptions['onStatement']> = statement => {
      if (statement.index !== operation.results.length) throw Error('SQLite结果集顺序与原任务不匹配');
      if (statement.index >= resultLimit) { resultLimitReached = true; throw Error('SQLite结果集数量超过200，后续语句尚未执行'); }
      // SQLite列可逐行改变存储类型，不能把声明亲和性伪装成结果中每个单元格的真实类型。
      const columns = statement.columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' }));
      const result: QueryResult = { columns, rows: [], sqliteStorage: { version: 1, rows: [] }, truncated: false, elapsedMs: 0, statement: statement.sql.slice(0, 32768) };
      operation.results.push(result);
      titles.push(columns.length && validQueryResultTitle(statement.title) ? statement.title : null);
      // 续执行中，失败语句可能发出部分行；在原生确认前留在本次缓冲。
      if (!continueRanges) event({ resultIndex: statement.index, columns, executionSql: statement.sql });
    };
    const onBatch: NonNullable<SqliteExecuteOptions['onBatch']> = batch => {
      const result = operation.results[batch.index]; if (!result) throw Error('SQLite结果行缺少原始列定义');
      const accepted: DataRow[] = [];
      for (const values of batch.rows) {
        if (values.length !== result.columns.length) throw Error('SQLite结果列数与原批次不匹配');
        if (operation.rows >= input.maxRows) { result.truncated = true; continue; }
        accepted.push(Object.fromEntries(values.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)])));
        // 只标记原driver已确认的存储类；同样的字符串原文也能区分INTEGER、REAL与TEXT。
        result.sqliteStorage!.rows.push(values.map(value => value === null ? 'n' : typeof value === 'string' ? 't' : value.type === 'binary' ? 'b' : value.type === 'integer' ? 'i' : 'r').join(''));
        operation.rows++;
        if (continueRanges) retainedBytes += Buffer.byteLength(JSON.stringify(values)) + 1;
      }
      result.rows.push(...accepted);
      if (accepted.length && !continueRanges) event({ resultIndex: batch.index, batch: accepted, rows: operation.rows });
    };
    try {
      event({ executionDatabase: { state: 'known', database: 'main' } });
      if (continueRanges) {
        let checkpoint = {results: 0, rows: 0, bytes: 0};
        const {facts, ordinals, report, cancelled, transaction} = await continueSqliteScript(this.driver, sql, continueRanges, options.namedParameters, resultLimit, statementTimeoutMs, {
          cancelled: () => operation.cancelled,
          budget: () => {
            checkpoint = {results: operation.results.length, rows: operation.rows, bytes: retainedBytes};
            return {rows: input.maxRows - operation.rows, bytes: queryBytes - retainedBytes};
          },
          statement: onStatement,
          batch: onBatch,
          discard: () => {
            operation.results.length = checkpoint.results;
            titles.length = checkpoint.results;
            operation.rows = checkpoint.rows;
            retainedBytes = checkpoint.bytes;
          },
        });
        const completed = complete(facts, ordinals);
        const message = queryScriptReportSummary(report), first = report.errors[0];
        const failure = first && {statementOrdinal: first.statementOrdinal, statementsCompleted: first.statementsCompleted,
          sourceRange: first.sourceRange, message};
        terminalEvent({status: cancelled ? 'cancelled' : failure ? 'failed' : 'completed', progress: 100, rows: operation.rows, message});
        return {...completed, ...displayTitles(facts.length), elapsedMs: performance.now() - operation.started,
          transactionOpen: transaction, scriptReport: report, ...(failure ? {failure} : {})};
      }
      const outcome = await this.driver.execute(sql, {
        maxRows: input.maxRows, batchRows: 200, maxBytes: queryBytes,
        ...(statementTimeoutMs === undefined ? {} : {statementTimeoutMs}),
        // 空绑定数组显式启用原worker的原生单完整语句复核；词法定位错误也不能偷偷step第二句。
        ...(options.single ? { parameters: [] } : {}),
        ...(options.namedParameters ? { namedParameters: options.namedParameters } : {}),
        ...(!options.single && !options.namedParameters && !options.explainView ? {captureFailureRange: true as const} : {}),
        ...(!options.explainView ? {captureQueryReceipt: true as const} : {}),
        onStatement, onBatch,
      });
      if (!outcome.statements.length) throw Error('SQLite脚本中没有可执行语句');
      const completed = complete(outcome.statements), {results} = completed;
      // 即使原表受行预算截断，也交共享builder显式降级为不完整表格；只有原生成功才附计划。
      const sqliteExplain = options.explainView && results.length === 1 ? buildSqliteExplainPlan(results[0], this.driver.version, options.explainView) : undefined;
      terminalEvent({ status: 'completed', progress: 100, rows: operation.rows, message: 'SQLite查询执行完成' });
      return { ...completed, ...displayTitles(results.length), elapsedMs: performance.now() - operation.started, transactionOpen: outcome.transaction, ...(sqliteExplain ? { sqliteExplain } : {}) };
    } catch (reason) {
      const cancelled = reason instanceof SqliteDriverError && ['SQLITE_CANCELLED', 'SQLITE_CANCELLED_SESSION_CLOSED'].includes(reason.code);
      const message = options.explainView && this.driver.readOnly && reason instanceof SqliteDriverError && reason.code === 'SQLITE_NATIVE_23'
        ? 'SQLite执行计划被原只读会话的原生权限检查拒绝；本次未执行原SQL，也未绕过写权限'
        : reason instanceof Error ? reason.message : 'SQLite查询失败';
      terminalEvent({ status: cancelled ? 'cancelled' : 'failed', progress: 0, message });
      // 只返回原生确认完成的前序结果；失败语句的部分流式行不能冒充完整结果。
      if (reason instanceof SqliteDriverError && !cancelled && !reason.sessionClosed && (reason.code.startsWith('SQLITE_NATIVE_') || reason.code === 'SQLITE_STATEMENT_TIMEOUT' || options.namedParameters && reason.code === 'SQLITE_NAMED_PARAMETERS_INVALID' || options.single && reason.code === 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT' || resultLimitReached && reason.code === 'SQLITE_CONSUMER_FAILED')) {
        if (reason.completedResults.length !== reason.completedStatements) throw Error('SQLite失败回执缺少前序完整结果，不能发布成功摘要');
        const sourceRange = options.sourceRange ?? options.parameterRanges?.[reason.completedStatements] ?? reason.sourceRange;
        return { ...complete(reason.completedResults), ...displayTitles(reason.completedStatements), elapsedMs: performance.now() - operation.started, transactionOpen: reason.transaction ?? undefined, failure: { statementOrdinal: reason.completedStatements + 1, statementsCompleted: reason.completedStatements, message, ...(sourceRange ? { sourceRange: { ...sourceRange } } : {}) } };
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
    if (this.objectsRevision >= Number.MAX_SAFE_INTEGER) throw Error('SQLite会话目录修订已达上限，请明确重开会话');
    this.objectsRevision++;
    this.transactionCommand = true;
    try { await this.driver.execute(sql); } finally { this.transactionCommand = false; }
  }
  /** 只取消本会话仍持有的准确task；旧编号不能取消后继任务或其它标签。 */
  async cancel(taskId: string): Promise<SqliteCancellation | undefined> {
    const operation = this.active;
    if (!operation || operation.taskId !== taskId) return;
    operation.cancelled = true;
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
