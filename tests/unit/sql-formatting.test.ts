import { describe, expect, it } from 'vitest';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';
import { completionLimits } from '../../src/shared/sqlCompletion';

describe('选区格式化的原文与安全边界', () => {
  it.each([[1, true], [8, true], [4, false]] as const)('显式格式化使用宽度%s/空格%s，字面量原文不变且重复格式化不追加编辑', (tabSize, insertSpaces) => {
    const source = "select a,b,'🚢  原文' from 表 where id=1;", indentation = { tabSize, insertSpaces };
    const plan = planSqlFormatting(source, 0, source.length, '\n', indentation)!;
    expect(plan.text).toContain('\n' + (insertSpaces ? ' '.repeat(tabSize) : '\t') + 'a,'); expect(plan.text).toContain("'🚢  原文'"); expect(planSqlFormatting(plan.text, 0, plan.text.length, '\n', indentation)).toBeNull();
  });
  it('只排版选中SQL，Unicode、字符串、注释及选区外内容逐字不变', () => {
    const prefix = "select '🚢外面' as 前; -- 头部保持\n", body = "select 名称,'🚢  ; -- 字符串' as 标记 from 表 where 编号=1; -- 注释保持", suffix = "\nselect '尾部' as 后;";
    const source = prefix + body + suffix, plan = planSqlFormatting(source, prefix.length, prefix.length + body.length)!;
    expect(plan).not.toBeNull(); expect(plan.text).not.toBe(body); expect(plan.text).toContain("'🚢  ; -- 字符串'"); expect(plan.text).toContain('-- 注释保持');
    const next = source.slice(0, plan.start) + plan.text + source.slice(plan.end); expect(next.slice(0, prefix.length)).toBe(prefix); expect(next.slice(-suffix.length)).toBe(suffix);
  });
  it('保留选区两端空白，防止选区与外部token粘连', () => {
    const source = 'select a,b from 表 where id=1;', start = source.indexOf(' a'), end = source.indexOf(' where');
    const plan = planSqlFormatting(source, start, end)!; expect(plan.text.startsWith(' ')).toBe(true); expect(plan.text).toContain('from'); expect(source.slice(plan.end)).toBe(' where id=1;');
  });
  it('无选区的全文计划保留大小写及CRLF，重复排版不产生编辑', () => {
    const source = "select 名称,'🚢' from 表 where id=1;\r\n";
    const plan = planSqlFormatting(source, 0, source.length, '\r\n')!; expect(plan.text).toContain('\r\n'); expect(plan.text.replaceAll('\r\n', '')).not.toContain('\n');
    expect(planSqlFormatting(plan.text, 0, plan.text.length, '\r\n')).toBeNull(); expect(plan.text).toContain('select');
  });
  it('只选空白时不回退到全文', () => { expect(planSqlFormatting('select a,b;\n  \n', 12, 15)).toBeNull(); });
  it('原formatter不支持的语法返回固定错误，不把用户SQL放入异常', () => { const source = 'select [合成私有字段] from 表;'; expect(() => planSqlFormatting(source, 0, source.length)).toThrow('SQL 格式化失败，原文未改动。'); });
  it.each(["select '未闭合", 'select (1;', 'select 1);', 'select 1; /* 未闭合', "select 'a\\'b';", 'DELIMITER $$\nselect 1$$', 'select 1 /*!80000 + 1 */;', 'select /*+ MAX_EXECUTION_TIME(1) */ 1;', 'select /*M! 1 */ 1;', 'SET sql_mode=\'ANSI_QUOTES\'; select 1;', 'CREATE PROCEDURE p() BEGIN SELECT 1; END;'])('无法证明安全则原文不进入修改计划：%s', source => { expect(() => planSqlFormatting(source, 0, source.length)).toThrow(); });
  it.each([['select 名称 from 表;', 8, 9], ["select '字符串';", 9, 10], ['select 1; -- 注释文字', 13, 15]] as const)('不截断标识符、字符串或注释：%s', (source, start, end) => { expect(() => planSqlFormatting(source, start, end)).toThrow('完整文本范围'); });
  it('字符串和普通注释中的DELIMITER不是客户端指令', () => { const source = "select 'DELIMITER $$', 1,2; -- DELIMITER $$"; expect(planSqlFormatting(source, 0, source.length)?.text).toContain("'DELIMITER $$'"); });
  it('函数名称和左括号间的模式敏感空白不能被静默移除', () => { const source = 'select count ( * ) from 表;'; expect(() => planSqlFormatting(source, 0, source.length)).toThrow(); });
  it('拒绝超长源、过多token、过深括号、NUL及截断CRLF', () => {
    for (const source of ['x'.repeat(completionLimits.sourceUnits + 1), 'select ' + Array(9000).fill('1').join(',') + ';', 'select ' + '('.repeat(65) + '1' + ')'.repeat(65), 'select \0;']) expect(() => planSqlFormatting(source, 0, source.length)).toThrow();
    expect(() => planSqlFormatting('select 1;\r\nselect 2;', 0, 10)).toThrow();
  });
});
