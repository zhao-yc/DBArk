import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
const tracer = vi.hoisted(() => ({ ids: new Set<number>() }));
/** 仅记录真实线程编号；建连、取消控制、驱动和关闭均使用生产实现。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { const managed = await actual.connect(...args); if (managed.connection.threadId) tracer.ids.add(managed.connection.threadId); return managed; } };
});
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableRenameGetOutput, TableRenamePreviewOutput } from '../../src/shared/tableRename';
import { assertTableRenameLiveTarget } from '../helpers/tableRenameTarget';

// 默认关闭；仅双显式开关允许实际访问，不读取本地凭据文件、不创建账号、不修改全局。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_RENAME_TEST === '1';
const writablePort = ['13380', '13384', '13484'].includes(process.env.DBARK_TEST_PORT ?? '');
const database = 'dbark_rename_' + randomUUID().replaceAll('-', '').slice(0, 12);
const profile: ConnectionProfile = { id: randomUUID(), name: '表重命名隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 0), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false;
const target = (table: string) => `${identifier(database)}.${identifier(table)}`;
async function sql(query: string) { return (await execute(observer!, query)).rows as Record<string, unknown>[]; }
async function ddl(table: string) { return String((await sql('SHOW CREATE TABLE ' + target(table)))[0]['Create Table']); }
async function get(table: string): Promise<TableRenameGetOutput> { return engine.handle('schema.tableRename.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableRenameGetOutput, newName: string): Promise<TableRenamePreviewOutput> { return engine.handle('schema.tableRename.preview', { snapshotId: snapshot.snapshotId, newName, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(next: TableRenamePreviewOutput, taskId = randomUUID(), revision = 1) { return engine.handle('schema.tableRename.apply', { previewToken: next.previewToken, acknowledgements: next.requiredAcknowledgements, taskId, connectionRevision: revision }); }
/** 定义包含生成列、前缀索引、显式字符集、自增及注释，确认重命名不重述整表。 */
async function create(name: string) { await sql(`CREATE TABLE ${target(name)}(id INT NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,g INT GENERATED ALWAYS AS(length(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='普通说明'`); }

