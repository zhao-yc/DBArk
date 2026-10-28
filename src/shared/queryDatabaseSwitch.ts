import { z } from 'zod';
import type { QueryDatabaseContext } from './queryContext';
import type { CompletionSessionState } from './sqlCompletion';

export const queryDatabaseSwitchMessages = {
  invalid: '默认数据库切换参数无效',
  stale: '当前会话默认库已变化，请重新选择数据库',
  unconfirmed: '切换可能已发生，当前库待确认；未自动重试或重连',
  shuttingDown: '客户端正在退出，不能切换默认数据库',
  sessionMissing: '原查询会话已关闭，请重新连接后选择数据库',
} as const;

export interface QueryDatabaseSwitchInput {
  sessionId: string;
  taskId: string;
  database: string;
  expectedContext: QueryDatabaseContext;
}

/** 成功仅携带同一物理连接确认的事实；事务未知时不能补写false。 */
export interface QueryDatabaseSwitchOutput {
  sessionId: string;
  taskId: string;
  database: string;
  completion: CompletionSessionState;
  transactionKnown: boolean;
  transactionOpen?: boolean;
  unchanged: boolean;
}

/** 沿用已有库名的BMP及长度边界，允许选择系统库，不trim或改变大小写。 */
export function validateQueryDatabaseSwitchName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64 || /[\u0000-\u001f\u007f.\\/\ud800-\udfff]/.test(value) || /\s$/u.test(value) || /^#mysql50#/iu.test(value)) throw Error('数据库名须为1～64个BMP字符，不能含路径、控制字符、尾空白或旧版名称前缀');
  return value;
}

/** 在Zod读取字段前复制自有数据属性，拒绝数组、访问器及额外隐藏或符号字段。 */
function ownFields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw Error(queryDatabaseSwitchMessages.invalid);
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.length || names.some(name => typeof name !== 'string' || !keys.includes(name))) throw Error(queryDatabaseSwitchMessages.invalid);
  const copied: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(queryDatabaseSwitchMessages.invalid);
    copied[key] = descriptor.value;
  }
  return copied;
}

/** 只读取属性描述符来选择联合分支，不执行不可信state getter。 */
function contextFields(input: unknown): Record<string, unknown> {
  const descriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'state') : undefined;
  return ownFields(input, descriptor && 'value' in descriptor && descriptor.value === 'known' ? ['state', 'database'] : ['state']);
}

/** 将结构检查异常转为统一IPC校验失败。 */
function guarded<T extends z.ZodType>(copy: (input: unknown) => Record<string, unknown>, schema: T) {
  return z.preprocess((input, context) => {
    try { return copy(input); }
    catch { context.addIssue({ code: 'custom', message: queryDatabaseSwitchMessages.invalid }); return z.NEVER; }
  }, schema);
}

const database = z.string().refine(value => {
  try { validateQueryDatabaseSwitchName(value); return true; } catch { return false; }
}, '数据库名称不在受控范围');
const id = z.string().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value), '会话或任务编号无效');
const expectedContext = guarded(contextFields, z.discriminatedUnion('state', [
  z.object({ state: z.literal('known'), database: database.nullable() }).strict(),
  z.object({ state: z.literal('unknown') }).strict(),
]));
export const queryDatabaseSwitchSchema = guarded(input => ownFields(input, ['sessionId', 'taskId', 'database', 'expectedContext']), z.object({ sessionId: id, taskId: id, database, expectedContext }).strict());

/** Main只接受原任务的完整确认，误路由或未知事务回包不能被记为切换成功。 */
export function assertQueryDatabaseSwitchOutput(value: unknown, input: QueryDatabaseSwitchInput): asserts value is QueryDatabaseSwitchOutput {
  try {
    const required = ['sessionId', 'taskId', 'database', 'completion', 'transactionKnown', 'unchanged'];
    const hasTransaction = !!value && typeof value === 'object' && Object.hasOwn(value, 'transactionOpen');
    const output = ownFields(value, hasTransaction ? [...required, 'transactionOpen'] : required);
    const completionKeys = ['database', 'databaseKnown', 'ansiQuotes', 'noBackslashEscapes', 'dialect', 'serverVersion', 'objectsRevision', 'broken', 'busy'];
    const completion = output.completion;
    if (!completion || typeof completion !== 'object') throw Error();
    const names = Reflect.ownKeys(completion);
    if (names.some(name => typeof name !== 'string' || !completionKeys.includes(name))) throw Error();
    const state = ownFields(completion, names as string[]);
    if (output.sessionId !== input.sessionId || output.taskId !== input.taskId || output.database !== input.database || validateQueryDatabaseSwitchName(output.database) !== output.database || state.database !== output.database || state.databaseKnown !== true || state.broken !== false || state.busy !== false || typeof output.unchanged !== 'boolean' || typeof output.transactionKnown !== 'boolean') throw Error();
    if (output.transactionKnown ? !hasTransaction || typeof output.transactionOpen !== 'boolean' : hasTransaction) throw Error();
    if (state.ansiQuotes !== undefined && typeof state.ansiQuotes !== 'boolean' || state.noBackslashEscapes !== undefined && typeof state.noBackslashEscapes !== 'boolean' || state.dialect !== undefined && state.dialect !== 'mysql' && state.dialect !== 'mariadb' || state.serverVersion !== undefined && typeof state.serverVersion !== 'string' || state.objectsRevision !== undefined && (!Number.isSafeInteger(state.objectsRevision) || (state.objectsRevision as number) < 0)) throw Error();
  } catch { throw Error(queryDatabaseSwitchMessages.unconfirmed); }
}
