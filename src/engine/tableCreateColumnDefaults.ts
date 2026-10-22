import type { TableColumnDefinition, TableDefinitionContext } from '../shared/tableColumnPatches';
import { tableCreateTimeDefaultMatches, type TableCreateTimeColumn } from '../shared/tableCreateOnUpdate';
import { mariaDefault, temporalDefault } from './sql';

/** 每份完整COLUMNS必须就地与同份SHOW及原请求核对，不能让后读的简目录覆盖前一次矛盾。 */
export function tableCreateColumnDefaultMatches(requested: TableCreateTimeColumn, shown: TableColumnDefinition, catalogDefault: string | null, context: TableDefinitionContext): boolean {
  const actual = context.dialect === 'mariadb' ? mariaDefault(catalogDefault, context.mode.noBackslashEscapes) : catalogDefault;
  const expected = requested.defaultValue, value = shown.default;
  // 沿原新表默认语义：省略/NULL、文字量和受控时间表达式分别比较，不做数值舍入或通用函数等价。
  if (expected === undefined) return actual === null && (value.kind === 'none' || requested.nullable && value.kind === 'null');
  if (expected === null) return actual === null && value.kind === 'null';
  if (/^(?:DATE|TIME|DATETIME|TIMESTAMP)\b/i.test(requested.type) && temporalDefault(expected)) {
    if (value.kind !== 'expression') return false;
    if (Object.hasOwn(requested, 'onUpdate')) return tableCreateTimeDefaultMatches(expected, actual) && tableCreateTimeDefaultMatches(expected, value.sql);
    const temporal = (source: string) => source.toUpperCase().replace(/\(\)$/, '');
    return typeof actual === 'string' && temporal(actual) === temporal(expected) && temporal(value.sql) === temporal(expected);
  }
  return actual === expected && value.kind === 'literal' && value.value === expected;
}
