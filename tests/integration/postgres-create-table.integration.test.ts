import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresIndexChange } from '../../src/shared/postgresIndexEdit';
import { postgresStructureResultSchema } from '../../src/shared/postgresStructure';
import type { PostgresCreateTableInput } from '../../src/shared/postgresCreateTable';

const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
const enabled = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';

describe.skipIf(!enabled)('PostgreSQL 实库图形化建表', () => {
  /** 独立客户端复核预览不写库、精确落表、一次性确认及目录竞争保护。 */
  it('验证默认值、复合主键、标识、注释、重名及 schema 替换', async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
        database !== process.env.DBARK_POSTGRES_TEST_USER || !password || !Number.isInteger(port) || port <= 1024) {
      throw Error('只允许本轮专用回环 PostgreSQL 实库');
    }
    const id = randomUUID(), owner = randomUUID();
    const profile: PostgresConnectionProfile = { id, name: '隔离建表', group: '', color: '#123456',
      dialect: 'postgresql', host: '127.0.0.1', port, user: database, password, database, rememberPassword: false };
    const config = { host: profile.host, port, user: database, password, database, ssl: false,
      sslnegotiation: 'postgres' as const, options: ' ', replication: 'false' };
    const client = Object.assign(new Client(config), { binary: false });
    const engine = new Engine(), target = { connectionId: id, database, owner, profile, connectionRevision: 1 };
    const value = "中文\\'; DROP TABLE 原表; --";
    const draft: PostgresCreateTableInput = {
      connectionId: id, database, schema: '生成.甲', table: '新"表', comment: '表原注释',
      columns: [
        { name: '编号', type: 'bigint', nullable: false, primary: true, unique: false, identity: 'always', default: { mode: 'none' }, comment: '' },
        { name: '代码', type: 'varchar', length: 50, nullable: false, primary: true, unique: true, identity: 'none', default: { mode: 'literal', value }, comment: '列原注释' },
        { name: '金额', type: 'numeric', precision: 40, scale: 18, nullable: false, primary: false, unique: false,
          identity: 'none', default: { mode: 'literal', value: '1234567890123456789012.123456789012345678' }, comment: '' },
        { name: '日期', type: 'date', nullable: false, primary: false, unique: false, identity: 'none', default: { mode: 'currentDate' }, comment: '' },
      ],
    };
    const prepare = (patch: Partial<PostgresCreateTableInput> = {}) => engine.handle('postgres.createTable.preview', { ...target, ...draft, ...patch });
    const apply = (token: string, extra = {}) => engine.handle('postgres.createTable.apply', { ...target, token, ...extra });
    const qualified = '"生成.甲"."新""表"';
    await client.connect();
    try {
      await client.query('CREATE SCHEMA "生成.甲"; CREATE SCHEMA "另一个"; CREATE TABLE "生成.甲".原表 (id int)');
      const schemas = await engine.handle('postgres.createTable.schemas', target);
      expect(schemas).toContain(draft.schema);
      expect(schemas).not.toContain('pg_catalog');
      await expect(prepare({ schema: '不存在' })).rejects.toThrow('缺少建表权限');
      await expect(prepare({ columns: [{ ...draft.columns[1], length: 1 }] })).rejects.toThrow('默认值与字段类型或长度不符');
      await expect(prepare({ columns: [{ ...draft.columns[2], default: { mode: 'literal', value: '非法' } }] })).rejects.toThrow();

      const preview = await prepare();
      expect(preview.statements).toHaveLength(3);
      expect((await client.query('SELECT to_regclass($1)::text value', [qualified])).rows[0].value).toBeNull();
      await expect(apply(preview.token, { owner: randomUUID() })).rejects.toThrow('预览已失效');
      await expect(apply(preview.token, { connectionRevision: 2 })).rejects.toThrow('预览已失效');
      expect(await apply(preview.token)).toMatchObject({ outcome: 'committed', table: qualified });
      await expect(apply(preview.token)).rejects.toThrow('预览已失效');

      const structure = await engine.handle('postgres.structure.read', { ...target, table: qualified });
      expect(structure.comment).toBe(draft.comment);
      expect(structure.columns[0]).toMatchObject({ name: '编号', identity: 'a', nullable: false });
      expect(structure.columns[1]).toMatchObject({ name: '代码', type: 'character varying(50)', comment: '列原注释' });
      expect(structure.constraints).toContainEqual(expect.objectContaining({ kind: 'p', definition: expect.stringContaining('编号') }));
      expect((await client.query(`INSERT INTO ${qualified} DEFAULT VALUES
        RETURNING "编号"::text AS id, "代码" AS note, "金额"::text AS amount, "日期" = CURRENT_DATE AS today`)).rows)
        .toEqual([{ id: '1', note: value, amount: '1234567890123456789012.123456789012345678', today: true }]);
      expect((await client.query('SELECT count(*)::int n FROM "生成.甲".原表')).rows[0].n).toBe(0);
      await expect(prepare()).rejects.toThrow('同名关系');

      const race = await prepare({ table: '竞争' });
      await client.query('CREATE TABLE "生成.甲"."竞争" (marker text)');
      expect(await apply(race.token)).toMatchObject({ outcome: 'notSent' });
      expect((await client.query('SELECT marker FROM "生成.甲"."竞争"')).rows).toEqual([]);

      const replaced = await prepare({ schema: '另一个', table: '原目标' });
      await client.query('DROP SCHEMA "另一个"; CREATE SCHEMA "另一个"');
      expect(await apply(replaced.token)).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('已被替换') });
      const rejected = await prepare({ table: '回滚', columns: [{ ...draft.columns[0], name: 'ctid' }] });
      expect(await apply(rejected.token)).toMatchObject({ outcome: 'rolledBack' });
      expect((await client.query('SELECT to_regclass($1)::text value', ['"生成.甲"."回滚"'])).rows[0].value).toBeNull();

      // 同一创建服务的视图令牌隔离，服务器确认后再从独立会话回读数据及目录。
      const viewName = '"生成.甲"."新""视图"';
      const viewInput = { ...target, schema: draft.schema, view: '新"视图', comment: value,
        definition: `WITH x AS (SELECT "编号", "代码" FROM ${qualified}) SELECT * FROM x -- 末尾注释` };
      const previewView = () => engine.handle('postgres.createView.preview', viewInput);
      const applyView = (token: string) => engine.handle('postgres.createView.apply', { ...target, token });
      await expect(engine.handle('postgres.createView.preview', { ...viewInput,
        definition: 'SELECT 1; DROP TABLE "生成.甲".原表' })).rejects.toThrow('单条');
      const view = await previewView();
      expect(view.statements[0]).toContain('CREATE VIEW ' + viewName);
      expect((await client.query('SELECT to_regclass($1)::text AS name', [viewName])).rows[0].name).toBeNull();
      await expect(apply(view.token)).rejects.toThrow('预览已失效');
      expect(await applyView(view.token)).toMatchObject({ outcome: 'committed', table: viewName });
      await expect(applyView(view.token)).rejects.toThrow('预览已失效');
      expect((await client.query(`SELECT "编号"::text AS id, "代码" AS note FROM ${viewName}`)).rows).toEqual([{ id: '1', note: value }]);
      expect((await client.query('SELECT pg_catalog.obj_description($1::regclass) AS comment', [viewName])).rows[0].comment).toBe(value);
      await expect(previewView()).rejects.toThrow('同名关系');
      const badView = await engine.handle('postgres.createView.preview', { ...viewInput, view: '无效定义', definition: 'SELECT missing FROM pg_catalog.pg_class' });
      expect(await applyView(badView.token)).toMatchObject({ outcome: 'rolledBack' });
      expect((await client.query('SELECT to_regclass($1)::text AS name', ['"生成.甲"."无效定义"'])).rows[0].name).toBeNull();

      // 更新定义必须保留同一关系、依赖、授权、注释和安全选项。
      const viewOptions = '(security_barrier = true, security_invoker = true, check_option = local)';
      const dependent = '"生成.甲"."视图依赖"';
      await client.query(`CREATE OR REPLACE VIEW ${viewName} WITH ${viewOptions} AS
        SELECT "编号", "代码" FROM ${qualified} WHERE "编号" > 0;
        GRANT SELECT ON ${viewName} TO PUBLIC;
        CREATE VIEW ${dependent} AS SELECT * FROM ${viewName}`);
      const viewCatalog = async () => (await client.query(`SELECT c.oid::text, c.relowner::text,
        c.relacl::text, c.reloptions, pg_catalog.obj_description(c.oid) AS comment
        FROM pg_catalog.pg_class c WHERE c.oid = $1::regclass`, [viewName])).rows[0];
      const viewOriginal = await viewCatalog();
      const readView = async () => postgresStructureResultSchema.parse(await engine.handle('postgres.structure.read', { ...target, table: viewName }));
      const newQuery = `SELECT "编号", "代码", 42 AS "附加" FROM ${qualified}`;
      const previewEdit = async (definition = newQuery) => engine.handle('postgres.editView.preview', {
        ...target, table: viewName, stamp: (await readView()).viewEditStamp, definition,
      });
      const applyEdit = (token: string) => engine.handle('postgres.editView.apply', { ...target, token });
      const edit = await previewEdit();
      expect(edit.statements[0]).toContain('ALTER VIEW ' + viewName);
      expect(edit.statements[1]).toContain('CREATE OR REPLACE VIEW ' + viewName);
      expect(edit.statements[1]).toContain('"security_invoker"');
      expect(edit.statements[1]).toContain('"check_option"');
      expect((await readView()).columns.map(column => column.name)).toEqual(['编号', '代码']);
      await expect(applyView(edit.token)).rejects.toThrow('预览已失效');
      await client.query('BEGIN; LOCK TABLE ' + qualified + ' IN ROW EXCLUSIVE MODE');
      try {
        expect(await applyEdit(edit.token)).toMatchObject({ outcome: 'committed', table: viewName });
      } finally { await client.query('ROLLBACK'); }
      await expect(applyEdit(edit.token)).rejects.toThrow('预览已失效');
      expect(await viewCatalog()).toEqual(viewOriginal);
      expect((await client.query(`SELECT "附加" AS value FROM ${viewName}`)).rows).toEqual([{ value: 42 }]);
      expect((await client.query(`SELECT "代码" AS note FROM ${dependent}`)).rows).toEqual([{ note: value }]);
      const incompatible = await previewEdit(`SELECT "编号", "代码" FROM ${qualified}`);
      expect(await applyEdit(incompatible.token)).toMatchObject({ outcome: 'rolledBack' });

      // 另一会话已持有原视图的排他锁，等本次申请锁后提交，验证锁后仍会重读。
      const racing = await previewEdit(newQuery.replace('42', '43'));
      await client.query('BEGIN');
      let pending: ReturnType<typeof applyEdit> | undefined;
      try {
        await client.query(`CREATE OR REPLACE VIEW ${viewName} WITH ${viewOptions} AS ${newQuery.replace('42', '41')}`);
        pending = applyEdit(racing.token);
        await expect.poll(async () => (await client.query(`SELECT EXISTS (
          SELECT FROM pg_catalog.pg_locks WHERE relation = $1::oid
            AND mode = 'AccessExclusiveLock' AND NOT granted AND pid <> pg_catalog.pg_backend_pid()
        ) AS waiting`, [viewOriginal.oid])).rows[0].waiting, { timeout: 3500 }).toBe(true);
        await client.query('COMMIT');
        expect(await pending).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原视图已变化') });
      } finally {
        await client.query('ROLLBACK');
        await pending;
      }
      expect((await client.query(`SELECT "附加" AS value FROM ${viewName}`)).rows).toEqual([{ value: 41 }]);
      expect(await viewCatalog()).toEqual(viewOriginal);

      // 受限删除必须保留依赖，重命名须在同一 OID 上完成并验证真实属性。
      const renamed = '"生成.甲"."改"".视图"';
      const manageView = async (table: string, change: { action: 'drop' } | { action: 'rename'; name: string }) => {
        const structure = await engine.handle('postgres.structure.read', { ...target, table });
        return engine.handle('postgres.viewManage.preview', { ...target, table, stamp: structure.viewEditStamp, ...change });
      };
      const applyManage = (token: string) => engine.handle('postgres.viewManage.apply', { ...target, token });
      const blockedDrop = await manageView(viewName, { action: 'drop' });
      expect(blockedDrop.statements.at(-1)).toBe('DROP VIEW ' + viewName + ' RESTRICT');
      expect(await applyManage(blockedDrop.token)).toMatchObject({ outcome: 'rolledBack' });
      expect(await viewCatalog()).toEqual(viewOriginal);
      await expect(manageView(viewName, { action: 'rename', name: '原表' })).rejects.toThrow('同名关系');
      const rename = await manageView(viewName, { action: 'rename', name: '改".视图' });
      expect(rename.statements.at(-1)).toBe('ALTER VIEW ' + viewName + ' RENAME TO "改"".视图"');
      expect((await client.query('SELECT to_regclass($1)::text AS name', [renamed])).rows[0].name).toBeNull();
      await expect(applyEdit(rename.token)).rejects.toThrow('预览已失效');
      expect(await applyManage(rename.token)).toMatchObject({ outcome: 'committed', table: renamed });
      await expect(applyManage(rename.token)).rejects.toThrow('预览已失效');
      expect((await client.query(`SELECT to_regclass($1)::text AS old, c.oid::text, c.relowner::text,
        c.relacl::text, c.reloptions, pg_catalog.obj_description(c.oid) AS comment
        FROM pg_catalog.pg_class c WHERE c.oid = $2::regclass`, [viewName, renamed])).rows).toEqual([{ old: null, ...viewOriginal }]);
      expect((await client.query(`SELECT "代码" AS note FROM ${dependent}`)).rows).toEqual([{ note: value }]);

      await client.query('DROP VIEW ' + dependent);
      const staleDrop = await manageView(renamed, { action: 'drop' });
      await client.query(`COMMENT ON VIEW ${renamed} IS '另一会话的注释'`);
      expect(await applyManage(staleDrop.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原视图已变化') });
      expect((await client.query(`SELECT "附加" AS value FROM ${renamed}`)).rows).toEqual([{ value: 41 }]);
      const drop = await manageView(renamed, { action: 'drop' });
      expect(await applyManage(drop.token)).toMatchObject({ outcome: 'committed', table: renamed });
      expect((await client.query('SELECT to_regclass($1)::text AS name', [renamed])).rows[0].name).toBeNull();
      expect((await client.query(`SELECT "代码" AS note FROM ${qualified}`)).rows).toEqual([{ note: value }]);

      // 三种物化刷新都通过实际目录和独立查询核对，保留原 OID 和授权。
      const snapshot = '"生成.甲"."缓存""视图"';
      const snapshotQuery = `SELECT "编号", "代码" FROM ${qualified}`;
      const snapshotDraft = { ...target, schema: draft.schema, view: '缓存"视图', comment: '物化快照注释',
        definition: snapshotQuery + ' -- 行尾注释', materialized: { populate: false } };
      const snapshotPreview = await engine.handle('postgres.createView.preview', snapshotDraft);
      expect(snapshotPreview.statements[0]).toContain('CREATE MATERIALIZED VIEW ' + snapshot);
      expect(snapshotPreview.statements[0]).toMatch(/-- 行尾注释\nWITH NO DATA$/);
      expect(snapshotPreview.statements[1]).toContain('COMMENT ON MATERIALIZED VIEW ' + snapshot);
      expect((await client.query('SELECT to_regclass($1)::text AS name', [snapshot])).rows[0].name).toBeNull();
      expect(await applyView(snapshotPreview.token)).toMatchObject({ outcome: 'committed', table: snapshot });
      await expect(applyView(snapshotPreview.token)).rejects.toThrow('预览已失效');
      await expect(engine.handle('postgres.createView.preview', snapshotDraft)).rejects.toThrow('同名关系');
      expect((await client.query('SELECT pg_catalog.obj_description($1::regclass) AS comment', [snapshot])).rows[0].comment).toBe('物化快照注释');

      // 创建时填充只在明确确认后执行定义，错误时不留下目录项。
      const populatedDraft = { ...snapshotDraft, view: '创建时填充', comment: '', materialized: { populate: true },
        definition: `SELECT pg_catalog.nextval('"生成.甲".创建填充序列') AS id` };
      await client.query('CREATE SEQUENCE "生成.甲".创建填充序列');
      const filledPreview = await engine.handle('postgres.createView.preview', populatedDraft);
      expect(filledPreview.statements[0]).toMatch(/WITH DATA$/);
      expect((await client.query('SELECT is_called FROM "生成.甲".创建填充序列')).rows).toEqual([{ is_called: false }]);
      expect(await applyView(filledPreview.token)).toMatchObject({ outcome: 'committed', table: '"生成.甲"."创建时填充"' });
      expect((await client.query('SELECT id::text FROM "生成.甲"."创建时填充"')).rows).toEqual([{ id: '1' }]);
      expect((await client.query('SELECT last_value::text, is_called FROM "生成.甲".创建填充序列')).rows)
        .toEqual([{ last_value: '1', is_called: true }]);
      const badSnapshot = await engine.handle('postgres.createView.preview',
        { ...populatedDraft, view: '创建失败', definition: 'SELECT 1 / 0 AS id' });
      expect(await applyView(badSnapshot.token)).toMatchObject({ outcome: 'rolledBack' });
      expect((await client.query('SELECT to_regclass($1)::text AS name', ['"生成.甲"."创建失败"'])).rows[0].name).toBeNull();

      await client.query(`CREATE UNIQUE INDEX 缓存表达式 ON ${snapshot} (("编号" + 1));
        CREATE UNIQUE INDEX 缓存局部 ON ${snapshot} ("编号") WHERE "编号" > 0`);
      const readSnapshot = async () => postgresStructureResultSchema.parse(await engine.handle('postgres.structure.read', { ...target, table: snapshot }));
      const refresh = async (mode: 'data' | 'concurrent' | 'empty') => engine.handle('postgres.materializedRefresh.preview',
        { ...target, table: snapshot, mode, stamp: (await readSnapshot()).materialized?.stamp });
      const applyRefresh = (token: string) => engine.handle('postgres.materializedRefresh.apply', { ...target, token });
      const state = async () => (await client.query(
        'SELECT oid::text, relispopulated FROM pg_catalog.pg_class WHERE oid = $1::regclass', [snapshot])).rows[0];
      const unpopulated = await state();
      expect(unpopulated.relispopulated).toBe(false);
      expect((await readSnapshot()).materialized).toMatchObject({ populated: false, uniqueIndex: false, stamp: expect.any(String) });
      await expect(refresh('concurrent')).rejects.toThrow('并发刷新要求');
      const populate = await refresh('data');
      expect(populate.statements.at(-1)).toBe('REFRESH MATERIALIZED VIEW ' + snapshot + ' WITH DATA');
      expect(await state()).toEqual(unpopulated);
      await expect(applyManage(populate.token)).rejects.toThrow('预览已失效');
      expect(await applyRefresh(populate.token)).toMatchObject({ outcome: 'committed' });
      await expect(applyRefresh(populate.token)).rejects.toThrow('预览已失效');
      expect(await state()).toEqual({ ...unpopulated, relispopulated: true });
      await expect(refresh('concurrent')).rejects.toThrow('并发刷新要求');

      // 另一个读事务阻塞普通刷新，独立目录确认应用在申请排他锁前已持有目标的共享锁。
      const lockProof = await refresh('data');
      await client.query('BEGIN');
      let locking: ReturnType<typeof applyRefresh> | undefined;
      try {
        await client.query(`SELECT "编号" FROM ${snapshot} LIMIT 1`);
        locking = applyRefresh(lockProof.token);
        await expect.poll(async () => (await client.query(`SELECT EXISTS (
          SELECT FROM pg_catalog.pg_locks held JOIN pg_catalog.pg_locks waiting
            ON waiting.pid = held.pid AND waiting.relation = held.relation
          WHERE held.relation = $1::oid AND held.mode = 'AccessShareLock' AND held.granted
            AND waiting.mode = 'AccessExclusiveLock' AND NOT waiting.granted
        ) AS guarded`, [unpopulated.oid])).rows[0].guarded, { timeout: 3500 }).toBe(true);
        await client.query('COMMIT');
        expect(await locking).toMatchObject({ outcome: 'committed' });
      } finally {
        await client.query('ROLLBACK');
        await locking;
      }

      // 物化视图沿独立索引能力，创建、改名、删除与并发刷新资格必须一致。
      const indexPreview = async (changes: PostgresIndexChange[], table = snapshot) => {
        const original = await engine.handle('postgres.structure.read', { ...target, table });
        expect(original.editStamp).toBeUndefined();
        return engine.handle('postgres.indexEdit.preview', { ...target, table, changes, editStamp: original.indexEditStamp });
      };
      const indexApply = (token: string, table = snapshot) => engine.handle('postgres.indexEdit.apply', { ...target, table, token });
      const uniqueKey: PostgresIndexChange = { kind: 'create', name: '缓存唯一', method: 'btree', unique: true,
        keys: [{ column: '编号', direction: 'asc', nulls: 'default' }], include: [] };
      const createKey = await indexPreview([uniqueKey]);
      expect(createKey.statements[0]).toBe('ALTER MATERIALIZED VIEW ' + snapshot + ' SET SCHEMA "生成.甲"');
      expect(createKey.statements[1]).toContain('CREATE UNIQUE INDEX "缓存唯一"');
      expect((await readSnapshot()).materialized?.uniqueIndex).toBe(false);
      expect(await indexApply(createKey.token)).toMatchObject({ outcome: 'committed' });
      expect(await indexApply(createKey.token)).toMatchObject({ outcome: 'notSent' });
      expect((await readSnapshot()).materialized?.uniqueIndex).toBe(true);
      const indexOid = async (name: string) => (await client.query('SELECT to_regclass($1)::oid::text AS oid', [name])).rows[0].oid;
      const createdOid = await indexOid('"生成.甲"."缓存唯一"');
      expect(createdOid).toEqual(expect.any(String));
      const staleIndex = await indexPreview([{ kind: 'rename', from: '缓存唯一', name: '已过期名称' }]);
      await client.query('ALTER INDEX "生成.甲"."缓存唯一" RENAME TO "外部改名"');
      expect(await indexApply(staleIndex.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('索引结构已变化') });
      const renameIndex = await indexPreview([{ kind: 'rename', from: '外部改名', name: '窗口可刷新唯一' }]);
      expect(await indexApply(renameIndex.token)).toMatchObject({ outcome: 'committed' });
      expect(await indexOid('"生成.甲"."窗口可刷新唯一"')).toBe(createdOid);

      const duplicate = '"生成.甲"."重复物化"';
      await client.query(`CREATE MATERIALIZED VIEW ${duplicate} AS SELECT * FROM (VALUES (1), (1)) AS v("编号")`);
      const rejectedBatch = await indexPreview([{ ...uniqueKey, name: '先创建', unique: false }, { ...uniqueKey, name: '后冲突' }], duplicate);
      expect(await indexApply(rejectedBatch.token, duplicate)).toMatchObject({ outcome: 'rolledBack' });
      expect(await indexOid('"生成.甲"."先创建"')).toBeNull();
      expect(await indexOid('"生成.甲"."后冲突"')).toBeNull();

      await client.query(`UPDATE ${qualified} SET "代码" = '刷新后的值'`);
      const concurrent = await refresh('concurrent');
      expect(concurrent.statements.at(-1)).toBe('REFRESH MATERIALIZED VIEW CONCURRENTLY ' + snapshot + ' WITH DATA');
      await client.query('BEGIN');
      try {
        expect((await client.query(`SELECT "代码" AS note FROM ${snapshot}`)).rows).toEqual([{ note: value }]);
        // 原读会话保持共享锁，应用若误取排他锁就无法提交。
        expect(await applyRefresh(concurrent.token)).toMatchObject({ outcome: 'committed' });
        expect((await client.query(`SELECT "代码" AS note FROM ${snapshot}`)).rows).toEqual([{ note: '刷新后的值' }]);
      } finally { await client.query('ROLLBACK'); }

      const maintainer = process.env.DBARK_POSTGRES_MAINTAIN_TEST_USER;
      if (maintainer && maintainer === database + '_limited') {
        await client.query(`GRANT USAGE ON SCHEMA "生成.甲" TO ${maintainer};
          GRANT MAINTAIN ON ${snapshot} TO ${maintainer}`);
        expect((await client.query("SELECT pg_catalog.has_table_privilege($1, $2, 'SELECT') AS can_read",
          [maintainer, snapshot])).rows[0].can_read).toBe(false);
        const delegateId = randomUUID();
        const delegated = { ...target, connectionId: delegateId, profile: { ...profile, id: delegateId, user: maintainer }, table: snapshot };
        const delegateState = await engine.handle('postgres.structure.read', delegated);
        expect(delegateState.materialized?.stamp).toEqual(expect.any(String));
        expect(delegateState.indexEditStamp).toBeUndefined();
        expect(delegateState.materializedManageStamp).toBeUndefined();
        await expect(engine.handle('postgres.indexEdit.preview', {
          ...delegated, editStamp: (await readSnapshot()).indexEditStamp, changes: [uniqueKey],
        })).rejects.toThrow('原结构已变化');
        const delegatedPreview = await engine.handle('postgres.materializedRefresh.preview',
          { ...delegated, stamp: delegateState.materialized.stamp, mode: 'data' });
        expect(await engine.handle('postgres.materializedRefresh.apply', { ...delegated, token: delegatedPreview.token }))
          .toMatchObject({ outcome: 'committed' });
        await client.query(`REVOKE MAINTAIN ON ${snapshot} FROM ${maintainer}`);
        await expect(engine.handle('postgres.structure.read', delegated)).rejects.toThrow('没有读取结构的权限');
      }

      // 改名保留物化视图、已填充数据及索引；依赖阻止删除。
      const manageSnapshot = async (table: string, change: { action: 'drop' } | { action: 'rename'; name: string }) => {
        const structure = postgresStructureResultSchema.parse(await engine.handle('postgres.structure.read', { ...target, table }));
        return engine.handle('postgres.viewManage.preview', { ...target, table, stamp: structure.materializedManageStamp,
          relationKind: 'materialized', ...change });
      };
      const snapshotDependent = '"生成.甲"."物化依赖"';
      await client.query(`CREATE VIEW ${snapshotDependent} AS SELECT * FROM ${snapshot}`);
      const blockedSnapshot = await manageSnapshot(snapshot, { action: 'drop' });
      expect(blockedSnapshot.statements.at(-1)).toBe('DROP MATERIALIZED VIEW ' + snapshot + ' RESTRICT');
      expect(await applyManage(blockedSnapshot.token)).toMatchObject({ outcome: 'rolledBack' });
      expect(await state()).toEqual({ ...unpopulated, relispopulated: true });
      const beforeRenameSnapshot = await readSnapshot();
      expect(beforeRenameSnapshot.viewEditStamp).toBeUndefined();
      await expect(engine.handle('postgres.viewManage.preview', { ...target, table: snapshot,
        stamp: beforeRenameSnapshot.materializedManageStamp, action: 'drop' })).rejects.toThrow('视图不存在');
      await expect(manageSnapshot(snapshot, { action: 'rename', name: '原表' })).rejects.toThrow('同名关系');
      const renamedSnapshot = '"生成.甲"."快照""归档"';
      const snapshotRename = await manageSnapshot(snapshot, { action: 'rename', name: '快照"归档' });
      expect(snapshotRename.statements.at(-1)).toContain('RENAME TO "快照""归档"');
      expect(await indexOid(renamedSnapshot)).toBeNull();
      expect(await applyManage(snapshotRename.token)).toMatchObject({ outcome: 'committed', table: renamedSnapshot });
      await expect(applyManage(snapshotRename.token)).rejects.toThrow('预览已失效');
      expect(await indexOid(snapshot)).toBeNull();
      expect(await indexOid(renamedSnapshot)).toBe(unpopulated.oid);
      expect(await indexOid('"生成.甲"."窗口可刷新唯一"')).toBe(createdOid);
      expect((await client.query(`SELECT "代码" AS note FROM ${snapshotDependent}`)).rows).toEqual([{ note: '刷新后的值' }]);
      const returned = await manageSnapshot(renamedSnapshot, { action: 'rename', name: '缓存"视图' });
      expect(await applyManage(returned.token)).toMatchObject({ outcome: 'committed', table: snapshot });
      await client.query('DROP VIEW ' + snapshotDependent);
      const dropIndex = await indexPreview([{ kind: 'drop', from: '窗口可刷新唯一' }]);
      expect(dropIndex.statements.at(-1)).toBe('DROP INDEX "生成.甲"."窗口可刷新唯一" RESTRICT');
      expect(await indexApply(dropIndex.token)).toMatchObject({ outcome: 'committed' });
      expect(await indexOid('"生成.甲"."窗口可刷新唯一"')).toBeNull();
      expect((await readSnapshot()).materialized?.uniqueIndex).toBe(false);
      await expect(refresh('concurrent')).rejects.toThrow('并发刷新要求');
      const clear = await refresh('empty');
      expect(clear.statements.at(-1)).toBe('REFRESH MATERIALIZED VIEW ' + snapshot + ' WITH NO DATA');
      expect(await applyRefresh(clear.token)).toMatchObject({ outcome: 'committed' });
      expect(await state()).toEqual(unpopulated);
      await expect(client.query(`SELECT * FROM ${snapshot}`)).rejects.toMatchObject({ code: '55000' });
      const staleRefresh = await refresh('data');
      const staleSnapshotDrop = await manageSnapshot(snapshot, { action: 'drop' });
      await client.query(`ALTER MATERIALIZED VIEW ${snapshot} RENAME TO 缓存旧名;
        CREATE SEQUENCE "生成.甲".刷新副作用;
        CREATE MATERIALIZED VIEW ${snapshot} AS SELECT pg_catalog.nextval('"生成.甲".刷新副作用') AS id WITH NO DATA`);
      expect(await applyRefresh(staleRefresh.token)).toMatchObject({ outcome: 'notSent' });
      expect((await client.query('SELECT is_called FROM "生成.甲".刷新副作用')).rows).toEqual([{ is_called: false }]);
      expect(await applyManage(staleSnapshotDrop.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原视图已变化') });
      const oldSnapshot = '"生成.甲"."缓存旧名"';
      const dropSnapshot = await manageSnapshot(oldSnapshot, { action: 'drop' });
      expect(await applyManage(dropSnapshot.token)).toMatchObject({ outcome: 'committed', table: oldSnapshot });
      expect(await indexOid(oldSnapshot)).toBeNull();
      expect(await indexOid('"生成.甲"."缓存表达式"')).toBeNull();
      expect(await indexOid(snapshot)).toEqual(expect.any(String));

      // 序列浏览和新建使用 64 位原值，读取及预览都不会消耗计数。
      const sequenceName = '"生成.甲"."独立""序列"';
      const sequenceDraft = { ...target, schema: draft.schema, name: '独立"序列', dataType: 'bigint',
        start: '9223372036854775806', minimum: '', maximum: '', increment: '', cache: '', cycle: true, comment: value };
      const readSequence = (table = sequenceName) => engine.handle('postgres.sequence.read', { ...target, table });
      const applySequence = (token: string) => engine.handle('postgres.sequence.apply', { ...target, token });
      const applySequenceManage = (token: string) => engine.handle('postgres.sequence.manage.apply', { ...target, token });
      const manageSequence = async (table: string, operation: Record<string, unknown>) => engine.handle('postgres.sequence.manage.preview',
        { ...target, table, stamp: (await readSequence(table)).stamp, ...operation });
      await expect(engine.handle('postgres.sequence.preview', { ...sequenceDraft, increment: '0' })).rejects.toThrow('非零');
      await expect(engine.handle('postgres.sequence.preview', { ...sequenceDraft, maximum: '9223372036854775808' })).rejects.toThrow('上下限');
      const newSequence = await engine.handle('postgres.sequence.preview', sequenceDraft);
      expect(newSequence.statements[0]).toContain('MAXVALUE 9223372036854775807 START WITH 9223372036854775806');
      expect(await indexOid(sequenceName)).toBeNull();
      await expect(applyView(newSequence.token)).rejects.toThrow('预览已失效');
      expect(await applySequence(newSequence.token)).toMatchObject({ outcome: 'committed', table: sequenceName });
      await expect(applySequence(newSequence.token)).rejects.toThrow('预览已失效');
      expect(await readSequence()).toMatchObject({ start: sequenceDraft.start, maximum: '9223372036854775807', lastValue: null, comment: value });
      expect((await client.query(`SELECT is_called FROM ${sequenceName}`)).rows).toEqual([{ is_called: false }]);
      expect((await client.query('SELECT nextval($1::regclass)::text AS value', [sequenceName])).rows).toEqual([{ value: sequenceDraft.start }]);
      expect((await readSequence()).lastValue).toBe(sequenceDraft.start);
      await engine.handle('connections.open', { id, profile });
      expect(await engine.handle('metadata.objects', { connectionId: id, database })).toContainEqual({ name: sequenceName, kind: 'sequence' });
      if (maintainer && maintainer === database + '_limited') {
        const delegateId = randomUUID();
        const delegated = { ...target, connectionId: delegateId, profile: { ...profile, id: delegateId, user: maintainer }, table: sequenceName };
        await engine.handle('connections.open', { id: delegateId, profile: delegated.profile });
        const list = () => engine.handle('metadata.objects', { connectionId: delegateId, database });
        await expect(engine.handle('postgres.sequence.read', delegated)).rejects.toThrow('不可见');
        expect(await list()).not.toContainEqual({ name: sequenceName, kind: 'sequence' });
        await client.query(`GRANT UPDATE ON SEQUENCE ${sequenceName} TO ${maintainer}`);
        expect(await engine.handle('postgres.sequence.read', delegated)).toMatchObject({ lastValue: null });
        expect(await list()).toContainEqual({ name: sequenceName, kind: 'sequence' });
        await client.query(`GRANT USAGE ON SEQUENCE ${sequenceName} TO ${maintainer}`);
        const visible = await engine.handle('postgres.sequence.read', delegated);
        expect(visible).toMatchObject({ lastValue: sequenceDraft.start, canManage: false });
        await expect(engine.handle('postgres.sequence.manage.preview', { ...delegated, action: 'drop', stamp: visible.stamp }))
          .rejects.toThrow('没有序列管理权限');
      }
      const identitySequence = (await client.query("SELECT pg_get_serial_sequence($1, '编号') AS name", [qualified])).rows[0].name;
      const identityTarget = (await client.query(`SELECT pg_catalog.format('"%s"."%s"', replace(n.nspname::text,'"','""'),
        replace(c.relname::text,'"','""')) AS name FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::regclass`, [identitySequence])).rows[0].name;
      const identityInfo = await readSequence(identityTarget);
      const identityOwner = { schema: draft.schema, relation: draft.table, column: '编号', identity: true };
      expect(identityInfo.ownedBy).toEqual(identityOwner);
      await expect(manageSequence(identityTarget, { action: 'drop' })).rejects.toThrow('标识列序列');
      const { dataType, start, increment, minimum, maximum, cycle } = identityInfo;
      const identityEdit = await manageSequence(identityTarget, { action: 'edit', dataType, start, increment, minimum, maximum, cycle,
        cache: '2', restart: '' });
      expect(await applySequenceManage(identityEdit.token)).toMatchObject({ outcome: 'committed' });
      expect(await readSequence(identityTarget)).toMatchObject({ cache: '2', ownedBy: identityOwner });

      const sequenceEdit = { action: 'edit', dataType: 'bigint', start: '9223372036854775804', minimum: '1',
        maximum: '9223372036854775807', increment: '1', cache: '1', cycle: false, restart: '', comment: '' };
      await expect(manageSequence(sequenceName, { ...sequenceEdit, restart: '0' })).rejects.toThrow('重启值');
      const editPlan = await manageSequence(sequenceName, sequenceEdit);
      expect(editPlan.statements).toHaveLength(3);
      expect(editPlan.statements[1]).toContain('START WITH 9223372036854775804');
      expect(editPlan.statements[1]).not.toContain('RESTART');
      expect(editPlan.statements[2]).toContain('IS NULL');
      expect(await readSequence()).toMatchObject({ start: sequenceDraft.start, comment: value, canManage: true });
      // 业务在预览期间取号，不应使配置预览失效，也不应被参数变更重设。
      expect((await client.query('SELECT nextval($1::regclass)::text AS value', [sequenceName])).rows[0].value).toBe(sequenceEdit.maximum);
      await expect(applySequence(editPlan.token)).rejects.toThrow('预览已失效');
      expect(await applySequenceManage(editPlan.token)).toMatchObject({ outcome: 'committed' });
      expect(await readSequence()).toMatchObject({ start: sequenceEdit.start, lastValue: sequenceEdit.maximum, comment: null, cycle: false });

      const restart = await manageSequence(sequenceName, { ...sequenceEdit, restart: sequenceEdit.start });
      expect(restart.statements[1]).toContain('RESTART WITH 9223372036854775804');
      expect(await applySequenceManage(restart.token)).toMatchObject({ outcome: 'committed' });
      await expect(applySequenceManage(restart.token)).rejects.toThrow('预览已失效');
      expect((await client.query(`SELECT last_value::text, is_called FROM ${sequenceName}`)).rows)
        .toEqual([{ last_value: sequenceEdit.start, is_called: false }]);
      expect((await client.query('SELECT nextval($1::regclass)::text AS value', [sequenceName])).rows[0].value).toBe(sequenceEdit.start);

      const sequenceRename = { action: 'rename', name: '改名"序列' };
      await expect(manageSequence(sequenceName, { ...sequenceRename, name: draft.table })).rejects.toThrow('同名关系');
      const staleSequence = await manageSequence(sequenceName, sequenceRename);
      await client.query(`COMMENT ON SEQUENCE ${sequenceName} IS '外部注释'`);
      expect(await applySequenceManage(staleSequence.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原序列已变化') });
      const originalSequenceOid = await indexOid(sequenceName);
      const renamedSequence = '"生成.甲"."改名""序列"';
      const renameSequence = await manageSequence(sequenceName, sequenceRename);
      expect(await applySequenceManage(renameSequence.token)).toMatchObject({ outcome: 'committed', table: renamedSequence });
      expect(await indexOid(sequenceName)).toBeNull();
      expect(await indexOid(renamedSequence)).toBe(originalSequenceOid);
      expect(await readSequence(renamedSequence)).toMatchObject({ lastValue: sequenceEdit.start, comment: '外部注释' });

      await client.query(`CREATE VIEW "生成.甲"."取号依赖" AS SELECT nextval('${renamedSequence}'::regclass) AS value`);
      const blockedSequenceDrop = await manageSequence(renamedSequence, { action: 'drop' });
      expect(blockedSequenceDrop.statements[1]).toContain(' RESTRICT');
      expect(await applySequenceManage(blockedSequenceDrop.token)).toMatchObject({ outcome: 'rolledBack' });
      expect(await indexOid(renamedSequence)).toBe(originalSequenceOid);
      expect(await indexOid('"生成.甲"."取号依赖"')).not.toBeNull();
      await client.query('DROP VIEW "生成.甲"."取号依赖"');
      const replacedSequence = await manageSequence(renamedSequence, { action: 'drop' });
      await client.query(`DROP SEQUENCE ${renamedSequence}; CREATE SEQUENCE ${renamedSequence}`);
      expect(await applySequenceManage(replacedSequence.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('原序列已变化') });
      expect(await indexOid(renamedSequence)).not.toBeNull();
      expect(await applySequenceManage((await manageSequence(renamedSequence, { action: 'drop' })).token)).toMatchObject({ outcome: 'committed' });
      expect(await indexOid(renamedSequence)).toBeNull();

      const descending = await engine.handle('postgres.sequence.preview', { ...sequenceDraft, name: '倒序', dataType: 'smallint',
        start: '', increment: '-3', comment: '' });
      expect(await applySequence(descending.token)).toMatchObject({ outcome: 'committed' });
      expect(await readSequence('"生成.甲"."倒序"')).toMatchObject({ start: '-1', minimum: '-32768', maximum: '-1', increment: '-3' });

      const closed = await prepare({ table: '关闭' });
      await engine.handle('connections.close', { id });
      await expect(apply(closed.token)).rejects.toThrow('预览已失效');
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
