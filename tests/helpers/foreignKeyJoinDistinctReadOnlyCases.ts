import type { TableInfo } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';

/** SELECT派生表专供零写入语义验收；独立预期不通过产品去重或参照SQL生成。 */
export function foreignKeyJoinDistinctReadOnlyCases() {
  const info = (name: string, fields: Record<string, string>): TableInfo => ({ database: 'join_distinct_fixture', name, objectKind: 'table', engine: 'InnoDB', columns: Object.entries(fields).map(([name, type]) => ({ name, type, nullable: true, generated: false, extra: '', comment: '', defaultValue: null })), foreignKeys: [], indexes: [], primaryKey: [], editableKey: [], ddl: '' });
  const child = info('child', { id: 'BIGINT UNSIGNED', pid: 'BIGINT UNSIGNED', label: 'TEXT' }), parent = info('parent', { id: 'BIGINT UNSIGNED', amount: 'DECIMAL(30,4)' });
  child.foreignKeys = [{ name: 'fk', columns: ['pid'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }];
  const big = '18446744073709551615', amount = '99999999999999999999.1234', special = "中文'\\\0🚢";
  const integer = (value: string | null) => value === null ? 'NULL' : "CAST('" + value + "' AS UNSIGNED)";
  const string = (value: string | null) => value === null ? 'NULL' : "CONVERT(X'" + Buffer.from(value, 'utf8').toString('hex') + "' USING utf8mb4) COLLATE utf8mb4_bin";
  const c = ['9007199254740993', '9007199254740994', big, '9007199254740995', '9007199254740996', '18446744073709551614'].map((id, i) => 'SELECT ' + integer(id) + ' AS id,' + integer(['100', '100', '200', null, null, '300'][i]) + ' AS pid,' + string([special, special, 'a', null, null, 'A'][i]) + ' AS label').join('\nUNION ALL\n');
  const p = ['100', '200', '300'].map((id, i) => 'SELECT ' + integer(id) + " AS id,CAST('" + ['12.3400', '12.3400', amount][i] + "' AS DECIMAL(30,4)) AS amount").join('\nUNION ALL\n');
  const order: ForeignKeyJoinOptions['sort'] = [{ side: 'parent', column: 'id', direction: 'ASC', nulls: 'LAST' }];
  const base: ForeignKeyJoinOptions = { childColumns: [], parentColumns: ['id'], distinct: true, sort: order };
  const cases: { name: string; options: ForeignKeyJoinOptions; expected: Record<string, unknown>[]; kind?: 'LEFT' | 'INNER' }[] = [
    { name: '原普通明细保留重复父行及重复NULL', options: { ...base, distinct: false }, expected: ['100', '100', '200', '300', null, null].map(p_1_id => ({ p_1_id })) },
    { name: '仅父列去重且NULL组合只留一行', options: base, expected: ['100', '200', '300', null].map(p_1_id => ({ p_1_id })) },
    { name: '去重后再LIMIT不截取前两条重复行', options: { ...base, limit: 2 }, expected: [{ p_1_id: '100' }, { p_1_id: '200' }] },
    { name: 'INNER去重不产生未匹配NULL', options: base, kind: 'INNER', expected: ['100', '200', '300'].map(p_1_id => ({ p_1_id })) },
    { name: '不同父行的相同精确金额合并', options: { ...base, parentColumns: ['amount'], sort: [{ side: 'parent', column: 'amount', direction: 'ASC', nulls: 'LAST' }] }, expected: ['12.3400', amount, null].map(p_2_amount => ({ p_2_amount })) },
    { name: '同侧未投影键仍可用于WHERE', options: { ...base, filters: [{ side: 'child', column: 'id', operator: '>', value: '9007199254740993' }] }, expected: ['100', '200', '300', null].map(p_1_id => ({ p_1_id })) },
    { name: '父NULL去重后只有一行', options: { ...base, filters: [{ side: 'parent', column: 'id', operator: 'IS NULL' }] }, expected: [{ p_1_id: null }] },
    { name: '重复的特殊文本及NULL按完整输出去重', options: { ...base, childColumns: ['label'], parentColumns: [], sort: [{ side: 'child', column: 'label', direction: 'ASC', nulls: 'LAST' }] }, expected: ['A', 'a', special, null].map(c_3_label => ({ c_3_label })) },
    { name: '组合去重不会分别对各列去重', options: { ...base, childColumns: ['label'], parentColumns: ['amount'], sort: [{ side: 'child', column: 'label', direction: 'ASC', nulls: 'LAST' }] }, expected: [{ c_3_label: 'A', p_2_amount: amount }, { c_3_label: 'a', p_2_amount: '12.3400' }, { c_3_label: special, p_2_amount: '12.3400' }, { c_3_label: null, p_2_amount: null }] },
    { name: 'NULL置前及降序仍按同一投影', options: { ...base, sort: [{ side: 'parent', column: 'id', direction: 'DESC', nulls: 'FIRST' }] }, expected: [null, '300', '200', '100'].map(p_1_id => ({ p_1_id })) },
    { name: '加入子侧唯一ID后不再合并重复父行且保UINT64', options: { ...base, childColumns: ['id'], sort: [{ side: 'child', column: 'id', direction: 'DESC' }], limit: 2 }, expected: [{ c_1_id: big, p_1_id: '200' }, { c_1_id: '18446744073709551614', p_1_id: '300' }] },
    { name: '空结果保持空', options: { ...base, filters: [{ side: 'child', column: 'id', operator: '<', value: '1' }] }, expected: [] },
  ];
  return cases.map(test => {
    const generated = buildForeignKeyJoin(child, parent, 'fk', test.kind ?? 'LEFT', 43, test.options).sql;
    const from = 'FROM `join_distinct_fixture`.`child` AS c\n' + (test.kind ?? 'LEFT') + ' JOIN `join_distinct_fixture`.`parent` AS p\n';
    if (generated.split(from).length !== 2) throw Error('去重语义夹具FROM替换不唯一');
    return { ...test, generated, sql: generated.replace(from, 'FROM (\n' + c + '\n) AS c\n' + (test.kind ?? 'LEFT') + ' JOIN (\n' + p + '\n) AS p\n') };
  });
}
