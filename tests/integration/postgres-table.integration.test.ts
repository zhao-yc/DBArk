import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import { postgresRelatedTabPrefix } from '../../src/shared/postgresRelatedTab';
import type { PostgresRelatedTablePage, PostgresTableChange, PostgresTableExportInput, PostgresTablePage, PostgresTablePreview, PostgresTableReferenceResult, PostgresTableValues } from '../../src/shared/postgresTable';
import { appendPostgresValueFilter } from '../../src/renderer/postgresTableValues';
import { postgresBatchFillChanges } from '../../src/renderer/postgresBatchFill';
import { postgresBatchDeletePlan } from '../../src/renderer/postgresBatchDelete';
import { postgresBatchEditPlan, type PostgresBatchEditValues } from '../../src/renderer/postgresBatchEdit';
import { postgresBatchRows } from '../../src/renderer/postgresBatchSelection';
import { postgresBatchDuplicateChanges, postgresBatchDuplicatePlan, postgresRecordDuplicatePlan } from '../../src/renderer/postgresRecordDuplicate';
import { listExcelSheets, readExcelRows } from '../../src/engine/excelFiles';
import { inspectPostgresCopySource } from '../../src/engine/postgres/copyImportFile';

const active = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';
const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);

describe.skipIf(!active)('PostgreSQL实库表页和记录事务', () => {
  /** 读、预览、提交走真实引擎；独立客户端用于制造冲突和复核提交事实。 */
  it('分页、筛选、逐字精度、混合增改删、冲突与约束回滚', async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
        database !== process.env.DBARK_POSTGRES_TEST_USER || !password || !Number.isInteger(port) || port <= 1024) {
      throw Error('只允许本轮专用回环 PostgreSQL 实库');
    }
    const id = randomUUID(), tabId = randomUUID(), owner = randomUUID();
    const profile: PostgresConnectionProfile = {
      id, name: '隔离表页', group: '', color: '#123456', dialect: 'postgresql',
      host: '127.0.0.1', port, user: database, password, database, rememberPassword: false,
    };
    // 独立客户端固定普通连接和文本回包，避免专项环境变量改变核对口径。
    const config = { host: profile.host, port, user: database, password, database, ssl: false,
      sslnegotiation: 'postgres' as const, options: ' ', replication: 'false' };
    const client = Object.assign(new Client(config), { binary: false });
    const engine = new Engine();
    const table = '"浏览"."项目""清单"';
    const target = { owner, connectionRevision: 1, connectionId: id, database, table, tabId };
    const read = (options: Record<string, unknown> = {}): Promise<PostgresTablePage> =>
      engine.handle('postgres.table.page', { ...target, profile, offset: 0, limit: 2, ...options });
    const preview = (page: PostgresTablePage, changes: PostgresTableChange[], extra = {}): Promise<PostgresTablePreview> =>
      engine.handle('postgres.table.preview', { ...target, pageToken: page.pageToken, changes, ...extra });
    const apply = (page: PostgresTablePage, prepared: PostgresTablePreview, extra = {}) =>
      engine.handle('postgres.table.apply', { ...target, profile, pageToken: page.pageToken, previewToken: prepared.previewToken, ...extra });
    const field = (column: string, value: string) => ({ column, value: { mode: 'text' as const, value } });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "浏览";
        CREATE TABLE ${table} (id bigint PRIMARY KEY, note text DEFAULT '默认', amount numeric(40,18), raw bytea,
          tag text GENERATED ALWAYS AS (coalesce(note,'空') || '-生成') STORED,
          CHECK (amount >= 0));
        INSERT INTO ${table} (id,note,amount,raw) VALUES
          (1,'原一',1234567890123456789012.123456789012345678,decode('00ff','hex')),
          (2,'原二',2,NULL),(3,'原三',3,NULL);
        CREATE VIEW "浏览"."只读" AS SELECT * FROM ${table};`);
      const first = await read();
      expect(first).toMatchObject({ hasNext: true, truncated: false, order: 'primary', capabilities: { insert: true, update: true, delete: true } });
      expect(first.rows[0]).toMatchObject({ c0: '1', c2: '1234567890123456789012.123456789012345678', c3: { base64: 'AP8=' }, c4: '原一-生成' });
      const reference = { table: '"浏览"."引用记录"', tabId: randomUUID() };
      await client.query(`CREATE TABLE "浏览"."父""表" (code bigint, label text COLLATE pg_catalog."C", description text, PRIMARY KEY(code,label));
        INSERT INTO "浏览"."父""表" SELECT 9007199254740992 + i, '组' || i,
          CASE WHEN i=42 THEN '字面_%命中' ELSE '说明' || i END FROM generate_series(1,42) i;
        CREATE TABLE ${reference.table} (id bigint PRIMARY KEY, local_label text COLLATE pg_catalog."POSIX", local_code bigint,
          CONSTRAINT "反序复合外键" FOREIGN KEY(local_code,local_label) REFERENCES "浏览"."父""表"(code,label));
        INSERT INTO ${reference.table} VALUES (1,'组1',9007199254740993);`);
      const referencePage = await read(reference);
      const references = (extra: Record<string, unknown> = {}): Promise<PostgresTableReferenceResult> =>
        engine.handle('postgres.table.references', { ...target, ...reference, profile, pageToken: referencePage.pageToken, ...extra });
      const referenceDirectory = await references();
      expect(referenceDirectory.choices).toHaveLength(1);
      const choice = referenceDirectory.choices[0];
      expect(choice.pairs.map(pair => [pair.local, pair.remote])).toEqual([['c2', 'code'], ['c1', 'label']]);
      const lookup = { id: choice.id, stamp: choice.stamp, search: '', offset: 0 };
      expect((await references({ lookup })).page).toMatchObject({ hasNext: true });
      expect((await references({ lookup, parentRow: 0 })).page?.rows)
        .toEqual([{ c0: '9007199254740993', c1: '组1', c2: '说明1' }]);
      const readRelated = (opened: NonNullable<PostgresTableReferenceResult['opened']>, extra = {}): Promise<PostgresRelatedTablePage> =>
        engine.handle('postgres.table.related', { ...target, ...opened, profile, operation: 'page', offset: 0, ...extra });
      const editRelated = (opened: NonNullable<PostgresTableReferenceResult['opened']>, page: PostgresRelatedTablePage, row = 0): Promise<PostgresTablePage> =>
        engine.handle('postgres.table.related', { ...target, ...opened, profile, operation: 'edit', row, pageToken: page.editToken });
      const parentOpen = (await references({ lookup, parentRow: 0, relatedTabId: postgresRelatedTabPrefix + randomUUID() })).opened!;
      expect(parentOpen.table).toBe('"浏览"."父""表"');
      const relatedParent = await readRelated(parentOpen);
      expect(relatedParent.incoming).toBe(false);
      expect(relatedParent.page.rows).toEqual([{ c0: '9007199254740993', c1: '组1', c2: '说明1' }]);
      await expect(read({ ...parentOpen })).rejects.toThrow('原外键范围');
      await expect(readRelated(parentOpen, { owner: randomUUID() })).rejects.toThrow('已失效');
      await expect(readRelated(parentOpen, { connectionRevision: 2 })).rejects.toThrow('已失效');
      expect(relatedParent.editToken).toBeDefined();
      await expect(editRelated(parentOpen, relatedParent, 1)).rejects.toThrow('已过期');
      const parentEdit = await editRelated(parentOpen, relatedParent);
      expect(parentEdit.capabilities).toEqual({ insert: false, update: true, delete: false });
      await expect(preview(parentEdit, [{ kind: 'delete', row: 0 }], parentOpen)).rejects.toThrow('不支持');
      await expect(engine.handle('postgres.table.values', { ...target, ...parentOpen, profile, pageToken: parentEdit.pageToken, column: 'c0', search: '' }))
        .rejects.toThrow('只可用于原记录修改');
      const parentChange = await preview(parentEdit, [{ kind: 'update', row: 0, fields: [field('c2', '父记录已改')] }], parentOpen);
      expect(await apply(parentEdit, parentChange, parentOpen)).toMatchObject({ outcome: 'committed', affected: 1 });
      expect((await readRelated(parentOpen)).page.rows).toEqual([{ c0: '9007199254740993', c1: '组1', c2: '父记录已改' }]);
      await engine.handle('postgres.table.related', { ...target, ...parentOpen, operation: 'close' });
      await expect(readRelated(parentOpen)).rejects.toThrow('已失效');
      const filtered = await references({ lookup: { ...lookup, search: '_%' } });
      expect(filtered.page?.rows).toEqual([{ c0: '9007199254741034', c1: '组42', c2: '字面_%命中' }]);
      expect((await references({ lookup: { ...lookup, offset: 40 } })).page?.rows).toHaveLength(2);
      await expect(references({ owner: randomUUID(), lookup })).rejects.toThrow('快照');
      await expect(references({ lookup: { ...lookup, stamp: '0'.repeat(64) } })).rejects.toThrow('原外键');
      const limitedUser = process.env.DBARK_POSTGRES_COMPLETION_ROLE;
      if (limitedUser !== database + '_limited') throw Error('缺少本轮独占的列权限测试账号');
      await client.query(`GRANT USAGE ON SCHEMA "浏览" TO "${limitedUser}";
        GRANT SELECT, UPDATE ON ${reference.table} TO "${limitedUser}";
        GRANT SELECT(code,label) ON "浏览"."父""表" TO "${limitedUser}"`);
      const limitedProfile = { ...profile, id: randomUUID(), user: limitedUser };
      const limitedTarget = { ...target, ...reference, tabId: randomUUID(), profile: limitedProfile, connectionId: limitedProfile.id };
      const limitedPage = await read(limitedTarget);
      const limitedResult: PostgresTableReferenceResult = await engine.handle('postgres.table.references',
        { ...limitedTarget, pageToken: limitedPage.pageToken, lookup });
      expect(limitedResult.page?.columns.map(column => column.name)).toEqual(['code', 'label']);
      await client.query(`REVOKE SELECT(label) ON "浏览"."父""表" FROM "${limitedUser}"`);
      await expect(engine.handle('postgres.table.references',
        { ...limitedTarget, pageToken: limitedPage.pageToken, lookup })).rejects.toThrow('读取权限');
      await read(reference);
      await expect(references({ lookup })).rejects.toThrow('快照');

      const partitioned = { table: '"浏览"."分区外键"', tabId: randomUUID() };
      await client.query(`CREATE TABLE "浏览"."复合父键" (num bigint, raw bytea, label text, secret text, PRIMARY KEY (num,raw)) PARTITION BY LIST (num);
        CREATE TABLE "浏览"."复合父甲" PARTITION OF "浏览"."复合父键" FOR VALUES IN (1);
        CREATE TABLE "浏览"."复合父乙" PARTITION OF "浏览"."复合父键" FOR VALUES IN (2);
        INSERT INTO "浏览"."复合父键" VALUES (1,decode('00ff','hex'),'父甲','私有甲'),(2,decode('00ff','hex'),'父乙','私有乙');
        CREATE TABLE ${partitioned.table} (id int, n smallint, generated smallint GENERATED ALWAYS AS (n) STORED, raw bytea,
          FOREIGN KEY (generated,raw) REFERENCES "浏览"."复合父键" (num,raw)) PARTITION BY LIST (id);
        CREATE TABLE "浏览"."分区甲" PARTITION OF ${partitioned.table} FOR VALUES IN (1);
        CREATE TABLE "浏览"."分区乙" PARTITION OF ${partitioned.table} FOR VALUES IN (2,3);
        CREATE TABLE "浏览"."分区默认" PARTITION OF ${partitioned.table} DEFAULT;
        INSERT INTO ${partitioned.table} (id,n,raw) VALUES (1,1,decode('00ff','hex')),(2,2,decode('00ff','hex')),(3,NULL,decode('00ff','hex'));
        GRANT SELECT ON ${partitioned.table} TO "${limitedUser}";
        GRANT SELECT(num,raw,label) ON "浏览"."复合父键" TO "${limitedUser}";
        ALTER TABLE "浏览"."复合父键" ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "隐藏父乙" ON "浏览"."复合父键" FOR SELECT TO "${limitedUser}" USING (num <> 2);`);
      const parentPage = await read({ ...partitioned, limit: 3, sort: { column: 'id', direction: 'asc' } });
      expect(parentPage).toMatchObject({ canBrowseReferences: true, relationKind: 'p' });
      const identities = (await client.query(`SELECT ctid::text, xmin::text, tableoid::oid::text
        FROM ${partitioned.table} WHERE id IN (1,2) ORDER BY id`)).rows;
      expect(identities[0].ctid).toBe(identities[1].ctid);
      expect(identities[0].xmin).toBe(identities[1].xmin);
      expect(identities[0].tableoid).not.toBe(identities[1].tableoid);
      const parentBrowse = (parentRow: number, source = { ...partitioned, pageToken: parentPage.exportToken }) => {
        const request = { ...target, ...source, profile: 'profile' in source ? source.profile : profile, parentRow };
        return async (lookup?: { id: string; stamp: string; search: string; offset: number }): Promise<PostgresTableReferenceResult> =>
          engine.handle('postgres.table.references', { ...request, ...(lookup ? { lookup } : {}) });
      };
      const [parentKey] = (await parentBrowse(0)()).choices;
      expect(parentKey.pairs.map(pair => [pair.localName, pair.remote])).toEqual([['generated','num'], ['raw','raw']]);
      const byParent = { id: parentKey.id, stamp: parentKey.stamp, search: '', offset: 0 };
      expect((await parentBrowse(0)(byParent)).page?.rows).toEqual([
        { c0: '1', c1: { type: 'binary', base64: 'AP8=' }, c2: '父甲', c3: '私有甲' },
      ]);
      expect((await parentBrowse(1)(byParent)).page?.rows[0]?.c0).toBe('2');
      expect((await parentBrowse(2)(byParent)).page?.rows).toEqual([]);
      await expect(parentBrowse(3)()).rejects.toThrow('不可定位');
      const limitedChild = { ...limitedTarget, ...partitioned, tabId: randomUUID() };
      const limitedChildPage = await read({ ...limitedChild, limit: 3, sort: { column: 'id', direction: 'asc' } });
      expect(limitedChildPage.canBrowseReferences).toBe(true);
      expect(limitedChildPage.pageToken).toBeUndefined();
      const readOnlySource = { ...limitedChild, pageToken: limitedChildPage.exportToken };
      const visibleParent = (await parentBrowse(0, readOnlySource)(byParent)).page;
      expect(visibleParent?.columns.map(column => column.name)).toEqual(['num','raw','label']);
      expect(visibleParent?.rows[0]?.c2).toBe('父甲');
      expect((await parentBrowse(1, readOnlySource)(byParent)).page?.rows).toEqual([]);
      await client.query(`INSERT INTO ${partitioned.table} (id,n,raw)
        SELECT id, 1, decode('00ff','hex') FROM generate_series(4,45) id;
        CREATE TABLE "浏览"."另一引用" (num bigint, raw bytea, note text CHECK (note <> '拒绝'), ${Array.from({ length: 18 }, (_, i) => '"说明' + i + '" text').join(', ')},
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          FOREIGN KEY (num,raw) REFERENCES "浏览"."复合父键" (num,raw));
        INSERT INTO "浏览"."另一引用" (num,raw,note) VALUES (1,decode('00ff','hex'),'字面_%'),(2,decode('00ff','hex'),'另一条');`);
      const inboundRoot = { table: '"浏览"."复合父键"', tabId: randomUUID() };
      const inboundLeaf = { table: '"浏览"."复合父甲"', tabId: randomUUID() };
      const inboundRootPage = await read(inboundRoot), inboundLeafPage = await read(inboundLeaf);
      const children = (table: Record<string, unknown>, page: PostgresTablePage, extra = {}): Promise<PostgresTableReferenceResult> =>
        engine.handle('postgres.table.references', { ...target, profile, ...table, pageToken: page.exportToken, childrenRow: 0, ...extra });
      const inboundChoices = (await children(inboundRoot, inboundRootPage)).choices;
      expect(inboundChoices.map(item => item.table).sort()).toEqual(['分区外键', '另一引用']);
      expect((await children(inboundLeaf, inboundLeafPage)).choices).toEqual(inboundChoices);
      const inboundKey = inboundChoices.find(item => item.table === '分区外键')!;
      const inboundLookup = { id: inboundKey.id, stamp: inboundKey.stamp, search: '', offset: 0 };
      expect(inboundKey.pairs.map(pair => [pair.localName, pair.remote])).toEqual([['num','generated'], ['raw','raw']]);
      const related = (await children(inboundLeaf, inboundLeafPage, { lookup: inboundLookup })).page!;
      expect(related).toMatchObject({ hasNext: true });
      expect(related.rows).toHaveLength(40);
      expect(related.rows[0]).toMatchObject({ c0: '1', c1: { type: 'binary', base64: 'AP8=' }, c2: '1' });
      const rest = (await children(inboundLeaf, inboundLeafPage, { lookup: { ...inboundLookup, offset: 40 } })).page!;
      expect(rest).toMatchObject({ hasNext: false });
      expect([...related.rows, ...rest.rows]).toHaveLength(43);
      expect(new Set([...related.rows, ...rest.rows].map(row => row.c2)).size).toBe(43);
      const otherKey = inboundChoices.find(item => item.table === '另一引用')!;
      const otherLookup = { id: otherKey.id, stamp: otherKey.stamp, search: '_%', offset: 0 };
      expect((await children(inboundRoot, inboundRootPage, { lookup: otherLookup })).page?.rows[0]?.c2).toBe('字面_%');
      expect((await children(inboundRoot, inboundRootPage, { childrenRow: 1, lookup: otherLookup })).page?.rows).toEqual([]);
      const openingOrigin = { ...inboundLeaf, tabId: randomUUID() }, openingPage = await read(openingOrigin);
      const wideOpen = (await children(openingOrigin, openingPage, {
        relatedTabId: postgresRelatedTabPrefix + randomUUID(), lookup: otherLookup,
      })).opened!;
      const multiOpen = (await children(openingOrigin, openingPage, {
        relatedTabId: postgresRelatedTabPrefix + randomUUID(), lookup: inboundLookup,
      })).opened!;
      await engine.handle('postgres.table.release', { ...target, ...openingOrigin, pageToken: openingPage.exportToken });
      const widePage = await readRelated(wideOpen);
      expect(widePage.search).toBe('_%');
      expect(widePage.page.columns.map(column => column.name)).toContain('说明17');
      expect(widePage.page.rows[0]?.c2).toBe('字面_%');
      const relatedTail = await readRelated(multiOpen, { offset: 40 });
      expect(relatedTail.page.rows).toEqual(rest.rows);
      expect(relatedTail.editToken).toBeUndefined();
      const childEdit = await editRelated(wideOpen, widePage);
      const noteDraft = (note: string): PostgresTableChange => ({ kind: 'update', row: 0, fields: [field('c2', note)] });
      const badChild = await preview(childEdit, [noteDraft('拒绝')], wideOpen);
      expect(await apply(childEdit, badChild, wideOpen)).toMatchObject({ outcome: 'rolledBack', draftsRetained: true });
      await expect(apply(childEdit, badChild, wideOpen)).rejects.toThrow('预览已失效');
      const fixedChild = await preview(childEdit, [noteDraft('修正_%')], wideOpen);
      expect(await apply(childEdit, fixedChild, wideOpen)).toMatchObject({ outcome: 'committed', affected: 1 });
      const childRows = () => client.query('SELECT note FROM "浏览"."另一引用" ORDER BY id').then(result => result.rows);
      expect(await childRows()).toEqual([{ note: '修正_%' }, { note: '另一条' }]);
      const finalChildPage = await readRelated(wideOpen), finalChildEdit = await editRelated(wideOpen, finalChildPage);
      const staleChild = await preview(finalChildEdit, [noteDraft('失效修改')], wideOpen);
      await expect(readRelated(multiOpen, { table: inboundLeaf.table })).rejects.toThrow('已失效');
      await client.query(`GRANT SELECT ON "浏览"."复合父甲" TO "${limitedUser}";
        REVOKE SELECT ON ${partitioned.table} FROM "${limitedUser}";
        GRANT SELECT(id,generated,raw) ON ${partitioned.table} TO "${limitedUser}";
        ALTER TABLE ${partitioned.table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "限制子记录" ON ${partitioned.table} FOR SELECT TO "${limitedUser}" USING (id <= 2);`);
      const inboundLimited = { ...inboundLeaf, profile: limitedProfile, connectionId: limitedProfile.id, tabId: randomUUID() };
      const inboundLimitedPage = await read(inboundLimited);
      expect(inboundLimitedPage.pageToken).toBeUndefined();
      const [limitedInboundKey] = (await children(inboundLimited, inboundLimitedPage)).choices;
      const limitedInbound = { ...inboundLookup, stamp: limitedInboundKey.stamp };
      const limitedRows = (await children(inboundLimited, inboundLimitedPage, { lookup: limitedInbound })).page!;
      expect(limitedRows.columns.map(column => column.name)).toEqual(['generated', 'raw', 'id']);
      expect(limitedRows.rows.map(row => row.c2)).toEqual(['1']);
      await client.query(`REVOKE SELECT(raw) ON ${partitioned.table} FROM "${limitedUser}"`);
      await expect(children(inboundLimited, inboundLimitedPage, { lookup: limitedInbound })).rejects.toThrow('读取权限');
      await client.query('UPDATE "浏览"."复合父键" SET label = \'外部变动\' WHERE num = 1');
      await expect(children(inboundLeaf, inboundLeafPage, { lookup: inboundLookup })).rejects.toThrow('原记录已变化');
      await expect(readRelated(multiOpen)).rejects.toThrow('原记录已变化');
      expect(await apply(finalChildEdit, staleChild, wideOpen)).toMatchObject({ outcome: 'notSent' });
      expect(await childRows()).toEqual([{ note: '修正_%' }, { note: '另一条' }]);
      await client.query(`UPDATE ${partitioned.table} SET n=2 WHERE id=1`);
      await expect(parentBrowse(0)(byParent)).rejects.toThrow('原记录已变化');

      expect((await read({ offset: 2 })).rows.map(row => row.c0)).toEqual(['3']);
      expect((await read({ sort: { column: 'id', direction: 'desc' } })).rows.map(row => row.c0)).toEqual(['3', '2']);
      expect((await read({ filter: { column: 'note', text: "原三';--" } })).rows).toEqual([]);
      expect((await read({ filter: { column: 'note', text: '原三' } })).rows.map(row => row.c0)).toEqual(['3']);
      const navigationOptions = {
        limit: 1, filter: { mode: 'all', rules: [{ column: 'amount', operator: '>', value: '2' }] },
        sort: [{ column: 'id', direction: 'DESC' }],
      };
      const countPage = await read({ ...navigationOptions, navigation: 'count' });
      expect(countPage).toMatchObject({ counted: { matchingRows: '2', offset: 0 }, hasNext: true });
      expect(countPage.rows.map(row => row.c0)).toEqual(['3']);
      const lastPage = await read({ ...navigationOptions, navigation: 'last' });
      expect(lastPage).toMatchObject({ counted: { matchingRows: '2', offset: 1 }, hasNext: false });
      expect(lastPage.rows.map(row => row.c0)).toEqual(['1']);
      const correctedPage = await read({ ...navigationOptions, offset: 99, navigation: 'count' });
      expect(correctedPage.counted).toEqual({ matchingRows: '2', offset: 1 });
      const emptyLastPage = await read({ ...navigationOptions, navigation: 'last', filter: { column: 'note', text: '空范围' } });
      expect(emptyLastPage).toMatchObject({ counted: { matchingRows: '0', offset: 0 }, rows: [], hasNext: false });
      const valueTable = { table: '"浏览"."不同值"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${valueTable.table}
        (id bigint PRIMARY KEY, note text, amount numeric(40,18), raw bytea, doc jsonb, hidden json);
        INSERT INTO ${valueTable.table}
        SELECT i, CASE i WHEN 1 THEN NULL WHEN 2 THEN '' WHEN 3 THEN '换' || chr(13) || chr(10) || '行'
          WHEN 4 THEN repeat('大',4100) WHEN 502 THEN '末尾_%' WHEN 503 THEN '末尾_%'
          ELSE '候选' || i END, 1234567890123456789012.123456789012345678, decode('00ff','hex'), '{"n":9007199254740993}', '{}'
        FROM generate_series(1, 503) i;`);
      const originalFilter = { rules: [{ column: 'id', operator: '<', value: '503' }], mode: 'all' } as const;
      const valuePage = await read({ ...valueTable, filter: originalFilter, limit: 1 });
      const values = (column: string, search = '', extra = {}): Promise<PostgresTableValues> =>
        engine.handle('postgres.table.values', { ...target, ...valueTable, profile, pageToken: valuePage.exportToken, column, search, ...extra });
      const bounded = await values('c1');
      expect(bounded.truncated).toBe(true);
      expect(bounded.options).toHaveLength(500);
      expect(bounded.options.slice(0, 2)).toEqual([{ value: null, count: '1', clipped: false }, { value: '', count: '1', clipped: false }]);
      expect(await values('c1', '_%')).toEqual({ truncated: false, options: [{ value: '末尾_%', count: '1', clipped: false }] });
      expect((await values('c1', '大')).options).toEqual([{ value: '大'.repeat(200), count: '1', clipped: true }]);
      expect((await values('c2')).options).toEqual([{ value: '1234567890123456789012.123456789012345678', count: '502', clipped: false }]);
      expect((await values('c3')).options).toEqual([{ value: '\\x00ff', count: '502', clipped: false }]);
      expect((await values('c4')).options).toEqual([{ value: '{"n": 9007199254740993}', count: '502', clipped: false }]);
      await expect(values('c5')).rejects.toThrow('不支持');
      await expect(values('c1', '', { owner: randomUUID() })).rejects.toThrow('快照');
      const statistics = (tableSource: typeof valueTable, page: PostgresTablePage, column: string, extra = {}) =>
        engine.handle('postgres.table.statistics', { ...target, ...tableSource, profile, pageToken: page.exportToken, column, ...extra });
      expect(await statistics(valueTable, valuePage, 'c1')).toMatchObject({
        rows: '502', nonNull: '501', nulls: '1', empty: '1', groups: { distinct: '501', unique: '501', repeated: '0' },
      });
      expect(await statistics(valueTable, valuePage, 'c5')).toEqual({ rows: '502', nonNull: '502', nulls: '0' });
      await expect(statistics(valueTable, valuePage, 'c1', { owner: randomUUID() })).rejects.toThrow('快照');
      const profileTable = { table: '"浏览"."字段概况"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${profileTable.table} (id int PRIMARY KEY, amount numeric, label text COLLATE "C");
        INSERT INTO ${profileTable.table} VALUES (1,9007199254740993,''),(2,9007199254740995,'甲'),
          (3,'NaN','甲'),(4,'Infinity',repeat('龟',4100)),(5,NULL,NULL);
        CREATE VIEW "浏览"."字段概况视图" AS SELECT * FROM ${profileTable.table};`);
      const summary = await read({ ...profileTable, limit: 1 });
      expect(await statistics(profileTable, summary, 'c1')).toMatchObject({
        rows: '5', nulls: '1', groups: { distinct: '4', min: { text: '9007199254740993' }, max: { text: 'NaN' } },
        numeric: { zero: '0', nonFinite: '2', sum: { text: '18014398509481988' },
          average: { text: expect.stringMatching(/^9007199254740994(?:\.0+)?$/) }, deviation: { text: expect.stringMatching(/^1(?:\.0+)?$/) } },
      });
      expect(await statistics(profileTable, summary, 'c2')).toMatchObject({
        empty: '1', groups: { distinct: '3', unique: '2', repeated: '1', min: { text: '', clipped: false },
          max: { text: '龟'.repeat(4096), clipped: true } },
      });
      const profileView = { ...profileTable, table: '"浏览"."字段概况视图"' };
      const emptySummary = await read({ ...profileView, filter: { column: 'label', text: '空结果' } });
      expect(emptySummary.pageToken).toBeUndefined();
      expect(await statistics(profileView, emptySummary, 'c1')).toMatchObject({
        rows: '0', nonNull: '0', nulls: '0', groups: { distinct: '0', unique: '0', repeated: '0', min: null, max: null },
        numeric: { nonFinite: '0', sum: null, average: null, deviation: null },
      });
      await expect(statistics(profileTable, summary, 'c1')).rejects.toThrow('快照');
      const preparedFilter = { mode: 'all' as const, rules: [{ column: 'id', operator: '<' as const, value: '6' }] };
      const exactValues = [null, '', '换\r\n行'];
      const filteredIds = async (values: (string | null)[], exclude: boolean) =>
        (await read({ ...valueTable, limit: 10, filter: appendPostgresValueFilter(preparedFilter, 'note', values, exclude) })).rows.map(row => row.c0);
      expect(await filteredIds(exactValues, false)).toEqual(['1', '2', '3']);
      expect(await filteredIds(exactValues, true)).toEqual(['4', '5']);
      expect(await filteredIds(exactValues.slice(1), true)).toEqual(['1', '4', '5']);
      await expect(values('c1')).rejects.toThrow('快照');
      const beforeValuesDdl = await read({ ...valueTable, limit: 1 });
      await client.query(`ALTER TABLE ${valueTable.table} RENAME COLUMN note TO renamed`);
      await expect(values('c1', '', { pageToken: beforeValuesDdl.exportToken })).rejects.toThrow('结构或权限');
      await expect(statistics(valueTable, beforeValuesDdl, 'c1')).rejects.toThrow('结构或权限');
      const advancedFilter = { mode: 'all', rules: [
        { column: 'amount', operator: '>', value: '2.000000000000000001' },
        { column: 'id', operator: 'IN', values: ['1', '2'] },
        { column: 'raw', operator: 'IS NULL' },
        { column: 'note', operator: 'LIKE', value: '绝不会匹配', enabled: false },
      ], group: { mode: 'all', children: [0, { mode: 'any', children: [1, 2, 3] }] } } as const;
      const advancedFirst = await read({ limit: 1, filter: advancedFilter });
      expect(advancedFirst.rows.map(row => row.c0)).toEqual(['1']);
      const advancedSecond = await read({ limit: 1, offset: 1, filter: advancedFilter, retainPageTokens: [advancedFirst.pageToken] });
      expect(advancedSecond.rows.map(row => row.c0)).toEqual(['3']);
      await expect(read({ limit: 1, offset: 1, retainPageTokens: [advancedFirst.pageToken],
        filter: { ...advancedFilter, rules: advancedFilter.rules.map(rule => ({ ...rule, enabled: false })) } })).rejects.toThrow('筛选或排序');
      await expect(read({ filter: { mode: 'all', rules: [{ column: '不存在', operator: '=', value: '1' }] } })).rejects.toThrow('排序或筛选列');
      const retired = { mode: 'all', rules: [{ column: '不存在', operator: 'IS NULL', enabled: false }] };
      expect((await read({ filter: retired })).rows.map(row => row.c0)).toEqual(['1', '2']);
      await expect(read({ filter: retired, checkFilterColumns: true })).rejects.toThrow('排序或筛选列');
      await expect(read({ filter: { mode: 'all', rules: [{ column: 'id', operator: '1=1; DROP TABLE t', value: '1' }] } })).rejects.toThrow('操作符');
      const view = await read({ table: '"浏览"."只读"', tabId: randomUUID() });
      expect(view).toMatchObject({ relationKind: 'v', capabilities: { insert: false, update: false, delete: false } });
      expect(view.pageToken).toBeUndefined();
      const current = await read();
      await expect(preview(first, [{ kind: 'delete', row: 0 }])).rejects.toThrow('快照');
      await expect(preview(current, [{ kind: 'delete', row: 0 }], { owner: randomUUID() })).rejects.toThrow('快照');
      const fill = { table: '"浏览"."批量填充"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${fill.table} (id bigint PRIMARY KEY, note text, flag text DEFAULT '默认值', raw bytea);
        INSERT INTO ${fill.table} VALUES (9007199254740993,'原一','原标记',NULL),
          (9007199254740994,'原二','原标记',NULL),(9007199254740995,'原三','原标记',NULL)`);
      const fillPage = await read({ ...fill, limit: 3 });
      const fillChanges = postgresBatchFillChanges(fillPage, fillPage.columns, new Set([2, 0]), [
        { column: 'c1', value: { mode: 'null' } }, { column: 'c2', value: { mode: 'default' } },
        { column: 'c3', value: { mode: 'binary', value: '00ff' } },
      ], () => undefined);
      const filledRows = () => client.query(`SELECT id::text, note, flag, encode(raw, 'hex') AS raw FROM ${fill.table} ORDER BY id`).then(result => result.rows);
      const unchangedFill = await filledRows();
      const fillPreview = await preview(fillPage, fillChanges, fill);
      expect(fillPreview.statements).toHaveLength(2);
      expect(await filledRows()).toEqual(unchangedFill);
      expect(await apply(fillPage, fillPreview, fill)).toMatchObject({ outcome: 'committed', affected: 2 });
      expect(await filledRows()).toEqual([
        { id: '9007199254740993', note: null, flag: '默认值', raw: '00ff' }, unchangedFill[1],
        { id: '9007199254740995', note: null, flag: '默认值', raw: '00ff' },
      ]);
      const editBatchPage = await read({ ...fill, limit: 3 });
      const selectedEdits = postgresBatchRows(editBatchPage, new Set([0, 2]), () => undefined);
      const editInputs = new Map<number, PostgresBatchEditValues>([
        [2, new Map([['c1', { mode: 'text', value: '' }], ['c3', { mode: 'binary', value: 'ff00' }]])],
        [0, new Map([['c1', { mode: 'text', value: '逐条甲' }], ['c3', { mode: 'null' }]])],
      ]);
      const editBatchPlan = postgresBatchEditPlan(editBatchPage, selectedEdits, editInputs);
      expect(editBatchPlan.remove.size).toBe(0);
      const beforeBatchEdit = await filledRows();
      const editBatchPreview = await preview(editBatchPage, editBatchPlan.changes, fill);
      expect(editBatchPreview.counts).toEqual({ insert: 0, update: 2, delete: 0 });
      expect(await filledRows()).toEqual(beforeBatchEdit);
      expect(await apply(editBatchPage, editBatchPreview, fill)).toMatchObject({ outcome: 'committed', affected: 2 });
      expect(await filledRows()).toEqual([
        { ...beforeBatchEdit[0], note: '逐条甲', raw: null }, beforeBatchEdit[1], { ...beforeBatchEdit[2], note: '', raw: 'ff00' },
      ]);
      const duplicate = { table: '"浏览"."复制记录"', tabId: randomUUID() };
      await client.query(`CREATE SEQUENCE "浏览"."复制默认序列" START 41;
        CREATE TABLE ${duplicate.table} (id bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 9007199254740993) PRIMARY KEY,
          legacy bigserial, seq_value bigint DEFAULT nextval('"浏览"."复制默认序列"'::regclass),
          note text, blank text, raw bytea, amount numeric(40,18), tag text GENERATED ALWAYS AS (note || '-生成') STORED);
        INSERT INTO ${duplicate.table} (note,blank,raw,amount) VALUES ('源值','',decode('00ff','hex'),1234567890123456789012.123456789012345678)`);
      const sourceDuplicate = await read(duplicate);
      expect(sourceDuplicate.columns.filter(column => column.sequenceDefault).map(column => column.name)).toEqual(['id', 'legacy', 'seq_value']);
      const duplicatePlan = postgresRecordDuplicatePlan(sourceDuplicate, 0, { kind: 'update', row: 0, fields: [field('c3', '暂存值')] });
      expect(duplicatePlan.omitted).toEqual(['id', 'legacy', 'seq_value', 'tag']);
      expect(duplicatePlan.fields).toEqual([
        field('c3', '暂存值'), field('c4', ''), { column: 'c5', value: { mode: 'binary', value: '00ff' } },
        field('c6', '1234567890123456789012.123456789012345678'),
      ]);
      const duplicateRows = () => client.query(`SELECT id::text, legacy::text, seq_value::text, note, blank, encode(raw,'hex') AS raw,
        amount::text, tag FROM ${duplicate.table} ORDER BY id`).then(result => result.rows);
      const originalDuplicate = await duplicateRows();
      const duplicatePreview = await preview(sourceDuplicate, [{ kind: 'insert', fields: duplicatePlan.fields }], duplicate);
      expect(await duplicateRows()).toEqual(originalDuplicate);
      expect(await apply(sourceDuplicate, duplicatePreview, duplicate)).toMatchObject({ outcome: 'committed', affected: 1 });
      expect(await duplicateRows()).toEqual([originalDuplicate[0], { ...originalDuplicate[0],
        id: '9007199254740994', legacy: '2', seq_value: '42', note: '暂存值', tag: '暂存值-生成',
      }]);
      const batchCopy = { table: '"浏览"."批量复制"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${batchCopy.table} (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, code text UNIQUE, note text);
        INSERT INTO ${batchCopy.table} (code,note) VALUES ('原甲','值甲'),('原乙','值乙'),('原丙',NULL)`);
      const batchCopyRows = () => client.query(`SELECT code,note FROM ${batchCopy.table} ORDER BY id`).then(result => result.rows);
      const beforeBatchCopy = await batchCopyRows();
      const copyPreview = async (secondCode: string) => {
        const source = await read({ ...batchCopy, limit: 3 });
        const plan = postgresBatchDuplicatePlan(source, new Set([2, 0]), () => undefined);
        const changed = new Map([[0, new Map(plan.initial.get(0))], [2, new Map(plan.initial.get(2))]]);
        changed.get(0)!.set('c1', { mode: 'text', value: '副甲' });
        changed.get(2)!.set('c1', { mode: 'text', value: secondCode });
        const pending = await preview(source, postgresBatchDuplicateChanges(source, plan, changed), batchCopy);
        expect(pending.counts.insert).toBe(2);
        expect(await batchCopyRows()).toEqual(beforeBatchCopy);
        return apply(source, pending, batchCopy);
      };
      expect(await copyPreview('原丙')).toMatchObject({ outcome: 'rolledBack', affected: 0 });
      expect(await batchCopyRows()).toEqual(beforeBatchCopy);
      expect(await copyPreview('副丙')).toMatchObject({ outcome: 'committed', affected: 2 });
      expect(await batchCopyRows()).toEqual([...beforeBatchCopy, { code: '副甲', note: '值甲' }, { code: '副丙', note: null }]);
      const batchDelete = { table: '"浏览"."勾选删除"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${batchDelete.table} (id bigint, label text, note text, PRIMARY KEY(id,label));
        INSERT INTO ${batchDelete.table} VALUES (9007199254740993,'组一','保留一'),
          (9007199254740994,'组二','保留二'),(9007199254740995,'组三','保留三');
        CREATE TABLE "浏览"."删除限制" (id bigint, label text, FOREIGN KEY(id,label) REFERENCES ${batchDelete.table});
        INSERT INTO "浏览"."删除限制" VALUES (9007199254740995,'组三');`);
      const deleteRows = () => client.query(`SELECT id::text, label, note FROM ${batchDelete.table} ORDER BY id`).then(result => result.rows);
      const originalDeleteRows = await deleteRows();
      const deletePage = await read({ ...batchDelete, limit: 3 });
      const selectedDelete = new Set([2, 0]);
      const deletePlan = postgresBatchDeletePlan(deletePage, selectedDelete, () => undefined);
      expect(deletePlan.rows).toEqual([0, 2].map(index => ({ index, key: [
        { name: 'id', value: originalDeleteRows[index].id }, { name: 'label', value: originalDeleteRows[index].label },
      ] })));
      const deletePreview = await preview(deletePage, deletePlan.changes, batchDelete);
      expect(deletePreview.counts).toEqual({ insert: 0, update: 0, delete: 2 });
      expect(await deleteRows()).toEqual(originalDeleteRows);
      expect(await apply(deletePage, deletePreview, batchDelete)).toMatchObject({ outcome: 'rolledBack', affected: 0 });
      expect(await deleteRows()).toEqual(originalDeleteRows);
      await client.query('DELETE FROM "浏览"."删除限制"');
      const deleteRetry = await read({ ...batchDelete, limit: 3 });
      const deleteRetryPlan = postgresBatchDeletePlan(deleteRetry, selectedDelete, () => undefined);
      expect(await apply(deleteRetry, await preview(deleteRetry, deleteRetryPlan.changes, batchDelete), batchDelete))
        .toMatchObject({ outcome: 'committed', affected: 2 });
      expect(await deleteRows()).toEqual([originalDeleteRows[1]]);
      const cross = { table: '"浏览"."跨页编辑"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${cross.table} (id bigint PRIMARY KEY, note text CHECK (note <> '拒绝'));
        INSERT INTO ${cross.table} VALUES (1,'原甲'),(2,'原乙'),(3,'原丙')`);
      const crossPage = (offset: number, retainPageTokens: string[] = []) => read({ ...cross, offset, limit: 1, retainPageTokens });
      const pin = (page: PostgresTablePage) => page.pageToken!;
      const crossRows = () => client.query(`SELECT id::text, note FROM ${cross.table} ORDER BY id`).then(result => result.rows);
      const a = await crossPage(0);
      await expect(read({ ...cross, offset: 1, limit: 1, retainPageTokens: [pin(a)], owner: randomUUID() })).rejects.toThrow('快照');
      await expect(read({ ...cross, offset: 1, limit: 1, retainPageTokens: [pin(a)], sort: { column: 'id', direction: 'desc' } }))
        .rejects.toThrow('筛选或排序');
      const b = await crossPage(1, [pin(a)]);
      const revisited = await read({ ...cross, offset: 0, limit: 1, retainPageTokens: [pin(a), pin(b)], navigation: 'count' });
      expect(revisited.counted).toEqual({ matchingRows: '3', offset: 0 });
      expect(revisited.rowKeys).toEqual(a.rowKeys);
      expect(b.rowKeys).not.toEqual(a.rowKeys);
      const compatible = { ...cross, tabId: randomUUID() };
      const legacy = await read({ ...compatible, limit: 1, sort: { column: 'id', direction: 'desc' } });
      const normalized = await read({ ...compatible, offset: 1, limit: 1, sort: [{ column: 'id', direction: 'DESC' }], retainPageTokens: [pin(legacy)] });
      expect([legacy.rows[0].c0, normalized.rows[0].c0]).toEqual(['3', '2']);
      const update = (page: PostgresTablePage, note: string): PostgresTableChange =>
        ({ kind: 'update', pageToken: pin(page), row: 0, fields: [field('c1', note)] });
      const historyScope = { table: '"浏览"."草稿历史"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${historyScope.table} (id bigint PRIMARY KEY, note text);
        INSERT INTO ${historyScope.table} VALUES (1,'原甲'),(2,'原乙')`);
      const historyFirst = await read({ ...historyScope, limit: 1 });
      const historySecond = await read({ ...historyScope, offset: 1, limit: 1, retainHistoryPageTokens: [pin(historyFirst), pin(a), randomUUID()] });
      expect(historySecond.retainedHistoryPageTokens).toEqual([pin(historyFirst)]);
      expect((await preview(historySecond, [update(historyFirst, '历史可恢复')], historyScope)).counts).toEqual({ insert: 0, update: 1, delete: 0 });
      await expect(preview(historySecond, [update(a, '别的标签不可恢复')], historyScope)).rejects.toThrow('快照');
      await client.query(`ALTER TABLE ${historyScope.table} ADD COLUMN extra text`);
      await expect(read({ ...historyScope, offset: 1, limit: 1, retainPageTokens: [pin(historyFirst)] })).rejects.toThrow('结构或权限');
      const changedHistory = await read({ ...historyScope, offset: 1, limit: 1, retainHistoryPageTokens: [pin(historyFirst)] });
      expect(changedHistory.retainedHistoryPageTokens).toBeUndefined();
      await expect(preview(changedHistory, [update(historyFirst, '旧目录不能恢复')], historyScope)).rejects.toThrow('快照');
      await expect(preview(revisited, [update(a, '重复'), update(revisited, '重复')], cross)).rejects.toThrow('同一原记录');
      await expect(preview(revisited, [update(first, '他表')], cross)).rejects.toThrow('快照');
      const multiple = await preview(revisited, [update(a, '已改甲'), update(b, '已改乙')], cross);
      expect(await crossRows()).toEqual([{ id: '1', note: '原甲' }, { id: '2', note: '原乙' }, { id: '3', note: '原丙' }]);
      expect(await apply(revisited, multiple, cross)).toMatchObject({ outcome: 'committed', affected: 2 });
      await expect(apply(revisited, multiple, cross)).rejects.toThrow('快照');
      expect(await crossRows()).toEqual([{ id: '1', note: '已改甲' }, { id: '2', note: '已改乙' }, { id: '3', note: '原丙' }]);
      const conflictA = await crossPage(0);
      const conflictB = await crossPage(1, [pin(conflictA)]);
      const multiConflict = await preview(conflictB, [update(conflictA, '不能写入'), update(conflictB, '旧乙')], cross);
      await client.query(`UPDATE ${cross.table} SET note='外部变动' WHERE id=2`);
      expect(await apply(conflictB, multiConflict, cross)).toMatchObject({ outcome: 'notSent', affected: 0 });
      await expect(preview(conflictB, [update(conflictA, '不能写入')], cross)).rejects.toThrow('快照');
      const rollbackA = await crossPage(0);
      const rollbackB = await crossPage(1, [pin(rollbackA)]);
      const multiRollback = await preview(rollbackB, [update(rollbackA, '应回滚'), update(rollbackB, '拒绝')], cross);
      expect(await apply(rollbackB, multiRollback, cross)).toMatchObject({ outcome: 'rolledBack', affected: 0, draftsRetained: true });
      await expect(apply(rollbackB, multiRollback, cross)).rejects.toThrow('预览已失效');
      const repaired = await preview(rollbackB, [update(rollbackA, '应回滚'), update(rollbackB, '修正乙')], cross);
      expect(repaired.previewToken).not.toBe(multiRollback.previewToken);
      expect(await crossRows()).toEqual([{ id: '1', note: '已改甲' }, { id: '2', note: '外部变动' }, { id: '3', note: '原丙' }]);
      expect(await apply(rollbackB, repaired, cross)).toMatchObject({ outcome: 'committed', affected: 2 });
      expect(await crossRows()).toEqual([{ id: '1', note: '应回滚' }, { id: '2', note: '修正乙' }, { id: '3', note: '原丙' }]);

      const deferred = { table: '"浏览"."延迟约束"', tabId: randomUUID() };
      await client.query(`CREATE TABLE ${deferred.table} (id bigint PRIMARY KEY, code text UNIQUE DEFERRABLE INITIALLY DEFERRED);
        INSERT INTO ${deferred.table} VALUES (1, '原甲'), (2, '原乙')`);
      const deferredPage = await read(deferred);
      const deferredPreview = await preview(deferredPage, [update(deferredPage, '原乙')], deferred);
      // 延迟约束在 COMMIT 时出错，连接转为空闲也不能代替明确的回滚回执。
      const unconfirmed = await apply(deferredPage, deferredPreview, deferred);
      expect(unconfirmed).toMatchObject({ outcome: 'unknown', affected: 0 });
      expect(unconfirmed.draftsRetained).toBeUndefined();
      await expect(apply(deferredPage, deferredPreview, deferred)).rejects.toThrow('快照');
      expect((await client.query(`SELECT code FROM ${deferred.table} ORDER BY id`)).rows)
        .toEqual([{ code: '原甲' }, { code: '原乙' }]);

      await expect(preview(current, [{ kind: 'update', row: 0, fields: [field('c4', '禁止修改')] }])).rejects.toThrow('数据库生成');
      const prepared = await preview(current, [
        { kind: 'update', row: 0, fields: [{ column: 'c1', value: { mode: 'null' } }, { column: 'c3', value: { mode: 'binary', value: 'abcd' } }] },
        { kind: 'delete', row: 1 },
        { kind: 'insert', fields: [field('c0', '9223372036854775807'), field('c2', '19.000000000000000123')] },
      ]);
      expect(prepared.counts).toEqual({ insert: 1, update: 1, delete: 1 });
      expect((await client.query(`SELECT note FROM ${table} WHERE id=1`)).rows).toEqual([{ note: '原一' }]);
      await expect(apply(current, prepared, { connectionRevision: 2 })).rejects.toThrow('快照');
      expect(await apply(current, prepared)).toMatchObject({ outcome: 'committed', affected: 3 });
      await expect(apply(current, prepared)).rejects.toThrow('快照');
      expect((await client.query(`SELECT id::text, note, encode(raw,'hex') raw, tag, amount::text FROM ${table} ORDER BY id`)).rows).toEqual([
        { id: '1', note: null, raw: 'abcd', tag: '空-生成', amount: '1234567890123456789012.123456789012345678' },
        { id: '3', note: '原三', raw: null, tag: '原三-生成', amount: '3.000000000000000000' },
        { id: '9223372036854775807', note: '默认', raw: null, tag: '默认-生成', amount: '19.000000000000000123' },
      ]);
      const stale = await read();
      const conflicting = await preview(stale, [
        { kind: 'update', row: 0, fields: [field('c1', '不能写入')] }, { kind: 'delete', row: 1 },
      ]);
      await client.query(`UPDATE ${table} SET note = '外部修改' WHERE id=3`);
      expect(await apply(stale, conflicting)).toMatchObject({ outcome: 'notSent', affected: 0 });
      expect((await client.query(`SELECT note FROM ${table} WHERE id IN (1,3) ORDER BY id`)).rows).toEqual([{ note: null }, { note: '外部修改' }]);

      const invalid = await read();
      const rollback = await preview(invalid, [
        { kind: 'update', row: 0, fields: [field('c1', '应回滚')] },
        { kind: 'update', row: 1, fields: [field('c2', '-1')] },
      ]);
      expect(await apply(invalid, rollback)).toMatchObject({ outcome: 'rolledBack', affected: 0 });
      expect((await client.query(`SELECT note FROM ${table} WHERE id=1`)).rows).toEqual([{ note: null }]);
      const beforeDdl = await read();
      const staleStructure = await preview(beforeDdl, [{ kind: 'delete', row: 0 }]);
      await client.query(`ALTER TABLE ${table} ADD COLUMN extra text`);
      expect(await apply(beforeDdl, staleStructure)).toMatchObject({ outcome: 'notSent', affected: 0 });
      expect((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows).toEqual([{ n: 3 }]);
      // 名称与列都相同的主键替换也要拒绝旧记录草稿。
      const beforeKey = await read();
      const staleKey = await preview(beforeKey, [{ kind: 'delete', row: 0 }]);
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT "项目""清单_pkey", ADD CONSTRAINT "项目""清单_pkey" PRIMARY KEY (id)`);
      expect(await apply(beforeKey, staleKey)).toMatchObject({ outcome: 'notSent', affected: 0 });
      expect((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows).toEqual([{ n: 3 }]);
      const beforeClose = await read();
      const closing = await preview(beforeClose, [{ kind: 'delete', row: 0 }]);
      await engine.handle('connections.close', { id });
      await expect(apply(beforeClose, closing)).rejects.toThrow('快照');

      // 持有原行的独立锁，确认断开会等待正在写入的专用事务。
      const last = await read();
      const inFlight = await preview(last, [{ kind: 'update', row: 0, fields: [field('c1', '断开前提交')] }]);
      await client.query('BEGIN');
      await client.query(`SELECT id FROM ${table} WHERE id=1 FOR UPDATE`);
      const writing = apply(last, inFlight);
      let disconnecting: Promise<unknown> | undefined;
      try {
        await expect.poll(async () => {
          await client.query('SELECT pg_stat_clear_snapshot()');
          return (await client.query(`SELECT count(*)::int n FROM pg_stat_activity
            WHERE application_name='tabrelio' AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`)).rows[0].n;
        }, { timeout: 3000 }).toBe(1);
        disconnecting = engine.handle('connections.close', { id });
        await expect(read()).rejects.toThrow('在途');
      } finally {
        await client.query('COMMIT');
        await Promise.allSettled([writing, disconnecting]);
      }
      expect(await writing).toMatchObject({ outcome: 'committed', affected: 1 });
      await disconnecting;
      expect((await client.query(`SELECT note FROM ${table} WHERE id=1`)).rows).toEqual([{ note: '断开前提交' }]);

      // 完整导出以原页筛选为准，独立游标跨过分页和多个 FETCH 批次。
      const directory = await mkdtemp(join(tmpdir(), 'tabrelio-postgres-export-'));
      try {
        const exportTable = '"浏览"."导出表"';
        await client.query(`CREATE TABLE ${exportTable} (id bigint PRIMARY KEY, note text, amount numeric(40,18), raw bytea, marker text);
          INSERT INTO ${exportTable} SELECT 9007199254740993+i, CASE WHEN i=1 THEN NULL WHEN i=2 THEN '' ELSE '引;号' END,
            1234567890123456789012.123456789012345678, decode('00ff','hex'), CASE WHEN i<=130 THEN '保留%' ELSE '其它' END
            FROM generate_series(1, 140) AS i`);
        const source = { ...target, table: exportTable, tabId: randomUUID() };
        const exportPage = await read({ ...source, offset: 4, filter: { column: 'marker', text: '保留%' }, sort: { column: 'id', direction: 'desc' } });
        expect(exportPage.rows[0].c0).toBe('9007199254741119');
        const exportRequest = (format: PostgresTableExportInput['format'], name: string, extra: Record<string, unknown> = {}) => ({
          ...source, profile, taskId: randomUUID(), fileToken: randomUUID(), filePath: join(directory, name),
          format, encoding: 'utf8', columns: ['c0', 'c1', 'c2', 'c3'], exportToken: exportPage.exportToken, ...extra,
        });
        const wrong = exportRequest('json', '拒绝.json', { owner: '其他文档' });
        await expect(engine.handle('postgres.table.export', wrong)).rejects.toThrow('快照');
        const csv = exportRequest('csv', '实际.csv', { csvDelimiter: ';' });
        expect(await engine.handle('postgres.table.export', csv)).toEqual({ rows: 130, fileCommitted: true });
        const csvText = await readFile(csv.filePath, 'utf8');
        expect(csvText).toContain('id;note;amount;raw\r\n9007199254741123;"引;号";1234567890123456789012.123456789012345678;base64:AP8=\r\n');
        expect(csvText).toContain('9007199254740995;"";');
        expect(csvText).toContain('9007199254740994;\\N;');
        const json = exportRequest('json', '实际.json', { encoding: 'utf16le' });
        expect(await engine.handle('postgres.table.export', json)).toEqual({ rows: 130, fileCommitted: true });
        const bytes = await readFile(json.filePath);
        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([255, 254]));
        const records = JSON.parse(bytes.toString('utf16le').slice(1));
        expect(records).toHaveLength(130);
        expect(records[0]).toEqual({ id: '9007199254741123', note: '引;号', amount: '1234567890123456789012.123456789012345678', raw: { type: 'binary', base64: 'AP8=' } });
        expect(records.at(-1)).toMatchObject({ id: '9007199254740994', note: null });
        const xlsx = exportRequest('xlsx', '实际.xlsx');
        expect(await engine.handle('postgres.table.export', xlsx)).toEqual({ rows: 130, fileCommitted: true });
        const [sheet] = await listExcelSheets({ filePath: xlsx.filePath });
        const excelRows = [];
        for await (const row of readExcelRows({ filePath: xlsx.filePath, sheetId: sheet.id, protocol: 'dbark-v1' })) excelRows.push(row);
        expect(excelRows).toHaveLength(130);
        expect(excelRows[0]).toEqual(records[0]);

        const typedSource = { ...source, tabId: randomUUID() };
        const typedPage = await read({ ...typedSource, limit: 1, sort: { column: 'id', direction: 'asc' }, filter: {
          mode: 'all', rules: [{ column: 'id', operator: 'BETWEEN', values: ['9007199254740994', '9007199254740996'] },
            { column: 'note', operator: 'IS NULL' },
            { column: 'note', operator: 'IN', values: ['', '引;号', "x'\\; DROP TABLE t; --"] }],
          group: { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] },
        } });
        expect(typedPage.rows.map(row => row.c0)).toEqual(['9007199254740994']);
        const typedRequest = (format: 'json' | 'copy') => exportRequest(format, '高级筛选.' + (format === 'copy' ? 'csv' : 'json'),
          { ...typedSource, encoding: 'utf8', columns: ['c0', 'c1'], exportToken: typedPage.exportToken, csvDelimiter: undefined });
        const typedJson = typedRequest('json'), typedCopy = typedRequest('copy');
        expect(await engine.handle('postgres.table.export', typedJson)).toEqual({ rows: 3, fileCommitted: true });
        expect(JSON.parse(await readFile(typedJson.filePath, 'utf8'))).toEqual([
          { id: '9007199254740994', note: null }, { id: '9007199254740995', note: '' }, { id: '9007199254740996', note: '引;号' },
        ]);
        expect(await engine.handle('postgres.table.export', typedCopy)).toEqual({ rows: 3, fileCommitted: true });
        expect(await readFile(typedCopy.filePath, 'utf8')).toBe('id,note\n9007199254740994,\n9007199254740995,""\n9007199254740996,引;号\n');

        // 验证首列 NULL 置前、次列 NULL 置后、NUMERIC 精确比较和主键补足顺序。
        const sortSource = { ...source, table: '"浏览"."多列排序"', tabId: randomUUID() };
        await client.query(`CREATE TABLE ${sortSource.table} (id bigint PRIMARY KEY, "分""组" int, score numeric);
          INSERT INTO ${sortSource.table} VALUES (1,NULL,5),(2,NULL,NULL),(3,1,9007199254740992.0001),
            (4,1,9007199254740992.0002),(5,1,9007199254740992.0002),(6,1,NULL),(7,2,10),(8,3,20)`);
        const sort = [{ column: '分"组', direction: 'ASC', nulls: 'FIRST' }, { column: 'score', direction: 'DESC', nulls: 'LAST' }];
        const sortedInput = { ...sortSource, sort, limit: 3, filter: { mode: 'all', rules: [{ column: 'id', operator: '<', value: '8' }] } };
        const sortedFirst = await read(sortedInput);
        const sortedSecond = await read({ ...sortedInput, offset: 3, retainPageTokens: [pin(sortedFirst)] });
        expect(sortedFirst.rows.map(row => row.c0)).toEqual(['1', '2', '4']);
        expect(sortedSecond.rows.map(row => row.c0)).toEqual(['5', '3', '6']);
        expect(sortedSecond.hasNext).toBe(true);
        await expect(read({ ...sortedInput, sort: [...sort].reverse(), retainPageTokens: [pin(sortedFirst)] })).rejects.toThrow('筛选或排序');
        await expect(read({ ...sortedInput, sort: [{ ...sort[0], nulls: 'LAST' }, sort[1]], retainPageTokens: [pin(sortedFirst)] })).rejects.toThrow('筛选或排序');
        await expect(read({ ...sortedInput, sort: [sort[0], sort[0]] })).rejects.toThrow('排序字段不能重复');
        await expect(read({ ...sortedInput, sort: [{ column: 'id', direction: 'DESC; SELECT 1' }] })).rejects.toThrow();
        await expect(read({ ...sortedInput, sort: [{ column: '不存在', direction: 'ASC' }] })).rejects.toThrow('排序或筛选列');
        const sortExtra = { ...sortSource, columns: ['c0'], exportToken: sortedSecond.exportToken };
        const sortedJson = exportRequest('json', '多列排序.json', sortExtra);
        const sortedCopy = exportRequest('copy', '多列排序.csv', sortExtra);
        expect(await engine.handle('postgres.table.export', sortedJson)).toEqual({ rows: 7, fileCommitted: true });
        expect(await engine.handle('postgres.table.export', sortedCopy)).toEqual({ rows: 7, fileCommitted: true });
        expect(JSON.parse(await readFile(sortedJson.filePath, 'utf8')).map((row: { id: string }) => row.id)).toEqual(['1', '2', '4', '5', '3', '6', '7']);
        expect(await readFile(sortedCopy.filePath, 'utf8')).toBe('id\n1\n2\n4\n5\n3\n6\n7\n');

        // 真实 COPY FROM 复核原生 CSV 的精度、NULL、空字符串、换行和跨协议块字段。
        const marker = "保留%'\\; SELECT 1; --";
        const longNote = '跨块;🙂\r\n"引号"'.repeat(25_000);
        await client.query(`UPDATE ${exportTable} SET marker=$1, note=CASE WHEN id=9007199254741123 THEN $2 ELSE note END WHERE marker='保留%'`, [marker, longNote]);
        const copySource = { ...source, tabId: randomUUID() };
        const copyPage = await read({ ...copySource, offset: 4, filter: { column: 'marker', text: marker }, sort: { column: 'id', direction: 'desc' } });
        const copy = exportRequest('copy', '原生.csv', { ...copySource, csvDelimiter: ';', columns: ['c1', 'c0', 'c2', 'c3'], exportToken: copyPage.exportToken });
        expect(await engine.handle('postgres.table.export', copy)).toEqual({ rows: 130, fileCommitted: true });
        const copyText = await readFile(copy.filePath, 'utf8');
        expect(copyText.startsWith('note;id;amount;raw\n"跨块;🙂\r\n""引号""')).toBe(true);
        expect(copyText).toContain('\n"";9007199254740995;1234567890123456789012.123456789012345678;\\x00ff\n;9007199254740994;');
        await client.query('CREATE TEMP TABLE copy_roundtrip (position bigint GENERATED ALWAYS AS IDENTITY, note text, id bigint, amount numeric(40,18), raw bytea)');
        await pipeline(createReadStream(copy.filePath), client.query(copyFrom(
          "COPY copy_roundtrip (note, id, amount, raw) FROM STDIN WITH (FORMAT CSV, HEADER true, DELIMITER ';', ENCODING 'UTF8')")));
        const copied = (await client.query('SELECT id::text, note, amount::text, encode(raw, \'hex\') AS raw FROM copy_roundtrip ORDER BY position')).rows;
        const expectedCopy = (await client.query(`SELECT id::text, note, amount::text, encode(raw, 'hex') AS raw FROM ${exportTable} AS t WHERE marker=$1 ORDER BY t.id DESC`, [marker])).rows;
        expect(copied).toEqual(expectedCopy);
        await client.query(`UPDATE ${exportTable} SET marker='保留%', note=CASE WHEN id=9007199254741123 THEN '引;号' ELSE note END WHERE marker=$1`, [marker]);
        const emptyPage = await read({ ...copySource, filter: { column: 'marker', text: '无匹配' } });
        const empty = exportRequest('copy', '无匹配.csv', { ...copySource, csvDelimiter: '\t', columns: ['c0', 'c1'], exportToken: emptyPage.exportToken });
        expect(await engine.handle('postgres.table.export', empty)).toEqual({ rows: 0, fileCommitted: true });
        expect(await readFile(empty.filePath, 'utf8')).toBe('id\tnote\n');

        await client.query(`ALTER TABLE ${exportTable} ADD COLUMN changed text`);
        const changed = exportRequest('json', '已有.json');
        await writeFile(changed.filePath, '原文件');
        await expect(engine.handle('postgres.table.export', changed)).rejects.toThrow('结构已变化');
        expect(await readFile(changed.filePath, 'utf8')).toBe('原文件');

        // 第二批读取阻塞时已写入暂存，取消只能清理该暂存，保留原文件。
        const waiting = '"浏览"."等待视图"';
        await client.query(`CREATE FUNCTION "浏览".wait_export(id bigint, note text) RETURNS text LANGUAGE plpgsql VOLATILE AS $body$
          BEGIN IF id >= 9007199254741058 THEN PERFORM pg_advisory_xact_lock(75693); END IF; RETURN note; END; $body$;
          CREATE VIEW ${waiting} AS SELECT id, "浏览".wait_export(id, note) AS note FROM ${exportTable} ORDER BY id;`);
        const viewSource = { ...source, table: waiting, tabId: randomUUID() };
        const viewPage = await read(viewSource);
        expect(viewPage.pageToken).toBeUndefined();
        expect(viewPage.exportToken).toBeTruthy();
        await expect(preview({ ...viewPage, pageToken: viewPage.exportToken }, [{ kind: 'delete', row: 0 }], viewSource)).rejects.toThrow('没有记录修改能力');
        const stopped = exportRequest('json', '已有.json', { ...viewSource, columns: ['c0', 'c1'], exportToken: viewPage.exportToken });
        await client.query('SELECT pg_advisory_lock(75693)');
        const exporting = engine.handle('postgres.table.export', stopped);
        void exporting.catch(() => {});
        try {
          await expect.poll(async () => (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE application_name='tabrelio' AND wait_event='advisory' AND query LIKE 'FETCH FORWARD%'`)).rows[0].n,
          { timeout: 5000 }).toBe(1);
          expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(true);
          await engine.handle('query.cancel', { taskId: stopped.taskId });
          await expect(exporting).rejects.toThrow();
          expect(await readFile(stopped.filePath, 'utf8')).toBe('原文件');
          expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
        } finally { await client.query('SELECT pg_advisory_unlock(75693)'); await Promise.allSettled([exporting]); }
        const stoppedCopy = { ...stopped, format: 'copy', taskId: randomUUID() };
        await client.query('SELECT pg_advisory_lock(75693)');
        const copying = engine.handle('postgres.table.export', stoppedCopy);
        void copying.catch(() => {});
        try {
          await expect.poll(async () => (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE application_name='tabrelio' AND wait_event='advisory' AND query LIKE 'COPY (%'`)).rows[0].n,
          { timeout: 5000 }).toBe(1);
          expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(true);
          await engine.handle('query.cancel', { taskId: stoppedCopy.taskId });
          await expect(copying).rejects.toThrow();
          expect(await readFile(stoppedCopy.filePath, 'utf8')).toBe('原文件');
          expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
        } finally { await client.query('SELECT pg_advisory_unlock(75693)'); await Promise.allSettled([copying]); }
        // 服务端已送出一部分 COPY 后报错，只有完整终态才允许发布文件。
        const failingView = '"浏览"."导出异常视图"';
        await client.query(`CREATE FUNCTION "浏览".fail_copy(id bigint) RETURNS text LANGUAGE plpgsql VOLATILE AS $body$
          BEGIN IF id >= 9007199254741058 THEN RAISE EXCEPTION '实库 COPY 中断验证'; END IF;
          RETURN repeat('已发送', 4096); END; $body$;
          CREATE VIEW ${failingView} AS SELECT id, "浏览".fail_copy(id) AS note FROM ${exportTable} ORDER BY id;`);
        const failingSource = { ...source, table: failingView, tabId: randomUUID() };
        const failingPage = await read({ ...failingSource, limit: 1 });
        const failedCopy = exportRequest('copy', '已有.json', { ...failingSource, columns: ['c1'], exportToken: failingPage.exportToken });
        await expect(engine.handle('postgres.table.export', failedCopy)).rejects.toThrow('实库 COPY 中断验证');
        expect(await readFile(failedCopy.filePath, 'utf8')).toBe('原文件');
        expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
        // 在第二批被阻塞时改写一条尚未返回的行，验证跨批仍沿游标声明时的快照。
        const stable = exportRequest('json', '游标快照.json', { ...viewSource, columns: ['c0', 'c1'], exportToken: viewPage.exportToken });
        await client.query('SELECT pg_advisory_lock(75693)');
        const reading = engine.handle('postgres.table.export', stable);
        void reading.catch(() => {});
        try {
          await expect.poll(async () => (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE application_name='tabrelio' AND wait_event='advisory' AND query LIKE 'FETCH FORWARD%'`)).rows[0].n,
          { timeout: 5000 }).toBe(1);
          await client.query(`UPDATE ${exportTable} SET note = '并发新值' WHERE id = 9007199254741060`);
        } finally { await client.query('SELECT pg_advisory_unlock(75693)'); await Promise.allSettled([reading]); }
        expect(await reading).toEqual({ rows: 140, fileCommitted: true });
        expect(JSON.parse(await readFile(stable.filePath, 'utf8')).find((row: { id: string }) => row.id === '9007199254741060'))
          .toEqual({ id: '9007199254741060', note: '引;号' });
        expect((await client.query(`SELECT note FROM ${exportTable} WHERE id = 9007199254741060`)).rows).toEqual([{ note: '并发新值' }]);

        const finished = exportRequest('json', '视图.json', { ...viewSource, columns: ['c0'], exportToken: viewPage.exportToken });
        expect(await engine.handle('postgres.table.export', finished)).toEqual({ rows: 140, fileCommitted: true });
        await expect(engine.handle('postgres.table.export', exportRequest('sql', '视图.sql',
          { ...viewSource, columns: ['c0'], exportToken: viewPage.exportToken }))).rejects.toThrow('只支持表的可插入列');
        await client.query(`CREATE OR REPLACE VIEW ${waiting} AS SELECT id, note FROM ${exportTable} WHERE id > 9007199254741058 ORDER BY id`);
        await expect(engine.handle('postgres.table.export', { ...finished, taskId: randomUUID() })).rejects.toThrow('结构已变化');
        expect(JSON.parse(await readFile(finished.filePath, 'utf8'))).toHaveLength(140);

        // 在另一套同名结构上实际执行 SQL 文件，核对精度、时区、类型文本及原子回放。
        const sqlTable = '"浏览"."SQL""原表"';
        const payload = "值'); DROP TABLE 不能执行; --\n\\字";
        await client.query(`CREATE TABLE ${sqlTable} (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text, amount numeric(40,18), raw bytea,
          stamp timestamptz, day date, elapsed interval, vals text[], data jsonb, f double precision, cash money,
          rel regclass, marker text, computed text GENERATED ALWAYS AS (coalesce(note, '空') || ':生成') STORED);
          INSERT INTO ${sqlTable} (id, note, amount, raw, stamp, day, elapsed, vals, data, f, cash, rel, marker)
          OVERRIDING SYSTEM VALUE SELECT i, CASE WHEN i=1 THEN NULL WHEN i=2 THEN '' ELSE '普通' END,
            1234567890123456789012.123456789012345678, decode('00ff','hex'), '2026-03-03 09:12:34.654321+05:30',
            '2026-02-03', '1 mon 2 days 00:00:00.123456', ARRAY['a;b', 'NULL', NULL, E'反\\\\斜杠'],
            '{"number":90071992547409931234}', CASE WHEN i=1 THEN '-0'::float8 WHEN i=2 THEN 'NaN'::float8 ELSE 1.0000000000000002::float8 END,
            1234.56::numeric::money, '"浏览"."导出表"'::regclass, CASE WHEN i<=67 THEN '保留%' ELSE '其它' END
            FROM generate_series(1, 68) AS i;`);
        await client.query(`UPDATE ${sqlTable} SET note = $1 WHERE id=3`, [payload]);
        const sqlSource = { ...source, table: sqlTable, tabId: randomUUID() };
        const selectExact = `SELECT id::text, note, amount::text, encode(raw,'hex') raw, stamp::text, day::text, elapsed::text,
          vals::text, data::text, encode(float8send(f),'hex') f, cash::numeric::text, rel::oid::text, marker, computed FROM ${sqlTable} src ORDER BY src.id`;
        const expectedSqlRows = (await client.query(selectExact)).rows.filter(row => row.marker.includes('保留%'));
        await client.query(`ALTER ROLE CURRENT_USER SET DateStyle TO 'SQL, DMY'; ALTER ROLE CURRENT_USER SET IntervalStyle TO 'iso_8601';
          ALTER ROLE CURRENT_USER SET TimeZone TO 'America/St_Johns'; ALTER ROLE CURRENT_USER SET search_path TO "浏览", pg_catalog;
          ALTER ROLE CURRENT_USER SET extra_float_digits TO 3;`);
        const outputSql = join(directory, '可还原.sql');
        try {
          const pageForSql = await read({ ...sqlSource, offset: 5, filter: { column: 'marker', text: '保留%' } });
          expect(pageForSql.columns[0]).toMatchObject({ name: 'id', identityAlways: true });
          const sqlExport = exportRequest('sql', '可还原.sql', { ...sqlSource, exportToken: pageForSql.exportToken,
            columns: pageForSql.columns.filter(column => column.name !== 'computed').map(column => column.key) });
          const computed = pageForSql.columns.find(column => column.name === 'computed')!;
          await expect(engine.handle('postgres.table.export', { ...sqlExport, taskId: randomUUID(), columns: [computed.key] })).rejects.toThrow('计算生成列');
          expect(await engine.handle('postgres.table.export', sqlExport)).toEqual({ rows: 67, fileCommitted: true });
          await client.query('ALTER ROLE CURRENT_USER SET extra_float_digits TO 0');
          await expect(engine.handle('postgres.table.export', { ...sqlExport, taskId: randomUUID() })).rejects.toThrow('extra_float_digits');
        } finally {
          await client.query(`ALTER ROLE CURRENT_USER RESET DateStyle; ALTER ROLE CURRENT_USER RESET IntervalStyle;
            ALTER ROLE CURRENT_USER RESET TimeZone; ALTER ROLE CURRENT_USER RESET search_path; ALTER ROLE CURRENT_USER RESET extra_float_digits;`);
        }
        const script = await readFile(outputSql, 'utf8');
        expect(script).toContain('OVERRIDING SYSTEM VALUE');
        expect(script).toContain("E'SQL, DMY'");
        expect(script).not.toContain('"computed"');
        expect(script.match(/INSERT INTO "浏览"\."SQL""原表"/g)).toHaveLength(2);
        const restoreSettings = (await client.query(`SELECT current_setting('DateStyle') AS date, current_setting('TimeZone') AS tz`)).rows[0];
        await client.query(`ALTER TABLE ${sqlTable} RENAME TO sql_source_backup;
          CREATE TABLE ${sqlTable} (LIKE "浏览".sql_source_backup INCLUDING ALL);
          ALTER TABLE ${sqlTable} ADD CONSTRAINT late_restore_failure CHECK (id < 67);`);
        await expect(client.query(script)).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK');
        expect((await client.query(`SELECT count(*)::int n FROM ${sqlTable}`)).rows).toEqual([{ n: 0 }]);
        await client.query(`ALTER TABLE ${sqlTable} DROP CONSTRAINT late_restore_failure`);
        await client.query(script);
        expect((await client.query(`SELECT current_setting('DateStyle') AS date, current_setting('TimeZone') AS tz`)).rows[0]).toEqual(restoreSettings);
        const restored = (await client.query(selectExact)).rows;
        expect(restored).toHaveLength(expectedSqlRows.length);
        const mismatch = restored.flatMap((row, i) => Object.keys(row).filter(key => !Object.is(row[key], expectedSqlRows[i][key]))
          .map(key => ({ id: row.id, key, expected: expectedSqlRows[i][key], actual: row[key] })));
        if (mismatch.length) throw Error('SQL 回放值不一致：' + JSON.stringify(mismatch.slice(0, 4)));

        const partitionTable = '"浏览"."SQL分区"';
        await client.query(`CREATE TABLE ${partitionTable} (id int PRIMARY KEY, note text) PARTITION BY RANGE (id);
          CREATE TABLE "浏览".sql_leaf_a PARTITION OF ${partitionTable} FOR VALUES FROM (0) TO (10);
          CREATE TABLE "浏览".sql_leaf_b PARTITION OF ${partitionTable} FOR VALUES FROM (10) TO (20);
          INSERT INTO ${partitionTable} VALUES (1, '第一分区'), (11, '第二分区');`);
        const partitionSource = { ...source, table: partitionTable, tabId: randomUUID() };
        const partitionPage = await read(partitionSource);
        expect(partitionPage.relationKind).toBe('p');
        const partitionExport = exportRequest('sql', '分区.sql', { ...partitionSource, columns: ['c0', 'c1'], exportToken: partitionPage.exportToken });
        expect(await engine.handle('postgres.table.export', partitionExport)).toEqual({ rows: 2, fileCommitted: true });
        await client.query(`TRUNCATE TABLE ${partitionTable}`);
        await client.query(await readFile(partitionExport.filePath, 'utf8'));
        expect((await client.query(`SELECT p.id, p.note, c.relname FROM ${partitionTable} p
          JOIN pg_catalog.pg_class c ON c.oid = p.tableoid ORDER BY p.id`)).rows).toEqual([
          { id: 1, note: '第一分区', relname: 'sql_leaf_a' }, { id: 11, note: '第二分区', relname: 'sql_leaf_b' },
        ]);

        // 原生导入直接读取本地 UTF-8 字节，验证表头、手动映射和服务器回执。
        const importTarget = '"浏览"."导入""原表"';
        await client.query(`CREATE TABLE ${importTarget} (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          note text, amount numeric(40,18) CHECK (amount >= 0), raw bytea,
          derived text GENERATED ALWAYS AS (coalesce(note,'空') || '已生成') STORED);`);
        const importScope = { ...source, table: importTarget, tabId: randomUUID() };
        const importPath = join(directory, '待导入.csv');
        const exactAmount = '1234567890123456789012.123456789012345678';
        /** 每次文件与表页重新核准，回执只对应本次导入。 */
        const prepareImport = async (csv: string, columns = ['c1', 'c0', 'c2', 'c3'], scope = importScope, hasHeader = true) => {
          await writeFile(importPath, csv);
          const page = await read(scope);
          expect(page.canImport).toBe(true);
          const { source: copySource } = await inspectPostgresCopySource(importPath, ';', hasHeader);
          return { ...scope, profile, taskId: randomUUID(), fileToken: randomUUID(), pageToken: page.exportToken,
            source: copySource, columns };
        };
        const nativeData = '\uFEFF"含\n换行";编号;金额;字节\n;9007199254740994;' + exactAmount + ';\\x00ff\n' +
          '"";9007199254740995;2;\n' + '"多行;🙂\r\n""引号""\n\\.\n尾";9007199254740996;3;\\x0a\n';
        const csvImport = await prepareImport(nativeData);
        expect(csvImport.source.header).toEqual(['含\n换行', '编号', '金额', '字节']);
        expect((await inspectPostgresCopySource(importPath, ';')).sample.map(row => row[0]))
          .toEqual([null, '', '多行;🙂\r\n"引号"\n\\.\n尾']);
        expect(await engine.handle('postgres.table.import', csvImport)).toMatchObject({ outcome: 'committed', affected: 3 });
        const queryImported = `SELECT id::text, note, amount::text, encode(raw,'hex') AS raw, derived FROM ${importTarget} t ORDER BY t.id`;
        const imported = (await client.query(queryImported)).rows;
        expect(imported).toEqual([
          { id: '9007199254740994', note: null, amount: exactAmount, raw: '00ff', derived: '空已生成' },
          { id: '9007199254740995', note: '', amount: '2.000000000000000000', raw: null, derived: '已生成' },
          { id: '9007199254740996', note: '多行;🙂\r\n"引号"\n\\.\n尾', amount: '3.000000000000000000', raw: '0a', derived: '多行;🙂\r\n"引号"\n\\.\n尾已生成' },
        ]);
        await expect(engine.handle('postgres.table.import', { ...csvImport, taskId: randomUUID() })).rejects.toThrow('快照');
        const invalid = await prepareImport('id;amount\n44;4\n45;-1\n', ['c0', 'c2']);
        expect(await engine.handle('postgres.table.import', invalid)).toMatchObject({ outcome: 'rolledBack', affected: 0 });
        const changedFile = await prepareImport('id;note\n44;原文件\n', ['c0', 'c1']);
        await writeFile(importPath, 'id;note\n44;替换值\n');
        expect(await engine.handle('postgres.table.import', changedFile)).toMatchObject({ outcome: 'notSent', affected: 0 });
        const markerFile = await prepareImport('note\n已读\n\\.\n被截断\n', ['c1']);
        expect(await engine.handle('postgres.table.import', markerFile)).toMatchObject({ outcome: 'rolledBack', affected: 0,
          message: expect.stringContaining('反斜线') });
        expect((await client.query(queryImported)).rows).toEqual(imported);
        await client.query(`CREATE FUNCTION "浏览".wait_copy_insert() RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN IF NEW.id = 47 THEN PERFORM pg_advisory_xact_lock(75694); END IF; RETURN NEW; END; $body$;
          CREATE TRIGGER wait_copy_insert BEFORE INSERT ON ${importTarget} FOR EACH ROW EXECUTE FUNCTION "浏览".wait_copy_insert();`);
        const cancelled = await prepareImport('id;note\n46;前一行\n47;等待取消\n', ['c0', 'c1']);
        await client.query('SELECT pg_advisory_lock(75694)');
        const importing = engine.handle('postgres.table.import', cancelled);
        void importing.catch(() => {});
        try {
          await expect.poll(async () => (await client.query(`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE application_name='tabrelio' AND wait_event='advisory' AND query LIKE 'COPY % FROM STDIN%'`)).rows[0].n,
          { timeout: 5000 }).toBe(1);
          await engine.handle('query.cancel', { taskId: cancelled.taskId });
          expect(await importing).toMatchObject({ outcome: 'unknown', affected: 0 });
          expect((await client.query(queryImported)).rows).toEqual(imported);
        } finally { await client.query('SELECT pg_advisory_unlock(75694)'); await Promise.allSettled([importing]); }
        const changedTable = await prepareImport('id;note\n44;目标变化\n', ['c0', 'c1']);
        await client.query(`ALTER TABLE ${importTarget} ADD COLUMN changed text`);
        expect(await engine.handle('postgres.table.import', changedTable)).toMatchObject({ outcome: 'notSent', affected: 0 });
        const headerless = await prepareImport('\uFEFF"首条;🙂";9007199254741001\r\n;9007199254741002\r\n',
          ['c1', 'c0'], importScope, false);
        expect(headerless.source.header).toEqual(['第1列', '第2列']);
        expect((await inspectPostgresCopySource(importPath, ';', false)).sample)
          .toEqual([['首条;🙂', '9007199254741001'], [null, '9007199254741002']]);
        expect(await engine.handle('postgres.table.import', headerless)).toMatchObject({ outcome: 'committed', affected: 2 });
        expect((await client.query(queryImported)).rows.slice(3).map(row => [row.id, row.note]))
          .toEqual([['9007199254741001', '首条;🙂'], ['9007199254741002', null]]);
        const partitionImport = await prepareImport('id;note\n2;复制甲\n12;复制乙\n', ['c0', 'c1'], partitionSource);
        expect(await engine.handle('postgres.table.import', partitionImport)).toMatchObject({ outcome: 'committed', affected: 2 });
        expect((await client.query(`SELECT p.id, c.relname FROM ${partitionTable} p
          JOIN pg_catalog.pg_class c ON c.oid=p.tableoid WHERE p.id IN (2, 12) ORDER BY p.id`)).rows)
          .toEqual([{ id: 2, relname: 'sql_leaf_a' }, { id: 12, relname: 'sql_leaf_b' }]);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
