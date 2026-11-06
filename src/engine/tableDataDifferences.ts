import type { CellValue } from '../shared/contracts';
import { postgresDataCompareLimits as limits, type PostgresDataCompareOutput } from '../shared/postgresDataCompare';

export interface TableDataSnapshot {
  keys: string[];
  columns: PostgresDataCompareOutput['columns'];
  rows: CellValue[][];
}

const valueEqual = (a: CellValue, b: CellValue) => a === b || (
  a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && a.base64 === b.base64
);

/** 数值主键消除无意义的小数尾零用于匹配。字段对照仍保留各侧原始精度和显示形式。 */
function keyValue(value: CellValue, type: string): CellValue {
  if (typeof value !== 'string') return value;
  if (/^(?:numeric|decimal)(?:\(|$)/i.test(type) && value.includes('.')) return value.replace(/0+$/, '').replace(/\.$/, '');
  if ((type === 'real' || type === 'double precision') && value === '-0') return '0';
  return value;
}

/** 按确定的完整键比较，同一方言的驱动类型和值保持到字段详情。 */
export function compareTableData(left: TableDataSnapshot, right: TableDataSnapshot, sharedSnapshot: boolean, dialect: string,
  capture?: (source: CellValue[] | undefined, target: CellValue[] | undefined, targetPosition: number | undefined) => void): PostgresDataCompareOutput {
  if (JSON.stringify(left.columns) !== JSON.stringify(right.columns)) throw Error('两侧字段名及 ' + dialect + ' 声明类型须一致');
  if (JSON.stringify([...left.keys].sort()) !== JSON.stringify([...right.keys].sort())) throw Error('两侧主键字段须一致');
  const keyColumns = left.keys.map(name => left.columns.findIndex(column => column.name === name));
  const index = (rows: CellValue[][]) => {
    const result = new Map<string, { key: CellValue[]; values: CellValue[]; position: number }>();
    for (const [position, values] of rows.entries()) {
      const key = keyColumns.map(column => values[column]);
      if (key.some(value => value == null)) throw Error(dialect + ' 比较发现空主键');
      const id = JSON.stringify(key.map((value, position) => keyValue(value, left.columns[keyColumns[position]].type)));
      if (result.has(id)) throw Error(dialect + ' 比较发现重复的主键表示');
      result.set(id, { key, values, position });
    }
    return result;
  };
  const a = index(left.rows), b = index(right.rows);
  const counts = { 'source-only': 0, 'target-only': 0, different: 0 };
  const differences: PostgresDataCompareOutput['differences'] = [];
  let equal = 0;
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const source = a.get(id), target = b.get(id);
    if (!source && !target) continue;
    const kind = !target ? 'source-only' : !source ? 'target-only' : 'different';
    const cells = left.columns.flatMap((_, column) => {
      const before = source?.values[column], after = target?.values[column];
      if (before !== undefined && after !== undefined && valueEqual(before, after)) return [];
      return [{ column, ...(source ? { source: before } : {}), ...(target ? { target: after } : {}) }];
    });
    if (!cells.length) { equal++; continue; }
    counts[kind]++;
    differences.push({ kind, key: (source ?? target)!.key, cells });
    capture?.(source?.values, target?.values, target?.position);
  }
  if (Buffer.byteLength(JSON.stringify(differences)) > limits.bytes * 2) throw Error(dialect + ' 差异结果超过显示预算，请缩小筛选范围');
  return { sharedSnapshot, columns: left.columns, keyColumns: left.keys, sourceRows: a.size, targetRows: b.size, equal, counts, differences };
}
