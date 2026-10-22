import { expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { tableStatisticsColumnKind, type TableStatisticsOutput } from '../../src/shared/tableStatistics';
import { TableStatisticsIntent, type TableStatisticsConditions } from '../../src/renderer/tableStatisticsIntent';
import { checkTableStatisticsOutput, tableStatisticsCellPreview } from '../../src/renderer/tableStatisticsResult';

const source: TableInfo = { database: 'db', name: 'table', engine: 'InnoDB', objectKind: 'table', columns: [{ name: 'amount', type: 'decimal(30,6)', defaultValue: null, extra: '', nullable: true, generated: false, comment: '' }], primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], ddl: 'CREATE TABLE table (`amount` decimal(30,6))' };
const conditions: TableStatisticsConditions = { filters: [{ column: 'amount', operator: '>=', value: '9007199254740993.000001' }, { column: 'amount', operator: 'IS NULL', enabled: false }], filterMode: 'any', filterGroup: { mode: 'all', children: [0, { mode: 'any', children: [1] }] } };
/** 回执均为RAM合成，测试不冒充数据库数值语义或全表读取。 */
function fixture() {
  let active = true; const first = {}, captured = new TableStatisticsIntent(source, conditions, [first, 1], () => active);
  const output: TableStatisticsOutput = { source: structuredClone(source), sourceDigest: 'a'.repeat(64), rowCount: '1000001', columns: [{ name: 'amount', type: 'decimal(30,6)', kind: 'numeric', nonNull: '1000000', nulls: '1', min: '9007199254740993.000001', max: '999999999999999999.999999', sum: '1234567890123456789012345.123456', avg: '1234567890123456789.0123456789', approximate: false }], warnings: [] };
  return { captured, output, first, off: () => { active = false; }, on: () => { active = true; } };
}
it('冻结原筛选精确值、停用标记、嵌套分组且不持有加载页计算数据', () => { const f = fixture(); expect(f.captured.conditions).toEqual(conditions); expect(f.captured.conditions).not.toBe(conditions); expect(Object.isFrozen(f.captured.conditions.filters[0])).toBe(true); expect(Object.hasOwn(f.captured, 'rows')).toBe(false); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output)).not.toThrow(); expect(f.output.rowCount).toBe('1000001'); });
it('行/页面/条件ABA永久撤销，回到同值不追认旧统计', async () => { const f = fixture(), notices: boolean[] = []; f.captured.subscribe(() => notices.push(f.captured.current())); f.captured.observe([{}, 1]); f.captured.observe([f.first, 1]); expect(f.captured.current()).toBe(false); await Promise.resolve(); expect(notices).toEqual([false]); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output)).toThrow(); });
it('同步活动标签或连接门失效不可复活，未知门异常同样拒绝', () => { const f = fixture(); f.off(); expect(f.captured.current()).toBe(false); f.on(); expect(f.captured.current()).toBe(false); const unknown = new TableStatisticsIntent(source, conditions, [], () => { throw Error('未知原身份'); }); expect(unknown.current()).toBe(false); });
it('BIGINT计数和DECIMAL极值、SUM/AVG原字符串不转换浮点', () => { const f = fixture(); f.output.rowCount = '18446744073709551615'; f.output.columns[0].nonNull = '18446744073709551614'; checkTableStatisticsOutput(f.captured, ['amount'], f.output); expect(tableStatisticsCellPreview((f.output.columns[0] as { min: string }).min)).toBe('9007199254740993.000001'); expect(f.output.columns[0]).toMatchObject({ sum: '1234567890123456789012345.123456', avg: '1234567890123456789.0123456789' }); });
it('实际NULL、文本NULL、空字符串、完整BLOB包装区分且预览有界', () => { expect(tableStatisticsCellPreview(null)).toContain('空集'); expect(tableStatisticsCellPreview('NULL')).toBe('NULL'); expect(tableStatisticsCellPreview('')).toBe('""'); expect(tableStatisticsCellPreview({ type: 'binary', base64: 'AP8=' })).toBe('0x00ff'); const value = { type: 'binary' as const, base64: Buffer.alloc(600, 255).toString('base64') }; expect(tableStatisticsCellPreview(value).length).toBeLessThanOrEqual(241); expect(value.base64).toBe(Buffer.alloc(600, 255).toString('base64')); });
it('只COUNT时不接纳附加列，空集和全NULL的聚合必须是真null', () => { const f = fixture(); f.output.columns = []; expect(() => checkTableStatisticsOutput(f.captured, [], f.output)).not.toThrow(); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output)).toThrow(); const empty = fixture(); empty.output.rowCount = '0'; Object.assign(empty.output.columns[0], { nonNull: '0', nulls: '0', min: null, max: null, sum: null, avg: null }); expect(() => checkTableStatisticsOutput(empty.captured, ['amount'], empty.output)).not.toThrow(); Object.assign(empty.output.columns[0], { min: '0' }); expect(() => checkTableStatisticsOutput(empty.captured, ['amount'], empty.output)).toThrow(); });
it.each(['source', 'digest', 'name', 'type', 'count', 'non-null-total', 'aggregate-number', 'infinite', 'bad-binary'])('错误%s回执禁止显示', kind => {
  const f = fixture(), column = f.output.columns[0];
  if (kind === 'source') f.output.source.name = 'other'; else if (kind === 'digest') f.output.sourceDigest = 'not-digest'; else if (kind === 'name') column.name = 'other'; else if (kind === 'type') column.type = 'int'; else if (kind === 'count') f.output.rowCount = '01'; else if (kind === 'non-null-total') column.nulls = '0'; else if (kind === 'aggregate-number') Object.assign(column, { sum: 9007199254740992 }); else if (kind === 'infinite') Object.assign(column, { min: Infinity }); else Object.assign(column, { min: { type: 'binary', base64: '!!!!' } });
  expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output)).toThrow();
});
it('视图也可COUNT，原完整视图定义变化拒绝', () => { const view = { ...source, objectKind: 'view' as const, engine: '', ddl: 'CREATE VIEW table AS SELECT 1 AS amount' }, captured = new TableStatisticsIntent(view, { filters: [], filterMode: 'all' }, [], () => true), output = { ...fixture().output, source: view, columns: [] }; expect(() => checkTableStatisticsOutput(captured, [], output)).not.toThrow(); output.source = { ...view, ddl: 'CREATE VIEW table AS SELECT 2 AS amount' }; expect(() => checkTableStatisticsOutput(captured, [], output)).toThrow(); });