describe.skipIf(!enabled)('同库表重命名核心验收（显式单实例）', () => {
  beforeAll(async () => {
    assertTableRenameLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA }, profile);
    if (!profile.user) throw new Error('必须显式指定专用测试账号');
    observer = await connect(profile); if (observer.connection.threadId) tracer.ids.add(observer.connection.threadId);
    const status = await engine.handle('connections.open', { id: profile.id, profile });
    const facts = (await sql('SELECT @@hostname AS host,@@version_compile_os AS os,@@lower_case_table_names AS names'))[0];
    console.info(JSON.stringify({ 表重命名准备: database, 版本: status.version, 方言: status.dialect, 端口: profile.port, 严格TLS: !!profile.tls?.enabled, ...facts }));
    if (writablePort && (status.dialect !== 'mysql' || !/^8\.(0|4)\./.test(status.version))) throw new Error('端口与预期MySQL8实例不符');
    await sql('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
  });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (observer && created) {
        await sql('ROLLBACK');
        const rows = await sql('SHOW FULL PROCESSLIST'), remaining = rows.filter(row => Number(row.Id) !== observer!.connection.threadId && (tracer.ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        expect(remaining).toHaveLength(0);
        if (!/^dbark_rename_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝清理非本轮隔离库');
        await sql('DROP DATABASE ' + identifier(database));
        console.info(JSON.stringify({ 已清理隔离库: database, 实际线程编号: [...tracer.ids], 残留线程: remaining.length }));
      }
    } finally { await observer?.close({ strict: true }); }
  });
  it.skipIf(writablePort)('5.7和MariaDB当前只读，明确拒绝预览且保留原表', async () => {
    await create('readonly'); const before = await ddl('readonly'), snapshot = await get('readonly'); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.join('')).toContain('首批');
    await expect(preview(snapshot, 'readonly_new')).rejects.toThrow(); expect(await ddl('readonly')).toBe(before);
  });
  it.skipIf(!writablePort)('完整定义与数据不变，只读预览零DDL，成功后相同物理ID且旧名消失', async () => {
    await create('complex'); await sql(`INSERT INTO ${target('complex')}(s) VALUES('保留数据'),('第二行')`);
    const before = await ddl('complex'), snapshot = await get('complex'); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const next = await preview(snapshot, 'complex_new'); expect(await ddl('complex')).toBe(before); expect(next.sql).toBe(`RENAME TABLE ${target('complex')} TO ${target('complex_new')};`);
    const result = await apply(next); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { tableId: snapshot.tableId } });
    expect(await ddl('complex_new')).toBe(before.replace('CREATE TABLE `complex`', 'CREATE TABLE `complex_new`'));
    expect((await sql('SELECT id,s,g FROM ' + target('complex_new') + ' ORDER BY id')).map(row => [String(row.id), row.s, String(row.g)])).toEqual([['1', '保留数据', '12'], ['2', '第二行', '9']]);
    await expect(ddl('complex')).rejects.toThrow(); await expect(apply(next)).rejects.toThrow('已失效或已使用');
  });
  it.skipIf(!writablePort)('真实同名对象在预览和执行前均拒绝，不覆盖或自动改名', async () => {
    await create('conflict'); await create('occupied'); const snapshot = await get('conflict'); await expect(preview(snapshot, 'occupied')).rejects.toThrow('占用');
    const next = await preview(snapshot, 'late_occupied'); await create('late_occupied'); await expect(apply(next)).rejects.toThrow('占用'); await expect(apply(next)).rejects.toThrow('已失效或已使用'); expect(await ddl('conflict')).toContain('CREATE TABLE `conflict`');
  });
  it.skipIf(!writablePort)('同定义DROP重建原生ID变化、外部定义变化和连接修订变化均拒绝旧令牌', async () => {
    await create('identity'); const snapshot = await get('identity'), next = await preview(snapshot, 'identity_new'), before = await ddl('identity');
    await sql('DROP TABLE ' + target('identity')); await sql(before.replace('CREATE TABLE `identity`', 'CREATE TABLE ' + target('identity')));
    expect(await ddl('identity')).toBe(before); const recreated = await get('identity'); expect(recreated.tableId).not.toBe(snapshot.tableId); await expect(apply(next)).rejects.toThrow('身份');
    const changed = await preview(recreated, 'identity_new'); await sql('ALTER TABLE ' + target('identity') + " COMMENT='外部修改'"); await expect(apply(changed)).rejects.toThrow('定义');
    const revision = await preview(await get('identity'), 'identity_new'); await expect(apply(revision, randomUUID(), 2)).rejects.toThrow('连接配置');
  });
  it.skipIf(!writablePort)('入向外键、视图引用和触发器目标仅可查看，不重构依赖', async () => {
    await create('parent'); await sql(`CREATE TABLE ${target('child')}(id INT PRIMARY KEY,pid INT,FOREIGN KEY(pid) REFERENCES ${target('parent')}(id)) ENGINE=InnoDB`);
    expect((await get('parent')).writable).toBe(false); expect((await get('child')).writable).toBe(false);
    await create('viewed'); await sql(`CREATE VIEW ${target('v')} AS SELECT id FROM ${target('viewed')}`); expect((await get('viewed')).writable).toBe(false);
    await create('triggered'); await sql(`CREATE TRIGGER ${target('tr')} BEFORE INSERT ON ${target('triggered')} FOR EACH ROW SET NEW.s='触发'`); expect((await get('triggered')).writable).toBe(false);
  });
  it.skipIf(!writablePort)('RENAME等待真实元数据锁时取消，记录未知执行事实并收尾，不重放', async () => {
    await create('cancelled'); const next = await preview(await get('cancelled'), 'cancelled_new'), taskId = randomUUID();
    await sql('START TRANSACTION'); await sql('SELECT * FROM ' + target('cancelled'));
    const pending = apply(next, taskId).catch(error => error);
    try {
      await vi.waitFor(() => expect(events.some(event => event.taskId === taskId && event.tableRename?.ddlSubmitted)).toBe(true), { timeout: 15000 });
      await engine.handle('query.cancel', { taskId }); expect(await pending).toBeInstanceOf(Error);
      expect(events.filter(event => event.taskId === taskId).at(-1)?.tableRename).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    } finally { await sql('ROLLBACK'); await pending; }
    expect(await ddl('cancelled')).toContain('CREATE TABLE `cancelled`'); await expect(ddl('cancelled_new')).rejects.toThrow(); await expect(apply(next)).rejects.toThrow('已失效或已使用');
  });
});
