import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo } from '../../src/shared/contracts';
import { validateLosslessImport } from '../../src/engine/losslessImport';

/** 目标定义和源文本独立给出，断言边界语义，不通过被测函数产生预期值。 */
function check(type: string, value: CellValue, dialect: 'mysql' | 'mariadb' = 'mysql') {
  const column: ColumnInfo = { name: '测试字段', type, nullable: true, generated: false, defaultValue: null, extra: '', comment: '' };
  return () => validateLosslessImport(column, value, dialect);
}
describe('文件导入的无损可表示性', () => {
  it.each([
    ['FLOAT(5,1)', '1.375'], ['DOUBLE(5,1)', '1.375'], ['FLOAT(5,1)', '-1.375'], ['DOUBLE(5,1)', '-1.375'],
    ['FLOAT(5,1)', '10000'], ['DOUBLE(5,1)', '-10000'], ['DOUBLE(5,1)', '1.00000000000000001'], ['DOUBLE(5,1)', '1e-2'],
    ['DOUBLE(5,1) UNSIGNED', '-0.1'], ['FLOAT(5,1)', '0.1'], ['FLOAT(24)', '1.5'], ['DOUBLE(5)', '1'], ['REAL(5,1)', '1.5'], ['DOUBLE(2,3)', '0.1'],
  ])('定标或不能可靠解释的 %s 不放行有损原文 %s', (type, value) => { expect(check(type, value)).toThrow(); });
  it.each([
    ['FLOAT(5,1)', '1.5000'], ['FLOAT(5,1)', '-9999.5000'], ['FLOAT(5,1) UNSIGNED', '9999.5'],
    ['DOUBLE(5,1)', '0.1'], ['DOUBLE(5,1)', '0000.1000'], ['DOUBLE(5,1)', '-9999.9000'], ['DOUBLE(5,1) UNSIGNED', '9999.9'],
    ['DOUBLE(5,1)', '1e-1'], ['DOUBLE(1,1)', '0.9'], ['FLOAT(5,1) UNSIGNED', '-0.000'], ['DOUBLE PRECISION(5,1)', '1.5'],
  ])('定标 %s 接受等值尾零、负数与边界 %s', (type, value) => { expect(check(type, value)).not.toThrow(); });
  it.each([
    ['DECIMAL(5,2)', '1.239'], ['DECIMAL(5,2)', '1000'], ['DECIMAL(5,2) UNSIGNED', '-1'], ['DECIMAL(5,2)', '1e2'],
    ['TINYINT UNSIGNED', '-1'], ['TINYINT', '128'], ['INT', '1.2'], ['BIGINT UNSIGNED', '18446744073709551616'], ['BIGINT', 9007199254740992],
    ['VARCHAR(2)', '中文🚢'], ['CHAR(4)', '尾部 '], ['TINYTEXT', '中'.repeat(86)], ['TEXT', true],
    ['DATETIME(3)', '2026-10-15 10:20:30.123456'], ['DATETIME(6)', '2026-02-30 00:00:00'], ['DATETIME', '2026-10-15 24:00:00'],
    ['TIME(2)', '01:02:03.123'], ['TIME(6)', '838:59:59.000001'], ['DATE', '0000-00-00'], ['YEAR', '26'],
    ['FLOAT', '0.1'], ['DOUBLE', '9007199254740993'], ['DOUBLE', '1e309'], ['DOUBLE', '1e-999'],
    ['VARBINARY(2)', { type: 'binary', base64: 'AAH/' }], ['BINARY(4)', { type: 'binary', base64: 'AAH/' }], ['BLOB', { type: 'binary', base64: 'YQ=' }],
    ["enum('一','二')", '1'], ["set('a','b')", 'b,a'], ['VARCHAR(4)', '\uD800'],
  ] as [string, CellValue][])('拒绝目标 %s 的有损输入', (type, value) => { expect(check(type, value)).toThrow(); });
  it.each([
    ['DECIMAL(5,2)', '999.99'], ['DECIMAL(2,2)', '.12'], ['DECIMAL(5,2)', '0001.2300'],
    ['BIGINT UNSIGNED', '18446744073709551615'], ['BIGINT', '-9223372036854775808'], ['TINYINT', '-128'], ['TINYINT UNSIGNED', '255'],
    ['VARCHAR(2)', '中🚢'], ['TEXT', '=SUM(A1)'], ['VARCHAR(2)', ''], ['TEXT', null],
    ['DATETIME(6)', '2024-02-29 10:20:30.123456'], ['DATETIME(3)', '2026-10-15 10:20:30.123000'], ['TIME(6)', '-838:59:59'],
    ['DOUBLE', '0.1'], ['FLOAT', '0.10000000149011612'], ['DOUBLE', '-0'], ['DOUBLE', '1.25e+2'],
    ['VARBINARY(3)', { type: 'binary', base64: 'AAH/' }], ['BIT(64)', { type: 'binary', base64: '//////////8=' }],
    ["enum('一','二')", '一'], ["set('a','b')", 'a,b'],
  ] as [string, CellValue][])('接受目标 %s 的可表示边界', (type, value) => { expect(check(type, value)).not.toThrow(); });
  it('MariaDB 的 TIME 微秒端点不套用 MySQL 上界', () => { expect(check('TIME(6)', '838:59:59.123456', 'mariadb')).not.toThrow(); });
  it('文本按列字符集核对容量和可表示性，不套用整表默认编码', () => {
    const column = { name: '列', type: 'tinytext', nullable: true, generated: false, defaultValue: null, extra: '', comment: '', characterSet: 'latin1' };
    expect(() => validateLosslessImport(column, 'é'.repeat(200), 'mysql')).not.toThrow();
    expect(() => validateLosslessImport(column, 'é'.repeat(256), 'mysql')).toThrow('容量');
    expect(() => validateLosslessImport(column, '🚢', 'mysql')).toThrow('字符集');
    expect(() => validateLosslessImport({ ...column, characterSet: 'utf8mb3' }, '🚢', 'mysql')).toThrow('补充平面');
  });
});
