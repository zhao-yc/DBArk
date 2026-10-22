import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { DatabaseDropApplyOutput, DatabaseDropGetOutput, DatabaseDropPreviewOutput } from '../../src/shared/databaseDrop';
import { databaseDropAcknowledgements } from '../../src/shared/databaseDrop';
import { bindDatabaseDropTarget, databaseDropGate, databaseDropLifetime, loadDatabaseDropModules, assertDatabaseDropIdentity, watchDatabaseDropConnection, assertDatabaseDropReleased, closeDatabaseDropObserver, type DatabaseDropConnectionFact, type DatabaseDropLifetime } from '../helpers/databaseDropIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 只旁观实际connect的原连接、原mysql2回调和原流，不替换服务器响应或结构执行器。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('删除数据库连接没有本轮原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});
let lifetime: DatabaseDropLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

// 双门位于测试体：默认/list不读取凭据、证书或live Engine，不创建网络连接。
describe.sequential('删除数据库六实例实库专项（Root逐端口独立执行）', () => {
  it('真实删除空库和六类对象库，精确原名/兄弟令牌/目录漂移/外库入向外键拒绝及原资源收尾', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[databaseDropGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('删除数据库旧例仍保留现场，不自动重跑');
    const binding = bindDatabaseDropTarget(() => process.env, 'dbdrop-' + context.task.id), owner = lifetime = databaseDropLifetime(context, binding, () => { retained = true; });
    const facts: DatabaseDropConnectionFact[] = [], events: TaskEvent[] = []; let allowedSql: string | undefined;
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchDatabaseDropConnection(managed, scope, owner, () => allowedSql)); };
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined, checkpoint = '尚未连接';
    const states = new Map<string, 'absent' | 'unknown' | 'confirmed'>(); let marker = '', databases: string[] = [];
    try {
      const { connection, engine: engineModule } = await owner.step(loadDatabaseDropModules);
      const [quote, crypto] = await owner.step(() => Promise.all([import('../../src/engine/sql'), import('node:crypto')]));
      const nonce = crypto.randomUUID().replaceAll('-', ''), empty = 'dbark_dbdrop_' + nonce + '_empty', subject = 'dbark_dbdrop_' + nonce + '_中文`库', external = 'dbark_dbdrop_' + nonce + '_ref';
      marker = 'dbark-dbdrop-owner:' + crypto.randomUUID().replaceAll('-', ''); databases = [empty, subject, external];
      if (new Set(databases).size !== 3 || databases.some(name => !/^dbark_dbdrop_[a-f0-9]{32}_(?:empty|中文`库|ref)$/u.test(name) || name.length > 64)) throw Error('删除数据库随机独占资源计划无效');
      for (const name of databases) states.set(name, 'absent');
      process.stdout.write(JSON.stringify({ 专项: '删除数据库', 阶段: '原资源计划', 端口: binding.profile.port, 所有者标记: marker, 数据库: databases, 空库: empty, 完整对象库: subject, 外部引用库: external, 空库所有权: '创建前精确不存在、原CREATE成功和外库owner_ledger原始登记；不声称空库具有物理OID' }) + '\n');
      const db = quote.identifier, target = (name: string) => db(subject) + '.' + db(name), neighbor = (name: string) => db(external) + '.' + db(name);
      /** observer始终复用同一个原生连接，所有SQL动作受同一原owner期限约束。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      checkpoint = '核对原observer及实际服务器'; audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuid = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertDatabaseDropIdentity(identity, binding, observer.status, uuid);
      const tls = await sql("SHOW SESSION STATUS LIKE 'Ssl_cipher'"); expect(tls).toHaveLength(1); expect(tls[0].Variable_name).toBe('Ssl_cipher'); expect(typeof tls[0].Value).toBe('string'); expect(!!tls[0].Value).toBe(binding.profile.port === 13484);
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('删除数据库observer原线程未知');
      engine = new engineModule.Engine(event => events.push(event));
      /** 每次Engine调用均等待原回调和原物理流关闭；预期拒绝不改变owner期限或资源门槛。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string): Promise<{ value?: T; error?: unknown; facts: DatabaseDropConnectionFact[] }> => {
        const count = facts.length; audit.scope = crypto.randomUUID(); allowedSql = expectedSql;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(count); for (const fact of actual) await owner.step(() => fact.closed);
        assertDatabaseDropReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      /** BINARY原名核对，不把连接排序规则下的同形名称当成同一个资源。 */
      const schema = async (name: string) => sql('SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [name]);
      const createSchema = async (name: string) => {
        expect(await schema(name)).toHaveLength(0); states.set(name, 'unknown'); const result = await sql<{ warningStatus: number }>(`CREATE DATABASE ${db(name)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); expect(result.warningStatus).toBe(0); states.set(name, 'confirmed'); expect(await schema(name)).toEqual([{ name, charset: 'utf8mb4', collation: 'utf8mb4_bin' }]);
      };
      /** 六个对象目录分别查精确原名；库消失后每一目录都必须为空。 */
      const objectCatalog = async (name: string) => {
        const output: Record<string, unknown[]> = {};
        for (const [view, column, nameColumn] of [['TABLES', 'TABLE_SCHEMA', 'TABLE_NAME'], ['ROUTINES', 'ROUTINE_SCHEMA', 'ROUTINE_NAME'], ['TRIGGERS', 'TRIGGER_SCHEMA', 'TRIGGER_NAME'], ['EVENTS', 'EVENT_SCHEMA', 'EVENT_NAME']]) output[view] = await sql(`SELECT ${nameColumn} AS name FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? ORDER BY BINARY ${nameColumn}`, [name]);
        return output;
      };
      /** 目标库不存在且四种原生目录均不存在，才记录本例已经删除。 */
      const absent = async (name: string) => { expect(await schema(name)).toHaveLength(0); expect(await objectCatalog(name)).toEqual({ TABLES: [], ROUTINES: [], TRIGGERS: [], EVENTS: [] }); states.set(name, 'absent'); };
      for (const name of databases) expect(await schema(name)).toHaveLength(0);
      checkpoint = '创建三库并登记跨库精确所有权'; await sql('SET NAMES utf8mb4 COLLATE utf8mb4_bin');
      await createSchema(external);
      await sql(`CREATE TABLE ${neighbor('owner_ledger')}(database_name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,owner_marker VARCHAR(80) NOT NULL,schema_hash CHAR(64) NOT NULL) ENGINE=InnoDB COMMENT='${marker}'`);
      await createSchema(empty); await createSchema(subject);
      const schemaDefinitions = new Map<string, string>();
      for (const name of databases) {
        const definition = String((await sql(`SHOW CREATE DATABASE ${db(name)}`))[0]['Create Database']); expect(definition).toContain(db(name)); schemaDefinitions.set(name, definition);
        const registered = await sql<{ affectedRows: number; warningStatus: number }>(`INSERT INTO ${neighbor('owner_ledger')} VALUES(?,?,?)`, [name, marker, crypto.createHash('sha256').update(definition).digest('hex')]); expect(registered.affectedRows).toBe(1); expect(registered.warningStatus).toBe(0);
      }
      const ledger = async () => sql(`SELECT database_name AS name,owner_marker AS marker,schema_hash AS hash FROM ${neighbor('owner_ledger')} ORDER BY BINARY database_name`);
      const expectedLedger = [...databases].sort().map(name => ({ name, marker, hash: crypto.createHash('sha256').update(schemaDefinitions.get(name)!).digest('hex') })); expect(await ledger()).toEqual(expectedLedger);
      const snapshots = new Set<string>(), previews = new Set<string>();
      /** 所有请求真实经过Engine公开命令，不直接调用task实现或改缓存状态。 */
      const get = async (name: string) => {
        const result = await invoke<DatabaseDropGetOutput>('schema.databaseDrop.get', { connectionId: binding.profile.id, database: name, taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); expect(result.facts.flatMap(fact => fact.writes)).toHaveLength(0);
        expect(result.value!.target).toEqual({ connectionId: binding.profile.id, database: name }); snapshots.add(result.value!.snapshotId); return result.value!;
      };
      const preview = async (source: DatabaseDropGetOutput) => {
        const result = await invoke<DatabaseDropPreviewOutput>('schema.databaseDrop.preview', { snapshotId: source.snapshotId, taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.facts.flatMap(fact => fact.writes)).toHaveLength(0); if (result.value) { previews.add(result.value.previewToken); expect(result.value.target).toEqual(source.target); expect(result.value.counts).toEqual(source.counts); expect(result.value.catalogDigest).toBe(source.catalogDigest); expect(result.value.requiredAcknowledgements).toEqual([...databaseDropAcknowledgements]); expect(result.value.sql).toBe(`DROP DATABASE ${db(source.target.database)};`); } return result;
      };
      const apply = async (plan: DatabaseDropPreviewOutput, allowWrite = false, confirmation = plan.target.database) => invoke<DatabaseDropApplyOutput>('schema.databaseDrop.apply', { previewToken: plan.previewToken, confirmation, acknowledgements: [...databaseDropAcknowledgements], taskId: crypto.randomUUID(), connectionRevision: 1 }, allowWrite ? plan.sql : undefined);
      const zeroCounts = { tables: 0, views: 0, procedures: 0, functions: 0, triggers: 0, events: 0 };
      checkpoint = '空库错误确认与兄弟预览消费'; const emptySource = await get(empty); expect(emptySource.writable, emptySource.reasons.join('；')).toBe(true); expect(emptySource.counts).toEqual(zeroCounts); expect(await objectCatalog(empty)).toEqual({ TABLES: [], ROUTINES: [], TRIGGERS: [], EVENTS: [] });
      const first = await preview(emptySource), sibling = await preview(emptySource); expect(first.error).toBeUndefined(); expect(sibling.error).toBeUndefined();
      const bad = await apply(first.value!, false, empty + ' '); expect(bad.error).toBeInstanceOf(Error); expect(bad.facts).toHaveLength(0);
      const badSibling = await apply(sibling.value!); expect(badSibling.error).toBeInstanceOf(Error); expect(badSibling.facts).toHaveLength(0); expect(await schema(empty)).toHaveLength(1); expect(await ledger()).toEqual(expectedLedger);
      checkpoint = '空库显式预览释放'; const released = await preview(await get(empty)); expect(released.error).toBeUndefined(); expect((await invoke('schema.databaseDrop.release', { previewToken: released.value!.previewToken })).error).toBeUndefined(); const revoked = await apply(released.value!); expect(revoked.error).toBeInstanceOf(Error); expect(revoked.facts).toHaveLength(0);
      checkpoint = '空库原快照释放撤销全部兄弟'; const releasedSource = await get(empty), releasedA = await preview(releasedSource), releasedB = await preview(releasedSource); expect(releasedA.error).toBeUndefined(); expect(releasedB.error).toBeUndefined(); expect((await invoke('schema.databaseDrop.release', { snapshotId: releasedSource.snapshotId })).error).toBeUndefined();
      for (const plan of [releasedA.value!, releasedB.value!]) { const rejected = await apply(plan); expect(rejected.error).toBeInstanceOf(Error); expect(rejected.facts).toHaveLength(0); } const sourceReplay = await preview(releasedSource); expect(sourceReplay.error).toBeInstanceOf(Error); expect(sourceReplay.facts).toHaveLength(0);
      checkpoint = '真正删除空库'; const emptyPlan = await preview(await get(empty)); expect(emptyPlan.error).toBeUndefined(); const emptyApplied = await apply(emptyPlan.value!, true); expect(emptyApplied.error).toBeUndefined(); expect(emptyApplied.value).toMatchObject({ target: { connectionId: binding.profile.id, database: empty }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true }, warnings: [] }); expect(emptyApplied.facts.flatMap(fact => fact.writes)).toEqual([emptyPlan.value!.sql]); await absent(empty);
      const emptyReplay = await apply(emptyPlan.value!); expect(emptyReplay.error).toBeInstanceOf(Error); expect(emptyReplay.facts).toHaveLength(0);
      checkpoint = '创建含精度数据与全部六类对象的原库';
      await sql(`CREATE TABLE ${target('parent')}(id BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(65,30),happened DATETIME(6),note TEXT,payload BLOB) ENGINE=InnoDB COMMENT='${marker}'`);
      await sql(`CREATE TABLE ${target('child')}(id INT NOT NULL PRIMARY KEY,parent_id BIGINT UNSIGNED NOT NULL,CONSTRAINT fk_internal FOREIGN KEY(parent_id) REFERENCES ${target('parent')}(id)) ENGINE=InnoDB COMMENT='${marker}'`);
      const inserted = await sql<{ affectedRows: number; warningStatus: number }>(`INSERT INTO ${target('parent')} VALUES(18446744073709551615,-12345678901234567890123456789012345.123456789012345678901234567890,'2026-10-23 01:02:03.123456',?,?),(9007199254740993,0.000000000000000000000000000001,'2026-10-23 23:59:59.999999',?,?),(2,NULL,NULL,NULL,NULL)`, ["中文😀'\"\\\0\r\n", Buffer.from('00ff805c27', 'hex'), '', Buffer.alloc(0)]); expect(inserted.affectedRows).toBe(3); expect(inserted.warningStatus).toBe(0);
      await sql(`INSERT INTO ${target('child')} VALUES(1,18446744073709551615)`);
      await sql(`CREATE VIEW ${target('v_parent')} AS SELECT id,note FROM ${target('parent')}`);
      await sql(`CREATE PROCEDURE ${target('p_noop')}() SQL SECURITY INVOKER COMMENT '${marker}' SELECT 1`);
      await sql(`CREATE FUNCTION ${target('f_noop')}() RETURNS INT DETERMINISTIC NO SQL SQL SECURITY INVOKER COMMENT '${marker}' RETURN 1`);
      await sql(`CREATE TRIGGER ${target('tr_noop')} BEFORE INSERT ON ${target('parent')} FOR EACH ROW SET NEW.note=NEW.note`);
      await sql(`CREATE EVENT ${target('ev_disabled')} ON SCHEDULE AT '2030-01-01 00:00:00' ON COMPLETION PRESERVE DISABLE COMMENT '${marker}' DO SET @dbark_dbdrop_noop=1`);
      expect(await sql('SELECT STATUS AS status FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA=BINARY ? AND BINARY EVENT_NAME=BINARY ?', [subject, 'ev_disabled'])).toEqual([{ status: 'DISABLED' }]);
      const parentDefinition = async () => String((await sql(`SHOW CREATE TABLE ${target('parent')}`))[0]['Create Table']);
      const rows = async () => sql(`SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,CAST(happened AS CHAR) AS happened,HEX(note) AS note,HEX(payload) AS payload FROM ${target('parent')} ORDER BY parent.id`);
      const originalRows = await rows(), originalParent = await parentDefinition();
      expect(originalRows.map(row => row.id)).toEqual(['2', '9007199254740993', '18446744073709551615']); expect(originalRows[2]).toMatchObject({ amount: '-12345678901234567890123456789012345.123456789012345678901234567890', happened: '2026-10-23 01:02:03.123456', note: Buffer.from("中文😀'\"\\\0\r\n").toString('hex').toUpperCase(), payload: '00FF805C27' }); expect(originalRows[0]).toMatchObject({ amount: null, happened: null, note: null, payload: null }); expect(originalRows[1]).toMatchObject({ note: '', payload: '' });
      const allCounts = { tables: 2, views: 1, procedures: 1, functions: 1, triggers: 1, events: 1 };
      checkpoint = '真实外库入向外键只读且零DDL';
      await sql(`CREATE TABLE ${neighbor('incoming')}(id INT NOT NULL PRIMARY KEY,parent_id BIGINT UNSIGNED NOT NULL,CONSTRAINT fk_external FOREIGN KEY(parent_id) REFERENCES ${target('parent')}(id)) ENGINE=InnoDB COMMENT='${marker}'`);
      await sql(`INSERT INTO ${neighbor('incoming')} VALUES(1,2)`);
      const incoming = await get(subject); expect(incoming.writable).toBe(false); expect(incoming.counts).toEqual(allCounts); expect(incoming.reasons.join('；')).toContain('外键'); const blocked = await preview(incoming); expect(blocked.error).toBeInstanceOf(Error); expect(blocked.facts).toHaveLength(0); expect(await parentDefinition()).toBe(originalParent); expect(await rows()).toEqual(originalRows);
      await sql(`ALTER TABLE ${neighbor('incoming')} DROP FOREIGN KEY fk_external`);
      const outsideDefinitions = new Map<string, string>(); for (const name of ['owner_ledger', 'incoming']) outsideDefinitions.set(name, String((await sql(`SHOW CREATE TABLE ${neighbor(name)}`))[0]['Create Table']));
      checkpoint = '目录定义变化拒绝零DDL并消费兄弟'; const before = await get(subject); expect(before.writable, before.reasons.join('；')).toBe(true); expect(before.counts).toEqual(allCounts); expect(before.charset).toBe('utf8mb4'); expect(before.collation).toBe('utf8mb4_bin'); const stalePlan = await preview(before), staleSibling = await preview(before); expect(stalePlan.error).toBeUndefined(); expect(staleSibling.error).toBeUndefined();
      await sql(`ALTER TABLE ${target('parent')} COMMENT='${marker}:changed'`); expect(await parentDefinition()).not.toBe(originalParent);
      const stale = await apply(stalePlan.value!); expect(stale.error).toBeInstanceOf(Error); expect(stale.facts).toHaveLength(1); expect(stale.facts.flatMap(fact => fact.writes)).toHaveLength(0); expect(await rows()).toEqual(originalRows); expect(await schema(subject)).toHaveLength(1); const staleBrother = await apply(staleSibling.value!); expect(staleBrother.error).toBeInstanceOf(Error); expect(staleBrother.facts).toHaveLength(0);
      await sql(`ALTER TABLE ${target('parent')} COMMENT='${marker}'`); expect(await parentDefinition()).toBe(originalParent); const restoredReplay = await apply(stalePlan.value!); expect(restoredReplay.error).toBeInstanceOf(Error); expect(restoredReplay.facts).toHaveLength(0);
      checkpoint = '真正删除Unicode反引号原名及六类对象'; const finalSource = await get(subject); expect(finalSource.writable, finalSource.reasons.join('；')).toBe(true); expect(finalSource.counts).toEqual(allCounts); const finalPlan = await preview(finalSource); expect(finalPlan.error).toBeUndefined(); expect(finalPlan.value!.sql).toContain('中文``库'); expect(await rows()).toEqual(originalRows);
      const applied = await apply(finalPlan.value!, true); expect(applied.error).toBeUndefined(); expect(applied.facts.flatMap(fact => fact.writes)).toEqual([finalPlan.value!.sql]); expect(applied.value).toMatchObject({ target: { connectionId: binding.profile.id, database: subject }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true }, warnings: [] }); await absent(subject);
      const replay = await apply(finalPlan.value!); expect(replay.error).toBeInstanceOf(Error); expect(replay.facts).toHaveLength(0); expect(await ledger()).toEqual(expectedLedger); expect(await sql(`SELECT id,CAST(parent_id AS CHAR) AS parent_id FROM ${neighbor('incoming')} ORDER BY id`)).toEqual([{ id: 1, parent_id: '2' }]);
      checkpoint = '精确令牌释放与原Engine关闭';
      for (const previewToken of previews) expect((await invoke('schema.databaseDrop.release', { previewToken })).error).toBeUndefined();
      for (const snapshotId of snapshots) expect((await invoke('schema.databaseDrop.release', { snapshotId })).error).toBeUndefined();
      await owner.step(() => engine!.closeAll()); const tasks = facts.filter(fact => fact.scope !== 'observer'); assertDatabaseDropReleased(tasks, false); const taskIds = [...new Set(tasks.map(fact => fact.id))];
      expect(facts.filter(fact => fact.scope !== 'observer').flatMap(fact => fact.writes)).toEqual([emptyPlan.value!.sql, finalPlan.value!.sql]);
      if (taskIds.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${taskIds.join(',')})`)).toHaveLength(0);
      expect(events.filter(event => event.databaseDrop && event.status === 'running')).not.toHaveLength(0);
      process.stdout.write(JSON.stringify({ 专项: '删除数据库', 阶段: '行为审计', 端口: binding.profile.port, 版本: observer.status.version, 方言: observer.status.dialect, 严格TLS: !!binding.profile.tls?.enabled, 实际TLS密码套件: tls[0].Value, 原资源数据库: databases, 空库真实删除: true, 六类对象真实删除: true, 内部外键由原生DROP处理: true, Unicode反引号精确原名: true, 逐字确认及兄弟消费拒绝零DDL: true, 旧目录漂移拒绝零DDL: true, 外库入向外键只读拒绝零DDL: true, 外库原行保持: true, 原任务严格收尾: true, 原任务线程残留: 0, Engine实际DDL次数: 2, 权限不足: '未验；本轮不创建用户或GRANT', 取消及部分失败断线: '本专项未验；不能据成功删除推断' }) + '\n');
      checkpoint = '独占外库所有权及全部原定义复核后清理';
      expect(await ledger()).toEqual(expectedLedger); expect(await schema(empty)).toHaveLength(0); expect(await schema(subject)).toHaveLength(0);
      expect(String((await sql(`SHOW CREATE DATABASE ${db(external)}`))[0]['Create Database'])).toBe(schemaDefinitions.get(external));
      expect(await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [external])).toEqual([{ name: 'incoming', marker, kind: 'BASE TABLE' }, { name: 'owner_ledger', marker, kind: 'BASE TABLE' }]);
      for (const name of ['owner_ledger', 'incoming']) expect(String((await sql(`SHOW CREATE TABLE ${neighbor(name)}`))[0]['Create Table'])).toBe(outsideDefinitions.get(name));
      expect(await objectCatalog(external)).toEqual({ TABLES: [{ name: 'incoming' }, { name: 'owner_ledger' }], ROUTINES: [], TRIGGERS: [], EVENTS: [] });
      expect(await sql('SELECT 1 FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY REFERENCED_TABLE_SCHEMA=BINARY ? AND BINARY TABLE_SCHEMA<>BINARY ? LIMIT 1', [external, external])).toHaveLength(0);
      if (states.get(external) !== 'confirmed' || !/^dbark_dbdrop_[a-f0-9]{32}_ref$/u.test(external)) throw Error('外部引用库归属未证明，拒绝清理');
      await sql('DROP DATABASE ' + db(external)); await absent(external); for (const name of databases) await absent(name);
      await owner.step(() => closeDatabaseDropObserver(observer!)); assertDatabaseDropReleased(facts, false); owner.finish(); complete = true; audit.watch = undefined; audit.check = undefined; audit.scope = '';
      process.stdout.write(JSON.stringify({ 专项: '删除数据库', 阶段: '精确清理', 端口: binding.profile.port, 已清理数据库: databases, 数据库残留: 0, 已关闭原生线程数: facts.length, 原任务线程残留: 0, observer原线程: observerId, Engine实际DDL次数: 2 }) + '\n');
    } catch (reason) {
      owner.stop(); retained = true;
      process.stdout.write(JSON.stringify({ 专项: '删除数据库', 保留现场: true, 检查点: checkpoint, 数据库: databases, 所有者标记: marker, 数据库状态: [...states].map(([name, state]) => ({ name, state })), 原错误: reason instanceof Error ? reason.message : String(reason), 已取得原生线程: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose, writes: fact.scope === 'observer' ? fact.writes.length : fact.writes })) }) + '\n');
      throw reason;
    } finally {
      // 失败后不启动DROP、重连、取消或重试；只释放已取得observer句柄，保留首因与原事实供Root核对。
      if (!complete && observer) try { await observer.close({ strict: true }); } catch { /* 保留原失败及未释放现场，不以清理覆盖首因。 */ }
    }
  });
});
