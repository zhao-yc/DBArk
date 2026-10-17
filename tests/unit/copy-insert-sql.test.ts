import { describe, expect, it, vi } from 'vitest';
import { buildCopyInsertSql, copyInsertSql } from '../../src/main/copyInsertSql';
import { copyInsertSqlLimits, type CopyInsertColumn, type CopyInsertSqlInput } from '../../src/shared/copyInsertSql';
import { exportLiteral } from '../../src/engine/sql';

const column = (name: string, type: string, nullable = true): CopyInsertColumn => ({ name, type, nullable, extra: '', generated: false });
const fixture = (): CopyInsertSqlInput => ({ database: '库.名`', table: '表`名', columns: [column('id', 'bigint unsigned'), column('金额', 'decimal(65,30)'), column('时刻', 'datetime(6)'), column('空', 'varchar(20)'), column('文', 'text'), column('JSON', 'json'), column('字节', 'blob')], rows: [{ id: '18446744073709551615', 金额: '-12345678901234567890123456789012345.123456789012345678901234567890', 时刻: '2026-10-17 01:02:03.123456', 空: null, 文: "中😀\0'\\\r\n", JSON: '{"id":18446744073709551615,"x":1.00000000000000000001}', 字节: { type: 'binary', base64: 'AP8=' } }] });
describe('本地生成 INSERT，所有剪贴板均为内存替身', () => {
  it('分别引用库表和字段，保留大整数、小数、微秒、NULL、JSON原文和原始字节', () => {
    const input = fixture(), sql = buildCopyInsertSql(input), row = input.rows[0];
    expect(sql).toBe(`INSERT INTO \`库.名\`\`\`.\`表\`\`名\` (\`id\`, \`金额\`, \`时刻\`, \`空\`, \`文\`, \`JSON\`, \`字节\`) VALUES (${row.id}, ${row.金额}, ${exportLiteral(row.时刻)}, NULL, ${exportLiteral(row.文)}, ${exportLiteral(row.JSON)}, X'00ff');`);
    expect(sql).not.toContain('18446744073709552000'); expect(sql).not.toContain("中😀");
  });
  it('文本全用导出十六进制字面量，不依赖引号、反斜杠或 SQL mode', () => {
    const input = { database: 'a', table: 'b', columns: [column('__proto__', 'text')], rows: [Object.fromEntries([['__proto__', "'\"\\\0; DROP TABLE x; -- 😀"]])] };
    expect(buildCopyInsertSql(input)).toBe(`INSERT INTO \`a\`.\`b\` (\`__proto__\`) VALUES (${exportLiteral(input.rows[0].__proto__)});`);
  });
  it.each([9007199254740992, Number.NaN, Number.POSITIVE_INFINITY, -0])('整数 Number %s 无法保真时拒绝', value => {
    const input = fixture(); input.rows[0].id = value; expect(() => buildCopyInsertSql(input)).toThrow();
  });
  it('DECIMAL Number、未知类型、生成/不可见/未知 extra、缺失字段整次拒绝', () => {
    const mutations = [
      (v: CopyInsertSqlInput) => { v.rows[0].金额 = 0.1; },
      (v: CopyInsertSqlInput) => { v.columns[0].type = 'geometry'; },
      (v: CopyInsertSqlInput) => { v.columns[0].generated = true; },
      (v: CopyInsertSqlInput) => { v.columns[0].extra = 'INVISIBLE'; },
      (v: CopyInsertSqlInput) => { v.columns[0].extra = 'unknown'; },
      (v: CopyInsertSqlInput) => { delete v.rows[0].空; },
      (v: CopyInsertSqlInput) => { v.rows[0].其他 = '值'; },
      (v: CopyInsertSqlInput) => { v.rows[0].文 = '\ud800'; },
      (v: CopyInsertSqlInput) => { v.rows[0].id = '1); DROP TABLE x'; }
    ];
    for (const change of mutations) { const input = fixture(), write = vi.fn(); change(input); expect(() => copyInsertSql(input, write)).toThrow(); expect(write).not.toHaveBeenCalled(); }
  });
  it.each(['AP9=', 'A===', '!!!!', 'AA', 'AP8=\n'])('拒绝非规范二进制 %s，不宽松解码', base64 => {
    const input = fixture(); input.rows[0].字节 = { type: 'binary', base64 }; expect(() => buildCopyInsertSql(input)).toThrow();
  });
  it('接受空二进制、精确浮点字符串、自动增长值和自有特殊列名', () => {
    const input = fixture(); input.rows[0].字节 = { type: 'binary', base64: '' }; input.columns[0].extra = 'auto_increment'; expect(buildCopyInsertSql(input)).toContain("X''");
    const floating = { database: 'a', table: 'b', columns: [column('f', 'double')], rows: [{ f: '1.2345678901234567e-10' }] }; expect(buildCopyInsertSql(floating)).toContain('1.2345678901234567e-10');
  });
  it('未知 NO_AUTO_VALUE_ON_ZERO 时拒绝自增零值，避免重放时悄悄分配新值', () => {
    const input = fixture(); input.columns[0].extra = 'auto_increment'; input.rows[0].id = '0'; const write = vi.fn();
    expect(() => copyInsertSql(input, write)).toThrow(); expect(write).not.toHaveBeenCalled();
  });
  it('数组访问器和隐藏参数也拒绝，不在遍历时执行读取逻辑', () => {
    const input = fixture(), getter = vi.fn(() => input.rows[0]);
    Object.defineProperty(input.rows, '0', { enumerable: true, get: getter }); expect(() => buildCopyInsertSql(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const hidden = fixture(); Object.defineProperty(hidden.columns, 'sql', { value: '无关参数' }); expect(() => buildCopyInsertSql(hidden)).toThrow();
  });
  it('零行、重复列、NUL 名称和访问器均拒绝，访问器不执行', () => {
    const input = fixture(), getter = vi.fn(() => '值'); input.rows[0] = Object.defineProperty({}, 'id', { enumerable: true, get: getter });
    expect(() => buildCopyInsertSql(input)).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const change of [(v: CopyInsertSqlInput) => { v.rows = []; }, (v: CopyInsertSqlInput) => { v.columns[1].name = 'id'; }, (v: CopyInsertSqlInput) => { v.database = '坏\0名'; }]) { const value = fixture(); change(value); expect(() => buildCopyInsertSql(value)).toThrow(); }
  });
  it('输入、单字段、行数、单元格和最终 SQL 的字节超限均不写入任何前缀', () => {
    const base = { database: 'a', table: 'b', columns: [column('t', 'text')], rows: [{ t: '' }] };
    const cases = [
      { ...base, rows: Array.from({ length: copyInsertSqlLimits.rows + 1 }, () => ({ t: '' })) },
      { ...base, columns: Array.from({ length: 51 }, (_, n) => column('t' + n, 'text')), rows: Array.from({ length: 1000 }, () => ({})) },
      { ...base, rows: [{ t: '中'.repeat(100_000) }] },
      { ...base, rows: Array.from({ length: 6 }, () => ({ t: 'a'.repeat(200_000) })) },
      { ...base, rows: Array.from({ length: 3 }, () => ({ t: 'a'.repeat(200_000) })) }
    ];
    for (const input of cases) { const write = vi.fn(); expect(() => copyInsertSql(input, write)).toThrow('上限'); expect(write).not.toHaveBeenCalled(); }
  });
  it('全部成功后只写一次，保留页顺序，写入错误向上传递且不重试', () => {
    const input = fixture(); input.rows.push({ ...input.rows[0], id: '2' }); const write = vi.fn(); copyInsertSql(input, write);
    expect(write).toHaveBeenCalledExactlyOnceWith(buildCopyInsertSql(input)); expect(write.mock.calls[0][0].split('\n')).toHaveLength(2);
    const error = Error('合成写失败'), failing = vi.fn(() => { throw error; }); expect(() => copyInsertSql(input, failing)).toThrow(error); expect(failing).toHaveBeenCalledTimes(1);
  });
  it('原生异步写入完成前不宣告成功，原失败保持且不重试', async () => {
    const error = Error('合成异步写失败'), write = vi.fn(async () => { throw error; });
    await expect(copyInsertSql(fixture(), write)).rejects.toBe(error); expect(write).toHaveBeenCalledTimes(1);
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    expect(copyInsertSql(fixture(), () => pending)).toBe(pending); finish(); await pending;
  });
});
