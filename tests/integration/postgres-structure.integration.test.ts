import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';
import type { PostgresColumnChange } from '../../src/shared/postgresColumnEdit';

const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
const enabled = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';

describe.skipIf(!enabled)('PostgreSQL 实库结构快照', () => {
  /** 核对字段、索引和约束的真实定义，并证明只读目录没有执行视图正文。 */
  it('读取限定 schema、表达式、约束、索引、分区、视图和物化视图', async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
        database !== process.env.DBARK_POSTGRES_TEST_USER || !password || !Number.isInteger(port) || port <= 1024) {
      throw Error('只允许本轮专用回环 PostgreSQL 实库');
    }
    const id = randomUUID();
    const profile: PostgresConnectionProfile = { id, name: '隔离结构', group: '', color: '#123456',
      dialect: 'postgresql', host: '127.0.0.1', port, user: database, password, database, rememberPassword: false };
    const config = { host: profile.host, port, user: database, password, database, ssl: false,
      sslnegotiation: 'postgres' as const, options: ' ', replication: 'false' };
    const client = Object.assign(new Client(config), { binary: false });
    const engine = new Engine();
    const structure = (table: string): Promise<PostgresStructureResult> =>
      engine.handle('postgres.structure.read', { connectionId: id, database, table, profile });
    const target = '"结构.甲"."含""引号"';
    await client.connect();
    try {
      await client.query(`
        CREATE SCHEMA "结构.甲";
        CREATE SCHEMA "结构.乙";
        CREATE TABLE "结构.乙"."含""引号" (different integer);
        CREATE TABLE "结构.甲".parent (id bigint PRIMARY KEY);
        CREATE TABLE ${target} (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          obsolete text,
          note text COLLATE "C" DEFAULT '原注记',
          amount numeric(40,18) NOT NULL,
          stored numeric GENERATED ALWAYS AS (amount * 2) STORED,
          parent_id bigint,
          CONSTRAINT unique_note UNIQUE(note),
          CONSTRAINT defer_parent FOREIGN KEY(parent_id) REFERENCES "结构.甲".parent(id) DEFERRABLE INITIALLY DEFERRED
        );
        ALTER TABLE ${target} DROP COLUMN obsolete;
        ALTER TABLE ${target} ADD CONSTRAINT amount_check CHECK(amount >= 0) NOT VALID;
        COMMENT ON TABLE ${target} IS '关系结构原注释';
        COMMENT ON COLUMN ${target}.note IS '字段原注释';
        CREATE INDEX partial_note ON ${target} (lower(note)) INCLUDE (parent_id) WHERE note IS NOT NULL;
        CREATE TABLE "结构.甲".range_parent (id int NOT NULL) PARTITION BY RANGE (id);
        CREATE TABLE "结构.甲".range_child PARTITION OF "结构.甲".range_parent FOR VALUES FROM (0) TO (10);
        CREATE FUNCTION "结构.甲".bomb() RETURNS int LANGUAGE plpgsql VOLATILE AS $f$
          BEGIN RAISE EXCEPTION '视图正文不应执行'; END;
        $f$;
        CREATE VIEW "结构.甲".subject_view AS SELECT id, "结构.甲".bomb() AS never_run FROM ${target};
        CREATE MATERIALIZED VIEW "结构.甲".subject_mv AS SELECT id FROM ${target} WITH NO DATA;
        INSERT INTO ${target} (amount) VALUES (1);
      `);
      const result = await structure(target);
      expect(result).toMatchObject({ schema: '结构.甲', name: '含"引号', database, kind: 'r', comment: '关系结构原注释' });
      expect(result.columns.map(column => column.position)).toEqual([1, 3, 4, 5, 6]);
      expect(result.columns).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'id', nullable: false, identity: 'a', defaultExpression: null }),
        expect.objectContaining({ name: 'note', collation: 'pg_catalog."C"', defaultExpression: "'原注记'::text", comment: '字段原注释' }),
        expect.objectContaining({ name: 'amount', type: 'numeric(40,18)', nullable: false }),
        expect.objectContaining({ name: 'stored', generation: 's', generationExpression: expect.stringContaining('amount') }),
      ]));
      expect(result.constraints).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'defer_parent', kind: 'f', deferrable: true, initiallyDeferred: true,
          definition: expect.stringContaining('REFERENCES "结构.甲".parent') }),
        expect.objectContaining({ name: 'amount_check', kind: 'c', validated: false }),
        expect.objectContaining({ name: 'unique_note', kind: 'u' }),
      ]));
      expect(result.indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'unique_note', constraint: 'unique_note', valid: true, unique: true }),
        expect.objectContaining({ name: 'partial_note', method: 'btree', constraint: null, definition: expect.stringContaining('INCLUDE (parent_id)') }),
      ]));
      expect(result.indexes.find(index => index.name === 'partial_note')?.definition).toContain('WHERE (note IS NOT NULL)');
      expect((await structure('"结构.乙"."含""引号"')).columns.map(column => column.name)).toEqual(['different']);
      expect(await structure('"结构.甲"."range_parent"')).toMatchObject({ kind: 'p', partitionKey: 'RANGE (id)' });
      expect(await structure('"结构.甲"."range_child"')).toMatchObject({ kind: 'r', partitionBound: 'FOR VALUES FROM (0) TO (10)' });
      expect(await structure('"结构.甲"."subject_view"')).toMatchObject({ kind: 'v',
        viewDefinition: expect.stringContaining('"结构.甲".bomb()') });
      expect(await structure('"结构.甲"."subject_mv"')).toMatchObject({ kind: 'm',
        viewDefinition: expect.stringContaining('"结构.甲"."含""引号"') });
      await expect(client.query('SELECT * FROM "结构.甲".subject_view')).rejects.toThrow('视图正文不应执行');
      await expect(structure('"结构.甲"."不存在"')).rejects.toThrow('关系不存在');
      await expect(structure('pg_catalog.pg_class')).rejects.toThrow('关系不存在');
      expect((await client.query(`SELECT count(*)::int n FROM ${target}`)).rows[0].n).toBe(1);
      const scoped = { connectionId: id, database, table: target, profile, owner: '原结构文档', connectionRevision: 1 };
      const field = { name: '扩"展', type: 'text', nullable: true, primary: false, unique: false, identity: 'none',
        default: { mode: 'literal', value: "原值'; --" }, comment: '附加字段' } as const;
      const rename = { kind: 'rename', from: 'note', name: '现注记' } as const;
      const preview = (changes: PostgresColumnChange[], editStamp = result.editStamp) =>
        engine.handle('postgres.columnEdit.preview', { ...scoped, changes, editStamp });
      const apply = (token: string, owner = scoped.owner) => engine.handle('postgres.columnEdit.apply', { ...scoped, token, owner });
      expect(result.editStamp).toMatch(/^[a-f0-9]{64}$/);
      expect((await structure('"结构.甲"."range_child"')).editStamp).toBeUndefined();
      const invalid = await preview([rename, { kind: 'add', field: { ...field, nullable: false, default: { mode: 'none' } } }]);
      expect((await apply(invalid.token)).outcome).toBe('rolledBack');
      expect((await structure(target)).editStamp).toBe(result.editStamp);
      const stale = await preview([rename]);
      await client.query(`BEGIN; LOCK TABLE ${target} IN SHARE MODE; COMMENT ON TABLE ${target} IS '并发修改'`);
      const racing = apply(stale.token);
      try {
        await expect.poll(async () => (await client.query(
          'SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE relation = $1::regclass AND NOT granted', [target],
        )).rows[0].n, { timeout: 3000 }).toBe(1);
        await client.query('COMMIT');
      } catch (reason) {
        await client.query('ROLLBACK');
        await racing;
        throw reason;
      }
      expect(await racing).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('加锁后') });
      expect((await structure(target)).columns.some(column => column.name === 'note')).toBe(true);
      const current = await structure(target);
      const ready = await preview([rename, { kind: 'add', field }], current.editStamp);
      expect(ready.statements[0]).toContain('RENAME COLUMN "note" TO "现注记"');
      expect((await apply(ready.token, '另一个文档')).outcome).toBe('notSent');
      expect((await structure(target)).editStamp).toBe(current.editStamp);
      expect((await apply(ready.token)).outcome).toBe('committed');
      expect((await apply(ready.token)).outcome).toBe('notSent');
      const altered = await structure(target);
      expect(altered.columns.find(column => column.name === '现注记')?.position).toBe(3);
      expect(altered.columns.find(column => column.name === '扩"展')?.comment).toBe('附加字段');
      expect((await client.query(`SELECT "现注记", "扩""展" FROM ${target}`)).rows).toEqual([{ 现注记: '原注记', '扩"展': "原值'; --" }]);
      expect(altered.indexes.find(index => index.name === 'partial_note')?.definition).toContain('现注记');
      const replacement = '"结构.甲"."同名替换"';
      await client.query(`CREATE TABLE ${replacement} (id int)`);
      const beforeReplacement = await structure(replacement);
      const replacePlan = await engine.handle('postgres.columnEdit.preview', { ...scoped, table: replacement,
        editStamp: beforeReplacement.editStamp, changes: [{ kind: 'rename', from: 'id', name: 'new_id' }] });
      await client.query(`DROP TABLE ${replacement}; CREATE TABLE ${replacement} (id int)`);
      expect((await engine.handle('postgres.columnEdit.apply', { ...scoped, table: replacement, token: replacePlan.token })).outcome).toBe('notSent');
      expect((await structure(replacement)).columns.map(column => column.name)).toEqual(['id']);
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
