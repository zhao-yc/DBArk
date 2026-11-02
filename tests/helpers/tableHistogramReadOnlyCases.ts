import type { TableInfo } from '../../src/shared/contracts';
import type { TableStatisticsInput } from '../../src/shared/tableStatistics';

interface Vector { name: string; type: string; relation: string; expected(bins: 5 | 10 | 20): string[]; nonNull: string; nulls: string; min?: string; max?: string; filter?: true; column?: string; }
const text = (value: string) => `_utf8mb4 X'${Buffer.from(value).toString('hex')}'`;
const relation = (values: (string | null)[], cast?: string) => values.map(value => `SELECT ${value === null ? cast ? `CAST(NULL AS ${cast})` : 'NULL' : cast ? `CAST(${text(value)} AS ${cast})` : value} AS n`).join(' UNION ALL ');
const sparse = (bins: number, entries: [number, number][]) => { const counts = Array<string>(bins).fill('0'); for (const [index, value] of entries) counts[index] = String(Number(counts[index]) + value); return counts; };

/** 独立手写分布oracle；只提供常量派生关系，不创建资源、读取业务表或用产品边界计算期望数量。 */
export function tableHistogramReadOnlyCases() {
  const largest = '18446744073709551615', quantum = '0.' + '0'.repeat(29), huge = '9'.repeat(35) + '.' + '0'.repeat(29) + '1';
  const vectors: Vector[] = [
    { name: '整数边界和空区间', type: 'INT', relation: relation(['0', '1', '19', '20', '21', '50', '99', '100', null], 'SIGNED'), expected: bins => bins === 5 ? ['3', '2', '1', '0', '2'] : bins === 10 ? ['2', '1', '2', '0', '0', '1', '0', '0', '0', '2'] : sparse(20, [[0, 2], [3, 1], [4, 2], [10, 1], [19, 2]]), nonNull: '8', nulls: '1', min: '0', max: '100' },
    ...(['BIGINT UNSIGNED', 'BIT(64)'] as const).map(type => ({ name: type + '极大精确值', type, relation: relation(['0', '0', '9007199254740993', '9223372036854775807', '18446744073709551614', largest, null], 'UNSIGNED'), expected: (bins: 5 | 10 | 20) => sparse(bins, [[0, 3], [Math.ceil(bins / 2) - 1, 1], [bins - 1, 2]]), nonNull: '6', nulls: '1', min: '0', max: largest })),
    { name: 'DECIMAL65位异号极值', type: 'DECIMAL(65,30)', relation: relation(['-' + huge, '0', huge, null], 'DECIMAL(65,30)'), expected: bins => sparse(bins, [[0, 1], [Math.floor(bins / 2), 1], [bins - 1, 1]]), nonNull: '3', nulls: '1' },
    { name: 'DECIMAL最末小数位', type: 'DECIMAL(65,30)', relation: relation(['-' + quantum + '3', '-' + quantum + '2', '-' + quantum + '1', quantum + '0', quantum + '1', quantum + '2', quantum + '3', null], 'DECIMAL(65,30)'), expected: bins => bins === 5 ? ['2', '1', '1', '1', '2'] : Array(7).fill('1'), nonNull: '7', nulls: '1' },
    { name: '常量和NULL', type: 'BIGINT', relation: relation(['17', '17', null], 'SIGNED'), expected: () => ['2'], nonNull: '2', nulls: '1', min: '17', max: '17' },
    { name: '全部NULL', type: 'DECIMAL(30,12)', relation: relation([null, null], 'DECIMAL(30,12)'), expected: () => [], nonNull: '0', nulls: '2' },
    { name: 'FLOAT精确二进制代表值', type: 'FLOAT', relation: relation([String(Math.fround(.1)) + 'e0', String(Math.fround(.1)) + 'e0', String(Math.fround(.2)) + 'e0', null]), expected: bins => sparse(bins, [[0, 2], [bins - 1, 1]]), nonNull: '3', nulls: '1', min: String(Math.fround(.1)), max: String(Math.fround(.2)) },
    { name: 'DOUBLE极大异号范围', type: 'DOUBLE', relation: relation([String(-Number.MAX_VALUE), '0e0', String(Number.MAX_VALUE), null]), expected: bins => sparse(bins, [[0, 1], [Math.floor(bins / 2), 1], [bins - 1, 1]]), nonNull: '3', nulls: '1', min: String(-Number.MAX_VALUE), max: String(Number.MAX_VALUE) },
    { name: '原筛选分组与停用条件', type: 'INT', relation: relation(['0', '1', '19', '20', '21', '50', '99', '100', null], 'SIGNED'), filter: true, expected: bins => sparse(bins, [[0, 2], [bins - 1, 1]]), nonNull: '3', nulls: '0', min: '20', max: '50' },
    { name: '原列与聚合别名同名', type: 'INT', column: 'h_nonNull', relation: relation(['0', '0', '100', null], 'SIGNED').replaceAll(' AS n', ' AS `h_nonNull`'), expected: bins => sparse(bins, [[0, 2], [bins - 1, 1]]), nonNull: '3', nulls: '1', min: '0', max: '100' },
  ];
  return vectors.flatMap(vector => ([5, 10, 20] as const).map(bins => {
    const column = vector.column ?? 'n', source: TableInfo = { database: 'dbark_readonly', name: 'subject', objectKind: 'table', engine: 'InnoDB', columns: [{ name: column, type: vector.type, nullable: true, defaultValue: null, extra: '', generated: false, comment: '' }], indexes: [], primaryKey: [], editableKey: [], foreignKeys: [], ddl: '' };
    const input: TableStatisticsInput = { connectionId: 'readonly', database: source.database, table: source.name, taskId: 'readonly-vector', columns: [], histogram: { column, bins }, filters: vector.filter ? [{ column, operator: '>=', value: '20' }, { column, operator: '<=', value: '50' }, { column, operator: 'IS NULL', enabled: false }] : [], ...(vector.filter ? { filterMode: 'all', filterGroup: { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] } } as const : {}) };
    /** 仅替换唯一物理FROM，聚合、区间、筛选和解码都保持产品实现。 */
    const derived = (sql: string) => { const from = 'FROM `dbark_readonly`.`subject`'; if (sql.split(from).length !== 2) throw Error('分布只读来源不唯一'); return sql.replace(from, `FROM (${vector.relation}) AS subject`); };
    return { name: vector.name + '/' + bins, source, input, derived, expected: vector.expected(bins), nonNull: vector.nonNull, nulls: vector.nulls, min: vector.min, max: vector.max };
  }));
}
