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
import type { PostgresTableChange, PostgresTableExportInput, PostgresTablePage, PostgresTablePreview } from '../../src/shared/postgresTable';
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
      expect((await read({ offset: 2 })).rows.map(row => row.c0)).toEqual(['3']);
      expect((await read({ sort: { column: 'id', direction: 'desc' } })).rows.map(row => row.c0)).toEqual(['3', '2']);
      expect((await read({ filter: { column: 'note', text: "原三';--" } })).rows).toEqual([]);
      expect((await read({ filter: { column: 'note', text: '原三' } })).rows.map(row => row.c0)).toEqual(['3']);
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
      await expect(read({ filter: { mode: 'all', rules: [{ column: 'id', operator: '1=1; DROP TABLE t', value: '1' }] } })).rejects.toThrow('操作符');
      const view = await read({ table: '"浏览"."只读"', tabId: randomUUID() });
      expect(view).toMatchObject({ relationKind: 'v', capabilities: { insert: false, update: false, delete: false } });
      expect(view.pageToken).toBeUndefined();
      const current = await read();
      await expect(preview(first, [{ kind: 'delete', row: 0 }])).rejects.toThrow('快照');
      await expect(preview(current, [{ kind: 'delete', row: 0 }], { owner: randomUUID() })).rejects.toThrow('快照');
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
      const revisited = await crossPage(0, [pin(a), pin(b)]);
      expect(revisited.rowKeys).toEqual(a.rowKeys);
      expect(b.rowKeys).not.toEqual(a.rowKeys);
      const update = (page: PostgresTablePage, note: string): PostgresTableChange =>
        ({ kind: 'update', pageToken: pin(page), row: 0, fields: [field('c1', note)] });
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
      const rollbackA = await crossPage(0);
      const rollbackB = await crossPage(1, [pin(rollbackA)]);
      const multiRollback = await preview(rollbackB, [update(rollbackA, '应回滚'), update(rollbackB, '拒绝')], cross);
      expect(await apply(rollbackB, multiRollback, cross)).toMatchObject({ outcome: 'rolledBack', affected: 0 });
      expect(await crossRows()).toEqual([{ id: '1', note: '已改甲' }, { id: '2', note: '外部变动' }, { id: '3', note: '原丙' }]);

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
