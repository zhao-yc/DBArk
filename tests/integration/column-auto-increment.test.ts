import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { ColumnPatch, TableColumnApplyOutput, TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import { bindColumnAutoIncrementTarget, columnAutoIncrementIntegrationGate, columnAutoIncrementLifetime, loadColumnAutoIncrementModules, assertColumnAutoIncrementIdentity, watchColumnAutoIncrementConnection, assertColumnAutoIncrementReleased, closeColumnAutoIncrementObserver, type ColumnAutoIncrementConnectionFact, type ColumnAutoIncrementLifetime } from '../helpers/columnAutoIncrementIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 只旁观原连接、原回调及实际协议，不替换Engine、SQL或服务器响应。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('列自增原连接没有本轮owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

let lifetime: ColumnAutoIncrementLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('列级自增启用取消六实例实库（逐端口独立进程）', () => {
  it('真实普通复合索引、零值与精度保持、只读预览、一次DDL和原线程收尾', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[columnAutoIncrementIntegrationGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('列自增原验收仍保留现场，不自动重跑');
    const binding = bindColumnAutoIncrementTarget(() => process.env, 'autoattr-' + context.task.id);
    const owner = lifetime = columnAutoIncrementLifetime(context, binding, () => { retained = true; });
    const facts: ColumnAutoIncrementConnectionFact[] = [], events: TaskEvent[] = []; let allowedSql: string | undefined;
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchColumnAutoIncrementConnection(managed, scope, owner, () => allowedSql)); };
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent';
    try {
      const { engine: engineModule, connection } = await owner.step(loadColumnAutoIncrementModules);
      const [quote, crypto] = await owner.step(() => Promise.all([import('../../src/engine/sql'), import('node:crypto')]));
      database = 'dbark_e2e_autoattr_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-autoattr-owner:' + crypto.randomUUID();
      if (!/^dbark_e2e_autoattr_[a-f0-9]{32}$/.test(database)) throw Error('列自增资源计划无效');
      process.stdout.write(JSON.stringify({ 专项: '列级自增', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port }) + '\n');
      const db = quote.identifier(database), table = db + '.`subject`';
      /** 同一原observer核身份、准备、全量读回和精确清理，未知状态后不新连恢复。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertColumnAutoIncrementIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('列自增observer原线程未知');
      engine = new engineModule.Engine(event => events.push(event));
      /** 等待原操作及原物理流close；任何发送后的未知均不重放。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        const scope = crypto.randomUUID(); audit.scope = scope; allowedSql = expectedSql; const count = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(count); for (const fact of actual) await owner.step(() => fact.closed);
        assertColumnAutoIncrementReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      created = 'unknown'; expect((await sql<{ warningStatus: number }>(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)).warningStatus).toBe(0); created = 'confirmed';
      await sql(`CREATE TABLE ${table}(k INT NOT NULL PRIMARY KEY,id BIGINT NOT NULL COMMENT '原候选',amount DECIMAL(30,6) NOT NULL,payload VARBINARY(8),nullable_id INT NULL,default_id INT NOT NULL DEFAULT 7,KEY idx_id(id,k),KEY idx_nullable(nullable_id),KEY idx_default(default_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='${marker}'`);
      const inserted = await sql<{ affectedRows: number; warningStatus: number }>(`INSERT INTO ${table}(k,id,amount,payload) VALUES(1,-9,123456789012345678.123456,X'0000FF'),(2,0,0.000001,X''),(3,0,-1.000001,NULL),(4,7,987654321098765432.999999,X'FF00'),(5,9007199254740993,1.000000,X'010203')`); expect(inserted.affectedRows).toBe(5); expect(inserted.warningStatus).toBe(0);
      const definition = async () => String((await sql(`SHOW CREATE TABLE ${table}`))[0]['Create Table']);
      const rows = async () => sql(`SELECT CAST(k AS CHAR) AS k,CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,nullable_id,default_id FROM ${table} ORDER BY k`);
      const beforeRows = await rows(), beforeDefinition = await definition(); expect(beforeRows.map(row => row.id)).toEqual(['-9', '0', '0', '7', '9007199254740993']);
      const originalMode = await sql('SELECT @@SESSION.sql_mode AS mode');
      const get = async (tableName = 'subject') => { const result = await invoke<TableColumnGetOutput>('schema.columns.get', { connectionId: binding.profile.id, database, table: tableName, taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); return result.value!; };
      const patch = (snapshot: TableColumnGetOutput, enabled: boolean): ColumnPatch => { const column = snapshot.columns.find(value => value.name === 'id'); expect(column?.autoIncrement?.access.editable).toBe(true); return { kind: 'alter', columnRef: column!.columnRef, changes: { autoIncrement: enabled } }; };
      const preview = (snapshot: TableColumnGetOutput, patches: ColumnPatch[]) => invoke<TableColumnPreviewOutput>('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = (value: TableColumnPreviewOutput, allowWrite: boolean, acknowledgements = value.requiredAcknowledgements) => invoke<TableColumnApplyOutput>('schema.columns.apply', { previewToken: value.previewToken, acknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, allowWrite ? value.sql : undefined);
      const first = await get(); expect(first.columns.find(column => column.name === 'id')?.autoIncrement?.enabled).toBe(false);
      for (const name of ['nullable_id', 'default_id', 'amount', 'payload']) expect(first.columns.find(column => column.name === name)?.autoIncrement?.access.editable).not.toBe(true);
      const noOp = await preview(first, [patch(first, false)]); expect(noOp.error).toBeInstanceOf(Error); expect(noOp.facts.flatMap(fact => fact.writes)).toEqual([]);
      const enablePreview = await preview(first, [patch(first, true)]); expect(enablePreview.error).toBeUndefined(); const plan = enablePreview.value!;
      expect(plan.sql).toMatch(/MODIFY COLUMN/); expect(plan.sql).toMatch(/AUTO_INCREMENT/); expect(plan.sql).toMatch(/ALGORITHM\s*=\s*COPY/); expect(plan.sql).toMatch(/LOCK\s*=\s*EXCLUSIVE/);
      expect(plan.requiredAcknowledgements).toEqual(expect.arrayContaining(['ddl-implicit-commit', 'external-ddl-window', 'column-auto-increment-copy']));
      expect(enablePreview.facts.flatMap(fact => fact.writes)).toEqual([]); expect(await definition()).toBe(beforeDefinition); expect(await rows()).toEqual(beforeRows);
      const missingAck = await apply(plan, false, ['ddl-implicit-commit', 'external-ddl-window']); expect(missingAck.error).toBeInstanceOf(Error); expect(missingAck.facts.flatMap(fact => fact.writes)).toEqual([]);
      const consumed = await apply(plan, false); expect(consumed.error).toBeInstanceOf(Error); expect(consumed.facts).toHaveLength(0);
      const nextEnable = await preview(first, [patch(first, true)]); expect(nextEnable.error).toBeUndefined(); const enabled = await apply(nextEnable.value!, true);
      expect(enabled.error).toBeUndefined(); expect(enabled.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(enabled.facts.flatMap(fact => fact.writes)).toEqual([nextEnable.value!.sql]); expect(await rows()).toEqual(beforeRows);
      const on = await get(); expect(on.columns.find(column => column.name === 'id')?.autoIncrement?.enabled).toBe(true); expect(on.columns.find(column => column.name === 'k')?.autoIncrement?.access.editable).not.toBe(true);
      expect((await sql<{ warningStatus: number }>(`INSERT INTO ${table}(k,amount,payload) VALUES(6,2.000000,X'00')`)).warningStatus).toBe(0); const withNew = await rows(); expect(withNew.slice(0,5)).toEqual(beforeRows); expect(withNew[5].id).toBe('9007199254740994');
      // 新增行改变计数后必须重新get，不能把旧计数快照当当前定义。
      const currentOn = await get(), disablePreview = await preview(currentOn, [patch(currentOn, false)]); expect(disablePreview.error).toBeUndefined();
      const disabled = await apply(disablePreview.value!, true); expect(disabled.error).toBeUndefined(); expect(disabled.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(disabled.facts.flatMap(fact => fact.writes)).toEqual([disablePreview.value!.sql]); expect(await rows()).toEqual(withNew); expect(await definition()).toBe(beforeDefinition);
      const staleSnapshot = await get(), stale = await preview(staleSnapshot, [patch(staleSnapshot, true)]); expect(stale.error).toBeUndefined(); await sql(`ALTER TABLE ${table} COMMENT='${marker}:changed'`);
      const refused = await apply(stale.value!, false); expect(refused.error).toBeInstanceOf(Error); expect(refused.facts.flatMap(fact => fact.writes)).toEqual([]); expect(await rows()).toEqual(withNew);
      // COPY能重算不引用目标的旁生成列；未证明重算保真时整表自增必须只读，不能只比较SHOW文本。
      const guarded = db + '.`generated_guard`';
      await sql(`CREATE TABLE ${guarded}(id INT NOT NULL PRIMARY KEY,k INT NOT NULL,g INT GENERATED ALWAYS AS(k+1) STORED) ENGINE=InnoDB COMMENT='${marker}:generated'`);
      await sql(`INSERT INTO ${guarded}(id,k) VALUES(0,3),(7,-1)`);
      const guardDefinition = await sql(`SHOW CREATE TABLE ${guarded}`), guardRows = await sql(`SELECT id,k,g FROM ${guarded} ORDER BY id`), guardSnapshot = await get('generated_guard'), guardColumn = guardSnapshot.columns.find(column => column.name === 'id')!;
      expect(guardColumn.autoIncrement?.access.editable).toBe(false); expect(guardColumn.autoIncrement?.access.reason).toMatch(/生成/);
      const guardPreview = await preview(guardSnapshot, [{ kind:'alter', columnRef:guardColumn.columnRef, changes:{autoIncrement:true} }]); expect(guardPreview.error).toBeInstanceOf(Error); expect(guardPreview.facts.flatMap(fact => fact.writes)).toEqual([]);
      expect(await sql(`SHOW CREATE TABLE ${guarded}`)).toEqual(guardDefinition); expect(await sql(`SELECT id,k,g FROM ${guarded} ORDER BY id`)).toEqual(guardRows);
      expect(await sql('SELECT @@SESSION.sql_mode AS mode')).toEqual(originalMode);
      process.stdout.write(JSON.stringify({ 专项: '列级自增', 端口: binding.profile.port, 版本: observer.status.version, 方言: observer.status.dialect, 严格TLS: !!binding.profile.tls?.enabled, 原行保持: true, 启用与取消均完整定义核验: true, 新增自增值: withNew[5].id, 预览写入: 0, 缺确认消费令牌: true, 外部DDL拒绝: true, 不相关生成列表实际拒绝且原值保持: true, observer模式保持: true, MDL取消限权:'本轮未验' }) + '\n');
      await owner.step(() => engine!.closeAll()); const taskFacts = facts.filter(fact => fact.scope !== 'observer'); assertColumnAutoIncrementReleased(taskFacts, false);
      const taskIds = [...new Set(taskFacts.map(fact => fact.id))]; if (taskIds.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${taskIds.join(',')})`)).toHaveLength(0);
      expect(await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual([{ name:'generated_guard', marker:marker+':generated', kind:'BASE TABLE' },{ name:'subject', marker:marker+':changed', kind:'BASE TABLE' }]);
      for (const [view,column] of [['TRIGGERS','TRIGGER_SCHEMA'],['ROUTINES','ROUTINE_SCHEMA'],['EVENTS','EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`,[database])).toHaveLength(0);
      if (created !== 'confirmed' || !/^dbark_e2e_autoattr_[a-f0-9]{32}$/.test(database)) throw Error('列自增精确资源归属未证明，拒绝清理');
      await sql('DROP DATABASE '+db); created='absent'; expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?',[database])).toHaveLength(0);
      await owner.step(() => closeColumnAutoIncrementObserver(observer!)); assertColumnAutoIncrementReleased(facts,false); owner.finish(); complete=true; audit.watch=undefined; audit.check=undefined; audit.scope='';
      process.stdout.write(JSON.stringify({ 专项:'列级自增',端口:binding.profile.port,已清理数据库:database,原生流全部关闭:true,原任务线程残留:0,实际事件数:events.length })+'\n');
    } catch(reason) {
      owner.stop(); retained=true; process.stdout.write(JSON.stringify({ 专项:'列级自增',保留现场:true,数据库:database,数据库状态:created,原生线程:facts.map(fact=>({id:fact.id,pending:fact.pending,closed:fact.sawClose,closeFailed:fact.closeFailed})) })+'\n'); throw reason;
    } finally {
      if(!complete&&observer) try { await observer.close({strict:true}); } catch { /* 原失败保留，不新连补救或重放。 */ }
    }
  });
});
