import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo, TableInfo } from '../../src/shared/contracts';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { buildPageSql, buildTableFilterSql } from '../../src/engine/sql';
import { decodeTableStatistics, planTableStatistics, tableStatisticsColumnCapability, tableStatisticsSourceIdentity } from '../../src/engine/tableStatistics';

const column = (name: string, type: string): ColumnInfo => ({ name, type, nullable: true, defaultValue: null, generated: false, extra: '', comment: '' });
/** 元数据含真实服务器类型字符串，不把类型当作可执行SQL。 */
function source(): TableInfo {
  return { database: '库`名', name: '表`名', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', columns: [column('__proto__', 'BIGINT UNSIGNED'), column('amount', 'DECIMAL(65,30)'), column('floating', 'FLOAT'), column('label', 'VARCHAR(100)'), column('binary', 'BLOB'), column('created', 'DATETIME(6)'), column('allnull', 'INT'), column('doc', 'JSON'), column('shape', 'POINT')], indexes: [], primaryKey: [], editableKey: [], foreignKeys: [], ddl: 'CREATE TABLE `表``名` (`__proto__` bigint unsigned,`amount` decimal(65,30),`floating` float,`label` varchar(100),`binary` blob,`created` datetime(6),`allnull` int,`doc` json,`shape` point) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4' };
}
const request = (columns: string[]) => ({ columns, filters: [] });
/** 按固定服务端别名投影原数据，不由实现重新计算预期统计值。 */
function values(plan: ReturnType<typeof planTableStatistics>, row: Record<string, CellValue>): CellValue[] { return plan.aliases.map(alias => Object.hasOwn(row, alias) ? row[alias] : null); }

describe('全部服务器筛选范围的单条统计SQL', () => {
  it('零列只请求COUNT，不读取客户端页、不排序、不LIMIT，不混入原列名为别名', () => {
    const plan = planTableStatistics(source(), request([]));
    expect(plan.sql).toBe('SELECT CAST(`s_rows` AS CHAR) AS `rowCount` FROM (SELECT COUNT(*) AS `s_rows` FROM `库``名`.`表``名`) AS `dbark_statistics`');
    expect(plan.aliases).toEqual(['rowCount']); expect(plan.sql).not.toContain('SELECT *'); expect(plan.sql).not.toContain('LIMIT');
    expect(decodeTableStatistics(plan, ['18446744073709551615'])).toEqual({ rowCount: '18446744073709551615', columns: [] });
  });
  it('MIN/MAX在派生聚合外按真实UTF8或二进制字节CASE限长，原值不SUBSTRING截断', () => {
    const plan = planTableStatistics(source(), request(['label', 'binary', '__proto__']));
    expect(plan.sql).toContain('MIN(`label`) AS `c0_min`'); expect(plan.sql).toContain('OCTET_LENGTH(CONVERT(`c0_min` USING utf8mb4))<=262144 THEN `c0_min` ELSE NULL');
    expect(plan.sql).toContain('CAST(OCTET_LENGTH(CONVERT(`c0_min` USING utf8mb4)) AS CHAR) AS `c0_minBytes`');
    expect(plan.sql).toContain('OCTET_LENGTH(`c1_min`)<=262144'); expect(plan.sql).toContain('CAST(`c2_sum` AS CHAR)'); expect(plan.sql).toContain('CAST(`c2_avg` AS CHAR)');
    expect(plan.sql).not.toContain('SUBSTRING'); expect(plan.sql).not.toContain('LEFT('); expect(plan.aliases[0]).toBe('rowCount');
  });
  it('复用原筛选构建器，嵌套OR/启停/IN文本保持原值，不把分页尾巴当统计范围', () => {
    const info = source(), input = { columns: ['amount'], filters: [{ column: 'label', operator: 'IN' as const, values: ['a,b', 'NULL', '中文'] }, { column: 'amount', operator: '>' as const, value: '9007199254740993.12345678901234567890' }, { column: 'label', operator: 'LIKE' as const, value: '%a_\\b%', enabled: false }], filterMode: 'any' as const, filterGroup: { mode: 'any' as const, children: [0, { mode: 'all' as const, children: [1, 2] }] } };
    const filter = buildTableFilterSql(info, input.filters, input.filterMode, input.filterGroup), page = buildPageSql(info, 2, 25, input.filters, [], input.filterMode, input.filterGroup), plan = planTableStatistics(info, input);
    expect(page.sql).toContain(' WHERE ' + filter.where); expect(filter.params).toEqual(['a,b', 'NULL', '中文', '9007199254740993.12345678901234567890']);
    expect(plan.sql).toContain(' OR '); expect(plan.sql).toContain(Buffer.from('9007199254740993.12345678901234567890').toString('hex')); expect(plan.sql).not.toContain('LIMIT'); expect(plan.sql).not.toContain('OFFSET'); expect(plan.sql).not.toContain('LIKE');
  });
  it('字段选择顺序保持、重复/未知/超过12列拒绝；危险名称只作为真实标识符引用', () => {
    const info = source(); expect(planTableStatistics(info, request(['label', '__proto__'])).columns.map(item => item.column.name)).toEqual(['label', '__proto__']);
    for (const columns of [['missing'], ['label', 'label'], Array.from({ length: 13 }, (_, index) => String(index))]) expect(() => planTableStatistics(info, request(columns))).toThrow();
    info.columns[3].name = 'x`;DROP TABLE y'; expect(planTableStatistics(info, request(['x`;DROP TABLE y'])).sql).toContain('MIN(`x``;DROP TABLE y`)');
  });
  it.each(['JSON', 'GEOMETRY', 'POINT', 'LINESTRING', 'UNKNOWN_TYPE'])('%s仅计数，不尝试伪造MIN/MAX或数值能力', type => {
    const info = source(); info.columns[0].type = type; const plan = planTableStatistics(info, request(['__proto__']));
    expect(plan.columns[0].capability.kind).toBe('count-only'); expect(plan.sql).not.toContain('MIN('); expect(plan.sql).not.toContain('SUM(');
    expect(decodeTableStatistics(plan, ['4', '3', '1']).columns[0]).toMatchObject({ kind: 'count-only', nonNull: '3', nulls: '1' });
  });
  it.each(['TINYINT', 'BIGINT UNSIGNED', 'DECIMAL(65,30)', 'BIT(64)', 'YEAR'])('%s保留服务器精确合计文本', type => { expect(tableStatisticsColumnCapability(column('c', type))).toMatchObject({ kind: 'numeric', approximate: false }); });
  it.each(['FLOAT', 'DOUBLE', 'REAL'])('%s必须标记近似', type => { expect(tableStatisticsColumnCapability(column('c', type))).toMatchObject({ kind: 'numeric', approximate: true }); });
  it('BIT64全部数值聚合显式服务器unsigned，COUNT仍按原列而不将字节隐式转文本', () => {
    const info = source(); info.columns[0].type = 'BIT(64)'; const plan = planTableStatistics(info, request(['__proto__']));
    expect(plan.sql).toContain('COUNT(`__proto__`) AS `c0_count`');
    for (const operation of ['MIN', 'MAX', 'SUM', 'AVG']) expect(plan.sql).toContain(`${operation}(CAST(\`__proto__\` AS UNSIGNED))`);
    const row = { rowCount: '1', c0_nonNull: '1', c0_nulls: '0', c0_min: '18446744073709551615', c0_minBytes: '20', c0_max: '18446744073709551615', c0_maxBytes: '20', c0_sum: '18446744073709551615', c0_avg: '18446744073709551615.0000' };
    expect(decodeTableStatistics(plan, values(plan, row)).columns[0]).toMatchObject({ kind: 'numeric', min: '18446744073709551615', sum: '18446744073709551615', approximate: false });
    expect(() => decodeTableStatistics(plan, values(plan, { ...row, c0_min: 18446744073709551615 }))).toThrow();
    expect(() => decodeTableStatistics(plan, values(plan, { ...row, c0_max: { type: 'binary', base64: '//////////8=' } }))).toThrow();
  });
});

describe('原服务器单行统计解码与精度', () => {
  it('UINT64计数、DECIMAL30位、浮点近似、二进制及微秒都不经过客户端求和或Number', () => {
    const plan = planTableStatistics(source(), request(['amount', 'floating', 'binary', 'created']));
    const row: Record<string, CellValue> = { rowCount: '18446744073709551615',
      c0_nonNull: '18446744073709551614', c0_nulls: '1', c0_min: '0.000000000000000000000000000001', c0_minBytes: '32', c0_max: '99999999999999999999.123456789012345678901234567890', c0_maxBytes: '51', c0_sum: '999999999999999999999999999999.123456789012345678901234567890', c0_avg: '0.123456789012345678901234567890',
      c1_nonNull: '18446744073709551614', c1_nulls: '1', c1_min: 1.0000001192092896, c1_minBytes: '18', c1_max: 1.000000238418579, c1_maxBytes: '17', c1_sum: '2.0000003576278687', c1_avg: '1.0000001788139343',
      c2_nonNull: '18446744073709551614', c2_nulls: '1', c2_min: { type: 'binary', base64: '' }, c2_minBytes: '0', c2_max: { type: 'binary', base64: 'AP8=' }, c2_maxBytes: '2',
      c3_nonNull: '18446744073709551614', c3_nulls: '1', c3_min: '2000-01-01 00:00:00.000001', c3_minBytes: '26', c3_max: '2026-10-22 23:59:59.999999', c3_maxBytes: '26' };
    const output = decodeTableStatistics(plan, values(plan, row)); expect(output.rowCount).toBe('18446744073709551615');
    expect(output.columns[0]).toMatchObject({ kind: 'numeric', min: row.c0_min, max: row.c0_max, sum: row.c0_sum, avg: row.c0_avg, approximate: false }); expect(output.columns[1]).toMatchObject({ min: row.c1_min, approximate: true });
    expect(output.columns[2]).toMatchObject({ kind: 'ordered', min: { type: 'binary', base64: '' }, max: { type: 'binary', base64: 'AP8=' } }); expect(output.columns[3]).toMatchObject({ min: row.c3_min, max: row.c3_max });
  });
  it.each(['0', '123'])('空集或全部NULL行数%s，极值及SUM/AVG明确为NULL', rowCount => {
    const plan = planTableStatistics(source(), request(['allnull', 'label'])), row = { rowCount, c0_nonNull: '0', c0_nulls: rowCount, c1_nonNull: '0', c1_nulls: rowCount };
    const result = decodeTableStatistics(plan, values(plan, row)); expect(result.columns[0]).toMatchObject({ nonNull: '0', min: null, max: null, sum: null, avg: null }); expect(result.columns[1]).toMatchObject({ min: null, max: null });
  });
  it('服务端超限事实不能当成NULL结果，真实值超限/计数矛盾/非规范数值均拒绝', () => {
    const plan = planTableStatistics(source(), request(['amount']));
    const original: Record<string, CellValue> = { rowCount: '1', c0_nonNull: '1', c0_nulls: '0', c0_min: '1.00', c0_minBytes: '4', c0_max: '1.00', c0_maxBytes: '4', c0_sum: '1.00', c0_avg: '1.000000' };
    const patches: Record<string, CellValue>[] = [{ c0_min: null, c0_minBytes: '262145' }, { c0_min: 'x'.repeat(262145) }, { c0_nulls: '1' }, { rowCount: '01' }, { c0_sum: 'NaN' }, { c0_avg: 1 }, { c0_nonNull: '0', c0_nulls: '1' }, { c0_max: null }];
    for (const patch of patches) expect(() => decodeTableStatistics(plan, values(plan, { ...original, ...patch }))).toThrow();
  });
  it('文本UTF8/二进制输出长度必须与服务器事实一致，不能用小长度掩盖另一值', () => {
    const plan = planTableStatistics(source(), request(['label', 'binary'])), row: Record<string, CellValue> = { rowCount: '1', c0_nonNull: '1', c0_nulls: '0', c0_min: '中文', c0_minBytes: '6', c0_max: '中文', c0_maxBytes: '6', c1_nonNull: '1', c1_nulls: '0', c1_min: { type: 'binary', base64: 'AP8=' }, c1_minBytes: '2', c1_max: { type: 'binary', base64: 'AP8=' }, c1_maxBytes: '2' };
    expect(decodeTableStatistics(plan, values(plan, row)).columns).toHaveLength(2);
    expect(() => decodeTableStatistics(plan, values(plan, { ...row, c0_minBytes: '2' }))).toThrow(); expect(() => decodeTableStatistics(plan, values(plan, { ...row, c1_maxBytes: '1' }))).toThrow();
  });
});

describe('按需服务器COUNT(DISTINCT)', () => {
  it('省略与false的SQL、计划及旧结果形状完全一致', () => {
    const info = source(), input = request(['__proto__', 'label', 'binary', 'doc']);
    const omitted = planTableStatistics(info, input), disabled = planTableStatistics(info, { ...input, distinct: false });
    expect(disabled).toEqual(omitted); expect(omitted.sql).not.toContain('DISTINCT');
    expect(omitted.columns.every(item => !Object.hasOwn(item, 'distinct'))).toBe(true);
    const plan = planTableStatistics(info, request(['label']));
    const row = { rowCount: '1', c0_nonNull: '1', c0_nulls: '0', c0_min: 'A', c0_minBytes: '1', c0_max: 'A', c0_maxBytes: '1' };
    expect(Object.hasOwn(decodeTableStatistics(plan, values(plan, row)).columns[0], 'distinct')).toBe(false);
  });
  it('文字ci、二进制和大整数去重使用原列，不覆盖排序规则或转换为近似数', () => {
    const info = source(); info.collation = 'utf8mb4_general_ci';
    const plan = planTableStatistics(info, { ...request(['label', 'binary', '__proto__', 'doc']), distinct: true });
    for (const [index, name] of ['label', 'binary', '__proto__'].entries()) {
      expect(plan.sql).toContain(`COUNT(DISTINCT \`${name}\`) AS \`c${index}_distinct\``);
      expect(plan.sql).toContain(`CAST(\`c${index}_distinct\` AS CHAR) AS \`c${index}_distinct\``);
      expect(plan.aliases.indexOf(`c${index}_distinct`)).toBe(plan.aliases.indexOf(`c${index}_nulls`) + 1);
      expect(plan.columns[index].distinct).toBe(true);
    }
    expect(plan.sql).not.toMatch(/\bCOLLATE\b|\bBINARY\b/); expect(plan.columns[3]).not.toHaveProperty('distinct'); expect(plan.sql).not.toContain('c3_distinct');
  });
  it('BIT去重按原bytes列，数值极值和合计继续显式UNSIGNED', () => {
    const info = source(); info.columns[0].type = 'BIT(64)';
    const plan = planTableStatistics(info, { ...request(['__proto__']), distinct: true });
    expect(plan.sql).toContain('COUNT(DISTINCT `__proto__`)'); expect(plan.sql).not.toContain('COUNT(DISTINCT CAST(');
    for (const operation of ['MIN', 'MAX', 'SUM', 'AVG']) expect(plan.sql).toContain(`${operation}(CAST(\`__proto__\` AS UNSIGNED))`);
  });
  it.each([[], ['doc'], ['shape']].map(selected => ({ selected })))('没有支持列%j时不增SQL或结果字段', ({ selected }) => {
    const ordinary = planTableStatistics(source(), request(selected)), enabled = planTableStatistics(source(), { ...request(selected), distinct: true });
    expect(enabled).toEqual(ordinary); expect(enabled.sql).not.toContain('DISTINCT');
    const result = decodeTableStatistics(enabled, selected.length ? ['4', '3', '1'] : ['4']);
    expect(result.columns.every(item => !Object.hasOwn(item, 'distinct'))).toBe(true);
  });
  it.each([null, 0, 1, 'true', {}, []].map(distinct => ({ distinct })))('计划不将非布尔请求%j当作启用', ({ distinct }) => {
    expect(() => planTableStatistics(source(), { ...request(['label']), distinct } as never)).toThrow();
  });
  it('超过安全整数的去重计数保留十进制串，不截断大整数', () => {
    const plan = planTableStatistics(source(), { ...request(['__proto__']), distinct: true });
    const row = { rowCount: '18446744073709551615', c0_nonNull: '18446744073709551615', c0_nulls: '0', c0_distinct: '9007199254740993', c0_min: '0', c0_minBytes: '1', c0_max: '18446744073709551615', c0_maxBytes: '20', c0_sum: '18446744073709551615', c0_avg: '1.0000' };
    expect(decodeTableStatistics(plan, values(plan, row)).columns[0]).toMatchObject({ kind: 'numeric', distinct: '9007199254740993', max: '18446744073709551615' });
  });
  it('文字和binary极值保留原CellValue及各自去重结果', () => {
    const plan = planTableStatistics(source(), { ...request(['label', 'binary']), distinct: true });
    const row: Record<string, CellValue> = { rowCount: '4', c0_nonNull: '3', c0_nulls: '1', c0_distinct: '1', c0_min: 'A', c0_minBytes: '1', c0_max: 'a', c0_maxBytes: '1', c1_nonNull: '3', c1_nulls: '1', c1_distinct: '2', c1_min: { type: 'binary', base64: '' }, c1_minBytes: '0', c1_max: { type: 'binary', base64: 'AP8=' }, c1_maxBytes: '2' };
    const result = decodeTableStatistics(plan, values(plan, row));
    expect(result.columns[0]).toMatchObject({ kind: 'ordered', distinct: '1', min: 'A', max: 'a' });
    expect(result.columns[1]).toMatchObject({ kind: 'ordered', distinct: '2', max: { type: 'binary', base64: 'AP8=' } });
  });
  it.each(['0', '123'])('空集/全NULL行数%s去重明确为0', rowCount => {
    const plan = planTableStatistics(source(), { ...request(['allnull', 'label']), distinct: true });
    const row = { rowCount, c0_nonNull: '0', c0_nulls: rowCount, c0_distinct: '0', c1_nonNull: '0', c1_nulls: rowCount, c1_distinct: '0' };
    expect(decodeTableStatistics(plan, values(plan, row)).columns).toEqual([expect.objectContaining({ distinct: '0', min: null, max: null, sum: null, avg: null }), expect.objectContaining({ distinct: '0', min: null, max: null })]);
    expect(() => decodeTableStatistics(plan, values(plan, { ...row, c1_distinct: '1' }))).toThrow();
  });
  it.each(['0', '4', '01', '-1', '1.0', 'NaN', '', 1, null, undefined])('伪造去重计数%j不命中/不舍入/不当NULL忽略', distinct => {
    const plan = planTableStatistics(source(), { ...request(['label']), distinct: true });
    const row = { rowCount: '4', c0_nonNull: '3', c0_nulls: '1', c0_distinct: distinct, c0_min: 'A', c0_minBytes: '1', c0_max: 'z', c0_maxBytes: '1' };
    expect(() => decodeTableStatistics(plan, values(plan, row as Record<string, CellValue>))).toThrow();
  });
  it('缺失或额外原值不能移位成另一统计字段', () => {
    const plan = planTableStatistics(source(), { ...request(['label']), distinct: true });
    const row = ['4', '3', '1', '2', 'A', '1', 'z', '1'];
    expect(() => decodeTableStatistics(plan, row.slice(1))).toThrow(); expect(() => decodeTableStatistics(plan, [...row, '伪造'])).toThrow();
  });
});

describe('统计结构身份包括视图定义', () => {
  const context = { managed: { sqlMode: '', status: { dialect: 'mysql' } } } as StructureTaskContext;
  it('表尾自增计数可变，列/备注/表达式变化不能混成同次统计', () => {
    const info = source(), digest = tableStatisticsSourceIdentity(info, context);
    expect(tableStatisticsSourceIdentity({ ...info, ddl: info.ddl.replace('AUTO_INCREMENT=17', 'AUTO_INCREMENT=9999') }, context)).toEqual(digest);
    expect(tableStatisticsSourceIdentity({ ...info, ddl: info.ddl.replace('decimal(65,30)', 'decimal(64,30)') }, context).digest).not.toBe(digest.digest);
  });
  it('视图绑定完整原定义且不会把视图SQL中AUTO_INCREMENT词样当表计数', () => {
    const info = { ...source(), objectKind: 'view' as const, engine: '', ddl: "CREATE ALGORITHM=UNDEFINED VIEW `表``名` AS SELECT 'AUTO_INCREMENT=17' AS x" }, original = tableStatisticsSourceIdentity(info, context);
    expect(original.conservative).toBe(false); expect(tableStatisticsSourceIdentity({ ...info, ddl: info.ddl.replace('17', '18') }, context).digest).not.toBe(original.digest);
  });
  it('无法解析的复杂表保守绑定全DDL并显式标记，不静默跳过校验', () => {
    const info = { ...source(), ddl: '复杂未知表定义 AUTO_INCREMENT=17' }, original = tableStatisticsSourceIdentity(info, context);
    expect(original.conservative).toBe(true); expect(tableStatisticsSourceIdentity({ ...info, ddl: info.ddl.replace('17', '18') }, context).digest).not.toBe(original.digest);
  });
});
