import { describe, expect, it, vi } from 'vitest';
import { validateSqliteQueryParameters } from '../../src/shared/sqliteQueryParameters';
import { queryParameterLiteral, validateQueryParametersForInfo, type QueryParameter, type QueryParameterNames } from '../../src/shared/queryParameters';

const info = (names: string[] = []): QueryParameterNames => ({ dialect: 'sqlite', names, warnings: [], noBackslashEscapes: true, ansiQuotes: true, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 38, allowTimeEndpointFraction: true });
const one = (type: QueryParameter['type'], value?: string) => validateSqliteQueryParameters([{ name: 'value', type, ...(value === undefined ? {} : { value }) }]).get('value');
describe('SQLite 参数真实 native 值转换', () => {
  it('九类型不生成SQL字面量，text及时间/小数原文、64位整数和BLOB各保语义', () => {
    const text = "中文🧭\0' ; DROP TABLE x; -- \\", decimal = '+0009007199254740993.12345678901234567890123456789012345678';
    expect(one('text', text)).toBe(text); expect(one('integer', '+0009223372036854775807')).toEqual({ type: 'integer', value: '9223372036854775807' }); expect(one('integer', '-9223372036854775808')).toEqual({ type: 'integer', value: '-9223372036854775808' }); expect(one('integer', '-000')).toEqual({ type: 'integer', value: '0' });
    expect(one('decimal', decimal)).toBe(decimal); expect(one('boolean', 'true')).toEqual({ type: 'integer', value: '1' }); expect(one('boolean', 'false')).toEqual({ type: 'integer', value: '0' }); expect(one('null')).toBeNull(); expect(one('null', '')).toBeNull(); expect(one('binary', '00fFA1')).toEqual({ type: 'binary', base64: 'AP+h' });
    expect(one('date', '0001-01-01')).toBe('0001-01-01'); expect(one('datetime', '0004-02-29 23:59:59.123456')).toBe('0004-02-29 23:59:59.123456'); expect(one('time', '-838:59:59.999999')).toBe('-838:59:59.999999');
  });
  it('空文本、空BLOB、NULL及base64填充严格区分，不依赖Buffer编码', () => {
    expect(one('text', '')).toBe(''); expect(one('binary', '')).toEqual({ type: 'binary', base64: '' }); expect(one('null')).toBeNull();
    for (const [hex, base64] of [['ff', '/w=='], ['ffff', '//8='], ['ffffff', '////'], ['000102030405', 'AAECAwQF']]) expect(one('binary', hex)).toEqual({ type: 'binary', base64 });
  });
  it.each(['9223372036854775808', '-9223372036854775809', '18446744073709551615', '1.0', '1e2', ' 1', '1;SELECT 2'])('SQLite拒超限/非法整数%s且不回显原值', value => {
    let failure: unknown; try { one('integer', value); } catch (reason) { failure = reason; } expect(failure).toBeInstanceOf(Error); expect(String(failure)).not.toContain(value);
  });
  it('decimal按TEXT保65位精度/38scale原文，不接受指数或悄然Number转换', () => {
    const maximum = '9'.repeat(27) + '.' + '1'.repeat(38); expect(one('decimal', maximum)).toBe(maximum); expect(one('decimal', '-.000001')).toBe('-.000001');
    for (const value of ['9'.repeat(66), '0.' + '1'.repeat(39), '1e2', 'NaN', 'Infinity', '1.']) expect(() => one('decimal', value)).toThrow();
  });
  it('公历/微秒/时长精确验证，保0001年与负838小时，不调用Date或时区转换', () => {
    for (const value of ['0000-01-01', '1900-02-29', '2026-04-31', '10000-01-01']) expect(() => one('date', value)).toThrow(); expect(one('date', '2000-02-29')).toBe('2000-02-29');
    for (const value of ['2026-10-14T12:00:00Z', '2026-10-14 24:00:00', '2026-10-14 12:00:00.1234567', '0000-01-01 00:00:00']) expect(() => one('datetime', value)).toThrow();
    for (const value of ['839:00:00', '+12:00:00', '12:60:00', '12:00:60', '00:00:00.1234567']) expect(() => one('time', value)).toThrow();
  });
  it('仅裸ASCII名称，重复/缺值/无效Unicode/未知类型均拒绝，无部分Map返回', () => {
    expect(validateSqliteQueryParameters([{ name: '__proto__', type: 'null' }]).has('__proto__')).toBe(true);
    for (const name of [':value', '1value', '中文', 'a'.repeat(65)]) expect(() => validateSqliteQueryParameters([{ name, type: 'text', value: '' }])).toThrow();
    expect(() => validateSqliteQueryParameters([{ name: 'a', type: 'null' }, { name: 'a', type: 'null' }])).toThrow('重复'); expect(() => one('text')).toThrow(); expect(() => one('text', '\uD800')).toThrow('Unicode'); expect(() => one('binary', 'f')).toThrow(); expect(() => one('null', 'NULL')).toThrow(); expect(() => one('boolean', 'TRUE')).toThrow();
  });
  it('精确保留200名称/单值64KiB/合计1MiB边界，超过任一预算即拒绝', () => {
    expect(validateSqliteQueryParameters(Array.from({ length: 200 }, (_, i) => ({ name: 'p' + i, type: 'null' as const }))).size).toBe(200); expect(() => validateSqliteQueryParameters(Array.from({ length: 201 }, (_, i) => ({ name: 'p' + i, type: 'null' as const })))).toThrow('200');
    expect(one('text', 'a'.repeat(65536))).toHaveLength(65536); expect(() => one('text', 'a'.repeat(65537))).toThrow('64 KiB'); expect(() => one('text', '中'.repeat(22000))).toThrow('64 KiB');
    const full = Array.from({ length: 16 }, (_, i) => ({ name: 'p' + i, type: 'text' as const, value: 'a'.repeat(65536) })); expect(validateSqliteQueryParameters(full).size).toBe(16); expect(() => validateSqliteQueryParameters([...full, { name: 'extra', type: 'text', value: '🧭' }])).toThrow('1 MiB');
  });
  it('参数/数组getter从不执行，额外/symbol/隐藏属性及稀疏数组都拒绝', () => {
    const getter = vi.fn(() => '秘密值'), accessed = { name: 'p', type: 'text' }; Object.defineProperty(accessed, 'value', { get: getter, enumerable: true }); const arrayGetter: unknown[] = []; Object.defineProperty(arrayGetter, '0', { get: getter, enumerable: true });
    const good = { name: 'p', type: 'null' }, hidden = { ...good }; Object.defineProperty(hidden, 'value', { value: undefined, enumerable: false });
    for (const parameters of [[accessed], arrayGetter, new Array(1), Object.assign([good], { extra: 1 }), [{ ...good, extra: 1 }], [{ ...good, [Symbol('x')]: 1 }], [hidden]]) expect(() => validateSqliteQueryParameters(parameters as QueryParameter[])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

describe('参数验证按识别方言分发，旧网络语义保持', () => {
  it('旧无dialect和mysql/mariadb继续接受原UInt64及MySQL日期下界，不落SQLite转换', () => {
    const parameter: QueryParameter = { name: 'value', type: 'integer', value: '18446744073709551615' }, base = { maxDecimalScale: 38 as const, allowTimeEndpointFraction: true };
    for (const dialect of [undefined, 'mysql', 'mariadb'] as const) expect(() => validateQueryParametersForInfo([parameter], { ...base, ...(dialect ? { dialect } : {}) })).not.toThrow(); expect(queryParameterLiteral(parameter)).toBe('18446744073709551615'); expect(() => validateQueryParametersForInfo([{ name: 'value', type: 'date', value: '0001-01-01' }], base)).toThrow();
  });
  it('SQLite names exactset拒missing/extra/重复，空组不能冒充缺项；旧MySQL仍准许动态补参', () => {
    const value: QueryParameter = { name: 'value', type: 'date', value: '0001-01-01' }; expect(() => validateQueryParametersForInfo([value], info(['value']))).not.toThrow();
    for (const parameters of [[], [{ name: 'extra', type: 'null' as const }], [value, { name: 'extra', type: 'null' as const }]]) expect(() => validateQueryParametersForInfo(parameters, info(['value']))).toThrow('完整匹配');
    expect(() => validateQueryParametersForInfo([], info([]))).not.toThrow(); expect(() => validateQueryParametersForInfo([{ name: 'dynamic', type: 'null' }], { ...info(['value']), dialect: 'mysql' })).not.toThrow();
  });
  it('方言和names访问器/稀疏或伪undefined元数据不被读取或降级', () => {
    const getter = vi.fn(() => 'sqlite'), dialect = info([]); Object.defineProperty(dialect, 'dialect', { get: getter, enumerable: true }); expect(() => validateQueryParametersForInfo([], dialect)).toThrow();
    const names = info([]); Object.defineProperty(names, 'names', { get: getter, enumerable: true }); expect(() => validateQueryParametersForInfo([], names)).toThrow(); expect(() => validateQueryParametersForInfo([], { ...info([]), names: undefined })).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});
