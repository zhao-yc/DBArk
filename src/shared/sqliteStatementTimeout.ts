export const sqliteStatementTimeoutMaximumMs = 60 * 60 * 1000;

/** 省略超时代表不限时。实际传入的预算必须为毫秒正整数。 */
export function validSqliteStatementTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= sqliteStatementTimeoutMaximumMs;
}
