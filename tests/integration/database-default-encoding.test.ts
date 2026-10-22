import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { DatabaseDefaultEncodingApplyOutput, DatabaseDefaultEncodingGetOutput, DatabaseDefaultEncodingPreviewOutput } from '../../src/shared/databaseDefaultEncoding';
import { bindDatabaseEncodingTarget, databaseEncodingGate, databaseEncodingLifetime, assertDatabaseEncodingIdentity, watchDatabaseEncodingConnection, assertDatabaseEncodingReleased, closeDatabaseEncodingObserver, type DatabaseEncodingConnectionFact, type DatabaseEncodingLifetime } from '../helpers/databaseDefaultEncodingIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 只旁观实际connect返回的原连接，包括Engine短会话；不替换网络或服务器回包。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('数据库编码连接没有本轮原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});
let lifetime: DatabaseEncodingLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

// 双门放在测试体中：默认/list不读取凭据、文件、证书或live引擎，更不访问网络。
describe.sequential('数据库默认编码六实例实库专项（Root逐端口运行）', () => {
  it('真实目录及单次默认变更保持既有表列字节与精度，新表继承；旧预览拒绝及精确收尾', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[databaseEncodingGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('数据库编码旧例仍保留现场，不自动重跑');
    const binding = bindDatabaseEncodingTarget(() => process.env, 'dbencoding-' + context.task.id);
    const owner = lifetime = databaseEncodingLifetime(context, binding, () => { retained = true; });
    const facts: DatabaseEncodingConnectionFact[] = [], events: TaskEvent[] = []; let allowedSql: string | undefined;
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchDatabaseEncodingConnection(managed, scope, owner, () => allowedSql)); };
    let observer: ManagedConnection | undefined, engine: import('../../src/engine').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent';
    try {
      const modules = await owner.step(() => Promise.all([import('../../src/engine'), import('../../src/engine/connection'), import('../../src/engine/sql'), import('node:crypto')]));
      const [engineModule, connection, quote, crypto] = modules;
      database = 'dbark_dbencoding_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-dbencoding-owner:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_dbencoding_[a-f0-9]{32}$/.test(database)) throw Error('数据库编码随机资源计划无效');
      const db = quote.identifier(database), table = (name: 'existing' | 'inherited') => db + '.' + quote.identifier(name);
      /** 所有observer动作都绑定同一原生会话，不借新连接修复原现场。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertDatabaseEncodingIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId;
      if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('数据库编码observer原线程未知');
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      const original = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, changed = { charset: 'latin1', collation: 'latin1_swedish_ci' };
      created = 'unknown'; const create = await sql<{ affectedRows: number; warningStatus: number }>(`CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); expect(create.warningStatus).toBe(0); created = 'confirmed';
      await sql(`CREATE TABLE ${table('existing')}(id BIGINT UNSIGNED NOT NULL PRIMARY KEY,signed_value BIGINT,amount DECIMAL(65,30),happened DATETIME(6),clock_value TIME(6),note TEXT,payload BLOB) ENGINE=InnoDB COMMENT='${marker}'`);
      const insert = await sql<{ affectedRows: number; warningStatus: number }>(`INSERT INTO ${table('existing')} VALUES(18446744073709551615,-9223372036854775808,-12345678901234567890123456789012345.123456789012345678901234567890,'2026-10-22 01:02:03.123456','-12:34:56.654321',?,?),(9007199254740993,9007199254740993,0.000000000000000000000000000001,'2026-10-22 23:59:59.999999','12:34:56.000001',?,?),(2,NULL,NULL,NULL,NULL,NULL,NULL)`, ["中文😀'\"\\\0\r\n", Buffer.from('00ff805c27', 'hex'), '', Buffer.alloc(0)]);
      expect(insert.affectedRows).toBe(3); expect(insert.warningStatus).toBe(0);
      const definition = async () => String((await sql(`SHOW CREATE TABLE ${table('existing')}`))[0]['Create Table']);
      const columns = async () => sql('SELECT COLUMN_NAME,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,IS_NULLABLE FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, 'existing']);
      const rows = async () => sql(`SELECT CAST(id AS CHAR) AS id,CAST(signed_value AS CHAR) AS signed_value,CAST(amount AS CHAR) AS amount,CAST(happened AS CHAR) AS happened,CAST(clock_value AS CHAR) AS clock_value,HEX(note) AS note,HEX(payload) AS payload FROM ${table('existing')} ORDER BY existing.id`);
      const beforeDefinition = await definition(), beforeColumns = await columns(), beforeRows = await rows();
      expect(beforeRows.map(row => row.id)).toEqual(['2', '9007199254740993', '18446744073709551615']);
      expect(beforeRows[2]).toMatchObject({ signed_value: '-9223372036854775808', amount: '-12345678901234567890123456789012345.123456789012345678901234567890', happened: '2026-10-22 01:02:03.123456', clock_value: '-12:34:56.654321', note: Buffer.from("中文😀'\"\\\0\r\n").toString('hex').toUpperCase(), payload: '00FF805C27' });
      engine = new engineModule.Engine(event => events.push(event));
      /** 每个原Engine调用都等其实际流关闭；预期拒绝在step内部记录，避免把预期失败伪装成可继续的超时。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string): Promise<{ value?: T; error?: unknown; facts: DatabaseEncodingConnectionFact[] }> => {
        const scope = crypto.randomUUID(); audit.scope = scope; allowedSql = expectedSql; const count = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(count); for (const fact of actual) await owner.step(() => fact.closed);
        assertDatabaseEncodingReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined();
      const get = async () => { const result = await invoke<DatabaseDefaultEncodingGetOutput>('schema.databaseDefaultEncoding.get', { connectionId: binding.profile.id, database, taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); return result.value!; };
      const preview = async (snapshot: DatabaseDefaultEncodingGetOutput, pair = changed) => invoke<DatabaseDefaultEncodingPreviewOutput>('schema.databaseDefaultEncoding.preview', { snapshotId: snapshot.snapshotId, ...pair, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = async (value: DatabaseDefaultEncodingPreviewOutput, allowWrite: boolean) => invoke<DatabaseDefaultEncodingApplyOutput>('schema.databaseDefaultEncoding.apply', { previewToken: value.previewToken, confirmation: database, acknowledgements: value.requiredAcknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, allowWrite ? value.sql : undefined);
      const currentSchema = async () => sql('SELECT DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database]);
      const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.current).toEqual(original); expect(snapshot.candidates).toContainEqual(changed);
      const next = await preview(snapshot); expect(next.error).toBeUndefined(); const plan = next.value!; expect(next.facts.flatMap(fact => fact.writes)).toHaveLength(0); expect(await currentSchema()).toEqual([original]); expect(await definition()).toBe(beforeDefinition);
      const applied = await apply(plan, true); expect(applied.error).toBeUndefined(); expect(applied.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, before: original, after: changed }); expect(applied.facts.flatMap(fact => fact.writes)).toEqual([plan.sql]); expect(await currentSchema()).toEqual([changed]);
      expect(await definition()).toBe(beforeDefinition); expect(await columns()).toEqual(beforeColumns); expect(await rows()).toEqual(beforeRows);
      await sql(`CREATE TABLE ${table('inherited')}(id INT NOT NULL PRIMARY KEY,note VARCHAR(40)) ENGINE=InnoDB COMMENT='${marker}'`);
      expect(await sql('SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND TABLE_NAME=\'inherited\' AND COLUMN_NAME=\'note\'', [database])).toEqual([changed]);
      const duplicate = await apply(plan, false); expect(duplicate.error).toBeInstanceOf(Error); expect(duplicate.facts).toHaveLength(0);
      const latest = await get(), noOp = await preview(latest, changed); expect(noOp.error).toBeInstanceOf(Error); expect(noOp.facts).toHaveLength(0);
      const released = await preview(latest, original); expect(released.error).toBeUndefined(); const release = await invoke('schema.databaseDefaultEncoding.release', { snapshotId: latest.snapshotId }); expect(release.error).toBeUndefined(); const revoked = await apply(released.value!, false); expect(revoked.error).toBeInstanceOf(Error); expect(revoked.facts).toHaveLength(0);
      const external = await preview(await get(), original); expect(external.error).toBeUndefined(); await sql(`ALTER DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
      const stale = await apply(external.value!, false); expect(stale.error).toBeInstanceOf(Error); expect(stale.facts.flatMap(fact => fact.writes)).toHaveLength(0); expect(await currentSchema()).toEqual([original]);
      expect(await definition()).toBe(beforeDefinition); expect(await columns()).toEqual(beforeColumns); expect(await rows()).toEqual(beforeRows);
      // 权限不足需要另行授权的新账号资源；本namespace不扩张旧cp_*/dbark_colperm_*授权。
      console.info(JSON.stringify({ 专项: '数据库默认编码', 数据库: database, 端口: binding.profile.port, 版本: observer.status.version, 方言: observer.status.dialect, 严格TLS: !!binding.profile.tls?.enabled, 权限不足: '未验；本轮不创建用户', 已有表定义列及精度字节保持: true, 新表继承默认: true }));
      /** cleanup只在主体和所有原Engine任务严格结束后进入；未知绝不DROP。 */
      await owner.step(() => engine!.closeAll());
      const taskFacts = facts.filter(fact => fact.scope !== 'observer'); assertDatabaseEncodingReleased(taskFacts, false);
      const taskIds = [...new Set(taskFacts.map(fact => fact.id))];
      expect(events.filter(event => event.databaseDefaultEncoding && event.status === 'running')).not.toHaveLength(0);
      if (taskIds.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${taskIds.join(',')})`)).toHaveLength(0);
      const owned = await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY TABLE_NAME', [database]);
      expect(owned).toEqual([{ name: 'existing', marker, kind: 'BASE TABLE' }, { name: 'inherited', marker, kind: 'BASE TABLE' }]);
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [database])).toHaveLength(0);
      if (created !== 'confirmed' || !/^dbark_dbencoding_[a-f0-9]{32}$/.test(database)) throw Error('数据库编码资源归属未证明，拒绝清理');
      await sql('DROP DATABASE ' + db); created = 'absent'; expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      await owner.step(() => closeDatabaseEncodingObserver(observer!)); assertDatabaseEncodingReleased(facts, false);
      owner.finish(); complete = true; audit.watch = undefined; audit.check = undefined; audit.scope = '';
      console.info(JSON.stringify({ 专项: '数据库默认编码', 端口: binding.profile.port, 已清理数据库: database, 数据库残留: 0, 已关闭原生线程数: facts.length, 原任务线程残留: 0, observer原线程: observerId }));
    } catch (reason) {
      owner.stop(); retained = true;
      console.info(JSON.stringify({ 专项: '数据库默认编码', 保留现场: true, 数据库: database, 数据库状态: created, 已取得原生线程: facts.map(fact => ({ id: fact.id, pending: fact.pending, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })) }));
      throw reason;
    } finally {
      // 失败后不启动DROP、重连、取消或重新执行；只释放已取得的observer句柄并保留全部原事实。
      if (!complete && observer) try { await observer.close({ strict: true }); } catch { /* 保留首因及未释放现场，由Root核对。 */ }
    }
  });
});
