import { beforeAll, describe, expect, it, vi } from 'vitest';
import { planSqlFormatting, prepareSqlFormattingRoles } from '../../src/renderer/sqlFormatting';
import { sqlKeywordRoleLimits } from '../../src/shared/sqlKeywordCase';
import { lowerKeywordCases } from '../fixtures/sql-keyword-lower-cases';
const mutation = vi.hoisted(() => ({ from: '', to: '' }));
// 真实formatter及角色模块参与；仅污染反例在正式词法捕获后修改返回文本。
vi.mock('sql-formatter', async original => {
  const real = await original<typeof import('sql-formatter')>();
  return { ...real, formatDialect: (...args: Parameters<typeof real.formatDialect>) => { const output = real.formatDialect(...args); return mutation.from ? output.replace(mutation.from, mutation.to) : output; } };
});
beforeAll(async () => { await prepareSqlFormattingRoles(); });
const lower = (source: string, start = 0, end = source.length, eol = '\n') => planSqlFormatting(source, start, end, eol, { keywordCase: 'lower' });
/** 仅解析这组手工语料的原文单元，忽略单元外排版；引号/注释内部逐字保留，不做大小写归一化。 */
function raw(text: string) { return text.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\[\s\S]|[^'])*'|"(?:""|\\[\s\S]|[^"])*"|`(?:``|[^`])*`|[A-Za-z_$\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*|\d+(?:\.\d+)?|[^\s]/g); }

describe.each(lowerKeywordCases)('旧8条原输入与手工小写期望：$name', example => {
  it('旧输入逐字沿用，lower结果符合手工原文单元，重复操作不编辑', () => {
    const result = lower(example.source)?.text ?? example.source; expect(raw(result)).toEqual(raw(example.expected)); expect(lower(result)).toBeNull();
  });
  it('显式大写关键字输入只转已证明关键字，名称/函数/类型不跟随', () => {
    const result = lower(example.uppercaseKeywords)!.text; expect(raw(result)).toEqual(raw(example.expected));
    if (example.name === '有敏感空白的函数名称') { expect(result).toContain('MyFn ('); expect(result).toContain('Db.OtherFn ('); }
  });
});

it('lower选区之外、CRLF、数值与特殊字面量均原样，全文/选区共用', () => {
  const prefix = 'SELECT PriorValue FROM BeforeTable;\r\n', body = "SELECT MiXeD,'🚢  ; -- 字符串',1.20E+3,0xFF FROM T WHERE id=1; -- 注释 SeLeCt", suffix = '\r\nSELECT Tail FROM AfterTable;', source = prefix + body + suffix;
  const plan = lower(source, prefix.length, prefix.length + body.length, '\r\n')!;
  expect(plan).toMatchObject({ start: prefix.length, end: prefix.length + body.length }); expect(raw(plan.text)).toEqual(raw("select MiXeD,'🚢  ; -- 字符串',1.20E+3,0xFF from T where id=1; -- 注释 SeLeCt")); expect(plan.text.replaceAll('\r\n', '')).not.toContain('\n');
  const next = source.slice(0, plan.start) + plan.text + source.slice(plan.end); expect(next.startsWith(prefix)).toBe(true); expect(next.endsWith(suffix)).toBe(true);
});

it.each([
  ['Key', 'key', 'SELECT Key FROM T;'], ['ſelect', 'select', 'SELECT ſelect FROM T;'], ['MiXeD', 'mixed', 'SELECT MiXeD FROM T;'], ['@ORDER', '@order', 'SELECT @ORDER FROM T;'], ['COUNT', 'count', 'SELECT COUNT(a) FROM T;'], ['DECIMAL', 'decimal', 'SELECT CAST(a AS DECIMAL(10,2)) FROM T;'], ['`Name`', '`name`', 'SELECT `Name` FROM T;'], ["'String'", "'string'", "SELECT 'String' FROM T;"], ['-- Comment', '-- comment', 'SELECT a FROM T; -- Comment'], ['t.ORDER', 't.order', 'SELECT t.ORDER FROM T t;'], ['1.20E+3', '1.20e+3', 'SELECT 1.20E+3 FROM T;'],
])('formatter污染%s不能借小写通过逐token证明', (from, to, source) => {
  mutation.from = from; mutation.to = to; try { expect(() => lower(source)).toThrow(); } finally { mutation.from = ''; mutation.to = ''; }
});

it.each([
  'SELECT OFFSET, END FROM OFFSET;', 'SELECT 1 AS END, 2 END, 3 AS OFFSET, 4 OFFSET;', 'SELECT ſelect FROM T;', 'SELECT Key FROM T;', 'SELECT SELECΤ FROM T;',
])('非保留词名字和Unicode相似词不因lower放宽：%s', source => {
  // 若上游保留原名字可以安全排版；任何返回的计划仍须与手工名称原文逐字一致。
  let result: ReturnType<typeof lower>; try { result = lower(source); } catch { return; }
  const expected = source.replace(/^SELECT /, 'select ').replaceAll(' AS ', ' as ').replaceAll(' FROM ', ' from '); expect(raw(result?.text ?? source)).toEqual(raw(expected));
});

it.each(['SELECT T.ORDER FROM T;', 'SELECT @ORDER FROM T;', 'SELECT Db.SELECT (a) FROM T;'])('仅选择名字后半段不取得新关键字身份：%s', source => {
  const name = source.includes('Db.SELECT') ? 'SELECT' : 'ORDER', start = source.lastIndexOf(name); expect(() => lower(source, start, start + name.length)).toThrow();
});

it.each(["SELECT '未闭合", "SELECT 'a\\'b';", 'SELECT 1 /*!80000 + 1 */;', 'DELIMITER $$\nSELECT 1$$', "SET sql_mode='ANSI_QUOTES'; SELECT 1;"] )('四模式或角色不确定保持拒绝：%s', source => { expect(() => lower(source)).toThrow(); });

it('lower与upper使用相同额外角色预算，preserve原预算不变', () => {
  const source = 'SELECT a FROM T;' + ' '.repeat(sqlKeywordRoleLimits.sourceUnits); expect(() => lower(source)).toThrow('超出安全格式化范围'); expect(() => planSqlFormatting(source, 0, source.length)).not.toThrow();
});
