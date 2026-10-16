import { describe, expect, it } from 'vitest';
import { completeCaptureSql, type CaptureSqlChange } from '../helpers/pageCaptureSql';

const change: CaptureSqlChange = { id: '18446744073709551615', before: 'old', after: '[old|$]' };
const canonical = '`id` <=> ? AND BINARY CONVERT(`note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)';
const protectedTail = ' AND `amount` <=> ? AND `payload` <=> ? AND BINARY CONVERT(`nil` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND BINARY CONVERT(`generated` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)';
const binary = { type: 'binary', base64: 'AAH/' }, amount = '12345678901234567890.123456';
/** 独立手写本片静态模板，不导入生产SQL生成器。 */
function source(where: string, params: unknown[], table = 'capture_batch') {
  return `UPDATE \`dbark_e2e_probe\`.\`${table}\` SET \`note\` = ? WHERE ${where};\n-- 参数：${JSON.stringify(params)}`;
}
const check = (sql: string, table = 'capture_batch') => completeCaptureSql(sql, 'dbark_e2e_probe', table, [change]);

describe('捕获UI静态夹具的精确WHERE与参数绑定', () => {
  // 员工4四个where表达式原样保留；旧59ac会全部接受，预期false不得放宽。
  it.each([
    ['键比较列被替换', canonical.replace('`id`', '`amount`')],
    ['精确键相等被反转', canonical.replace('`id` <=>', '`id` <>')],
    ['原值参数只作恒真检查', '`id` <=> ? AND ? IS NOT NULL'],
    ['原值比较尾部增加恒真OR', canonical + ' OR 1=1'],
  ])('员工4原样严格反例：%s必须拒绝', (_name, where) => {
    expect(check(source(where, [change.after, change.id, change.before]))).toBe(false);
  });
  it.each([false, true])('只接受本片两种结构及已知键布局，重复键=%s', duplicate => {
    const where = (duplicate ? '`id` <=> ? AND ' : '') + canonical, params = [change.after, change.id, ...(duplicate ? [change.id] : []), change.before];
    expect(check(source(where, params))).toBe(true);
    expect(check(source(where + protectedTail, [...params, amount, binary, null, change.before], 'capture_unicode'), 'capture_unicode')).toBe(true);
  });
  it.each([
    ['重复id实际绑定另一值', '`id` <=> ? AND ' + canonical, [change.after, change.id, '18446744073709551614', change.before], 'capture_batch'],
    ['before出现于生成列但note绑定错误', canonical + protectedTail, [change.after, change.id, 'wrong-note', amount, binary, null, change.before], 'capture_unicode'],
    ['BLOB原值绑定不同字节', canonical + protectedTail, [change.after, change.id, change.before, amount, { ...binary, base64: 'AAE=' }, null, change.before], 'capture_unicode'],
  ])('参数按字段位置核对：%s', (_name, where, params, table) => {
    expect(check(source(where as string, params as unknown[], table as string), table as string)).toBe(false);
  });
  it('完整原行其余字段的位置也须保持夹具原值', () => {
    for (const [index, wrong] of [[3, '12345678901234567890.123455'], [5, 'NULL'], [6, 'wrong-generated']] as const) {
      const params: unknown[] = [change.after, change.id, change.before, amount, binary, null, change.before]; params[index] = wrong;
      expect(check(source(canonical + protectedTail, params, 'capture_unicode'), 'capture_unicode')).toBe(false);
    }
  });
  it('未知模板、额外条件、注释、参数残余和重复预期行均保守拒绝', () => {
    const params = [change.after, change.id, change.before];
    for (const where of [canonical + ' AND 1=1', canonical + ' /* 注释 */', canonical.replace('AND BINARY', 'OR BINARY')]) expect(check(source(where, params))).toBe(false);
    expect(check(source(canonical + protectedTail, [...params, amount, binary, null, change.before]))).toBe(false);
    expect(check(source(canonical, params, 'other_table'), 'other_table')).toBe(false);
    expect(check(source(canonical, [...params, '额外参数']))).toBe(false);
    expect(completeCaptureSql(source(canonical, params), 'dbark_e2e_probe', 'capture_batch', [change, change])).toBe(false);
  });
});
