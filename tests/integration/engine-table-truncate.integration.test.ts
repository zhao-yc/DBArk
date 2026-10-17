import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine as EngineType } from '../../src/engine';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableTruncateGetOutput, TableTruncatePreviewOutput } from '../../src/shared/tableTruncate';
import { assertTableTruncateLiveTarget } from '../helpers/tableTruncateTarget';
import { tableAutoIncrementMdlThread } from '../helpers/tableAutoIncrementMdl';

const tracer = vi.hoisted(() => ({ ids: new Set<number>() }));
/** 只记录真实线程编号，默认关闭时不求值生产连接模块。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { const value = await actual.connect(...args); if (value.connection.threadId) tracer.ids.add(value.connection.threadId); return value; } };
});
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_TRUNCATE_TEST === '1';
const database = 'dbark_truncate_' + randomUUID().replaceAll('-', '').slice(0, 12);
let engine: EngineType | undefined, observer: ManagedConnection | undefined, created = false;
let execute: typeof import('../../src/engine/connection')['execute'];
const events: TaskEvent[] = [], pending = new Set<Promise<unknown>>();
const target = (table: string) => `\`${database}\`.\`${table}\``;
async function sql(source: string) { return (await execute(observer!, source)).rows as Record<string, unknown>[]; }
async function get(table: string): Promise<TableTruncateGetOutput> { return engine!.handle('schema.tableTruncate.get', { connectionId: 'truncate-live', database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableTruncateGetOutput): Promise<TableTruncatePreviewOutput> { return engine!.handle('schema.tableTruncate.preview', { snapshotId: snapshot.snapshotId, taskId: randomUUID(), connectionRevision: 1 }); }
/** 准备独立正式用例表；任何数据写入都局限本轮随机隔离库。 */
async function create(table: string) { await sql(`CREATE TABLE ${target(table)}(id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,s VARCHAR(80) DEFAULT NULL) ENGINE=InnoDB AUTO_INCREMENT=20 COMMENT='隔离清空测试'`); await sql(`INSERT INTO ${target(table)}(s) VALUES('合成数据'),('合成数据2')`); }
/** 不缓存失败回放，跟踪尚未收到终态的实际apply，未终态时禁止清库。 */
function apply(next: TableTruncatePreviewOutput, table: string, taskId = randomUUID(), confirmation = `${database}.${table}`) {
  const request = engine!.handle('schema.tableTruncate.apply', { previewToken: next.previewToken, confirmation, acknowledgements: next.requiredAcknowledgements, taskId, connectionRevision: 1 });
  pending.add(request); void request.then(() => pending.delete(request), () => pending.delete(request)); return request;
}

