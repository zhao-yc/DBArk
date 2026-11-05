import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile, QueryOutcome } from '../../src/shared/contracts';
import type { PostgresCompletionInput, PostgresCompletionResult, PostgresRoutineCompletionTarget } from '../../src/shared/postgresCompletion';
import type { PostgresRoutineProperties } from '../../src/shared/postgresRoutine';

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
    const routines = (prefix: string, routine: PostgresRoutineCompletionTarget, sessionId?: string) =>
      read({ ...target, kind: 'routines', prefix, routine, sessionId });
    const signatures = (prefix: string, routine: PostgresRoutineCompletionTarget, sessionId?: string) =>
      read({ ...target, kind: 'signatures', prefix, routine, sessionId });
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
        CREATE FUNCTION "隐藏".tabrelio_hidden() RETURNS integer LANGUAGE sql AS 'SELECT 1';
        REVOKE USAGE ON SCHEMA "隐藏" FROM CURRENT_USER;
        CREATE TABLE public.unique_scope (only_field integer);
        CREATE TABLE public.duplicate_scope (public_field integer);
        CREATE TABLE "补全.乙".duplicate_scope (other_field text);
        CREATE TABLE public.r_literal (round_hint int);
        CREATE TABLE public.rXliteral (id int);
        CREATE FUNCTION public.tabrelio_fold(value integer) RETURNS bigint LANGUAGE sql AS 'SELECT value::bigint';
        CREATE FUNCTION "补全.乙".tabrelio_fold(value integer) RETURNS numeric LANGUAGE sql AS 'SELECT value::numeric';
        CREATE FUNCTION "补全.乙".tabrelio_fold(value text) RETURNS text LANGUAGE sql AS 'SELECT value';
        CREATE FUNCTION "补全.乙".tabrelio_rows(bound integer) RETURNS SETOF integer LANGUAGE sql AS 'SELECT generate_series(1, bound)';
        CREATE PROCEDURE "补全.乙".tabrelio_proc(value integer) LANGUAGE plpgsql AS 'BEGIN NULL; END';
        CREATE FUNCTION "补全.乙"."TabrelioSig"(seed integer, label text DEFAULT 'a,b') RETURNS text LANGUAGE sql AS 'SELECT label';
        CREATE FUNCTION "补全.乙"."TabrelioSig"(seed text, VARIADIC labels text[]) RETURNS text LANGUAGE sql AS 'SELECT seed';
        CREATE FUNCTION "补全.乙".tabreliosig(seed int) RETURNS int LANGUAGE sql AS 'SELECT seed';
        CREATE FUNCTION "补全.乙".tabrelio_out(seed integer, OUT answer bigint) LANGUAGE sql AS 'SELECT seed::bigint';
        CREATE PROCEDURE "补全.乙".tabrelio_modes(IN first integer, OUT second integer, INOUT third bigint)
          LANGUAGE plpgsql AS 'BEGIN second := first; END';
        CREATE TYPE "补全.甲"."带.型" AS ENUM ('x');
        CREATE FUNCTION "补全.甲"."定""义.函数"(param "补全.甲"."带.型") RETURNS text
          LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS 'SELECT param::text';
        COMMENT ON FUNCTION "补全.甲"."定""义.函数"("补全.甲"."带.型") IS '中文定义注释';
        REVOKE EXECUTE ON FUNCTION "补全.乙"."TabrelioSig"(text, text[]) FROM PUBLIC;
        CREATE TABLE public.routine_side_effects (id integer);
        CREATE FUNCTION public.tabrelio_write() RETURNS integer LANGUAGE plpgsql AS
          'BEGIN INSERT INTO public.routine_side_effects VALUES (1); RETURN 1; END';
        REVOKE EXECUTE ON FUNCTION "补全.乙".tabrelio_fold(text) FROM PUBLIC;
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
      expect((await routines('tabrelio_fold', { context: 'expression' })).items).toEqual([
        { kind: 'routine', schema: 'public', name: 'tabrelio_fold', arguments: 'value integer', returns: 'bigint', category: 'f' },
      ]);
      expect((await routines('tabrelio_hidden', { context: 'expression', schema: '隐藏' })).items).toEqual([]);
      expect((await routines('count', { context: 'expression', schema: 'pg_catalog' })).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'count', schema: 'pg_catalog', returns: 'bigint', category: 'a' }),
      ]));
      expect((await routines('row_number', { context: 'expression' })).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'row_number', returns: 'bigint', category: 'w' }),
      ]));
      expect((await routines('tabrelio_proc', { context: 'call', schema: '补全.乙' })).items).toEqual([
        { kind: 'routine', schema: '补全.乙', name: 'tabrelio_proc', arguments: 'IN value integer', returns: null, category: 'p' },
      ]);
      expect((await routines('tabrelio_proc', { context: 'expression', schema: '补全.乙' })).items).toEqual([]);
      expect((await routines('tabrelio_rows', { context: 'from', schema: '补全.乙' })).items).toEqual([
        { kind: 'routine', schema: '补全.乙', name: 'tabrelio_rows', arguments: 'bound integer', returns: 'SETOF integer', category: 'f' },
      ]);
      expect((await routines('tabrelio_write', { context: 'expression' })).items).toHaveLength(1);
      const exact = { context: 'expression', schema: '补全.乙' } as const;
      expect((await signatures('TabrelioSig', exact)).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'TabrelioSig', parameters: [
          { name: 'seed', type: 'integer', mode: 'i', optional: false }, { name: 'label', type: 'text', mode: 'i', optional: true },
        ] }), expect.objectContaining({ name: 'TabrelioSig', parameters: [
          { name: 'seed', type: 'text', mode: 'i', optional: false }, { name: 'labels', type: 'text[]', mode: 'v', optional: false },
        ] }),
      ]));
      expect((await signatures('TabrelioSig', exact)).items).toHaveLength(2);
      expect((await signatures('Tabrelio', exact)).items).toEqual([]);
      expect((await signatures('tabrelio_out', exact)).items).toEqual([expect.objectContaining({ parameters: [
        { name: 'seed', type: 'integer', mode: 'i', optional: false },
      ] })]);
      expect((await signatures('tabrelio_modes', { context: 'call', schema: '补全.乙' })).items).toEqual([expect.objectContaining({ parameters: [
        { name: 'first', type: 'integer', mode: 'i', optional: false }, { name: 'second', type: 'integer', mode: 'o', optional: false },
        { name: 'third', type: 'bigint', mode: 'b', optional: false },
      ] })]);
      expect((await signatures('percentile_cont', { context: 'expression', schema: 'pg_catalog' })).items)
        .toEqual(expect.arrayContaining([expect.objectContaining({ directArguments: 1 })]));
      expect((await signatures('tabrelio_write', { context: 'expression' })).items).toHaveLength(1);
      expect((await client.query('SELECT count(*)::int AS count FROM public.routine_side_effects')).rows).toEqual([{ count: 0 }]);
      await client.query('BEGIN; CREATE TEMP TABLE temp_completion (original int); INSERT INTO temp_completion VALUES (7)');
      expect((await relations('temp_completion')).items).toEqual([]);
      expect((await client.query('SELECT original FROM temp_completion')).rows).toEqual([{ original: 7 }]);
      await client.query('ROLLBACK');

      await engine.handle('connections.open', { id: connectionId, profile });
      const readRoutine = (name: string, kind: 'function' | 'procedure' = 'function', selected = profile) =>
        engine.handle('postgres.routine.read', { connectionId: selected.id, database, profile: selected, name, kind });
      const routineCatalog = (id = connectionId) => engine.handle('metadata.objects', { connectionId: id, database });
      const integerRoutine = '"补全.乙"."tabrelio_fold"(integer)', textRoutine = '"补全.乙"."tabrelio_fold"(text)';
      const modesRoutine = '"补全.乙"."tabrelio_modes"(integer, bigint)';
      const quotedRoutine = '"补全.甲"."定""义.函数"("补全.甲"."带.型")';
      const hiddenRoutine = '"隐藏"."tabrelio_hidden"()';
      const objects = await routineCatalog();
      expect(objects).toEqual(expect.arrayContaining([
        { kind: 'table', name: '"补全.甲"."订""单"' }, { kind: 'function', name: integerRoutine }, { kind: 'function', name: textRoutine },
        { kind: 'function', name: quotedRoutine }, { kind: 'procedure', name: modesRoutine },
      ]));
      expect(objects).not.toContainEqual({ kind: 'function', name: hiddenRoutine });
      expect(objects).not.toContainEqual({ kind: 'function', name: '"pg_catalog"."count"()' });
      expect(await readRoutine(integerRoutine)).toMatchObject({ category: 'f', returns: 'numeric', definition: expect.stringContaining('SELECT value::numeric') });
      expect(await readRoutine(textRoutine)).toMatchObject({ category: 'f', returns: 'text', arguments: 'value text' });
      expect(await readRoutine(modesRoutine, 'procedure')).toMatchObject({ category: 'p', returns: null,
        arguments: 'IN first integer, OUT second integer, INOUT third bigint', definition: expect.stringContaining('CREATE OR REPLACE PROCEDURE') });
      expect(await readRoutine(quotedRoutine)).toMatchObject({ name: quotedRoutine, language: 'sql', owner: database,
        securityDefiner: true, volatility: 's', comment: '中文定义注释', definition: expect.stringContaining('SECURITY DEFINER') });
      await expect(readRoutine(modesRoutine)).rejects.toThrow('不可见');
      await expect(readRoutine(hiddenRoutine)).rejects.toThrow('不可见');
      expect(await readRoutine('"public"."tabrelio_write"()')).toMatchObject({ definition: expect.stringContaining('routine_side_effects') });
      expect((await client.query('SELECT count(*)::int AS count FROM public.routine_side_effects')).rows).toEqual([{ count: 0 }]);

      const routineTarget = { ...target, profile, owner: randomUUID(), connectionRevision: 1, schema: '补全.甲' };
      const createRoutine = (fields: Record<string, unknown>) => engine.handle('postgres.routine.create.preview', { ...routineTarget, ...fields });
      const applyRoutine = (token: string) => engine.handle('postgres.routine.create.apply', { ...target, profile, owner: routineTarget.owner,
        connectionRevision: routineTarget.connectionRevision, token });
      const parameter = { name: '值', mode: 'in', type: 'integer', default: { mode: 'none' } };
      const fixtureFunction = { kind: 'function', name: '图形"例程', language: 'sql', parameters: [parameter], returns: 'integer',
        setReturning: false, volatility: 'volatile', securityDefiner: false, comment: '图形化注释',
        body: 'INSERT INTO public.routine_side_effects VALUES ("值");\nSELECT "值";' };
      await client.query('CREATE TABLE "补全.甲"."图形""例程" (id integer)');
      await expect(createRoutine({ ...fixtureFunction, returns: 'integer); DROP TABLE public.routine_side_effects; --' })).rejects.toThrow('类型名');
      const integerCreate = await createRoutine(fixtureFunction);
      const fixtureIdentity = '"补全.甲"."图形""例程"(integer)';
      expect(integerCreate.statements).toHaveLength(2);
      expect(integerCreate.statements[0]).toContain('CREATE FUNCTION "补全.甲"."图形""例程"(IN "值" integer)');
      expect((await routineCatalog()).some((object: { name: string }) => object.name === fixtureIdentity)).toBe(false);
      expect(await applyRoutine(integerCreate.token)).toMatchObject({ outcome: 'committed', table: fixtureIdentity });
      await expect(applyRoutine(integerCreate.token)).rejects.toThrow('预览已失效');
      await expect(createRoutine(fixtureFunction)).rejects.toThrow('相同输入签名');
      expect(await readRoutine(fixtureIdentity)).toMatchObject({ comment: fixtureFunction.comment, returns: 'integer' });
      expect((await client.query('SELECT count(*)::int AS count FROM public.routine_side_effects')).rows).toEqual([{ count: 0 }]);

      const customCreate = await createRoutine({ ...fixtureFunction, volatility: 'stable', securityDefiner: true, returns: 'text',
        parameters: [{ ...parameter, type: '"补全.甲"."带.型"', default: { mode: 'literal', value: 'x' } }], body: 'SELECT "值"::text' });
      const customIdentity = '"补全.甲"."图形""例程"("补全.甲"."带.型")';
      expect(await applyRoutine(customCreate.token)).toMatchObject({ outcome: 'committed', table: customIdentity });
      expect(await readRoutine(customIdentity)).toMatchObject({ securityDefiner: true, volatility: 's', returns: 'text' });
      expect((await client.query('SELECT "补全.甲"."图形""例程"() AS result')).rows).toEqual([{ result: 'x' }]);

      const procedureCreate = await createRoutine({ kind: 'procedure', name: '图形过程', language: 'plpgsql', securityDefiner: false,
        parameters: [parameter, { ...parameter, mode: 'out', name: '结果' }], comment: '过程注释', body: 'BEGIN "结果" := "值" + 1; END' });
      const procedureIdentity = '"补全.甲"."图形过程"(integer)';
      expect(await applyRoutine(procedureCreate.token)).toMatchObject({ outcome: 'committed', table: procedureIdentity });
      expect(await readRoutine(procedureIdentity, 'procedure')).toMatchObject({ comment: '过程注释', returns: null });
      expect((await client.query('CALL "补全.甲"."图形过程"(41, NULL)')).rows).toEqual([{ 结果: 42 }]);

      const tableFunction = await createRoutine({ ...fixtureFunction, name: '表函数', returns: '', setReturning: true,
        parameters: [parameter, { ...parameter, mode: 'out', name: '编号' }, { ...parameter, mode: 'out', name: '标签', type: 'text' }],
        body: 'SELECT "值", \'文本\'::text' });
      expect(await applyRoutine(tableFunction.token)).toMatchObject({ outcome: 'committed' });
      expect((await client.query('SELECT * FROM "补全.甲"."表函数"(7)')).rows).toEqual([{ 编号: 7, 标签: '文本' }]);
      const variadic = await createRoutine({ ...fixtureFunction, name: '可变函数', parameters: [{ ...parameter, mode: 'variadic', type: 'integer[]' }],
        body: 'SELECT cardinality("值")' });
      expect(await applyRoutine(variadic.token)).toMatchObject({ outcome: 'committed', table: '"补全.甲"."可变函数"(integer[])' });
      expect((await client.query('SELECT "补全.甲"."可变函数"(1, 2, 3) AS result')).rows).toEqual([{ result: 3 }]);

      const rejectedBody = await createRoutine({ ...fixtureFunction, name: '无效正文', body: 'SELECT 不存在的列' });
      expect(await applyRoutine(rejectedBody.token)).toMatchObject({ outcome: 'rolledBack' });
      await expect(readRoutine('"补全.甲"."无效正文"(integer)')).rejects.toThrow('不可见');

      await client.query('CREATE TYPE "补全.甲"."可漂移" AS ENUM (\'a\')');
      const staleType = await createRoutine({ ...fixtureFunction, name: '漂移类型', parameters: [{ ...parameter, type: '"补全.甲"."可漂移"' }], body: 'SELECT 1' });
      await client.query('DROP TYPE "补全.甲"."可漂移"; CREATE TYPE "补全.甲"."可漂移" AS ENUM (\'b\')');
      expect(await applyRoutine(staleType.token)).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('类型已变化') });
      await expect(readRoutine('"补全.甲"."漂移类型"("补全.甲"."可漂移")')).rejects.toThrow('不可见');

      const occupied = await createRoutine({ ...fixtureFunction, name: '抢先签名', body: 'SELECT 1' });
      await client.query('CREATE FUNCTION "补全.甲"."抢先签名"(integer) RETURNS integer LANGUAGE sql AS \'SELECT 2\'');
      expect(await applyRoutine(occupied.token)).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('相同输入签名') });
      expect((await client.query('SELECT "补全.甲"."抢先签名"(0) AS result')).rows).toEqual([{ result: 2 }]);

      const manageRoutine = async (name: string, action: 'rename' | 'drop', newName?: string,
        kind: 'function' | 'procedure' = 'function', selected = profile) => {
        const { stamp } = await readRoutine(name, kind, selected);
        const base = { database, connectionId: selected.id, profile: selected, owner: routineTarget.owner,
          connectionRevision: routineTarget.connectionRevision, name, kind, stamp };
        return engine.handle('postgres.routine.manage.preview', action === 'rename'
          ? { ...base, action, newName: newName! } : { ...base, action });
      };
      const applyManage = (token: string) => engine.handle('postgres.routine.manage.apply', { ...target, profile,
        owner: routineTarget.owner, connectionRevision: routineTarget.connectionRevision, token });
      const editRoutine = async (name: string, body: string, kind: 'function' | 'procedure' = 'function') => {
        const { stamp } = await readRoutine(name, kind);
        return engine.handle('postgres.routine.manage.preview', { ...target, profile, owner: routineTarget.owner,
          connectionRevision: routineTarget.connectionRevision, name, kind, stamp, action: 'edit', body });
      };
      const changeProperties = async (name: string, changes: Partial<PostgresRoutineProperties>, kind: 'function' | 'procedure' = 'function') => {
        const { stamp } = await readRoutine(name, kind);
        return engine.handle('postgres.routine.manage.preview', { ...target, profile, owner: routineTarget.owner,
          connectionRevision: routineTarget.connectionRevision, name, kind, stamp, action: 'properties', changes });
      };
      const routineOid = async (name: string) => (await client.query<{ oid: string | null }>(
        'SELECT pg_catalog.to_regprocedure($1)::oid::text AS oid', [name])).rows[0].oid;
      const renamedIdentity = '"补全.甲"."改""名.函数"(integer)';
      const fixtureOid = await routineOid(fixtureIdentity);
      expect(fixtureOid).toBeTruthy();
      await client.query(`REVOKE EXECUTE ON FUNCTION ${fixtureIdentity} FROM PUBLIC;
        CREATE VIEW "补全.甲"."例程依赖" AS SELECT "补全.甲"."图形""例程"(42) AS value`);
      await expect(manageRoutine(fixtureIdentity, 'rename', '抢先签名')).rejects.toThrow('相同输入签名');
      const rename = await manageRoutine(fixtureIdentity, 'rename', '改"名.函数');
      expect(rename.statements.at(-1)).toBe(`ALTER FUNCTION ${fixtureIdentity} RENAME TO "改""名.函数"`);
      expect(await routineOid(fixtureIdentity)).toBe(fixtureOid);
      expect(await routineOid(renamedIdentity)).toBeNull();
      await expect(applyRoutine(rename.token)).rejects.toThrow('预览已失效');
      expect(await applyManage(rename.token)).toMatchObject({ outcome: 'committed', table: renamedIdentity });
      await expect(applyManage(rename.token)).rejects.toThrow('预览已失效');
      expect(await routineOid(fixtureIdentity)).toBeNull();
      expect(await routineOid(renamedIdentity)).toBe(fixtureOid);
      expect(await readRoutine(renamedIdentity)).toMatchObject({ canManage: true, comment: fixtureFunction.comment,
        definition: expect.stringContaining('INSERT INTO public.routine_side_effects') });
      expect(await readRoutine(customIdentity)).toMatchObject({ securityDefiner: true, volatility: 's' });
      expect((await client.query(`SELECT NOT EXISTS (SELECT FROM pg_catalog.aclexplode(p.proacl) a
        WHERE a.grantee = 0) AS private FROM pg_catalog.pg_proc p WHERE p.oid = $1::oid`, [fixtureOid])).rows)
        .toEqual([{ private: true }]);
      const editedBody = `SELECT "值" + 1;\n-- $function$ ' \\ DROP VIEW "补全.甲"."例程依赖";`;
      expect(await readRoutine(renamedIdentity)).toMatchObject({ editableBody: fixtureFunction.body });
      const edit = await editRoutine(renamedIdentity, editedBody);
      expect(edit.statements.at(-1)).toContain('CREATE OR REPLACE FUNCTION');
      expect(await readRoutine(renamedIdentity)).toMatchObject({ editableBody: fixtureFunction.body });
      expect(await applyManage(edit.token)).toMatchObject({ outcome: 'committed', table: renamedIdentity });
      expect(await routineOid(renamedIdentity)).toBe(fixtureOid);
      expect(await readRoutine(renamedIdentity)).toMatchObject({ editableBody: editedBody, comment: fixtureFunction.comment });
      expect((await client.query('SELECT value FROM "补全.甲"."例程依赖"')).rows).toEqual([{ value: 43 }]);
      const invalidEdit = await editRoutine(renamedIdentity, 'SELECT 不存在的列');
      expect(await applyManage(invalidEdit.token)).toMatchObject({ outcome: 'rolledBack' });
      expect(await readRoutine(renamedIdentity)).toMatchObject({ editableBody: editedBody });
      await client.query(`ALTER FUNCTION ${renamedIdentity} SET search_path TO public SET work_mem TO '8MB'`);
      await expect(changeProperties(renamedIdentity, { rows: '20' })).rejects.toThrow('返回集合');
      await expect(changeProperties(renamedIdentity, { cost: '1e39' })).rejects.toThrow();
      await expect(changeProperties(renamedIdentity, { cost: '1; DROP SCHEMA public' })).rejects.toThrow('正数');
      await expect(changeProperties(renamedIdentity, { volatility: 'v' })).rejects.toThrow('没有变化');
      const properties = await changeProperties(renamedIdentity, { volatility: 's', parallel: 'r', strict: true,
        cost: '0.125', securityDefiner: true, comment: '属性注释：带引号\'和反斜杠\\' });
      expect(properties.statements[1]).toBe(`ALTER FUNCTION ${renamedIdentity} STABLE PARALLEL RESTRICTED STRICT COST 0.125 SECURITY DEFINER SET search_path TO pg_catalog, pg_temp`);
      expect(await readRoutine(renamedIdentity)).toMatchObject({ securityDefiner: false, comment: fixtureFunction.comment });
      expect(await applyManage(properties.token)).toMatchObject({ outcome: 'committed', table: renamedIdentity });
      expect(await routineOid(renamedIdentity)).toBe(fixtureOid);
      expect(await readRoutine(renamedIdentity)).toMatchObject({ volatility: 's', parallel: 'r', strict: true,
        cost: '0.125', securityDefiner: true, editableBody: editedBody, comment: "属性注释：带引号'和反斜杠\\",
        configuration: expect.arrayContaining(['work_mem=8MB', 'search_path=pg_catalog, pg_temp']) });
      expect((await client.query('SELECT value FROM "补全.甲"."例程依赖"')).rows).toEqual([{ value: 43 }]);
      const reset = await changeProperties(renamedIdentity, { securityDefiner: false, comment: null });
      expect(await applyManage(reset.token)).toMatchObject({ outcome: 'committed' });
      expect(await readRoutine(renamedIdentity)).toMatchObject({ securityDefiner: false, comment: null,
        configuration: expect.arrayContaining(['work_mem=8MB', 'search_path=pg_catalog, pg_temp']) });

      const setIdentity = '"补全.甲"."表函数"(integer)';
      const setProperties = await changeProperties(setIdentity, { rows: '2.5e2' });
      expect(await applyManage(setProperties.token)).toMatchObject({ outcome: 'committed', table: setIdentity });
      expect(await readRoutine(setIdentity)).toMatchObject({ rows: '250' });

      const editCustom = await editRoutine(customIdentity, `SELECT "值"::text || '-更新'`);
      expect(await applyManage(editCustom.token)).toMatchObject({ outcome: 'committed', table: customIdentity });
      expect(await readRoutine(customIdentity)).toMatchObject({ securityDefiner: true, volatility: 's' });
      expect((await client.query('SELECT "补全.甲"."图形""例程"() AS result')).rows).toEqual([{ result: 'x-更新' }]);
      const standardIdentity = '"补全.甲"."标准正文"()';
      await client.query(`CREATE FUNCTION ${standardIdentity} RETURNS integer LANGUAGE sql RETURN 42`);
      expect(await readRoutine(standardIdentity)).toMatchObject({ editableBody: null });
      await expect(editRoutine(standardIdentity, 'SELECT 43')).rejects.toThrow('未提供可编辑');
      const standardProperties = await changeProperties(standardIdentity, { comment: '标准正文也可修改属性' });
      expect(await applyManage(standardProperties.token)).toMatchObject({ outcome: 'committed' });
      expect((await client.query('SELECT "补全.甲"."标准正文"() AS result')).rows).toEqual([{ result: 42 }]);

      const restricted = await manageRoutine(renamedIdentity, 'drop');
      expect(restricted.statements.at(-1)).toBe(`DROP FUNCTION ${renamedIdentity} RESTRICT`);
      expect(await applyManage(restricted.token)).toMatchObject({ outcome: 'rolledBack' });
      expect(await routineOid(renamedIdentity)).toBe(fixtureOid);
      await client.query('DROP VIEW "补全.甲"."例程依赖"');
      const staleDrop = await manageRoutine(renamedIdentity, 'drop');
      await client.query(`COMMENT ON FUNCTION ${renamedIdentity} IS '预览后已修改'`);
      expect(await applyManage(staleDrop.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('已变化') });
      const replacedDrop = await manageRoutine(renamedIdentity, 'drop');
      await client.query(`DROP FUNCTION ${renamedIdentity};
        CREATE FUNCTION ${renamedIdentity} RETURNS integer LANGUAGE sql AS 'SELECT 99'`);
      expect(await applyManage(replacedDrop.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('已变化') });
      expect((await client.query('SELECT "补全.甲"."改""名.函数"(0) AS result')).rows).toEqual([{ result: 99 }]);
      const drop = await manageRoutine(renamedIdentity, 'drop');
      expect(await applyManage(drop.token)).toMatchObject({ outcome: 'committed', table: renamedIdentity });
      expect(await routineOid(renamedIdentity)).toBeNull();
      expect(await routineOid(customIdentity)).toBeTruthy();

      const renamedProcedure = '"补全.甲"."改名过程"(integer)';
      const procedureOid = await routineOid(procedureIdentity);
      const staleProcedure = await editRoutine(procedureIdentity, 'BEGIN "结果" := 99; END', 'procedure');
      await client.query(`COMMENT ON PROCEDURE ${procedureIdentity} IS '过程原定义已变化'`);
      expect(await applyManage(staleProcedure.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('已变化') });
      const editProcedure = await editRoutine(procedureIdentity, 'BEGIN "结果" := "值" + 2; END', 'procedure');
      expect(await applyManage(editProcedure.token)).toMatchObject({ outcome: 'committed', table: procedureIdentity });
      await expect(changeProperties(procedureIdentity, { strict: true }, 'procedure')).rejects.toThrow('过程只支持');
      const staleProperties = await changeProperties(procedureIdentity, { comment: '待确认' }, 'procedure');
      await client.query(`COMMENT ON PROCEDURE ${procedureIdentity} IS '属性预览后已变化'`);
      expect(await applyManage(staleProperties.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('已变化') });
      const procedureProperties = await changeProperties(procedureIdentity, { securityDefiner: true, comment: '过程属性' }, 'procedure');
      expect(await applyManage(procedureProperties.token)).toMatchObject({ outcome: 'committed', table: procedureIdentity });
      expect(await readRoutine(procedureIdentity, 'procedure')).toMatchObject({ comment: '过程属性', securityDefiner: true,
        configuration: ['search_path=pg_catalog, pg_temp'] });
      const renameProcedure = await manageRoutine(procedureIdentity, 'rename', '改名过程', 'procedure');
      expect(renameProcedure.statements.at(-1)).toBe(`ALTER PROCEDURE ${procedureIdentity} RENAME TO "改名过程"`);
      expect(await applyManage(renameProcedure.token)).toMatchObject({ outcome: 'committed', table: renamedProcedure });
      expect(await routineOid(renamedProcedure)).toBe(procedureOid);
      expect((await client.query('CALL "补全.甲"."改名过程"(41, NULL)')).rows).toEqual([{ 结果: 43 }]);
      const dropProcedure = await manageRoutine(renamedProcedure, 'drop', undefined, 'procedure');
      expect(dropProcedure.statements.at(-1)).toBe(`DROP PROCEDURE ${renamedProcedure} RESTRICT`);
      expect(await applyManage(dropProcedure.token)).toMatchObject({ outcome: 'committed', table: renamedProcedure });
      expect(await routineOid(renamedProcedure)).toBeNull();
      expect((await client.query('SELECT count(*)::int AS count FROM public.routine_side_effects')).rows).toEqual([{ count: 0 }]);

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
      expect((await routines('tabrelio_fold', { context: 'expression' }, sessionId)).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ schema: '补全.乙', arguments: 'value integer', returns: 'numeric' }),
        expect.objectContaining({ schema: '补全.乙', arguments: 'value text', returns: 'text' }),
      ]));
      expect((await routines('tabrelio_fold', { context: 'expression' }, sessionId)).items).toHaveLength(2);
      expect((await routines('tabrelio_fold', { context: 'expression' }, other)).items).toHaveLength(1);
      expect((await read({ ...target, kind: 'columns', sessionId, prefix: 'rou', relations: [{ schema: 'public', name: 'r_literal' }],
        routine: { context: 'expression' } })).items).toEqual(expect.arrayContaining([
        { kind: 'column', reference: 0, name: 'round_hint', type: 'integer' }, expect.objectContaining({ kind: 'routine', name: 'round' }),
      ]));
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
        expect((await routines('tabrelio_fold', { context: 'expression' }, sessionId)).items).toEqual([
          expect.objectContaining({ schema: '补全.乙', arguments: 'value integer', returns: 'numeric' }),
        ]);
        expect((await signatures('TabrelioSig', { context: 'expression' }, sessionId)).items).toEqual([
          expect.objectContaining({ schema: '补全.乙', parameters: [expect.objectContaining({ name: 'seed', type: 'integer' }),
            expect.objectContaining({ name: 'label', optional: true })] }),
        ]);
        const limitedProfile = { ...profile, id: randomUUID(), user: limited };
        await engine.handle('connections.open', { id: limitedProfile.id, profile: limitedProfile });
        const limitedObjects = await routineCatalog(limitedProfile.id);
        expect(limitedObjects).toContainEqual({ kind: 'function', name: integerRoutine });
        expect(limitedObjects).not.toContainEqual({ kind: 'function', name: textRoutine });
        await expect(readRoutine(textRoutine, 'function', limitedProfile)).rejects.toThrow('不可见');
        expect(await readRoutine(integerRoutine, 'function', limitedProfile)).toMatchObject({ canManage: false });
        await expect(manageRoutine(integerRoutine, 'drop', undefined, 'function', limitedProfile)).rejects.toThrow('没有例程管理权限');
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
      expect(await routines('tabrelio_fold', { context: 'expression' }, sessionId)).toMatchObject({ deferred: 'transaction', items: [] });
      expect(await signatures('tabrelio_fold', { context: 'expression' }, sessionId)).toMatchObject({ deferred: 'transaction', items: [] });
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
