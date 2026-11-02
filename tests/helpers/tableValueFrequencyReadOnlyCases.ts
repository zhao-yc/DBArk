import type { CellValue, TableInfo } from '../../src/shared/contracts';
import type { TableValueOptionsInput, TableValueOptionsOrder } from '../../src/shared/tableValueOptions';
import { planTableValueOptions } from '../../src/engine/tableValueOptions';

const target = '`dbark_readonly`.`subject`';
const digit = '(SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
const text = (value: string) => `_utf8mb4 X'${Buffer.from(value).toString('hex')}' COLLATE utf8mb4_bin`;
const literalRows = (column: string, values: (string | null)[], cast?: string) => values.map(value => `SELECT ${value === null ? 'NULL' : cast ? `CAST(${text(value)} AS ${cast})` : text(value)} AS \`${column}\``).join(' UNION ALL ');
const metadata = (column: string, type: string): TableInfo => ({ database: 'dbark_readonly', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: '', columns: [{ name: column, type, nullable: true, defaultValue: null, generated: false, extra: '', comment: '' }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [] });

/** 只读派生来源替代FROM物理对象；生成器、WHERE、COUNT排序、LIMIT、外投影及原解码器保持生产实现。 */
export function tableValueFrequencyReadOnlyCases() {
  const cold = Array.from({ length: 520 }, (_, index) => ({ value: String(index).padStart(4, '0'), count: '1' }));
  const largeRelation = `SELECT LPAD(CAST(a.n+10*b.n+100*c.n AS CHAR),4,'0') COLLATE utf8mb4_bin AS label FROM ${digit} a CROSS JOIN ${digit} b CROSS JOIN ${digit} c WHERE a.n+10*b.n+100*c.n<520 UNION ALL SELECT ${text('yy_warm')} AS label FROM ${digit} a WHERE a.n<9 UNION ALL SELECT ${text('zz_hot')} AS label FROM ${digit} a CROSS JOIN ${digit} b`;
  const vectors: { name: string; column: string; type: string; relation: string; groups: { value: CellValue; count: string }[]; patch?: Pick<TableValueOptionsInput, 'searchPattern' | 'filters'> }[] = [
    { name: '超过500组后部热门值与100/9数值序', column: 'label', type: 'VARCHAR(64)', relation: largeRelation, groups: [...cold, { value: 'yy_warm', count: '9' }, { value: 'zz_hot', count: '100' }] },
    { name: '内部n原列与NULL空串及文本NULL', column: 'n', type: 'VARCHAR(64)', relation: literalRows('n', [null, null, '', 'NULL', 'a', 'a', 'a', 'z']), groups: [{ value: null, count: '2' }, { value: '', count: '1' }, { value: 'NULL', count: '1' }, { value: 'a', count: '3' }, { value: 'z', count: '1' }] },
    { name: 'BIGINT原值与内部n限定', column: 'n', type: 'BIGINT UNSIGNED', relation: literalRows('n', ['1', '9007199254740993', '9007199254740993', '18446744073709551615'], 'UNSIGNED'), groups: [{ value: '1', count: '1' }, { value: '9007199254740993', count: '2' }, { value: '18446744073709551615', count: '1' }] },
    { name: 'DECIMAL末位和尺度', column: 'amount', type: 'DECIMAL(65,30)', relation: literalRows('amount', ['-1.000000000000000000000000000001', '9007199254740993.123456789012345678901234567890', '9007199254740993.123456789012345678901234567890'], 'DECIMAL(65,30)'), groups: [{ value: '-1.000000000000000000000000000001', count: '1' }, { value: '9007199254740993.123456789012345678901234567890', count: '2' }] },
    { name: 'LIKE与原筛选后才计算次数', column: 'label', type: 'VARCHAR(64)', relation: literalRows('label', ['a', 'a', 'z_keep', 'z_keep', 'z_drop', 'z_drop', 'z_drop', 'other', null]), patch: { filters: [{ column: 'label', operator: '!=', value: 'z_drop' }], searchPattern: 'z%' }, groups: [{ value: 'z_keep', count: '2' }] },
  ];
  const result = [];
  for (const vector of vectors) for (const order of ['value', 'count-desc', 'count-asc'] as const satisfies readonly TableValueOptionsOrder[]) {
    const source = metadata(vector.column, vector.type), plan = planTableValueOptions(source, { column: vector.column, filters: [], ...vector.patch, order });
    if (plan.sql.split('FROM ' + target).length !== 2) throw Error('只读向量来源替换不唯一');
    const sql = plan.sql.replace('FROM ' + target, 'FROM (' + vector.relation + ') AS `fixture`').replaceAll(target + '.', '`fixture`.');
    if (sql.includes(target)) throw Error('只读向量仍引用物理测试对象');
    // groups已按各向量手写的原列顺序排列；稳定排序只改变次数优先级，不从被测SQL推算期望。
    const groups = [...vector.groups]; if (order !== 'value') groups.sort((left, right) => { const a = BigInt(left.count), b = BigInt(right.count); return a === b ? 0 : (a < b ? -1 : 1) * (order === 'count-asc' ? 1 : -1); });
    result.push({ name: vector.name + '/' + order, sql, plan, expected: groups.slice(0, 501) });
  }
  return result;
}