describe.skipIf(!enabled)('单表清空正式核心定义（默认关闭，员工3实际0）', () => {
  beforeAll(async () => {
    const profile: ConnectionProfile = { id: 'truncate-live', name: '隔离清空', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 0), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
    assertTableTruncateLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA }, profile);
    if (!profile.user) throw Error('必须显式提供本次专用测试账号');
    // 双开关、目标门通过后才导入实际引擎/驱动，不读取凭据文件。
    const modules = await Promise.all([import('../../src/engine'), import('../../src/engine/connection')]);
    execute = modules[1].execute; observer = await modules[1].connect(profile); if (observer.connection.threadId) tracer.ids.add(observer.connection.threadId);
    engine = new modules[0].Engine(event => events.push(event)); const status = await engine.handle('connections.open', { id: profile.id, profile });
    if (status.dialect !== 'mysql' || !/^8\.4\.11(?:[-+].*)?$/.test(status.version)) throw Error('实库版本与本片8.4.11不符，拒绝继续');
    const facts = (await sql('SELECT @@version_compile_os AS os,@@lower_case_table_names AS names'))[0];
    if (!['linux', 'debian-linux-gnu'].includes(String(facts.os).toLowerCase()) || Number(facts.names) !== 0) throw Error('实库物理名称映射未证明');
    await sql('SET SESSION information_schema_stats_expiry = 0'); await sql('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
  });
  it('预览零数据变更；单次清空后空表、计数重置和下一条插入从1开始', async () => {
    await create('basic'); const before = await sql('SELECT id,s FROM ' + target('basic')), next = await preview(await get('basic'));
    expect(await sql('SELECT id,s FROM ' + target('basic'))).toEqual(before); expect(next.sql).toBe('TRUNCATE TABLE ' + target('basic') + ';');
    expect(await apply(next, 'basic')).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { emptyObserved: true, autoIncrement: '1' } });
    expect(await sql('SELECT id,s FROM ' + target('basic'))).toHaveLength(0); await expect(apply(next, 'basic')).rejects.toThrow('已失效或已使用');
    await sql('INSERT INTO ' + target('basic') + "(s) VALUES('重置后')"); expect(String((await sql('SELECT id FROM ' + target('basic')))[0].id)).toBe('1');
  });
  it('入向FK只读、同名DROP重建拒绝、错误确认零数据变化', async () => {
    await create('parent'); await sql(`CREATE TABLE ${target('child')}(id BIGINT PRIMARY KEY,p BIGINT,FOREIGN KEY(p) REFERENCES ${target('parent')}(id)) ENGINE=InnoDB`);
    const blocked = await get('parent'); expect(blocked.writable).toBe(false); await expect(preview(blocked)).rejects.toThrow();
    await create('identity'); const ddl = String((await sql('SHOW CREATE TABLE ' + target('identity')))[0]['Create Table']), stale = await preview(await get('identity'));
    await sql('DROP TABLE ' + target('identity')); await sql(ddl.replace('CREATE TABLE `identity`', 'CREATE TABLE ' + target('identity'))); await expect(apply(stale, 'identity')).rejects.toThrow();
    await create('confirmation'); const rows = await sql('SELECT id,s FROM ' + target('confirmation')), next = await preview(await get('confirmation'));
    await expect(apply(next, 'confirmation', randomUUID(), database + '.confirmation ')).rejects.toThrow('完全一致'); expect(await sql('SELECT id,s FROM ' + target('confirmation'))).toEqual(rows);
  });
  it('真实MDL等待时取消，终态保留未知且原数据不变，旧token不重放', async () => {
    await create('cancelled'); const next = await preview(await get('cancelled')), taskId = randomUUID(), before = await sql('SELECT id,s FROM ' + target('cancelled'));
    await sql('START TRANSACTION'); await sql('SELECT * FROM ' + target('cancelled')); let settled = false;
    const request = apply(next, 'cancelled', taskId).then(value => { settled = true; return value; }, error => { settled = true; return error; });
    const unfinished = () => !events.some(event => event.taskId === taskId && (event.tableTruncate?.ddlCompleted || ['completed', 'failed', 'cancelled'].includes(event.status)));
    try {
      await vi.waitFor(async () => {
        expect(events.some(event => event.taskId === taskId && event.tableTruncate?.ddlSubmitted)).toBe(true);
        expect(unfinished()).toBe(true);
        const thread = tableAutoIncrementMdlThread(await sql('SHOW FULL PROCESSLIST'), tracer.ids, observer!.connection.threadId, next.sql); expect(thread).toBeDefined();
        expect(unfinished()).toBe(true);
      }, { timeout: 15000 });
      await engine!.handle('query.cancel', { taskId }); expect(await request).toBeInstanceOf(Error);
      expect(events.filter(event => event.taskId === taskId).at(-1)?.tableTruncate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
      expect(await sql('SELECT id,s FROM ' + target('cancelled'))).toEqual(before); await expect(apply(next, 'cancelled')).rejects.toThrow('已失效或已使用');
    } finally {
      // 观察失败也先等待本任务取消终态，不能先释放MDL让旧清空继续发送。
      if (!settled) { await engine!.handle('query.cancel', { taskId }); await request; }
      await sql('ROLLBACK');
    }
  });
  afterAll(async () => {
    if (pending.size) throw Error('尚有实际清空任务未终态，保留隔离库；禁止清库或归零');
    await engine?.closeAll();
    try {
      if (observer && created) {
        const remaining = (await sql('SHOW FULL PROCESSLIST')).filter(row => Number(row.Id) !== observer!.connection.threadId && (tracer.ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        expect(remaining).toHaveLength(0); if (!/^dbark_truncate_[a-f0-9]{12}$/.test(database)) throw Error('拒绝清理非本例隔离库');
        await sql('DROP DATABASE `' + database + '`'); expect(await sql("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='" + database + "'")).toHaveLength(0);
      }
    } finally { await observer?.close({ strict: true }); }
  });
});
