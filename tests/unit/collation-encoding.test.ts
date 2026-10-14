import { describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import { resolveCollationEncoding } from '../../src/engine/metadata';

/** 注入目录响应而不建连；生产解析器生成的能力查询、完整名称匹配及唯一性验证仍实际执行。 */
function catalog(full: boolean, rows: Record<string, unknown>[]) {
  const names = ['COLLATION_NAME', 'CHARACTER_SET_NAME', ...(full ? ['FULL_COLLATION_NAME', 'ID', 'IS_DEFAULT'] : [])];
  return vi.fn<(sql: string) => Promise<Record<string, unknown>[]>>().mockResolvedValueOnce(names.map(name => ({ name }))).mockResolvedValueOnce(rows);
}

describe('表排序规则的可信目录别名解析', () => {
  it.each([false, true])('按实际 FULL 能力 %s 选择列，不按服务器版本或名称前缀猜字符集', async full => {
    const query = catalog(full, [{ charset: 'latin1', collation: '目录别名' }]);
    expect(await resolveCollationEncoding({} as ManagedConnection, '目录别名', query)).toEqual({ charset: 'latin1', collation: '目录别名' });
    expect(query.mock.calls[0][0]).toContain("TABLE_NAME = 'COLLATION_CHARACTER_SET_APPLICABILITY'");
    expect(query.mock.calls[0][0]).toMatch(/LIMIT 64$/);
    expect(query.mock.calls[1][0]).toContain(`a.${full ? 'FULL_COLLATION_NAME' : 'COLLATION_NAME'} AS collation`);
    expect(query.mock.calls[1][0]).toContain('JOIN information_schema.CHARACTER_SETS');
    expect(query.mock.calls[1][0]).toMatch(/LIMIT 2$/);
    expect(query.mock.calls[1][0]).toContain(Buffer.from('目录别名').toString('hex'));
  });

  it.each([
    [], [{ charset: 'utf8mb4', collation: 'alias' }, { charset: 'latin1', collation: 'alias' }],
    [{ charset: null, collation: 'alias' }], [{ charset: '', collation: 'alias' }],
    [{ charset: 'utf8mb4', collation: 'ALIAS' }],
  ].map(rows => ({ rows })))('空、冲突、无真实字符集或非精确名称的目录不能当成可信匹配', async ({ rows }) => {
    await expect(resolveCollationEncoding({} as ManagedConnection, 'alias', catalog(true, rows))).rejects.toThrow('无法唯一确认');
  });

  it('目录能力不足即停止，不能失败后换另一种猜测查询', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'COLLATION_NAME' }]);
    await expect(resolveCollationEncoding({} as ManagedConnection, 'alias', query)).rejects.toThrow('目录能力'); expect(query).toHaveBeenCalledOnce();
  });
});
