import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import type { PostgresTableChange, PostgresTablePage, PostgresTablePreview } from '../../src/shared/postgresTable';

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
    } finally {
      await engine.closeAll();
      await client.end();
    }
  }, 60000);
});
