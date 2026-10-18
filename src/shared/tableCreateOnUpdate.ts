import { assertAddedColumnOnUpdate, columnOnUpdatePatchSchema, columnOnUpdateVersionSupported, readControlledTimestampDefault, type ColumnDefaultPatch, type ColumnOnUpdatePatch } from './tableColumnPatches';

export interface TableCreateTimeColumn { type: string; nullable: boolean; defaultValue?: string | null; autoIncrement: boolean; onUpdate?: ColumnOnUpdatePatch; }
/** 新表只解析普通时间类型，不允许把属性或任意表达式拼入类型栏。 */
export function tableCreateTimeType(value: string): { type: 'DATETIME' | 'TIMESTAMP'; precision: number } | undefined {
  const match = /^(DATETIME|TIMESTAMP)(?:\(([0-6])\))?$/i.exec(value.trim());
  return match ? { type: match[1].toUpperCase() as 'DATETIME' | 'TIMESTAMP', precision: Number(match[2] ?? 0) } : undefined;
}
/** 显式新属性首片只收NULL或原生成器认可的CURRENT_TIMESTAMP；省略新键时旧默认值规则不变。 */
function defaultPatch(value: string | null | undefined): ColumnDefaultPatch {
  if (value === undefined) return { kind: 'none' };
  if (value === null) return { kind: 'null' };
  if (/^CURRENT_TIMESTAMP(?:\([0-6]?\))?$/i.test(value)) return { kind: 'expression', expression: 'current-timestamp', precision: readControlledTimestampDefault(value)!.precision };
  throw Error('显式自动更新时间仅支持DEFAULT NULL或与字段精度一致的CURRENT_TIMESTAMP默认值');
}
/** 省略新键完全沿用旧创建行为；显式null和对象均复用已有ADD时间属性的DEFAULT/NULL/精度合同。 */
export function assertTableCreateColumnOnUpdate(column: TableCreateTimeColumn): void {
  if (!Object.hasOwn(column, 'onUpdate')) return;
  const onUpdate = columnOnUpdatePatchSchema.parse(column.onUpdate), temporal = tableCreateTimeType(column.type);
  if (!temporal || column.autoIncrement) throw Error('新表自动更新时间仅接受非自增的普通DATETIME/TIMESTAMP字段');
  assertAddedColumnOnUpdate({ type: { kind: 'temporal', ...temporal }, nullable: column.nullable, default: defaultPatch(column.defaultValue), onUpdate });
}
/** UI可先核字段组合，服务器版本仍由原预览快照在Engine核对，不增加草稿期网络读取。 */
export function tableCreateOnUpdateReason(column: TableCreateTimeColumn): string {
  try { assertTableCreateColumnOnUpdate({ ...column, onUpdate: Object.hasOwn(column, 'onUpdate') ? column.onUpdate : { kind: 'expression', expression: 'current-timestamp', precision: tableCreateTimeType(column.type)?.precision ?? 0 } }); return ''; }
  catch (error) { return error instanceof Error ? error.message : '新表自动更新时间属性无效'; }
}
/** 仅显式请求新属性时收紧原创建范围，不按邻近补丁或未知方言推断支持。 */
export function assertTableCreateOnUpdateVersion(columns: readonly TableCreateTimeColumn[], dialect: 'mysql' | 'mariadb', version: string): void {
  if (!columns.some(column => Object.hasOwn(column, 'onUpdate'))) return;
  if (!columnOnUpdateVersionSupported(dialect, version)) throw Error('当前服务器版本尚未开放新表自动更新时间属性');
  for (const column of columns) assertTableCreateColumnOnUpdate(column);
}
/** 只生成固定函数，省略精度继承已验证字段；null明确不附加，undefined显式输入由校验拒绝。 */
export function tableCreateOnUpdateSql(column: TableCreateTimeColumn): string {
  assertTableCreateColumnOnUpdate(column);
  if (!column.onUpdate) return '';
  const precision = tableCreateTimeType(column.type)!.precision;
  return ' ON UPDATE CURRENT_TIMESTAMP' + (precision ? `(${precision})` : '');
}
/** 服务器可把显式零精度写成无括号或空括号；只按已受控时间默认函数的精度核对。 */
export function tableCreateTimeDefaultMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const wanted = readControlledTimestampDefault(expected), observed = readControlledTimestampDefault(actual);
  return !!wanted && !!observed && wanted.precision === observed.precision;
}
/** COLUMNS.EXTRA仅接受可选DEFAULT_GENERATED与一条受控自动时间属性，未知后缀不能算核验通过。 */
export function tableCreateOnUpdateExtraMatches(column: TableCreateTimeColumn, extra: unknown): boolean {
  if (!Object.hasOwn(column, 'onUpdate')) return true;
  if (typeof extra !== 'string' || extra.length > 512 || (extra.match(/\bDEFAULT_GENERATED\b/gi)?.length ?? 0) > 1) return false;
  const value = extra.replace(/\bDEFAULT_GENERATED\b/gi, '').trim();
  if (!column.onUpdate) return value === '';
  const match = /^on\s+update\s+(.+)$/i.exec(value), actual = match && readControlledTimestampDefault(match[1]);
  return !!actual && actual.precision === tableCreateTimeType(column.type)?.precision;
}
