/** 原连接 ErrorResponse 经过脱敏后只保留自有 SQLSTATE，不读取外来访问器。 */
export function postgresQuerySqlState(error: Error): string | undefined {
  const field = Object.getOwnPropertyDescriptor(error, 'postgresSqlState');
  return field && 'value' in field && typeof field.value === 'string' && /^[0-9A-Z]{5}$/.test(field.value) ? field.value : undefined;
}

/** 仅原查询已收到 ReadyForQuery 的普通服务端错误可继续；取消、断线与资源故障停止。 */
export function canContinuePostgresQueryError(error: Error, state: {broken: boolean; transactionKnown: boolean}, cancelled: boolean): boolean {
  const code = postgresQuerySqlState(error);
  return !cancelled && !state.broken && state.transactionKnown && !!code &&
    !['00', '01', '02', '08', '53', '54', '57', '58', 'XX'].includes(code.slice(0, 2));
}

/** 参数服务端详情可能包含绑定原值；所有执行模式使用同一无值错误提示。 */
export function postgresQueryErrorMessage(error: Error, parameterized: boolean): string {
  const code = postgresQuerySqlState(error);
  return parameterized ? 'PostgreSQL参数查询未完成' + (code ? '（SQLSTATE ' + code + '）' : '') : error.message || 'PostgreSQL语句未完成';
}
