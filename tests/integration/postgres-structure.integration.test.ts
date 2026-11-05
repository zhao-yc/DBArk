import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';
import type { PostgresColumnChange } from '../../src/shared/postgresColumnEdit';
import type { PostgresIndexChange } from '../../src/shared/postgresIndexEdit';
import type { PostgresKeyChange } from '../../src/shared/postgresKeyEdit';
import type { PostgresForeignChange, PostgresForeignCreation, PostgresForeignTargets } from '../../src/shared/postgresForeignKeyEdit';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { PostgresConnection } from '../../src/engine/postgres/connection';
import { readPostgresForeignTargets } from '../../src/engine/postgres/foreignKeyEdit';

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
      // 外部依赖阻止删除，先前已经执行的类型、默认值和注释改动也全部回滚。
      await client.query(`CREATE VIEW "结构.甲".dependent_field AS SELECT "扩""展" FROM ${target}`);
      await client.query(`CREATE INDEX removable_idx ON ${target} ("扩""展")`);
      const beforeChanges = await structure(target);
      const modify: PostgresColumnChange[] = [
        { kind: 'type', from: '现注记', dataType: { type: 'varchar', length: 40 } },
        { kind: 'nullable', from: '现注记', nullable: false },
        { kind: 'default', from: '现注记', value: "新'默认" },
        { kind: 'comment', from: '现注记', value: '新注释' },
        { kind: 'drop', from: '扩"展' },
      ];
      const blocked = await preview(modify, beforeChanges.editStamp);
      expect(blocked.statements[0]).toContain('TYPE varchar(40) COLLATE pg_catalog."C"');
      expect(blocked.statements.at(-1)).toContain('DROP COLUMN "扩""展" RESTRICT');
      expect(await apply(blocked.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('depend') });
      expect((await structure(target)).editStamp).toBe(beforeChanges.editStamp);
      expect((await client.query('SELECT * FROM "结构.甲".dependent_field')).rows).toEqual([{ '扩"展': "原值'; --" }]);
      await client.query('DROP VIEW "结构.甲".dependent_field');
      expect((await apply((await preview(modify, (await structure(target)).editStamp)).token)).outcome).toBe('committed');
      const modified = await structure(target);
      expect(modified.columns.find(column => column.name === '现注记')).toMatchObject({ position: 3, nullable: false,
        type: 'character varying(40)', collation: 'pg_catalog."C"', comment: '新注释' });
      expect(modified.columns.some(column => column.name === '扩"展')).toBe(false);
      expect(modified.indexes.map(index => index.name)).toContain('partial_note');
      expect(modified.indexes.map(index => index.name)).not.toContain('removable_idx');
      expect((await client.query(`SELECT "现注记" FROM ${target}`)).rows).toEqual([{ 现注记: '原注记' }]);
      expect((await client.query(`INSERT INTO ${target} (amount) VALUES (2) RETURNING "现注记"`)).rows).toEqual([{ 现注记: "新'默认" }]);
      const clear = await preview([{ kind: 'default', from: '现注记', value: null },
        { kind: 'nullable', from: '现注记', nullable: true }, { kind: 'comment', from: '现注记', value: null }], modified.editStamp);
      expect((await apply(clear.token)).outcome).toBe('committed');
      expect((await structure(target)).columns.find(column => column.name === '现注记')).toMatchObject({
        nullable: true, defaultExpression: null, comment: null });
      expect((await client.query(`INSERT INTO ${target} (amount) VALUES (3) RETURNING "现注记"`)).rows).toEqual([{ 现注记: null }]);
      const replacement = '"结构.甲"."同名替换"';
      await client.query(`CREATE TABLE ${replacement} (id int)`);
      const beforeReplacement = await structure(replacement);
      const replacePlan = await engine.handle('postgres.columnEdit.preview', { ...scoped, table: replacement,
        editStamp: beforeReplacement.editStamp, changes: [{ kind: 'rename', from: 'id', name: 'new_id' }] });
      await client.query(`DROP TABLE ${replacement}; CREATE TABLE ${replacement} (id int)`);
      expect((await engine.handle('postgres.columnEdit.apply', { ...scoped, table: replacement, token: replacePlan.token })).outcome).toBe('notSent');
      expect((await structure(replacement)).columns.map(column => column.name)).toEqual(['id']);

      // 在同一 schema 里验证六种索引方法、约束保护、重命名身份和批次回滚。
      const indexTarget = '"结构.甲"."索引目标"';
      await client.query(`CREATE TABLE ${indexTarget} (id integer PRIMARY KEY, note text, j jsonb, p point, tag text NOT NULL);
        INSERT INTO ${indexTarget} VALUES (1, '重复值', '{}', '(1,1)', '甲'), (2, '重复值', '{}', '(2,2)', '乙');
        CREATE UNIQUE INDEX identity_idx ON ${indexTarget}(tag);
        ALTER TABLE ${indexTarget} REPLICA IDENTITY USING INDEX identity_idx;
        CREATE INDEX start_idx ON ${indexTarget}(note);`);
      const indexScoped = { ...scoped, table: indexTarget };
      const indexPreview = async (changes: PostgresIndexChange[], editStamp?: string) =>
        engine.handle('postgres.indexEdit.preview', { ...indexScoped, changes, editStamp: editStamp ?? (await structure(indexTarget)).editStamp });
      const indexApply = (token: string, owner = indexScoped.owner) => engine.handle('postgres.indexEdit.apply', { ...indexScoped, token, owner });
      const ordinary = { column: 'note', direction: 'asc', nulls: 'default' } as const;
      await expect(indexPreview([{ kind: 'drop', from: 'identity_idx' }])).rejects.toThrow('复制标识');
      await expect(indexPreview([{ kind: 'rename', from: '索引目标_pkey', name: 'invalid' }])).rejects.toThrow('受约束');
      const start = await structure(indexTarget);
      const rollbackIndex = await indexPreview([{ kind: 'rename', from: 'start_idx', name: '临时重命名' },
        { kind: 'create', name: '重复唯一值', method: 'btree', unique: true, keys: [ordinary], include: [] }]);
      expect((await indexApply(rollbackIndex.token)).outcome).toBe('rolledBack');
      expect((await structure(indexTarget)).editStamp).toBe(start.editStamp);
      const staleIndex = await indexPreview([{ kind: 'drop', from: 'start_idx' }]);
      await client.query(`DROP INDEX "结构.甲".start_idx; CREATE INDEX start_idx ON ${indexTarget}(note)`);
      const sameDefinition = await structure(indexTarget);
      expect(sameDefinition.indexes).toEqual(start.indexes);
      expect(sameDefinition.editStamp).not.toBe(start.editStamp);
      expect((await indexApply(staleIndex.token)).outcome).toBe('notSent');

      // ALTER INDEX 锁的是索引本身。让原名称在其锁等待期间被另一张表的索引占用。
      await client.query(`CREATE TABLE "结构.甲".other_index_table (note text);
        CREATE INDEX other_idx ON "结构.甲".other_index_table(note);`);
      const indexOid = async (name: string) => (await client.query('SELECT $1::regclass::oid::text AS id', [name])).rows[0].id;
      const firstOid = await indexOid('"结构.甲".start_idx');
      const otherOid = await indexOid('"结构.甲".other_idx');
      const raceIndex = await indexPreview([{ kind: 'rename', from: 'start_idx', name: 'race_idx' }]);
      await client.query('BEGIN; ALTER INDEX "结构.甲".start_idx RENAME TO moved_idx; ALTER INDEX "结构.甲".other_idx RENAME TO start_idx');
      const racingIndex = indexApply(raceIndex.token);
      try {
        await expect.poll(async () => (await client.query(
          'SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE relation = $1::oid AND NOT granted', [firstOid],
        )).rows[0].n, { timeout: 3000 }).toBe(1);
        await client.query('COMMIT');
      } catch (reason) {
        await client.query('ROLLBACK');
        await racingIndex;
        throw reason;
      }
      expect(await racingIndex).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('实际索引') });
      expect(await indexOid('"结构.甲".moved_idx')).toBe(firstOid);
      expect(await indexOid('"结构.甲".start_idx')).toBe(otherOid);
      expect((await client.query('SELECT pg_catalog.to_regclass($1) AS resolved', ['"结构.甲".race_idx'])).rows[0].resolved).toBeNull();
      await client.query('ALTER INDEX "结构.甲".start_idx RENAME TO other_idx; ALTER INDEX "结构.甲".moved_idx RENAME TO start_idx');

      const methods = [['hash', 'note'], ['gin', 'j'], ['gist', 'p'], ['spgist', 'tag'], ['brin', 'id']] as const;
      const readyIndexes = await indexPreview([
        { kind: 'rename', from: 'start_idx', name: '旧"索引' },
        { kind: 'create', name: '复合"索引', method: 'btree', unique: true, keys: [
          { ...ordinary, direction: 'desc', nulls: 'last' }, { ...ordinary, column: 'id', nulls: 'first' },
        ], include: ['tag'] },
        ...methods.map(([method, column]): PostgresIndexChange => ({ kind: 'create', name: 'method_' + method,
          method, unique: false, keys: [{ ...ordinary, column }], include: [] })),
      ]);
      expect(readyIndexes.statements[1]).toContain('"note" DESC NULLS LAST, "id" ASC NULLS FIRST) INCLUDE ("tag")');
      expect((await indexApply(readyIndexes.token, '其他文档')).outcome).toBe('notSent');
      expect((await structure(indexTarget)).editStamp).toBe(sameDefinition.editStamp);
      expect((await indexApply(readyIndexes.token)).outcome).toBe('committed');
      expect((await indexApply(readyIndexes.token)).outcome).toBe('notSent');
      const indexed = await structure(indexTarget);
      expect(indexed.indexes.find(index => index.name === '复合"索引')).toMatchObject({ method: 'btree', unique: true, parts: [
        { column: 'note', key: true, descending: true, nullsFirst: false },
        { column: 'id', key: true, descending: false, nullsFirst: true },
        { column: 'tag', key: false },
      ] });
      expect(indexed.indexes.filter(index => index.name.startsWith('method_')).map(index => index.method).sort())
        .toEqual(methods.map(([method]) => method).sort());
      const deleting = await indexPreview([{ kind: 'drop', from: '旧"索引' }]);
      expect(deleting.statements).toEqual(['DROP INDEX "结构.甲"."旧""索引" RESTRICT']);
      expect((await indexApply(deleting.token)).outcome).toBe('committed');
      expect((await structure(indexTarget)).indexes.some(index => index.name === '旧"索引')).toBe(false);
      expect((await client.query(`SELECT count(*)::int AS n FROM ${indexTarget}`)).rows[0].n).toBe(2);

      // 主键替换会更新真实键序和非空状态，原外键和复制标识仍有保护。
      const keyTarget = '"结构.甲"."键目标"';
      await client.query(`CREATE TABLE ${keyTarget} (id int, tenant int, code text, tag text NOT NULL,
        CONSTRAINT original_key PRIMARY KEY (id), CONSTRAINT replica_key UNIQUE (tag));
        INSERT INTO ${keyTarget} VALUES (1, 10, 'a', '甲'), (2, 10, 'b', '乙');
        ALTER TABLE ${keyTarget} REPLICA IDENTITY USING INDEX replica_key;
        CREATE TABLE "结构.甲".key_child (id int REFERENCES ${keyTarget}(id));
        INSERT INTO "结构.甲".key_child VALUES (1);`);
      const keyScope = { ...scoped, table: keyTarget };
      const keyPreview = async (changes: PostgresKeyChange[]) => engine.handle('postgres.keyEdit.preview', {
        ...keyScope, editStamp: (await structure(keyTarget)).editStamp, changes,
      });
      const keyApply = (token: string, owner = keyScope.owner) => engine.handle('postgres.keyEdit.apply', { ...keyScope, token, owner });
      await expect(keyPreview([{ kind: 'drop', from: 'replica_key' }])).rejects.toThrow('复制标识');
      const blockedByFk = await keyPreview([{ kind: 'drop', from: 'original_key' }]);
      expect(await keyApply(blockedByFk.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('depend') });
      expect((await client.query('SELECT id FROM "结构.甲".key_child')).rows).toEqual([{ id: 1 }]);
      const beforeKeys = await structure(keyTarget);
      const badKeys = await keyPreview([{ kind: 'rename', from: 'original_key', name: '临时主键' },
        { kind: 'create', key: 'u', name: '重复的租户', columns: ['tenant'], timing: 'immediate', nullsNotDistinct: false }]);
      expect((await keyApply(badKeys.token)).outcome).toBe('rolledBack');
      expect((await structure(keyTarget)).editStamp).toBe(beforeKeys.editStamp);
      await client.query('DROP TABLE "结构.甲".key_child');
      const replacePrimary: PostgresKeyChange[] = [{ kind: 'drop', from: 'original_key' },
        { kind: 'create', key: 'p', name: '新"主键', columns: ['tenant', 'id'], timing: 'immediate', nullsNotDistinct: false }];
      await client.query(`UPDATE ${keyTarget} SET tenant = NULL WHERE id = 1`);
      const invalidPrimary = await keyPreview(replacePrimary);
      expect((await keyApply(invalidPrimary.token)).outcome).toBe('rolledBack');
      expect((await structure(keyTarget)).constraints.find(key => key.kind === 'p')?.name).toBe('original_key');
      await client.query(`UPDATE ${keyTarget} SET tenant = 10 WHERE id = 1`);
      const replacementKeys = await keyPreview([...replacePrimary,
        { kind: 'create', key: 'u', name: '值唯一', columns: ['code'], timing: 'deferred', nullsNotDistinct: true },
        { kind: 'rename', from: '值唯一', name: '新唯一键' }]);
      expect(replacementKeys.statements[0]).toContain('DROP CONSTRAINT "original_key" RESTRICT');
      expect(replacementKeys.statements[1]).toContain('"新""主键" PRIMARY KEY ("tenant", "id")');
      expect(replacementKeys.statements[2]).toContain('UNIQUE NULLS NOT DISTINCT ("code") DEFERRABLE INITIALLY DEFERRED');
      expect((await keyApply(replacementKeys.token, '其他文档')).outcome).toBe('notSent');
      expect((await keyApply(replacementKeys.token)).outcome).toBe('committed');
      expect((await keyApply(replacementKeys.token)).outcome).toBe('notSent');
      const keyResult = await structure(keyTarget);
      expect(keyResult.constraints).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '新"主键', kind: 'p', keyColumns: ['tenant', 'id'] }),
        expect.objectContaining({ name: '新唯一键', kind: 'u', keyColumns: ['code'], deferrable: true, initiallyDeferred: true }),
      ]));
      expect(keyResult.columns.find(column => column.name === 'tenant')?.nullable).toBe(false);
      expect(keyResult.indexes.find(index => index.constraint === '新唯一键')).toMatchObject({ unique: true, nullsNotDistinct: true });
      await client.query(`INSERT INTO ${keyTarget} VALUES (3, 10, NULL, '丙')`);
      await expect(client.query(`INSERT INTO ${keyTarget} VALUES (4, 10, NULL, '丁')`)).rejects.toMatchObject({ code: '23505' });
      const staleConstraint = await keyPreview([{ kind: 'drop', from: '新唯一键' }]);
      await client.query(`ALTER TABLE ${keyTarget} DROP CONSTRAINT "新唯一键",
        ADD CONSTRAINT "新唯一键" UNIQUE NULLS NOT DISTINCT (code) DEFERRABLE INITIALLY DEFERRED`);
      const sameConstraint = await structure(keyTarget);
      expect(sameConstraint.constraints).toEqual(keyResult.constraints);
      expect(sameConstraint.editStamp).not.toBe(keyResult.editStamp);
      expect((await keyApply(staleConstraint.token)).outcome).toBe('notSent');
      const dropUnique = await keyPreview([{ kind: 'drop', from: '新唯一键' }]);
      expect((await keyApply(dropUnique.token)).outcome).toBe('committed');
      const afterDrop = await structure(keyTarget);
      expect(afterDrop.constraints.some(key => key.name === '新唯一键')).toBe(false);
      expect(afterDrop.indexes.some(index => index.name === '新唯一键')).toBe(false);
      expect(afterDrop.indexes.find(index => index.name === 'replica_key')?.replicaIdentity).toBe(true);

      // 外键从真实唯一索引读取有序列，验证跨 schema 绑定、NOT VALID 及引用动作。
      const child = '"结构.甲"."foreign_child"';
      const parent = '"引用.目标"."含""引用"';
      await client.query(`CREATE SCHEMA "引用.目标";
        CREATE TABLE ${parent} (a int, b int, extra text);
        CREATE UNIQUE INDEX eligible_unique ON ${parent}(b, a) INCLUDE (extra);
        CREATE UNIQUE INDEX ignore_partial ON ${parent}(extra) WHERE extra IS NOT NULL;
        ALTER TABLE ${parent} ADD CONSTRAINT ignore_deferrable UNIQUE (a) DEFERRABLE;
        CREATE TABLE ${child} (x int, y int);
        INSERT INTO ${parent} VALUES (1, 2, '源'); INSERT INTO ${child} VALUES (7, 8), (1, 2);`);
      const foreignScope = { ...scoped, table: child };
      const targets = (): Promise<PostgresForeignTargets> => engine.handle('postgres.foreignEdit.targets', { ...foreignScope, search: '含"引用' });
      const foreignPreview = async (changes: PostgresForeignChange[]) => engine.handle('postgres.foreignEdit.preview', {
        ...foreignScope, editStamp: (await structure(child)).editStamp, changes,
      });
      const foreignApply = (token: string, owner = foreignScope.owner) => engine.handle('postgres.foreignEdit.apply', { ...foreignScope, token, owner });
      const firstTargets = await targets();
      expect(firstTargets).toMatchObject({ truncated: false, targets: [{ schema: '引用.目标', name: '含"引用', keys: [['b', 'a']] }] });
      const limitedRole = process.env.DBARK_POSTGRES_COMPLETION_ROLE;
      if (limitedRole) {
        const role = postgresIdentifier(limitedRole);
        const limited = new PostgresConnection(profile, database);
        await client.query(`GRANT USAGE ON SCHEMA "引用.目标" TO ${role}; GRANT REFERENCES (a) ON ${parent} TO ${role}`);
        try {
          await limited.open();
          await limited.query('SET ROLE ' + role, undefined, { rows: 1, bytes: 8192 });
          expect(await readPostgresForeignTargets(limited, '含"引用')).toMatchObject({ targets: [] });
          await client.query(`GRANT REFERENCES (b) ON ${parent} TO ${role}`);
          expect(await readPostgresForeignTargets(limited, '含"引用')).toMatchObject({ targets: firstTargets.targets });
          await expect(limited.query(`SELECT a FROM ${parent}`, undefined, { rows: 1, bytes: 8192 })).rejects.toThrow('permission denied');
        } finally { await limited.close(); }
      }
      const { schema, name, stamp } = firstTargets.targets[0];
      const addForeign: PostgresForeignCreation = { kind: 'create', name: '跨模式外键', reference: { schema, name, stamp },
        pairs: [{ local: 'y', remote: 'b' }, { local: 'x', remote: 'a' }], match: 'f', onUpdate: 'c', onDelete: 'n',
        timing: 'deferred', notValid: true };
      const staleRef = await foreignPreview([addForeign]);
      await client.query(`DROP INDEX "引用.目标".eligible_unique; CREATE UNIQUE INDEX eligible_unique ON ${parent}(b, a) INCLUDE (extra)`);
      expect(await foreignApply(staleRef.token)).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('被引用表') });
      const fresh = (await targets()).targets[0];
      expect(fresh.stamp).not.toBe(stamp);
      const latest = { ...addForeign, reference: { schema, name, stamp: fresh.stamp } };
      const racedTarget = await foreignPreview([latest]);
      const parentOid = (await client.query('SELECT $1::regclass::oid::text AS id', [parent])).rows[0].id;
      await client.query(`BEGIN; ALTER TABLE ${parent} RENAME TO moved_reference;
        CREATE TABLE ${parent} (a int, b int, extra text); CREATE UNIQUE INDEX replacement_unique ON ${parent}(b, a);`);
      const applyingReference = foreignApply(racedTarget.token);
      try {
        await expect.poll(async () => (await client.query(
          'SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE relation = $1::oid AND NOT granted', [parentOid],
        )).rows[0].n, { timeout: 3000 }).toBe(1);
        await client.query('COMMIT');
      } catch (reason) {
        await client.query('ROLLBACK');
        await applyingReference;
        throw reason;
      }
      expect((await applyingReference).outcome).toBe('rolledBack');
      expect((await structure(child)).constraints).toEqual([]);
      expect((await client.query(`SELECT '"引用.目标".moved_reference'::regclass::oid::text AS id`)).rows[0].id).toBe(parentOid);
      await client.query(`DROP TABLE ${parent}; ALTER TABLE "引用.目标".moved_reference RENAME TO "含""引用"`);
      const immediateValidation = await foreignPreview([{ ...latest, notValid: false }]);
      expect((await foreignApply(immediateValidation.token)).outcome).toBe('rolledBack');
      expect((await structure(child)).constraints).toEqual([]);
      const deferredValidation = await foreignPreview([latest, { kind: 'rename', from: latest.name, name: '已命名外键' }]);
      expect(deferredValidation.statements[0]).toContain('FOREIGN KEY ("y", "x") REFERENCES "引用.目标"."含""引用" ("b", "a") MATCH FULL ON UPDATE CASCADE ON DELETE SET NULL');
      expect((await foreignApply(deferredValidation.token, '其他文档')).outcome).toBe('notSent');
      expect((await foreignApply(deferredValidation.token)).outcome).toBe('committed');
      expect((await foreignApply(deferredValidation.token)).outcome).toBe('notSent');
      expect((await structure(child)).constraints).toEqual([expect.objectContaining({ name: '已命名外键', validated: false,
        foreign: expect.objectContaining({ onUpdate: 'c', onDelete: 'n', match: 'f', pairs: latest.pairs }) })]);
      await expect(client.query(`INSERT INTO ${child} VALUES (7, 8)`)).rejects.toMatchObject({ code: '23503' });
      await expect(client.query(`INSERT INTO ${child} VALUES (1, NULL)`)).rejects.toMatchObject({ code: '23503' });
      const invalidHistory = await foreignPreview([{ kind: 'rename', from: '已命名外键', name: '临时改名' }, { kind: 'validate', from: '临时改名' }]);
      expect((await foreignApply(invalidHistory.token)).outcome).toBe('rolledBack');
      expect((await structure(child)).constraints[0]).toMatchObject({ name: '已命名外键', validated: false });
      await client.query(`DELETE FROM ${child} WHERE x = 7`);
      const validating = await foreignPreview([{ kind: 'validate', from: '已命名外键' }]);
      expect((await foreignApply(validating.token)).outcome).toBe('committed');
      expect((await structure(child)).constraints[0]).toMatchObject({ name: '已命名外键', validated: true });
      await client.query(`UPDATE ${parent} SET a=3, b=4 WHERE a=1`);
      expect((await client.query(`SELECT x, y FROM ${child}`)).rows).toEqual([{ x: 3, y: 4 }]);
      await client.query(`DELETE FROM ${parent} WHERE a=3`);
      expect((await client.query(`SELECT x, y FROM ${child}`)).rows).toEqual([{ x: null, y: null }]);
      const droppingForeign = await foreignPreview([{ kind: 'drop', from: '已命名外键' }]);
      expect(droppingForeign.statements[0]).toContain('DROP CONSTRAINT "已命名外键" RESTRICT');
      expect((await foreignApply(droppingForeign.token)).outcome).toBe('committed');
      expect((await structure(child)).constraints).toEqual([]);
      // 被引用表是分区父表时，验证只核对根外键，不把 PostgreSQL 的内部子约束当作独立草稿。
      const partitionReference = '"引用.目标"."分区引用"';
      await client.query(`CREATE TABLE ${partitionReference} (id int PRIMARY KEY) PARTITION BY RANGE (id);
        CREATE TABLE "引用.目标".reference_part PARTITION OF ${partitionReference} FOR VALUES FROM (0) TO (100);
        INSERT INTO ${partitionReference} VALUES (10); UPDATE ${child} SET x = 10;`);
      const partitionTargets: PostgresForeignTargets = await engine.handle('postgres.foreignEdit.targets', { ...foreignScope, search: '分区引用' });
      const partitionTarget = partitionTargets.targets[0];
      expect(partitionTarget).toMatchObject({ name: '分区引用', keys: [['id']] });
      const partitionKey: PostgresForeignCreation = { ...latest, name: '分区外键', notValid: false, match: 's',
        reference: { schema: partitionTarget.schema, name: partitionTarget.name, stamp: partitionTarget.stamp },
        pairs: [{ local: 'x', remote: 'id' }] };
      expect((await foreignApply((await foreignPreview([partitionKey])).token)).outcome).toBe('committed');
      const partitioned = await structure(child);
      expect(partitioned.constraints).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '分区外键', inherited: false, validated: true }),
        expect.objectContaining({ kind: 'f', inherited: true }),
      ]));
      await client.query(`UPDATE ${partitionReference} SET id = 11 WHERE id = 10`);
      expect((await client.query(`SELECT x FROM ${child}`)).rows).toEqual([{ x: 11 }]);
      const editPartition = await foreignPreview([{ kind: 'rename', from: '分区外键', name: '已改名分区外键' },
        { kind: 'drop', from: '已改名分区外键' }]);
      expect((await foreignApply(editPartition.token)).outcome).toBe('committed');
      expect((await structure(child)).constraints).toEqual([]);
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
