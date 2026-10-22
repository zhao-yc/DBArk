import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { ColumnPatch, TableColumnApplyOutput, TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import { bindGeneratedColumnTarget, generatedColumnIntegrationGate, generatedColumnLifetime, loadGeneratedColumnModules, assertGeneratedColumnIdentity, watchGeneratedColumnConnection, assertGeneratedColumnReleased, closeGeneratedColumnObserver, type GeneratedColumnConnectionFact, type GeneratedColumnLifetime } from '../helpers/generatedColumnIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 旁观原connect和实际协议，不注入Engine、SQL或服务器结果。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('生成列连接没有本轮原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

let lifetime: GeneratedColumnLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('新增数值生成列六实例实库（逐端口独立进程）', () => {
  it('VIRTUAL与STORED单次新增、原精度保持、后续写入计算、过期拒绝及原资源收尾', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[generatedColumnIntegrationGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('生成列原验收仍保留现场，不自动重跑');
    const binding = bindGeneratedColumnTarget(() => process.env, 'generated-' + context.task.id);
    const owner = lifetime = generatedColumnLifetime(context, binding, () => { retained = true; });
    const facts: GeneratedColumnConnectionFact[] = [], events: TaskEvent[] = []; let allowedSql: string | undefined;
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchGeneratedColumnConnection(managed, scope, owner, () => allowedSql)); };
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent';
    try {
      const { engine: engineModule, connection } = await owner.step(loadGeneratedColumnModules);
      const [quote, crypto] = await owner.step(() => Promise.all([import('../../src/engine/sql'), import('node:crypto')]));
      database = 'dbark_generated_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-generated-owner:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_generated_[a-f0-9]{32}$/.test(database)) throw Error('生成列资源计划无效');
      process.stdout.write(JSON.stringify({ 专项: '新增数值生成列', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port }) + '\n');
      const db = quote.identifier(database), table = db + '.`subject`';
      /** 同一原observer承担所有观察和夹具动作，不在未知状态后新连恢复。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertGeneratedColumnIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId;
      if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('生成列observer原线程未知');
      engine = new engineModule.Engine(event => events.push(event));
      /** 完整等待原操作及其原流close；失败的操作不重放。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        const scope = crypto.randomUUID(); audit.scope = scope; allowedSql = expectedSql; const count = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(count); for (const fact of actual) await owner.step(() => fact.closed);
        assertGeneratedColumnReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      created = 'unknown'; const create = await sql<{ warningStatus: number }>(`CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); expect(create.warningStatus).toBe(0); created = 'confirmed';
      await sql(`CREATE TABLE ${table}(id BIGINT UNSIGNED NOT NULL PRIMARY KEY,qty INT,unit_price DECIMAL(35,30),signed_value BIGINT,amount DECIMAL(65,30),happened DATETIME(6),clock_value TIME(6),note TEXT,payload BLOB) ENGINE=InnoDB COMMENT='${marker}'`);
      const insert = await sql<{ affectedRows: number; warningStatus: number }>(`INSERT INTO ${table} VALUES(18446744073709551615,2,10.123456789012345678901234567890,-9223372036854775808,-12345678901234567890123456789012345.123456789012345678901234567890,'2026-10-22 01:02:03.123456','-12:34:56.654321',?,?),(9007199254740993,-2,0.000000000000000000000000000001,9007199254740993,0.000000000000000000000000000001,'2026-10-22 23:59:59.999999','12:34:56.000001',?,?),(2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, ["中文😀'\"\\\0\r\n", Buffer.from('00ff805c27', 'hex'), '', Buffer.alloc(0)]);
      expect(insert.affectedRows).toBe(3); expect(insert.warningStatus).toBe(0);
      const definition = async () => String((await sql(`SHOW CREATE TABLE ${table}`))[0]['Create Table']);
      const columns = async () => sql('SELECT COLUMN_NAME,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, 'subject']);
      const rows = async () => sql(`SELECT CAST(id AS CHAR) AS id,CAST(signed_value AS CHAR) AS signed_value,CAST(amount AS CHAR) AS amount,CAST(happened AS CHAR) AS happened,CAST(clock_value AS CHAR) AS clock_value,HEX(note) AS note,HEX(payload) AS payload FROM ${table} ORDER BY subject.id`);
      const beforeColumns = await columns(), beforeRows = await rows(); expect(beforeRows.map(row => row.id)).toEqual(['2', '9007199254740993', '18446744073709551615']);
      expect(beforeRows[2]).toMatchObject({ signed_value: '-9223372036854775808', amount: '-12345678901234567890123456789012345.123456789012345678901234567890', happened: '2026-10-22 01:02:03.123456', clock_value: '-12:34:56.654321', note: Buffer.from("中文😀'\"\\\0\r\n").toString('hex').toUpperCase(), payload: '00FF805C27' });
      const get = async () => { const result = await invoke<TableColumnGetOutput>('schema.columns.get', { connectionId: binding.profile.id, database, table: 'subject', taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); return result.value!; };
      const preview = async (snapshot: TableColumnGetOutput, patches: ColumnPatch[]) => invoke<TableColumnPreviewOutput>('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = async (value: TableColumnPreviewOutput, allowWrite: boolean) => invoke<TableColumnApplyOutput>('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, allowWrite ? value.sql : undefined);
      // VIRTUAL明确覆盖服务器会丢弃的一元正号；不能只以RAM原样回显表达式冒称SHOW后核通过。
      const patch = (storage: 'VIRTUAL' | 'STORED', name: string): ColumnPatch => ({ kind: 'add', clientKey: crypto.randomUUID(), name, type: { kind: 'decimal', precision: 65, scale: 30, unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '数值生成列', position: { kind: 'last' }, generated: { storage, expression: (storage === 'VIRTUAL' ? '+(`qty` * `unit_price`)' : '(`qty` * `unit_price`)') + ' + 0.000000000000000000000000000001' } });
      const operations = [];
      for (const [storage, name] of [['VIRTUAL', 'virtual_total'], ['STORED', 'stored_total']] as const) {
        const snapshot = await get();
        if (snapshot.generatedAccess?.editable !== true) process.stdout.write(JSON.stringify({ 专项: '新增数值生成列', 阶段: '能力拒绝现场', 数据库: database, storage, capability: snapshot.generatedAccess, columns: await columns(), definition: await definition() }) + '\n');
        expect(snapshot.generatedAccess?.editable, snapshot.warnings.join('；')).toBe(true);
        expect(snapshot.columns.find(column => column.name === 'qty')?.generatedReference).toBe(true);
        const originalDefinition = await definition(), next = await preview(snapshot, [patch(storage, name)]); expect(next.error).toBeUndefined(); const plan = next.value!;
        expect(plan.sql).toContain('GENERATED ALWAYS AS'); expect(plan.sql).toContain(storage); expect(plan.requiredAcknowledgements).toContain('generated-column-computation');
        expect(next.facts.flatMap(fact => fact.writes)).toHaveLength(0); expect(await definition()).toBe(originalDefinition); expect(await rows()).toEqual(beforeRows);
        const applied = await apply(plan, true); expect(applied.error).toBeUndefined(); expect(applied.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(applied.facts.flatMap(fact => fact.writes)).toEqual([plan.sql]);
        expect((await columns()).slice(0, beforeColumns.length)).toEqual(beforeColumns); expect(await rows()).toEqual(beforeRows);
        expect(await sql(`SELECT CAST(${quote.identifier(name)} AS CHAR) AS value FROM ${table} ORDER BY id`)).toEqual([{ value: null }, { value: '-0.000000000000000000000000000001' }, { value: '20.246913578024691357802469135781' }]);
        const duplicate = await apply(plan, false); expect(duplicate.error).toBeInstanceOf(Error); expect(duplicate.facts).toHaveLength(0);
        operations.push({ storage, ddlCount: applied.facts.flatMap(fact => fact.writes).length, verified: applied.value!.definitionVerified });
      }
      const updated = await sql<{ affectedRows: number; warningStatus: number }>(`UPDATE ${table} SET qty=3 WHERE id=18446744073709551615`); expect(updated.affectedRows).toBe(1); expect(updated.warningStatus).toBe(0);
      expect(await sql(`SELECT CAST(virtual_total AS CHAR) AS virtual,CAST(stored_total AS CHAR) AS stored FROM ${table} WHERE id=18446744073709551615`)).toEqual([{ virtual: '30.370370367037037036703703703671', stored: '30.370370367037037036703703703671' }]); expect(await rows()).toEqual(beforeRows);
      // 同名原定义发生外部变化后，不允许旧计划投递任何ALTER。
      const stale = await preview(await get(), [patch('VIRTUAL', 'stale_total')]); expect(stale.error).toBeUndefined(); await sql(`ALTER TABLE ${table} COMMENT='${marker}:changed'`);
      const refused = await apply(stale.value!, false); expect(refused.error).toBeInstanceOf(Error); expect(refused.facts.flatMap(fact => fact.writes)).toHaveLength(0);
      expect((await columns()).map(column => column.COLUMN_NAME)).not.toContain('stale_total');
      process.stdout.write(JSON.stringify({ 专项: '新增数值生成列', 数据库: database, 端口: binding.profile.port, 版本: observer.status.version, 方言: observer.status.dialect, 严格TLS: !!binding.profile.tls?.enabled, operations, 原精度字节保持: true, 后续更新计算: true, 外部DDL拒绝: true, 限权取消: '本轮未验' }) + '\n');
      await owner.step(() => engine!.closeAll()); const taskFacts = facts.filter(fact => fact.scope !== 'observer'); assertGeneratedColumnReleased(taskFacts, false);
      const taskIds = [...new Set(taskFacts.map(fact => fact.id))]; if (taskIds.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${taskIds.join(',')})`)).toHaveLength(0);
      expect(await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY TABLE_NAME', [database])).toEqual([{ name: 'subject', marker: marker + ':changed', kind: 'BASE TABLE' }]);
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [database])).toHaveLength(0);
      if (created !== 'confirmed' || !/^dbark_generated_[a-f0-9]{32}$/.test(database)) throw Error('生成列资源归属未证明，拒绝清理');
      await sql('DROP DATABASE ' + db); created = 'absent'; expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      await owner.step(() => closeGeneratedColumnObserver(observer!)); assertGeneratedColumnReleased(facts, false);
      owner.finish(); complete = true; audit.watch = undefined; audit.check = undefined; audit.scope = '';
      process.stdout.write(JSON.stringify({ 专项: '新增数值生成列', 端口: binding.profile.port, 已清理数据库: database, 数据库残留: 0, 已关闭原生线程数: facts.length, 原任务线程残留: 0, observer原线程: observerId, 实际事件数: events.length }) + '\n');
    } catch (reason) {
      owner.stop(); retained = true;
      process.stdout.write(JSON.stringify({ 专项: '新增数值生成列', 保留现场: true, 数据库: database, 数据库状态: created, 已取得原生线程: facts.map(fact => ({ id: fact.id, pending: fact.pending, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })) }) + '\n'); throw reason;
    } finally {
      if (!complete && observer) try { await observer.close({ strict: true }); } catch { /* 保留首因和原资源事实，不新连补救或重放。 */ }
    }
  });
});
