import type { CompletionSessionState } from '../shared/sqlCompletion';
import type { QueryDatabaseContext } from '../shared/queryContext';
import { queryDatabaseFromSession } from '../shared/queryContext';
import { queryDatabaseSwitchSchema, queryDatabaseSwitchMessages, type QueryDatabaseSwitchInput, type QueryDatabaseSwitchOutput } from '../shared/queryDatabaseSwitch';
import { identifier } from './sql';

export interface QueryDatabaseSwitchContext {
  check(): void;
  physicalId(): number | undefined;
  completion(): CompletionSessionState;
  protocol(): { known: boolean; broken: boolean; serverStatus?: number };
  query(sql: string, submitted?: () => void): Promise<{ rows: unknown; fields: readonly { name: string }[]; schemaReported: boolean }>;
  confirmDatabase(database: string): void;
  invalidateDatabase(): void;
  onSubmitted(): void;
  onConfirmed(): void;
}

/** 已投递的USE不能按取消结果推断撤销，也不能自动重放或借替代连接确认。 */
export function queryDatabaseSwitchMayHaveChanged(error: unknown): Error {
  const message = queryDatabaseSwitchMessages.unconfirmed;
  if (error instanceof Error && error.message.startsWith(message)) return error;
  return new Error(message + '；' + (error instanceof Error ? error.message : String(error)).slice(0, 1024), { cause: error });
}

/** 比较协议缓存的完整语义，未知和已知空库不能互相代替。 */
export function assertExpectedDatabaseContext(expected: QueryDatabaseContext, current: QueryDatabaseContext): void {
  if (expected.state !== current.state || expected.state === 'known' && (current.state !== 'known' || expected.database !== current.database)) throw Error(queryDatabaseSwitchMessages.stale);
}

/** 原锁内只发一次引用后的USE；仅明确ACK成功而无schema报告时读取一次固定诊断。 */
export async function switchQueryDatabase(raw: QueryDatabaseSwitchInput, context: QueryDatabaseSwitchContext): Promise<QueryDatabaseSwitchOutput> {
  const input = queryDatabaseSwitchSchema.parse(raw);
  let submitted = false, confirmed = false;
  const originalId = context.physicalId();
  /** 每个异步边界重核原线程号；对象身份由Engine端口同时校验。 */
  const check = () => {
    context.check();
    if (!Number.isSafeInteger(originalId) || (originalId ?? 0) < 1 || context.physicalId() !== originalId) throw Error('原物理会话身份已变化，未自动重连或重试');
  };
  /** 只用当前协议状态输出事务事实；未知时禁止伪造transactionOpen=false。 */
  const result = (unchanged: boolean): QueryDatabaseSwitchOutput => {
    const completion = context.completion(), protocol = context.protocol();
    if (completion.broken || completion.busy || !completion.databaseKnown || completion.database !== input.database || protocol.broken) throw Error('未确认切换后的原会话默认库');
    const transactionKnown = protocol.known && Number.isInteger(protocol.serverStatus) && protocol.serverStatus! >= 0 && protocol.serverStatus! <= 65535;
    return { sessionId: input.sessionId, taskId: input.taskId, database: completion.database, completion, transactionKnown, ...(transactionKnown ? { transactionOpen: Boolean(protocol.serverStatus! & 1) } : {}), unchanged };
  };
  try {
    check();
    assertExpectedDatabaseContext(input.expectedContext, queryDatabaseFromSession(context.completion()));
    const current = context.completion();
    if (current.databaseKnown && current.database === input.database) return result(true);
    const before = context.protocol();
    check();
    const acknowledgement = await context.query('USE ' + identifier(input.database), () => { submitted = true; context.onSubmitted(); });
    check();
    const header = acknowledgement.rows, protocol = context.protocol();
    if (!header || typeof header !== 'object' || Array.isArray(header) || !('affectedRows' in header) || header.affectedRows !== 0 || !('warningStatus' in header) || header.warningStatus !== 0 || !('serverStatus' in header) || !Number.isInteger(header.serverStatus) || Number(header.serverStatus) < 0 || Number(header.serverStatus) > 65535 || acknowledgement.fields.length !== 0 || protocol.broken || !protocol.known || protocol.serverStatus !== header.serverStatus || Boolean(Number(header.serverStatus) & 8)) throw Error('切换默认库没有收到完整单个成功确认包');
    if (before.known && Number.isInteger(before.serverStatus) && (before.serverStatus! & 3) !== (Number(header.serverStatus) & 3)) throw Error('切库确认中的事务或自动提交状态与原会话不一致');
    if (!acknowledgement.schemaReported) {
      // 这条固定诊断属于用户显式切库动作，不能扩展到普通completionState或失败兜底。
      const diagnostic = await context.query('SELECT DATABASE() AS `database`');
      check();
      const rows = diagnostic.rows, fresh = context.protocol();
      if (!Array.isArray(rows) || rows.length !== 1 || diagnostic.fields.length !== 1 || diagnostic.fields[0].name !== 'database' || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0]) || Object.keys(rows[0]).length !== 1 || !Object.hasOwn(rows[0], 'database') || rows[0].database !== input.database || fresh.broken || !fresh.known || !Number.isInteger(fresh.serverStatus) || fresh.serverStatus! < 0 || fresh.serverStatus! > 65535 || Boolean(fresh.serverStatus! & 8)) throw Error('切换后的固定诊断未确认目标默认库');
      if ((fresh.serverStatus! & 3) !== (Number(header.serverStatus) & 3)) throw Error('固定切库诊断中的事务状态已变化');
      // 仅恢复库名；词法模式及临时对象目录仍由原协议缓存独立维护。
      context.confirmDatabase(rows[0].database);
    }
    check();
    const output = result(false);
    confirmed = true; context.onConfirmed();
    return output;
  } catch (error) {
    if (submitted) {
      if (!confirmed) context.invalidateDatabase();
      throw queryDatabaseSwitchMayHaveChanged(error);
    }
    throw error;
  }
}