/** 同时建立原元数据与受支持回包，避免只给回包换kind掩盖来源类型不一致。 */
function distinctFixture(kind: 'numeric' | 'ordered' | 'count-only' = 'numeric', type = kind === 'numeric' ? 'decimal(30,6)' : kind === 'ordered' ? 'varchar(100)' : 'json') {
  const base = fixture(), original = structuredClone(source); original.columns[0].type = type;
  const captured = new TableStatisticsIntent(original, conditions, [], () => true), previous = base.output.columns[0];
  const counts = { name: previous.name, type, nonNull: previous.nonNull, nulls: previous.nulls };
  const result = kind === 'numeric' ? { ...previous, type } : kind === 'ordered' ? { ...counts, kind: 'ordered' as const, min: '', max: '终值' } : { ...counts, kind: 'count-only' as const, reason: '当前类型只支持数量' };
  const output: TableStatisticsOutput = { ...base.output, source: original, columns: [result] };
  return { captured, output, result };
}
it.each(['numeric', 'ordered'] as const)('开启%s不同值保留完整BIGINT字符串与非NULL上界', kind => {
  const f = distinctFixture(kind); f.output.rowCount = '18446744073709551615'; Object.assign(f.result, { nonNull: '18446744073709551614', distinct: '18446744073709551614' });
  expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).not.toThrow(); expect(f.result).toMatchObject({ distinct: '18446744073709551614' });
});
it.each(['numeric', 'ordered'] as const)('开启%s空集或全NULL只能返回distinct零，不能当作NULL聚合', kind => {
  for (const total of ['0', '3']) {
    const f = distinctFixture(kind); f.output.rowCount = total; Object.assign(f.result, { nonNull: '0', nulls: total, distinct: '0', min: null, max: null, ...(kind === 'numeric' ? { sum: null, avg: null } : {}) });
    expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).not.toThrow();
    Object.assign(f.result, { distinct: '1' }); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
  }
});
it.each([undefined, null, 1, '', '01', '-1', '1.0', '1e3', ' 1', '1 ', '0', '1000001', '184467440737095516150'])('开启时拒绝缺失、非规范或数量矛盾的distinct：%s', value => {
  const f = distinctFixture(); Object.assign(f.result, { distinct: value }); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
});
it('开启时必须有自有distinct字符串，缺失或从原型继承均不能冒充回执', () => {
  const f = distinctFixture(); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
  Object.setPrototypeOf(f.result, { distinct: '1' }); expect(Object.hasOwn(f.result, 'distinct')).toBe(false); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
});
it.each(['numeric', 'ordered', 'count-only'] as const)('默认或显式关闭%s时拒绝多带distinct，包括自有undefined', kind => {
  for (const value of ['1', undefined]) {
    const f = distinctFixture(kind); Object.assign(f.result, { distinct: value });
    expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output)).toThrow(); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, false)).toThrow();
  }
});
it('count-only开启时继续提供计数，但不能多带distinct零或undefined', () => {
  const f = distinctFixture('count-only'); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).not.toThrow();
  for (const value of ['0', undefined]) { Object.assign(f.result, { distinct: value }); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow(); }
});
it('零选列开启不同值不隐选列，任何附加列仍拒绝', () => {
  const f = fixture(); expect(() => checkTableStatisticsOutput(f.captured, [], f.output, true)).toThrow(); f.output.columns = []; expect(() => checkTableStatisticsOutput(f.captured, [], f.output, true)).not.toThrow();
});
it.each(['json', 'geometry', 'point', 'vector(3)', 'unknown'])('原%s类型不能借伪ordered回包升级不同值能力', type => {
  const f = distinctFixture('ordered', type); Object.assign(f.result, { distinct: '1' }); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
  Reflect.deleteProperty(f.result, 'distinct'); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
});
it.each(['decimal(30,6)', 'varchar(80)', 'blob'])('原%s类型不能通过伪count-only回包省略已请求的distinct', type => {
  const f = distinctFixture('count-only', type); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
});
it('已请求不同值仍拒绝数值与有序类型互换，不能按回包kind决定聚合列', () => {
  const f = distinctFixture('ordered', 'bigint unsigned'); Object.assign(f.result, { distinct: '1' }); expect(() => checkTableStatisticsOutput(f.captured, ['amount'], f.output, true)).toThrow();
});
it.each(['tinyint(1)', 'smallint', 'mediumint unsigned', 'int zerofill', 'integer', 'bigint unsigned', 'decimal(65,30)', 'numeric(10,2)', 'fixed(10,2)', 'float', 'double', 'real', 'bit(64)', 'bool', 'boolean', 'year(4)'])('原数值类型%s支持精确不同值计数', type => { expect(tableStatisticsColumnKind(type)).toBe('numeric'); });
it.each(['char(5)', 'varchar(90)', 'tinytext', 'text', 'mediumtext', 'longtext', "enum('x','y')", "set('x','y')", 'binary(5)', 'varbinary(90)', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'date', 'time(6)', 'datetime(6)', 'timestamp(6)'])('原有序类型%s支持服务器不同值语义', type => { expect(tableStatisticsColumnKind(type)).toBe('ordered'); });
it.each(['json', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection', 'vector(3)', 'intention', 'textual', '', 'unknown'])('原未证明类型%s保留count-only', type => { expect(tableStatisticsColumnKind(type)).toBe('count-only'); });
it('能力判断只去类型两端空白并忽略大小写，不修改字段名或来源类型正文', () => { expect(tableStatisticsColumnKind('  BiGiNt UNSIGNED  ')).toBe('numeric'); expect(tableStatisticsColumnKind(' VaRbInArY(100) ')).toBe('ordered'); });
