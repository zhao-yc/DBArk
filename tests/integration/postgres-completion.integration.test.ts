import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../src/shared/postgresCompletion';

const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
const enabled = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';

describe.skipIf(!enabled)('PostgreSQL 实库补全目录', () => {
  /** 核对精确 schema、前缀、字段类型、重名保护及与用户事务隔离。 */
  it('只返回权限范围内的独立目录，未限定的重名关系不猜测', async () => {
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
      engine.handle('postgres.completion', { ...input, profile });
    const target = { connectionId, database };
    const relations = (prefix: string, schema?: string) => read({ ...target, kind: 'relations', prefix, schema });
    const columns = (prefix: string, refs: { schema?: string; name: string }[]) => read({ ...target, kind: 'columns', prefix, relations: refs });
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
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
