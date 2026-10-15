import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { IndexPatch } from '../../src/shared/tableIndexPatches';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';

// 双开关默认关闭；凭据由ROOT核对200服务器后注入，不读取本地凭据文件或启动任何Docker。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_SPECIAL_INDEX_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_special_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const profile: ConnectionProfile = { id: randomUUID(), name: '特殊索引独立验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false, mysql8 = false, version = '';
/** 独立观察连接直接检查服务器定义与数据，不以产品返回值代替实库结果。 */
async function sql(text: string): Promise<Record<string, unknown>[]> { return (await execute(observer!, text)).rows as Record<string, unknown>[]; }
async function get(table: string): Promise<TableIndexGetOutput> { return engine.handle('schema.indexes.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableIndexGetOutput, patches: IndexPatch[]): Promise<TableIndexPreviewOutput> { return engine.handle('schema.indexes.preview', { snapshotId: snapshot.snapshotId, patches, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(value: TableIndexPreviewOutput, taskId = randomUUID()) { return engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 }); }
/** 客户端只提交引用；FULLTEXT不带BTREE方向、前缀或解析器。 */
function add(snapshot: TableIndexGetOutput, kind: 'fulltext' | 'spatial', name: string, columns = [kind === 'fulltext' ? 'a' : 'g']): IndexPatch {
  return { op: 'add', clientKey: randomUUID(), definition: { name, kind, method: kind === 'fulltext' ? 'FULLTEXT' : 'RTREE', comment: '完整特殊索引', keyParts: columns.map(name => { const column = snapshot.columns.find(column => column.name === name); if (!column) throw new Error('缺少隔离夹具列'); return { columnRef: column.columnRef, direction: 'asc' }; }) } };
}
/** 每例独立表，仅复用本轮随机数据库；不改业务表或全局服务器配置。 */
async function fixture(table: string): Promise<void> {
  await sql(`CREATE TABLE ${qualified(database, table)} (id INT NOT NULL,a TEXT,b TEXT,g POINT NOT NULL${mysql8 ? ' SRID 0' : ''},PRIMARY KEY(id),KEY keep_id(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  await sql(`INSERT INTO ${qualified(database, table)} VALUES (1,'alpha searchword','beta searchword',ST_GeomFromText('POINT(1 2)',0)),(2,'gamma searchword','delta searchword',ST_GeomFromText('POINT(3 4)',0))`);
}
async function release(snapshot: TableIndexGetOutput): Promise<void> { await engine.handle('schema.indexes.release', { snapshotId: snapshot.snapshotId }); }

describe.skipIf(!enabled)('特殊索引实库准备（须ROOT明确开启）', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version; mysql8 = /^8\./.test(version) && !/mariadb/i.test(version);
    observer = await connect(profile); await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true;
    const facts = (await sql('SELECT @@version_compile_os AS compileOs,@@lower_case_table_names AS lowerCaseTableNames,@@innodb_page_size AS pageSize'))[0];
    console.info(JSON.stringify({ 验收库: database, 版本: version, ...facts, SSH: !!profile.ssh?.enabled, 严格TLS: !!profile.tls?.enabled }));
  });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (observer && created) {
        // Hook使用vi.waitFor，不能在测试外调用expect.poll；残留连接未清空时保留随机库。
        await vi.waitFor(async () => {
          const remaining = (await sql('SHOW FULL PROCESSLIST')).filter(row => Number(row.Id) !== observer!.connection.threadId && (row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
          expect(remaining.map(row => row.Id)).toEqual([]);
        }, { timeout: 12000, interval: 100 });
        await sql(`DROP DATABASE ${identifier(database)}`); console.info(JSON.stringify({ 已清理验收库: database, 残留线程: 0 }));
      }
    } finally { await observer?.close({ strict: true }); }
  });
  it('读取实际版本与字段能力；已有BTREE保留独立方法', async () => {
    await fixture('facts'); const snapshot = await get('facts');
    expect(snapshot.writable).toBe(true); expect(snapshot.capabilities?.specialIndexes).toEqual({ fulltext: true, spatial: true, spatialRequiresSrid: mysql8 });
    expect(snapshot.columns.find(c => c.name === 'a')?.specialIndexes?.fulltext.allowed).toBe(true); expect(snapshot.columns.find(c => c.name === 'g')?.specialIndexes?.spatial.allowed).toBe(true);
    expect(snapshot.indexes.every(index => index.editableDefinition?.method === 'BTREE')).toBe(true); await release(snapshot);
  });
  it.each(['fulltext', 'spatial'] as const)('%s预览、增加、独立目录核验、删除与令牌不重放', async kind => {
    const table = `cycle_${kind}`; await fixture(table); const snapshot = await get(table), initial = (await sql(`SHOW CREATE TABLE ${qualified(database, table)}`))[0]['Create Table'];
    const value = await preview(snapshot, [add(snapshot, kind, 'special', kind === 'fulltext' ? ['a', 'b'] : ['g'])]);
    expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'special-index-change']); expect(value.sql).not.toMatch(/USING BTREE|\bASC\b|\bDESC\b/);
    expect((await sql(`SHOW CREATE TABLE ${qualified(database, table)}`))[0]['Create Table']).toBe(initial);
    expect(await apply(value)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); await expect(apply(value)).rejects.toThrow('已失效或已使用');
    const rows = (await sql(`SHOW INDEX FROM ${qualified(database, table)}`)).filter(row => row.Key_name === 'special');
    expect(rows.map(row => row.Column_name)).toEqual(kind === 'fulltext' ? ['a', 'b'] : ['g']);
    for (const row of rows) expect(row).toMatchObject({ Non_unique: 1, Index_type: kind === 'fulltext' ? 'FULLTEXT' : 'SPATIAL', Index_comment: '完整特殊索引' });
    if (kind === 'fulltext') expect(String((await sql(`SELECT COUNT(*) AS n FROM ${qualified(database, table)} WHERE MATCH(a,b) AGAINST('searchword')`))[0].n)).toBe('2');
    else expect(String((await sql(`SELECT COUNT(*) AS n FROM ${qualified(database, table)} WHERE MBRContains(ST_GeomFromText('POLYGON((0 0,5 0,5 5,0 5,0 0))',0),g)`))[0].n)).toBe('2');
    const next = await get(table), old = next.indexes.find(index => index.name === 'special')!;
    expect(old.access).toMatchObject({ drop: { allowed: true }, rename: { allowed: false }, replace: { allowed: false } });
    await expect(preview(next, [{ op: 'alter', indexRef: old.indexRef, changes: { name: 'not_supported' } }])).rejects.toThrow('仅新增');
    const deletion = await preview(next, [{ op: 'drop', indexRef: old.indexRef }]); expect(deletion.requiredAcknowledgements).not.toContain('drop-unique-constraint'); expect(await apply(deletion)).toMatchObject({ definitionVerified: true });
    const final = (await sql(`SHOW INDEX FROM ${qualified(database, table)}`)).map(row => row.Key_name); expect(final).toEqual(['PRIMARY', 'keep_id']);
    expect(await sql(`SELECT id,a,b,ST_AsText(g) AS g FROM ${qualified(database, table)} ORDER BY id`)).toEqual([{ id: 1, a: 'alpha searchword', b: 'beta searchword', g: 'POINT(1 2)' }, { id: 2, a: 'gamma searchword', b: 'delta searchword', g: 'POINT(3 4)' }]);
  }, 120000);
  it('独立DDL使旧摘要失效，产品不再投递旧计划', async () => {
    await fixture('stale'); const snapshot = await get('stale'), value = await preview(snapshot, [add(snapshot, 'fulltext', 'ft')]);
    await sql(`ALTER TABLE ${qualified(database, 'stale')} COMMENT='独立修改'`); const taskId = randomUUID(); await expect(apply(value, taskId)).rejects.toThrow('变化');
    expect(events.filter(event => event.taskId === taskId).at(-1)?.indexPatch).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
    expect((await sql(`SHOW INDEX FROM ${qualified(database, 'stale')}`)).some(row => row.Key_name === 'ft')).toBe(false); await expect(apply(value)).rejects.toThrow('已失效或已使用');
  });
  it('可空空间字段及不兼容全文字符集在预览前拒绝，不替用户修改列', async () => {
    await sql(`CREATE TABLE ${qualified(database, 'invalid')} (id INT NOT NULL,a TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,b TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,g GEOMETRY,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    const snapshot = await get('invalid'), initial = snapshot.ddlHash;
    await expect(preview(snapshot, [add(snapshot, 'spatial', 'bad_space')])).rejects.toThrow(); await expect(preview(snapshot, [add(snapshot, 'fulltext', 'bad_text', ['a', 'b'])])).rejects.toThrow('相同');
    expect((await get('invalid')).ddlHash).toBe(initial);
  });
  it.each(['fulltext', 'spatial'] as const)('%s等待DDL锁时取消，真实释放后不重放', async kind => {
    const table = `cancel_${kind}`; await fixture(table); const snapshot = await get(table), value = await preview(snapshot, [add(snapshot, kind, 'cancelled_index')]);
    await sql(`LOCK TABLES ${qualified(database, table)} READ`); const taskId = randomUUID(), pending = apply(value, taskId).catch(error => error);
    try {
      await expect.poll(async () => (await sql('SHOW FULL PROCESSLIST')).some(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(database) && /metadata lock/i.test(String(row.State))), { timeout: 12000, interval: 100 }).toBe(true);
      await engine.handle('query.cancel', { taskId }); expect(await pending).toBeInstanceOf(Error);
    } finally {
      await sql('UNLOCK TABLES'); await engine.handle('query.cancel', { taskId }); await pending;
    }
    expect(events.filter(event => event.taskId === taskId).at(-1)).toMatchObject({ status: 'cancelled', indexPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect((await get(table)).indexes.some(index => index.name === 'cancelled_index')).toBe(false); await expect(apply(value)).rejects.toThrow('已失效或已使用');
  }, 60000);
});
