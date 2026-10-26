import { z } from 'zod';

/** 界面和固定SET语句共用空格形式，服务器连字符值仅在读取时显式转换。 */
export const queryTransactionIsolations = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
export type QueryTransactionIsolation = typeof queryTransactionIsolations[number];

/** 每次读取绑定真实物理连接；这些值不是可持久化的全局设置或事务提交凭据。 */
export interface QueryTransactionSettingsSnapshot {
  dialect: 'mysql' | 'mariadb';
  serverVersion: string;
  serverConnectionId: string;
  database: string | null;
  isolation: QueryTransactionIsolation;
  readOnly: boolean;
  transactionOpen: boolean;
  autocommit: boolean;
}
export interface QueryTransactionSettingsVariables {
  isolation: 'transaction_isolation' | 'tx_isolation';
  readOnly: 'transaction_read_only' | 'tx_read_only';
}

/** 只覆盖有官方依据的已知分支；不探测失败后降级重放，也不猜未来主版本。 */
export function queryTransactionSettingsVariables(status: { dialect: 'mysql' | 'mariadb'; version: string }): QueryTransactionSettingsVariables {
  if (!status || typeof status.version !== 'string' || status.version.length > 256 || /[\u0000-\u001f\u007f]/u.test(status.version)) throw Error('无法确认服务器版本，未启用本会话事务默认设置');
  const source = status.dialect === 'mariadb' ? status.version.replace(/^5\.5\.5-/u, '') : status.version;
  const match = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,5})(?:[-+.][A-Za-z0-9][A-Za-z0-9._+~ -]*)?$/u.exec(source);
  if (!match) throw Error('无法确认服务器版本，未启用本会话事务默认设置');
  const [major, minor, patch] = match.slice(1).map(Number);
  // MySQL 5.7.20引入现代名称，8.0.3移除旧tx别名；仅覆盖当前明确分支。
  // https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/server-system-variables.html#sysvar_transaction_isolation
  // https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-3.html
  if (status.dialect === 'mysql' && !/mariadb/iu.test(source) && (major === 5 && minor === 7 && patch >= 20 || major === 8 && (minor === 0 && patch >= 3 || minor === 4))) {
    return { isolation: 'transaction_isolation', readOnly: 'transaction_read_only' };
  }
  // MariaDB 11.1.1才提供transaction_isolation，10.11仍使用tx名称。
  // https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#transaction_isolation
  if (status.dialect === 'mariadb') {
    if (major === 10 && minor === 11) return { isolation: 'tx_isolation', readOnly: 'tx_read_only' };
    if (major === 11 && (minor > 1 || minor === 1 && patch >= 1)) return { isolation: 'transaction_isolation', readOnly: 'transaction_read_only' };
  }
  throw Error('当前服务器版本未覆盖本会话事务默认设置');
}

/** 不trim、不转大小写、不接受SQL片段；异常服务器值必须让读取失败。 */
export function parseQueryTransactionIsolation(value: unknown): QueryTransactionIsolation {
  switch (value) {
    case 'READ UNCOMMITTED': case 'READ-UNCOMMITTED': return 'READ UNCOMMITTED';
    case 'READ COMMITTED': case 'READ-COMMITTED': return 'READ COMMITTED';
    case 'REPEATABLE READ': case 'REPEATABLE-READ': return 'REPEATABLE READ';
    case 'SERIALIZABLE': return 'SERIALIZABLE';
    default: throw Error('服务器返回了无法确认的事务隔离级别');
  }
}

/** 只接受驱动可能返回的明确布尔值，避免Boolean("OFF")或宽松数值转换误判。 */
export function parseQueryTransactionBoolean(value: unknown): boolean {
  if (value === false || value === 0 || value === '0' || value === 'OFF') return false;
  if (value === true || value === 1 || value === '1' || value === 'ON') return true;
  throw Error('服务器返回了无法确认的事务布尔设置');
}

/** 仅白名单枚举生成本会话默认值语句；不接受GLOBAL、SQL文本或隐式事务控制。 */
export function queryTransactionSettingsSql(isolation: QueryTransactionIsolation, readOnly: boolean): string {
  if (!queryTransactionIsolations.includes(isolation) || typeof readOnly !== 'boolean') throw Error('本会话事务默认设置无效');
  return `SET SESSION TRANSACTION ISOLATION LEVEL ${isolation}, READ ${readOnly ? 'ONLY' : 'WRITE'}`;
}

/** 在Zod取字段前拒绝访问器及继承身份；固定小对象不执行不可信getter。 */
function ownFields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw Error('本会话事务设置参数无效');
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.length || names.some(name => typeof name !== 'string' || !keys.includes(name))) throw Error('本会话事务设置参数含未知或缺失字段');
  const copied: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('本会话事务设置字段必须是自有数据属性');
    copied[key] = descriptor.value;
  }
  return copied;
}

/** 将固定结构读取异常转为safeParse失败，保持IPC校验的统一错误通道。 */
function guardedFields<T extends z.ZodType>(keys: readonly string[], schema: T) {
  return z.preprocess((input, context) => {
    try { return ownFields(input, keys); }
    catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '本会话事务设置参数无效' }); return z.NEVER; }
  }, schema);
}

const id = z.string().min(1).max(200);
const isolation = z.enum(queryTransactionIsolations);
// 物理连接身份始终保留十进制文本，不经Number丢精度；零不是有效用户连接。
const serverConnectionId = z.string().max(20).regex(/^[1-9]\d{0,19}$/u).refine(value => value.length < 20 || value <= '18446744073709551615', '服务器连接编号超出范围');
const snapshotKeys = ['dialect', 'serverVersion', 'serverConnectionId', 'database', 'isolation', 'readOnly', 'transactionOpen', 'autocommit'] as const;
export const queryTransactionSettingsSnapshotSchema = guardedFields(snapshotKeys, z.object({
  dialect: z.enum(['mysql', 'mariadb']), serverVersion: z.string().min(1).max(256), serverConnectionId,
  database: z.string().min(1).max(64).refine(value => !value.includes('\0'), '默认数据库名称无效').nullable(),
  isolation, readOnly: z.boolean(), transactionOpen: z.boolean(), autocommit: z.boolean(),
}).strict()).superRefine((snapshot, context) => {
  try { queryTransactionSettingsVariables({ dialect: snapshot.dialect, version: snapshot.serverVersion }); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '服务器版本无效' }); }
});

export const queryTransactionSettingsReadSchema = guardedFields(['sessionId', 'taskId'], z.object({ sessionId: id, taskId: id }).strict());
export const queryTransactionSettingsApplySchema = guardedFields(['sessionId', 'taskId', 'expected', 'isolation', 'readOnly'], z.object({
  sessionId: id, taskId: id, expected: queryTransactionSettingsSnapshotSchema, isolation, readOnly: z.boolean(),
}).strict());
export type QueryTransactionSettingsReadInput = z.infer<typeof queryTransactionSettingsReadSchema>;
export type QueryTransactionSettingsApplyInput = z.infer<typeof queryTransactionSettingsApplySchema>;
