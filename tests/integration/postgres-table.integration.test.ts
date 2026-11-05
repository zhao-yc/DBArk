import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresTableChange, PostgresTableExportInput, PostgresTablePage, PostgresTablePreview } from '../../src/shared/postgresTable';
import { listExcelSheets, readExcelRows } from '../../src/engine/excelFiles';

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
      const view = await read({ table: '"浏览"."只读"', tabId: randomUUID() });
      expect(view).toMatchObject({ relationKind: 'v', capabilities: { insert: false, update: false, delete: false } });
      expect(view.pageToken).toBeUndefined();
      const current = await read();
      await expect(preview(first, [{ kind: 'delete', row: 0 }])).rejects.toThrow('快照');
      await expect(preview(current, [{ kind: 'delete', row: 0 }], { owner: randomUUID() })).rejects.toThrow('快照');
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
        await client.query(`CREATE OR REPLACE VIEW ${waiting} AS SELECT id, note FROM ${exportTable} WHERE id > 9007199254741058 ORDER BY id`);
        await expect(engine.handle('postgres.table.export', { ...finished, taskId: randomUUID() })).rejects.toThrow('结构已变化');
        expect(JSON.parse(await readFile(finished.filePath, 'utf8'))).toHaveLength(140);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
