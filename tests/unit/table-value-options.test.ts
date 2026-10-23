import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { tableValueOptionsColumnCapability, tableValueOptionsLimits, tableValueOptionsMessages, tableValueOptionsSearchPattern, validateTableValueOptionsOutput, type TableValueOptionsOutput } from '../../src/shared/tableValueOptions';
import { decodeTableValueOption as decodeOriginalTableValueOption, planTableValueOptions } from '../../src/engine/tableValueOptions';

/** 普通手写样本的组长度与代表值长度相同；专门的组内MAX案例显式传第四列。 */
const decodeTableValueOption = (plan: Parameters<typeof decodeOriginalTableValueOption>[0], cells: CellValue[]) => decodeOriginalTableValueOption(plan, cells.length === 3 ? [...cells, cells[2]] : cells);

const column = (name: string, type: string): ColumnInfo => ({ name, type, nullable: true, defaultValue: null, generated: false, extra: '', comment: '' });
/** 固定元数据和原始值独立写入，期望不由被测SQL计算。 */
function source(type = 'VARCHAR(100)'): TableInfo {
  return { database: '库`名', name: '表?名', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', columns: [column('__proto__', type), column('amount', 'DECIMAL(65,30)')], indexes: [], primaryKey: [], editableKey: [], foreignKeys: [], ddl: 'CREATE TABLE `表?名` (`__proto__` varchar(100),`amount` decimal(65,30)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' };
}
const plan = (type = 'VARCHAR(100)', searchPattern?: string) => planTableValueOptions(source(type), { column: '__proto__', filters: [], ...(searchPattern !== undefined ? { searchPattern } : {}) });
const expected = { database: '库`名', table: '表?名', column: '__proto__' };
const response = (type = 'VARCHAR(100)'): TableValueOptionsOutput => ({ source: source(type), sourceDigest: 'a'.repeat(64), column: '__proto__', values: [{ value: null, count: '18446744073709551615' }, { value: 'Alpha', count: '2' }], truncated: false, warnings: [tableValueOptionsMessages.scope, tableValueOptionsMessages.equality] });

describe('表列服务器不同值固定SQL与类型能力', () => {
  it('原列GROUP BY/ORDER BY，包含NULL组，500+1有限探测，不调用客户端distinct或覆盖collation', () => {
    const result = plan();
    expect(result.sql).toContain('FROM `库``名`.`表?名` GROUP BY `__proto__` ORDER BY `__proto__` LIMIT 501');
    expect(result.sql).toContain('COUNT(*) AS `n`'); expect(result.sql).toContain('CAST(`g`.`n` AS CHAR) AS `count`');
    expect(result.sql).not.toMatch(/COUNT\(DISTINCT|\bCOLLATE\b|\bBINARY\b|IS NOT NULL|OFFSET|SELECT \*/);
    expect(result.sql).toContain('`g`.`b`<=262144 THEN `g`.`v` ELSE NULL END AS `value`');
    expect(result.sql).toContain('MAX(OCTET_LENGTH(CONVERT(`__proto__` USING utf8mb4))) AS `b`');
    expect(result.sql).not.toMatch(/SUBSTRING|LEFT\(/); expect(result.aliases).toEqual(['value', 'count', 'valueBytes', 'groupBytes']);
  });
  it('完整原筛选嵌套、停用和精确参数不变；额外LIKE与整个条件树相与', () => {
    const result = planTableValueOptions(source(), { column: '__proto__', filters: [{ column: '__proto__', operator: 'IN', values: ['a,b', 'NULL', '中文'] }, { column: 'amount', operator: '>', value: '9007199254740993.123456789012345678901234567890' }, { column: '__proto__', operator: '=', value: '停用值', enabled: false }], filterMode: 'any', filterGroup: { mode: 'any', children: [0, { mode: 'all', children: [1, 2] }] }, searchPattern: "%a_\\'中文?%" });
    expect(result.sql).toContain(' OR '); expect(result.sql).toContain(' AND `__proto__` LIKE ');
    expect(result.sql).toContain('CAST('); expect(result.sql).toContain('DECIMAL(65,30)');
    expect(result.sql).toContain(Buffer.from("%a_\\'中文?%").toString('hex')); expect(result.sql).not.toContain(Buffer.from('停用值').toString('hex'));
    expect(result.searchPattern).toBe("%a_\\'中文?%");
  });
  it('名称只用原元数据列和逐段引用；未知/重复原列拒绝', () => {
    const info = source(); info.columns[0].name = 'x`;DROP TABLE y'; const result = planTableValueOptions(info, { column: info.columns[0].name, filters: [] });
    expect(result.sql).toContain('GROUP BY `x``;DROP TABLE y`');
    expect(() => planTableValueOptions(source(), { column: 'missing', filters: [] })).toThrow();
    info.columns.push({ ...info.columns[0] }); expect(() => planTableValueOptions(info, { column: info.columns[0].name, filters: [] })).toThrow();
    expect(() => planTableValueOptions(source(), { column: '__proto__', filters: [{ column: 'missing', operator: '=', value: '1', enabled: false }] })).toThrow();
  });
  it.each(['TINYINT(1)', 'SMALLINT', 'MEDIUMINT UNSIGNED', 'INT', 'INTEGER', 'BIGINT UNSIGNED', 'BOOL', 'BOOLEAN', 'YEAR(4)'])('%s完整整数文本输出，原列分组不转DOUBLE', type => {
    expect(tableValueOptionsColumnCapability(type)).toBe('integer'); expect(plan(type).sql).toContain('THEN CAST(`g`.`v` AS CHAR)');
    expect(decodeTableValueOption(plan(type), ['18446744073709551615', '1', '20'])).toEqual({ value: '18446744073709551615', count: '1' });
  });
  it.each(['DECIMAL(65,30)', 'NUMERIC(30,12)', 'FIXED(20,6)'])('%s保留尺度与末位原文', type => {
    expect(tableValueOptionsColumnCapability(type)).toBe('decimal');
    const value = '9007199254740993.123456789012345678901234567890';
    expect(decodeTableValueOption(plan(type), [value, '2', String(value.length)]).value).toBe(value);
  });
  it.each(['FLOAT', 'FLOAT(12,6)', 'DOUBLE', 'DOUBLE PRECISION', 'REAL'])('%s必须原binary number，不CAST CHAR制造伪精确值', type => {
    const result = plan(type); expect(result.capability).toBe('floating'); expect(result.sql).toContain('THEN `g`.`v` ELSE NULL');
    expect(result.sql).not.toContain('THEN CAST(`g`.`v` AS CHAR)');
    expect(decodeTableValueOption(result, [Math.fround(0.1), '3', '3']).value).toBe(0.10000000149011612);
    expect(() => decodeTableValueOption(result, ['0.1', '3', '3'])).toThrow();
  });
  it.each(['VARCHAR(100)', 'CHAR(1)', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', "ENUM('z','a')", "SET('z','a')"])('%s保留文本及列服务器相等语义', type => {
    expect(plan(type).capability).toBe('text'); expect(decodeTableValueOption(plan(type), ['中文', '1', '6']).value).toBe('中文');
  });
  it.each(["ENUM('z','a')", "SET('z','a')"])('%s保留原ENUM/SET序号排序，不在派生层改成文本排序', type => {
    const result = plan(type); expect(result.sql).toContain('MIN(`__proto__`+0) AS `s`'); expect(result.sql).toMatch(/ORDER BY `g`.`s`$/);
  });
  it.each(['DATE', 'TIME(6)', 'DATETIME(6)', 'TIMESTAMP(6)'])('%s完整服务器时间文本，不构造JS Date', type => {
    expect(plan(type).capability).toBe('temporal'); const value = '2026-10-23 12:34:56.123456';
    expect(decodeTableValueOption(plan(type), [value, '2', String(value.length)]).value).toBe(value);
  });
  it.each(['BIT(1)', 'BIT(64)', 'JSON', 'BINARY(5)', 'VARBINARY(100)', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'POINT', 'GEOMETRY', 'UNKNOWN'])('%s不能自动转字符串冒充可筛选标量', type => {
    expect(tableValueOptionsColumnCapability(type)).toBe('unsupported'); expect(() => plan(type)).toThrow(tableValueOptionsMessages.unsupported);
  });
  it('LIKE搜索为空只规范请求，不补通配符、不trim、非空不混入NULL', () => {
    expect(plan('VARCHAR(100)', '').searchPattern).toBeUndefined(); expect(plan('VARCHAR(100)', '').sql).not.toContain('LIKE');
    expect(plan('VARCHAR(100)', '  %_  ').searchPattern).toBe('  %_  ');
    expect(tableValueOptionsSearchPattern('😀'.repeat(256))).toBe('😀'.repeat(256));
    for (const invalid of ['x'.repeat(257), '\ud800', '\udc00', 3, null]) expect(() => tableValueOptionsSearchPattern(invalid)).toThrow();
  });
});

describe('原流行解码及有界完整值', () => {
  it('NULL与空串和文本NULL均分开，COUNT最大值保持文本', () => {
    expect(decodeTableValueOption(plan(), [null, '18446744073709551615', null])).toEqual({ value: null, count: '18446744073709551615' });
    expect(decodeTableValueOption(plan(), ['', '1', '0']).value).toBe(''); expect(decodeTableValueOption(plan(), ['NULL', '3', '4']).value).toBe('NULL');
  });
  it.each([['0', '1'], ['01', '1'], ['-1', '1'], ['1.0', '1'], [2, '1'], ['1', 1], ['1', '01'], ['1', '-1']])('原计数/字节事实%j不能Number或String强转', (count, bytes) => {
    expect(() => decodeTableValueOption(plan(), ['a', count as CellValue, bytes as CellValue])).toThrow();
  });
  it('超限保护的NULL不能被当原NULL，UTF8真实字节需与服务器一致', () => {
    expect(() => decodeTableValueOption(plan(), [null, '1', '262145'])).toThrow('预算');
    expect(() => decodeTableValueOption(plan(), [null, '1', '1'])).toThrow(); expect(() => decodeTableValueOption(plan(), ['a', '1', null])).toThrow();
    expect(() => decodeTableValueOption(plan(), ['中文', '1', '2'])).toThrow(); expect(() => decodeTableValueOption(plan(), ['a'.repeat(262145), '1', '1'])).toThrow('预算');
    expect(decodeTableValueOption(plan(), ['a'.repeat(262144), '1', '262144']).value).toHaveLength(262144);
  });
  it('同一原相等组代表值较短允许MAX较大，超限组成员不能被短代表值隐藏', () => {
    expect(decodeOriginalTableValueOption(plan(), ['A', '2', '1', '2'])).toEqual({ value: 'A', count: '2' });
    expect(() => decodeOriginalTableValueOption(plan(), [null, '2', '262144', '262145'])).toThrow('预算');
    expect(() => decodeOriginalTableValueOption(plan(), ['a'.repeat(262144), '2', '262144', '262145'])).toThrow('预算');
    expect(() => decodeOriginalTableValueOption(plan(), ['中文', '1', '6', '5'])).toThrow();
    expect(() => decodeOriginalTableValueOption(plan(), [null, '1', null, '0'])).toThrow();
    expect(() => decodeOriginalTableValueOption(plan(), ['a', '1', '1'])).toThrow();
  });
  it('非空LIKE不接受NULL，不可空原列也不接受NULL', () => {
    expect(() => decodeTableValueOption(plan('VARCHAR(100)', '%'), [null, '1', null])).toThrow();
    const value = plan(); value.column.nullable = false; expect(() => decodeTableValueOption(value, [null, '1', null])).toThrow();
  });
  it('数值类型不降为binary/boolean，浮点不得非有限或伪十进制串', () => {
    for (const value of [{ type: 'binary', base64: '' }, false, NaN, Infinity, -Infinity]) expect(() => decodeTableValueOption(plan('DOUBLE'), [value as CellValue, '1', '1'])).toThrow();
    for (const value of [42, '1e2', 'NaN']) expect(() => decodeTableValueOption(plan('DECIMAL(20,8)'), [value, '1', String(String(value).length)])).toThrow();
    expect(() => decodeTableValueOption(plan('BIGINT'), ['1.00', '1', '4'])).toThrow();
  });
});

describe('跨进程完整候选回执门', () => {
  it('完整元数据/原不同值/原正计数原样返回，不客户端重分组或重写数量', () => {
    const output = response(); expect(validateTableValueOptionsOutput(output, expected)).toBe(output); expect(output.values[0].count).toBe('18446744073709551615');
    output.values.push({ value: 'alpha', count: '1' }); expect(validateTableValueOptionsOutput(output, expected)).toBe(output);
  });
  it('明确搜索来源不同或空串自有回包拒绝，NULL组不能混入搜索页', () => {
    const output = response(); output.values.shift(); output.searchPattern = '%a%'; expect(validateTableValueOptionsOutput(output, { ...expected, searchPattern: '%a%' })).toBe(output);
    expect(() => validateTableValueOptionsOutput(output, expected)).toThrow(); output.values.push({ value: null, count: '2' }); expect(() => validateTableValueOptionsOutput(output, { ...expected, searchPattern: '%a%' })).toThrow();
    output.searchPattern = ''; expect(() => validateTableValueOptionsOutput(output, expected)).toThrow();
  });
  it('来源、字段、digest、元数据类别及回包自报类型不允许偷换', () => {
    const patches = [(output: TableValueOptionsOutput) => { output.source.name = 'other'; }, (output: TableValueOptionsOutput) => { output.column = 'amount'; }, (output: TableValueOptionsOutput) => { output.sourceDigest = 'not-a-hash'; }, (output: TableValueOptionsOutput) => { output.source.columns.push(output.source.columns[0]); }, (output: TableValueOptionsOutput) => { output.source.columns[0].type = 'JSON'; }, (output: TableValueOptionsOutput) => { output.source.objectKind = undefined; }, (output: TableValueOptionsOutput) => { output.source.columns[0].nullable = false; }];
    for (const patch of patches) { const output = response(); patch(output); expect(() => validateTableValueOptionsOutput(output, expected)).toThrow(); }
  });
  it('500组硬界，截断只能500且不暗示剩余组已读取，分组数不参与Number运算', () => {
    const output = response(); output.values = Array.from({ length: 500 }, (_, index) => ({ value: String(index), count: '9007199254740993' })); output.truncated = true;
    expect(validateTableValueOptionsOutput(output, expected)).toBe(output); output.values.pop(); expect(() => validateTableValueOptionsOutput(output, expected)).toThrow();
    output.truncated = false; output.values = Array.from({ length: 501 }, (_, index) => ({ value: String(index), count: '1' })); expect(() => validateTableValueOptionsOutput(output, expected)).toThrow();
    expect(tableValueOptionsLimits.pageSize).toBe(50);
  });
  it('重复原值、缺失值、非正计数、超预算及活性getter不能蒙混通过', () => {
    const duplicate = response(); duplicate.values.push({ value: 'Alpha', count: '3' }); expect(() => validateTableValueOptionsOutput(duplicate, expected)).toThrow();
    for (const count of ['0', '01', '-1', '1.0', 5, undefined]) { const output = response(); output.values[0].count = count as string; expect(() => validateTableValueOptionsOutput(output, expected)).toThrow(); }
    const oversized = response(); oversized.values = Array.from({ length: 40 }, (_, index) => ({ value: String(index) + 'a'.repeat(250000), count: '1' })); expect(() => validateTableValueOptionsOutput(oversized, expected)).toThrow('预算');
    const getter = response(); let calls = 0; Object.defineProperty(getter.values[0], 'value', { enumerable: true, get() { calls++; return null; } }); expect(() => validateTableValueOptionsOutput(getter, expected)).toThrow(); expect(calls).toBe(0);
    const sparse = response(); sparse.values = Array(1); expect(() => validateTableValueOptionsOutput(sparse, expected)).toThrow();
  });
  it('跨进程回执任意非枚举字段继续拒绝，不能借内部标记修复放宽plainData边界', () => {
    for (const property of ['unsupportedDesign', 'hiddenPayload']) {
      const output = response(); Object.defineProperty(output.source, property, { value: true, enumerable: false });
      expect(() => validateTableValueOptionsOutput(output, expected)).toThrow();
    }
    const output = response(); let calls = 0; Object.defineProperty(output.source, 'hiddenPayload', { enumerable: false, get() { calls++; return true; } });
    expect(() => validateTableValueOptionsOutput(output, expected)).toThrow(); expect(calls).toBe(0);
  });
  it('binary FLOAT32 widened、DOUBLE大值和-0保留浮点而不要求safeinteger', () => {
    const output = response('FLOAT'); output.values = [{ value: Math.fround(0.1), count: '1' }, { value: -0, count: '2' }, { value: Number.MAX_VALUE, count: '3' }];
    expect(validateTableValueOptionsOutput(output, expected)).toBe(output); expect(Object.is(output.values[1].value, -0)).toBe(true);
  });
});
