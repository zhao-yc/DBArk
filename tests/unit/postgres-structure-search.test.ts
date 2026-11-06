import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { postgresStructureSearchQuery, readPostgresStructureSearchPage } from '../../src/engine/postgres/structureSearch';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { StructureSearches, type StructureSearchState } from '../../src/engine/structureSearch';
import { structureSearchInputSchema, type StructureSearchInput } from '../../src/shared/databaseSearch';
import { definitionSearchOpenSchema } from '../../src/shared/definitionNavigation';
import { validateCommand } from '../../src/shared/validation';

const input: StructureSearchInput = { connectionId: 'PG', taskId: randomUUID(), dialect: 'postgresql', databases: ['库😀', '次库'],
  kinds: ['table'], pattern: { mode: 'contains', text: "A%_\\' --", caseSensitive: false }, maxResults: 200, onError: 'continue' };
const state = (): StructureSearchState => ({ input, scope: 0, total: 0 });
const row = (index: number) => ({ c0: '"例"."对象' + index + '"', c1: '对象' + index, c2: 'table' });

describe('PostgreSQL 结构名称搜索', () => {
  it('按方言验证对象类别、标识符和模式，保留有效的补充平面字符', () => {
    expect(structureSearchInputSchema.parse({ ...input, kinds: ['sequence'] }).databases).toEqual(input.databases);
    for (const value of [{ ...input, dialect: undefined }, { ...input, kinds: ['event'] }, { ...input, searchIn: 'definition', kinds: ['index'] },
      { ...input, pattern: { ...input.pattern, text: 'A\0B' } }])
      expect(structureSearchInputSchema.safeParse(value).success).toBe(false);
  });

  it('普通文字和续页键均为绑定参数，按同一 C 排序读取下一页', () => {
    const after = { object: '"a"."b"', name: "q' --" };
    const query = postgresStructureSearchQuery('column', input.pattern, 50, after);
    expect(query.params).toEqual([input.pattern.text, after.object, after.name]);
    expect(query.sql).not.toContain(input.pattern.text);
    expect(query.sql).toContain('pg_catalog.strpos(pg_catalog.lower(match_name), pg_catalog.lower($1::text))');
    expect(query.sql).toContain('AND (object_name COLLATE pg_catalog."C", match_name COLLATE pg_catalog."C") > ($2::text, $3::text)');
    expect(query.sql).toContain('LIMIT 51');
    const routine = postgresStructureSearchQuery('function', { ...input.pattern, mode: 'regexp' }, 1);
    expect(routine.sql).toContain('pg_catalog.oidvectortypes(p.proargtypes)');
    expect(routine.sql).toContain('match_name ~* $1::text');
  });

  it('单次续页按原数据库顺序，读取结束后才发布，错误方言不能消费游标', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: Array.from({ length: 51 }, (_, i) => row(i)) })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row(50)] });
    const visited: string[] = [];
    let closed = false;
    const read = (database: string, action: (connection: PostgresConnection) => Promise<unknown>) => {
      visited.push(database);
      closed = false;
      return action({ database, query } as unknown as PostgresConnection).finally(() => { closed = true; });
    };
    const searches = new StructureSearches();
    const run = (search: StructureSearchState) =>
      readPostgresStructureSearchPage(search, read as Parameters<typeof readPostgresStructureSearchPage>[1], () => {});
    const first = await searches.startPage(input, 'postgresql', run);
    expect(closed).toBe(true);
    expect(first).toMatchObject({ totalHits: 50, completedScopes: 0 });
    const next = { connectionId: input.connectionId, taskId: randomUUID(), cursor: first.cursor! };
    expect(() => searches.nextPage(next, undefined, run)).toThrow('不属于');
    const second = await searches.nextPage(next, 'postgresql', run);
    expect(second).toMatchObject({ totalHits: 51, completedScopes: 1 });
    expect(visited).toEqual([input.databases[0], input.databases[0]]);
    expect(query.mock.calls[3][1]).toEqual([input.pattern.text, row(49).c0, row(49).c1]);
    expect(() => searches.nextPage(next, 'postgresql', run)).toThrow('已过期或已继续');
  });

  it('仅在明确的目标库拒绝时按选择继续，传输失败与目录关闭失败不发布本页', async () => {
    const denied = Object.assign(Error('数据库权限不足'), { postgresDatabaseUnavailable: true });
    const read = async () => { throw denied; };
    const page = await readPostgresStructureSearchPage(state(), read, () => {});
    expect(page).toMatchObject({ completedScopes: 1, failures: [{ database: input.databases[0] }], stoppedOnError: false });
    const transport = async () => { throw Error('连接断开'); };
    await expect(readPostgresStructureSearchPage(state(), transport, () => {})).rejects.toThrow('连接断开');
    const close = async <T>(database: string, action: (connection: PostgresConnection) => Promise<T>) => {
      await action({ database, query: async () => ({ rows: [] }) } as unknown as PostgresConnection);
      throw Error('关闭未确认');
    };
    await expect(readPostgresStructureSearchPage(state(), close, () => {})).rejects.toThrow('关闭未确认');
  });

  it('断开使正在收尾的搜索失效，迟到回包不能生成新的续页', async () => {
    const searches = new StructureSearches();
    let finish!: () => void;
    const pending = searches.startPage(input, 'postgresql', () => new Promise(resolve => {
      finish = () => resolve({ hits: [], failures: [], totalHits: 0, completedScopes: 0,
        scopeCount: 2, limitReached: false, stoppedOnError: false });
    }));
    searches.releaseConnection(input.connectionId);
    finish();
    await expect(pending).rejects.toThrow('搜索连接已断开');
  });

  it('正文仅绑定到数据库匹配查询，回包只包含位置和摘要', async () => {
    const signature = '"例"."f"(integer)', body = "SELECT '正文%_😀'";
    const pattern = { mode: 'contains' as const, text: '正文%_😀', caseSensitive: true };
    const definitionState = { ...state(), input: { ...input, searchIn: 'definition' as const, kinds: ['function' as const], pattern } };
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ c0: signature, c1: 'f' }] })
      .mockResolvedValueOnce({ rows: [{ c0: body, c1: null }] }).mockResolvedValueOnce({ rows: [{ c0: '15' }] });
    const read = <T>(database: string, action: (connection: PostgresConnection) => Promise<T>) =>
      action({ database, query } as unknown as PostgresConnection);
    const page = await readPostgresStructureSearchPage(definitionState, read, () => {});
    expect(query.mock.calls[2][1]).toEqual([signature, 'function']);
    expect(query.mock.calls[3][1]).toEqual([pattern.text, body]);
    expect(query.mock.calls[3][0]).not.toContain(pattern.text);
    expect(page).toMatchObject({ totalHits: 1, completedScopes: 1, scannedDefinitions: 1, hits: [{ object: signature,
      definitionNavigation: { status: 'ready', ranges: [{ offset: 8, length: pattern.text.length }] } }] });
    expect(JSON.stringify(page)).not.toContain(body);
    const target = { connectionId: input.connectionId, database: input.databases[0], name: signature, kind: 'function' };
    expect(validateCommand('postgres.structure.definition', target)).toEqual(target);
    expect(() => validateCommand('postgres.structure.definition', { ...target, sql: body })).toThrow();
    expect(definitionSearchOpenSchema.safeParse({ ...target, dialect: 'postgresql', connectionVersion: 1, invalidated: false }).success).toBe(true);
  });
});
