import { beforeAll, expect, it, vi } from 'vitest';
import { sqlFormattingNameRanges, sqlKeywordRoleLimits } from '../../src/renderer/sqlFormattingRoles';
import { planSqlFormatting, prepareSqlFormattingRoles } from '../../src/renderer/sqlFormatting';

it.each([
  ['select offset, end from offset;', ['offset', 'end', 'offset']],
  ['select 1 as end, 2 end, 3 as offset, 4 offset;', ['end', 'end', 'offset', 'offset']],
  ['create table demo (year year, bit bit(1), name varchar(8));', ['demo', 'year', 'bit', 'name']],
] as const)('正式语法角色确实覆盖Root反例的名称跨度，不靠失败结果冒充角色证明：%s', (source, names) => {
  const actual = sqlFormattingNameRanges(source).map(range => source.slice(range.start, range.end)); expect(actual).toEqual(names);
});

it('等UTF16投影在emoji/中文后仍保护准确名称位置，不把码点偏移当UTF16偏移', () => {
  const source = "select '🚢', 中文, offset from offset;", ranges = sqlFormattingNameRanges(source);
  expect(ranges.map(range => source.slice(range.start, range.end))).toEqual(["'🚢'", '中文', 'offset', 'offset']);
});

it('额外角色预算只限制新大写模式，旧保持原样路径仍可排版', () => {
  const source = 'select a from T;' + ' '.repeat(sqlKeywordRoleLimits.sourceUnits);
  expect(() => planSqlFormatting(source, 0, source.length, '\n', { keywordCase: 'upper' })).toThrow('超出安全格式化范围');
  expect(() => planSqlFormatting(source, 0, source.length)).not.toThrow();
});

it('语法角色未知固定拒绝，不由第三方默认监听泄露原SQL', () => {
  const error = vi.spyOn(console, 'error'), log = vi.spyOn(console, 'log');
  try { expect(() => sqlFormattingNameRanges("select '合成私有正文")).toThrow(); expect(error).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); }
  finally { error.mockRestore(); log.mockRestore(); }
});

// 这些对照明确操作upper，默认入口测试不调用此准备函数。
beforeAll(async () => { await prepareSqlFormattingRoles(); });
