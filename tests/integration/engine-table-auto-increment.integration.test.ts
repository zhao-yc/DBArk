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
import type { TableAutoIncrementGetOutput, TableAutoIncrementPreviewOutput } from '../../src/shared/tableAutoIncrement';
import { assertTableAutoIncrementLiveTarget } from '../helpers/tableAutoIncrementTarget';
import { readTableAutoIncrementDefinition } from '../../src/engine/tableAutoIncrementSql';
import { tableAutoIncrementMdlProof, tableAutoIncrementMdlThread, tableAutoIncrementTaskUnfinished } from '../helpers/tableAutoIncrementMdl';

// 默认关闭；仅双显式开关允许实际访问，不读取本地凭据文件、不创建账号、不修改全局。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_AUTO_INCREMENT_TEST === '1';
const writablePort = ['13380', '13384', '13484'].includes(process.env.DBARK_TEST_PORT ?? '');
const database = 'dbark_auto_' + randomUUID().replaceAll('-', '').slice(0, 12);
const profile: ConnectionProfile = { id: randomUUID(), name: '下一自增值隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 0), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false;
const target = (table: string) => `${identifier(database)}.${identifier(table)}`;
async function sql(query: string) { return (await execute(observer!, query)).rows as Record<string, unknown>[]; }
async function ddl(table: string) { return String((await sql('SHOW CREATE TABLE ' + target(table)))[0]['Create Table']); }
async function get(table: string): Promise<TableAutoIncrementGetOutput> { return engine.handle('schema.tableAutoIncrement.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableAutoIncrementGetOutput, value: string): Promise<TableAutoIncrementPreviewOutput> { return engine.handle('schema.tableAutoIncrement.preview', { snapshotId: snapshot.snapshotId, value, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(next: TableAutoIncrementPreviewOutput, taskId = randomUUID(), revision = 1) { return engine.handle('schema.tableAutoIncrement.apply', { previewToken: next.previewToken, acknowledgements: next.requiredAcknowledgements, taskId, connectionRevision: revision }); }
/** 定义包含生成列、前缀索引、显式字符集、自增及注释，确认计数调整不重述整表。 */
async function create(name: string) { await sql(`CREATE TABLE ${target(name)}(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,g INT GENERATED ALWAYS AS(length(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='普通说明'`); }

describe.skipIf(!enabled)('表级下一自增值核心验收（显式单实例）', () => {
  beforeAll(async () => {
    assertTableAutoIncrementLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA }, profile);
    if (!profile.user) throw new Error('必须显式指定专用测试账号');
    observer = await connect(profile); if (observer.connection.threadId) tracer.ids.add(observer.connection.threadId);
    const status = await engine.handle('connections.open', { id: profile.id, profile });
    const facts = (await sql('SELECT @@hostname AS host,@@version_compile_os AS os,@@lower_case_table_names AS names'))[0];
    console.info(JSON.stringify({ 下一自增值准备: database, 版本: status.version, 方言: status.dialect, 端口: profile.port, 严格TLS: !!profile.tls?.enabled, ...facts }));
    if (writablePort && (status.dialect !== 'mysql' || !/^8\.(0|4)\./.test(status.version))) throw new Error('端口与预期MySQL8实例不符');
    if (writablePort) await sql('SET SESSION information_schema_stats_expiry = 0');
    await sql('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
  });
  it.skipIf(writablePort)('MySQL5.7及MariaDB保持只读，不宣称已有计数持久化语义等价', async () => {
    await create('readonly'); const before = await ddl('readonly'), snapshot = await get('readonly'); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.length).toBeGreaterThan(0);
    await expect(preview(snapshot, '9007199254740993')).rejects.toThrow(); expect(await ddl('readonly')).toBe(before);
  });
  it.skipIf(!writablePort)('精确2^53以上请求，预览零DDL，单属性上调且原列/键/行格式/数据保留', async () => {
    await create('complex'); await sql(`INSERT INTO ${target('complex')}(id,s) VALUES(7,'abc')`);
    const before = await ddl('complex'), rows = await sql('SELECT id,s,g FROM ' + target('complex')), snapshot = await get('complex');
    expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.autoIncrement).toBe('8'); expect(snapshot.column?.maximum).toBe('18446744073709551615');
    const next = await preview(snapshot, '9007199254740993'); expect(await ddl('complex')).toBe(before); expect(next.sql).toBe(`ALTER TABLE ${target('complex')} AUTO_INCREMENT = 9007199254740993;`);
    const result = await apply(next); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, structureVerified: true, counterState: 'matched', after: { value: '9007199254740993', tableId: snapshot.tableId } });
    const context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
    expect(readTableAutoIncrementDefinition(await ddl('complex'), context).preserved).toBe(readTableAutoIncrementDefinition(before, context).preserved);
    expect(await sql('SELECT id,s,g FROM ' + target('complex'))).toEqual(rows); await expect(apply(next)).rejects.toThrow('已失效或已使用');
  });
  it.skipIf(!writablePort)('没有自增列或已达整数上限时明确只读，不补列、不猜MAX或降低计数', async () => {
    await sql(`CREATE TABLE ${target('no_auto')}(id INT PRIMARY KEY) ENGINE=InnoDB`); expect((await get('no_auto')).writable).toBe(false);
    await sql(`CREATE TABLE ${target('tiny')}(id TINYINT NOT NULL AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB AUTO_INCREMENT=127`);
    const snapshot = await get('tiny'); expect(snapshot).toMatchObject({ writable: false, autoIncrement: '127', column: { maximum: '127' } });
    await expect(preview(snapshot, '128')).rejects.toThrow(); await expect(preview(snapshot, '126')).rejects.toThrow();
  });
  it.skipIf(!writablePort)('DML在预览后推进计数会拒绝旧预览，外部定义或连接修订变化同样拒绝', async () => {
    await create('dml'); const next = await preview(await get('dml'), '50'); await sql(`INSERT INTO ${target('dml')}(s) VALUES('外部写入')`);
    await expect(apply(next)).rejects.toThrow(); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    const changed = await preview(await get('dml'), '50'); await sql('ALTER TABLE ' + target('dml') + " COMMENT='外部定义'"); await expect(apply(changed)).rejects.toThrow('定义');
    const revision = await preview(await get('dml'), '50'); await expect(apply(revision, randomUUID(), 2)).rejects.toThrow('连接配置');
  });
  it.skipIf(!writablePort)('同定义DROP重建以原生TABLE_ID识别，不把相同DDL当同一物理表', async () => {
    await create('identity'); const before = await ddl('identity'), snapshot = await get('identity'), next = await preview(snapshot, '50');
    await sql('DROP TABLE ' + target('identity')); await sql(before.replace('CREATE TABLE `identity`', 'CREATE TABLE ' + target('identity')));
    expect(await ddl('identity')).toBe(before); const current = await get('identity'); expect(current.tableId).not.toBe(snapshot.tableId);
    await expect(apply(next)).rejects.toThrow('身份'); console.info(JSON.stringify({ 同定义重建: true, 原生编号之前: snapshot.tableId, 原生编号之后: current.tableId }));
  });
  it.skipIf(!writablePort)('ALTER等待真实MDL时取消，保留未知执行事实并核对目录，不重放', async () => {
    await create('cancelled'); const snapshot = await get('cancelled'), next = await preview(snapshot, '50'), taskId = randomUUID();
    await sql('START TRANSACTION'); await sql('SELECT * FROM ' + target('cancelled'));
    const pending = apply(next, taskId).catch(error => error);
    let mdlThreadId: number | undefined, mdlObserved = false;
    try {
      try {
        await vi.waitFor(async () => {
          expect(events.some(event => event.taskId === taskId && event.tableAutoIncrement?.ddlSubmitted)).toBe(true);
          expect(tableAutoIncrementTaskUnfinished(events, taskId), '本任务先结束，不能补记MDL等待').toBe(true);
          const rows = await sql('SHOW FULL PROCESSLIST');
          mdlThreadId = tableAutoIncrementMdlThread(rows, tracer.ids, observer!.connection.threadId, next.sql);
          expect(tableAutoIncrementTaskUnfinished(events, taskId), '查询期间本任务已结束，不能补记MDL等待').toBe(true);
          expect(mdlThreadId !== undefined, '必须实际观察本例唯一线程的完整SQL处于明确MDL等待').toBe(true);
          mdlObserved = true;
        }, { timeout: 15000 });
      } finally { console.info(JSON.stringify(tableAutoIncrementMdlProof(profile.port, taskId, mdlThreadId, mdlObserved))); }
      await engine.handle('query.cancel', { taskId }); expect(await pending).toBeInstanceOf(Error); expect(events.filter(event => event.taskId === taskId).at(-1)?.tableAutoIncrement).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    } finally { await sql('ROLLBACK'); await pending; }
    expect((await get('cancelled')).autoIncrement).toBe(snapshot.autoIncrement); await expect(apply(next)).rejects.toThrow('已失效或已使用');
  });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (observer && created) {
        await sql('ROLLBACK');
        const rows = await sql('SHOW FULL PROCESSLIST'), remaining = rows.filter(row => Number(row.Id) !== observer!.connection.threadId && (tracer.ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        expect(remaining).toHaveLength(0);
        if (!/^dbark_auto_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝清理非本轮隔离库');
        await sql('DROP DATABASE ' + identifier(database));
        console.info(JSON.stringify({ 已清理隔离库: database, 实际线程编号: [...tracer.ids], 残留线程: remaining.length }));
      }
    } finally { await observer?.close({ strict: true }); }
  });
});
