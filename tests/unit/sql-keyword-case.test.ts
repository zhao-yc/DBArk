import { describe, expect, it, vi } from 'vitest';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';
const mutation = vi.hoisted(() => ({ from: '', to: '' }));
// 正常路径执行真实依赖；仅反例在原词法捕获后污染formatter输出，验证没有全局忽略大小写。
vi.mock('sql-formatter', async original => {
  const real = await original<typeof import('sql-formatter')>();
  return { ...real, formatDialect: (...args: Parameters<typeof real.formatDialect>) => { const result = real.formatDialect(...args); return mutation.from ? result.replace(mutation.from, mutation.to) : result; } };
});
const upper = (source: string, start = 0, end = source.length, eol = '\n') => planSqlFormatting(source, start, end, eol, { keywordCase: 'upper' });

it('默认保持原样；显式大写只更改正式关键字，字符串、注释、反引号、变量和限定名称保持原文', () => {
  const source = "select MiXeD, `SeLeCt`, \"from\", 'where', @from, @@global.time_zone, t.order from MiXeDTable t where t.id=1; -- select lower";
  expect(planSqlFormatting(source, 0, source.length)!.text).toContain('select');
  const result = upper(source)!.text;
  for (const token of ['SELECT', 'FROM', 'WHERE', 'MiXeD', '`SeLeCt`', '"from"', "'where'", '@from', '@@global.time_zone', 't.order', 'MiXeDTable', '-- select lower']) expect(result).toContain(token);
  expect(upper(result)).toBeNull();
});

it.each([
  ['select count(MiXeD), current_user from T;', ['count(', 'current_user']],
  ['select MyFn (MiXeD), Db.OtherFn (MiXeD) from T;', ['MyFn (', 'Db.OtherFn (']],
  ['select cast(MiXeD as decimal(10,2)) from T;', ['cast(', 'decimal(']],
  ['select MiXeD from T group by MiXeD order by MiXeD;', ['GROUP BY', 'ORDER BY']],
  ['select a from T where a in (1,2);', ['WHERE', 'IN (']],
  ['select case when a=1 then 2 else 3 end as value from T;', ['CASE', 'WHEN', 'THEN', 'ELSE', 'END']],
] as const)('函数、数据类型、名称与多词关键字分别保留/排版：%s', (source, preserved) => {
  const result = upper(source)!.text; expect(result).toContain('SELECT'); for (const token of preserved) expect(result).toContain(token);
});

it('选区与全文使用同一偏好，选区之外逐字保留、CRLF不转为LF', () => {
  const prefix = 'select PriorValue from BeforeTable;\r\n', body = "select MiXeD,'🚢' from T;", suffix = '\r\nselect Tail from AfterTable;', source = prefix + body + suffix;
  const plan = upper(source, prefix.length, prefix.length + body.length, '\r\n')!;
  expect(plan).toMatchObject({ start: prefix.length, end: prefix.length + body.length }); expect(plan.text).toContain('SELECT'); expect(plan.text).toContain('FROM');
  const next = source.slice(0, plan.start) + plan.text + source.slice(plan.end);
  expect(next.startsWith(prefix)).toBe(true); expect(next.endsWith(suffix)).toBe(true); expect(plan.text.replaceAll('\r\n', '')).not.toContain('\n');
});

it.each(['select T.order from T;', 'select @order from T;', 'select Db.select (a) from T;'])('被选中的关键字形状名称必须沿完整上下文拒绝大小写改写：%s', source => {
  const name = source.includes('Db.select') ? 'select' : 'order', start = source.lastIndexOf(name);
  expect(() => upper(source, start, start + name.length)).toThrow();
});

it.each(['select insert (a,1,1,\'x\') from T;', "select replace (a,'x','y') from T;", "select '未闭合", 'DELIMITER $$\nselect 1$$', 'select 1 /*!80000 + 1 */;', 'SET sql_mode=\'ANSI_QUOTES\'; select 1;'])('函数歧义或原不支持语法继续在编辑前拒绝：%s', source => { expect(() => upper(source)).toThrow(); });

describe('上游输出污染不能借大写偏好穿过逐token校验', () => {
  it.each([
    ['MiXeD', 'MIXED', 'select MiXeD from T;'],
    ['@order', '@ORDER', 'select @order from T;'],
    ['count', 'COUNT', 'select count(a) from T;'],
    ['`Name`', '`NAME`', 'select `Name` from T;'],
    ["'String'", "'STRING'", "select 'String' from T;"],
    ['-- Comment', '-- COMMENT', 'select a from T; -- Comment'],
    ['t.order', 't.ORDER', 'select t.order from T t;'],
  ])('拒绝更改%s', (from, to, source) => {
    mutation.from = from; mutation.to = to;
    try { expect(() => upper(source)).toThrow(); } finally { mutation.from = ''; mutation.to = ''; }
  });
});


it.each(['select ſelect from T;', 'select Key from T;'])('Unicode忽略大小写形似关键字仍按名称保护，不许可改写：%s', source => { expect(() => upper(source)).toThrow(); });


it.each([
  'select offset, end from offset;',
  'select 1 as end, 2 end, 3 as offset, 4 offset;',
])('Root转交独立反例：未限定列/表/显式及隐式别名不得借keyword类型改写：%s', source => {
  // 不确定角色允许整次拒绝；若返回计划，所有标识符必须逐字不变。
  expect(() => upper(source)).toThrow();
});


it('Root第三条反例：DDL的大写关键字可用，但列名year/bit/name与类型原文都不改写', () => {
  const source = 'create table demo (year year, bit bit(1), name varchar(8));', result = upper(source)!.text;
  expect(result).toContain('CREATE TABLE'); expect(result).toContain('demo'); expect(result).toMatch(/year\s+year/); expect(result).toMatch(/bit\s+bit\(1\)/); expect(result).toMatch(/name\s+varchar\(8\)/);
});
