import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile, QueryOutcome } from '../../src/shared/contracts';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../src/shared/postgresCompletion';

const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
const enabled = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';

describe.skipIf(!enabled)('PostgreSQL 实库补全目录', () => {
  /** 核对独立目录、空闲原会话及事务内延后读取三种路径。 */
  it('保留独立目录，按原会话读取角色、路径和临时对象', async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
        database !== process.env.DBARK_POSTGRES_TEST_USER || !password || !Number.isInteger(port) || port <= 1024) {
      throw Error('只允许本轮专用回环 PostgreSQL 实库');
    }
    const connectionId = randomUUID();
    const profile: PostgresConnectionProfile = { id: connectionId, name: '隔离补全', group: '', color: '#123456',
      dialect: 'postgresql', host: '127.0.0.1', port, user: database, password, database, rememberPassword: false };
    const config = { host: profile.host, port, user: database, password, database, ssl: false,
      sslnegotiation: 'postgres' as const, options: ' ', replication: 'false' };
    const client = Object.assign(new Client(config), { binary: false });
    const engine = new Engine();
    const read = (input: PostgresCompletionInput): Promise<PostgresCompletionResult> =>
      engine.handle('postgres.completion', input.sessionId ? input : { ...input, profile });
    const target = { connectionId, database };
    const relations = (prefix: string, schema?: string, sessionId?: string) => read({ ...target, kind: 'relations', prefix, schema, sessionId });
    const columns = (prefix: string, refs: { schema?: string; name: string }[], sessionId?: string) =>
      read({ ...target, kind: 'columns', prefix, relations: refs, sessionId });
    await client.connect();
    try {
      await client.query(`
        CREATE SCHEMA "补全.甲";
        CREATE SCHEMA "补全.乙";
        CREATE SCHEMA "隐藏";
        CREATE TABLE "补全.甲"."订""单" ("品名" text, "价格" numeric(40,18), gone integer);
        ALTER TABLE "补全.甲"."订""单" DROP COLUMN gone;
        CREATE TABLE "补全.乙"."订""单" (other text);
        CREATE VIEW "补全.甲"."订阅" AS SELECT "品名" FROM "补全.甲"."订""单";
        CREATE TABLE "隐藏".secret (private_column text);
        REVOKE USAGE ON SCHEMA "隐藏" FROM CURRENT_USER;
        CREATE TABLE public.unique_scope (only_field integer);
        CREATE TABLE public.duplicate_scope (public_field integer);
        CREATE TABLE "补全.乙".duplicate_scope (other_field text);
        CREATE TABLE public.r_literal (id int);
        CREATE TABLE public.rXliteral (id int);
      `);
      // 中文排序由服务器区域设置决定，集合必须精确相同。
      expect(new Set((await relations('补全')).items.map(item => JSON.stringify(item)))).toEqual(new Set([
        JSON.stringify({ kind: 'schema', name: '补全.甲' }), JSON.stringify({ kind: 'schema', name: '补全.乙' }),
      ]));
      expect((await relations('订', '补全.甲')).items).toEqual(expect.arrayContaining([
        { kind: 'table', schema: '补全.甲', name: '订"单' }, { kind: 'view', schema: '补全.甲', name: '订阅' },
      ]));
      expect((await relations('r_')).items).toEqual([{ kind: 'table', schema: 'public', name: 'r_literal' }]);
      expect((await relations('secret', '隐藏')).items).toEqual([]);
      expect((await columns('', [{ schema: '隐藏', name: 'secret' }])).items).toEqual([]);
      expect((await columns('价', [{ schema: '补全.甲', name: '订"单' }, { schema: '补全.乙', name: '订"单' }])).items)
        .toEqual([{ kind: 'column', reference: 0, name: '价格', type: 'numeric(40,18)' }]);
      expect((await columns('other', [{ schema: '补全.甲', name: '订"单' }, { schema: '补全.乙', name: '订"单' }])).items)
        .toEqual([{ kind: 'column', reference: 1, name: 'other', type: 'text' }]);
      expect((await columns('gone', [{ schema: '补全.甲', name: '订"单' }])).items).toEqual([]);
      expect((await columns('', [{ name: 'unique_scope' }])).items).toEqual([{ kind: 'column', reference: 0, name: 'only_field', type: 'integer' }]);
      expect((await columns('', [{ name: 'duplicate_scope' }])).items).toEqual([]);
      await client.query('BEGIN; CREATE TEMP TABLE temp_completion (original int); INSERT INTO temp_completion VALUES (7)');
      expect((await relations('temp_completion')).items).toEqual([]);
      expect((await client.query('SELECT original FROM temp_completion')).rows).toEqual([{ original: 7 }]);
      await client.query('ROLLBACK');

      await engine.handle('connections.open', { id: connectionId, profile });
      const { sessionId } = await engine.handle('sessions.open', target);
      const { sessionId: other } = await engine.handle('sessions.open', target);
      const run = (sql: string, taskId = randomUUID()): Promise<QueryOutcome> =>
        engine.handle('query.execute', { sessionId, taskId, sql, maxRows: 100 });
      const fields = async (schema?: string, id = sessionId) =>
        (await columns('', [{ name: 'duplicate_scope', schema }], id)).items.map(item => item.name);
      expect((await run(`SET search_path TO "补全.乙", public, pg_catalog;
        SET statement_timeout TO '800ms'; SET lock_timeout TO '250ms'`)).failure).toBeUndefined();
      expect(await fields()).toEqual(['other_field']);
      expect(await fields(undefined, other)).toEqual(['public_field']);
      expect((await run('CREATE TEMP TABLE duplicate_scope (temp_field bigint); INSERT INTO duplicate_scope VALUES (7)')).failure).toBeUndefined();
      expect(await fields()).toEqual(['temp_field']);
      expect(await fields('pg_temp')).toEqual(['temp_field']);
      expect(await fields('pg_temp', other)).toEqual([]);
      expect((await relations('duplicate', undefined, sessionId)).items[0])
        .toEqual({ kind: 'table', name: 'duplicate_scope', schema: 'pg_temp' });
      expect((await relations('duplicate', undefined, other)).items).not.toContainEqual({ kind: 'table', name: 'duplicate_scope', schema: 'pg_temp' });
      expect((await run('SET search_path TO public, pg_temp, "补全.乙", pg_catalog')).failure).toBeUndefined();
      expect(await fields()).toEqual(['public_field']);
      const settings = await run("SELECT current_setting('statement_timeout'), current_setting('lock_timeout'), (SELECT temp_field FROM pg_temp.duplicate_scope)");
      expect(settings.results[0]?.rows).toEqual([{ c0: '800ms', c1: '250ms', c2: '7' }]);

      const limited = process.env.DBARK_POSTGRES_COMPLETION_ROLE;
      if (limited) {
        if (limited !== database + '_limited') throw Error('补全角色不是本轮专用角色');
        await client.query(`GRANT USAGE ON SCHEMA "补全.乙" TO "${limited}";
          GRANT SELECT (other_field) ON "补全.乙".duplicate_scope TO "${limited}"`);
        expect((await run(`SET ROLE "${limited}"; SET search_path TO "补全.乙", public, pg_catalog`)).failure).toBeUndefined();
        expect(await fields('补全.乙')).toEqual(['other_field']);
        expect(await fields('public')).toEqual([]);
        expect((await run('RESET ROLE')).failure).toBeUndefined();
        expect(await fields('public')).toEqual(['public_field']);
      }

      const pending = fields('public');
      const user = run('SELECT 17');
      expect(await columns('', [{ name: 'duplicate_scope' }], sessionId)).toMatchObject({ deferred: 'busy' });
      expect(await pending).toEqual(['public_field']);
      expect((await user).results[0]?.rows).toEqual([{ c0: '17' }]);
      const waiting = fields('pg_temp'), taskId = randomUUID();
      const write = run('UPDATE pg_temp.duplicate_scope SET temp_field = 99', taskId);
      await Promise.resolve();
      await engine.handle('query.cancel', { taskId });
      expect(await waiting).toEqual(['temp_field']);
      expect((await write).failure?.message).toContain('未发送用户 SQL');
      expect((await run('SELECT temp_field FROM pg_temp.duplicate_scope')).results[0]?.rows).toEqual([{ c0: '7' }]);
      await expect(read({ ...target, database: 'postgres', kind: 'relations', prefix: '', sessionId })).rejects.toThrow('原会话');
      expect((await run('BEGIN; SET LOCAL search_path TO public')).transactionOpen).toBe(true);
      expect(await columns('', [{ name: 'duplicate_scope' }], sessionId)).toMatchObject({ deferred: 'transaction', items: [] });
      expect((await run('SELECT 1/0')).failure).toBeDefined();
      expect(await relations('duplicate', undefined, sessionId)).toMatchObject({ deferred: 'transaction' });
      expect(await engine.handle('query.sessionState', { sessionId })).toMatchObject({ transactionFailed: true, transactionOpen: true });
      await run('ROLLBACK');
      expect(await fields('pg_temp')).toEqual(['temp_field']);
      await engine.handle('sessions.close', { sessionId });
      await expect(relations('duplicate', undefined, sessionId)).rejects.toThrow('原会话');
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
