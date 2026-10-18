/** 只控制显式SQL格式化的关键字；不控制名称、函数或类型名称。 */
export type SqlKeywordCase = 'preserve' | 'upper';
export const defaultSqlKeywordCase: SqlKeywordCase = 'preserve';
/** 旧缺项和损坏存量只在读取时回退，不隐式重写SQL或数据库。 */
export function readSqlKeywordCase(value: unknown): SqlKeywordCase { return value === 'upper' ? 'upper' : defaultSqlKeywordCase; }
/** 写入只兼容真正缺项；显式undefined和未知值必须在事务前拒绝。 */
export function assertSqlKeywordCaseWrite(settings: { sqlKeywordCase?: unknown }): void {
  if (Object.hasOwn(settings, 'sqlKeywordCase') && settings.sqlKeywordCase !== 'preserve' && settings.sqlKeywordCase !== 'upper') throw Error('SQL关键字大小写偏好必须为保持原样或大写');
}
