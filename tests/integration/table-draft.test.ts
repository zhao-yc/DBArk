import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, RowChange, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { TableDraftDocument } from '../../src/shared/tableDraft';
import type { DatabaseEncodingLifetime } from '../helpers/databaseDefaultEncodingIntegration';
import type { TableStatisticsConnectionFact } from '../helpers/tableStatisticsIntegration';
import { selectTableDraftProcesslist, tableDraftProcesslistNeedsCapability, tableDraftProcesslistQuery, assertTableDraftProcesslistVisible, assertTableDraftNoWarnings, assertTableDraftProcesslistWarnings, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), identity: undefined as undefined | ((managed: ManagedConnection) => Promise<void>), scope: '' }));
/** 原参数与实际句柄透传，每个产品连接在使用前核真实身份；默认双门外不加载驱动模块图。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.identity || !audit.scope) throw Error('草稿实库缺少原owner或身份核查');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope);
    try { await audit.identity(managed); }
    catch (error) { try { await managed.close({ strict: true }); } catch (closing) { throw new AggregateError([error, closing], '草稿实际身份与原连接收尾均失败'); } throw error; }
    return managed;
  } };
});

/** list先行于环境内容，关闭门不读取账号、证书或加载真实Engine。 */
export function tableDraftEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=') || value === 'list') && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_DRAFT_TEST === '1';
}

let lifetime: DatabaseEncodingLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('显式表格草稿只读复核六实例（默认关闭）', () => {
  it('精度混合草稿保旧值且零DML，并发改行/删行/重复原行/结构变化整次拒绝', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableDraftEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('草稿原验收保留现场，不自动重跑');
    const helpers = await import('../helpers/databaseDefaultEncodingIntegration');
    const binding = helpers.bindDatabaseEncodingTarget(() => {
      const raw = process.env; if (Object.hasOwn(raw, helpers.databaseEncodingGate)) throw Error('草稿用途不能与数据库编码用途重叠');
      return { ...raw, [helpers.databaseEncodingGate]: raw.DBARK_TABLE_DRAFT_TEST };
    }, 'tabledraft-' + context.task.id);
    const owner = lifetime = helpers.databaseEncodingLifetime(context, binding, () => { retained = true; });
    const watch = await owner.step(() => import('../helpers/tableDraftIntegration'));
    const released = await owner.step(() => import('../helpers/tableStatisticsIntegration'));
    const facts: TableStatisticsConnectionFact[] = [], events: TaskEvent[] = [], fixtureWrites = new Set<string>();
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check;
    audit.watch = (managed, scope) => { if (facts.some(fact => fact.managed === managed)) throw Error('草稿原连接重复登记'); facts.push(watch.watchTableDraftConnection(managed, scope, owner, fixtureWrites)); };
    try {
      const modules = await owner.step(helpers.loadDatabaseEncodingModules), crypto = await owner.step(() => import('node:crypto'));
      const quoting = await owner.step(() => import('../../src/engine/sql')), codec = await owner.step(() => import('../../src/shared/tableDraft'));
      const metadata = await owner.step(() => import('../../src/shared/tableCopySource'));
      audit.identity = async managed => {
        owner.check();
        const identity = (await modules.connection.execute(managed, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames')).rows;
        const uuid = binding.dialect === 'mysql' ? (await modules.connection.execute(managed, 'SELECT @@server_uuid AS uuid')).rows : undefined;
        helpers.assertDatabaseEncodingIdentity(identity, binding, managed.status, uuid);
        owner.check();
      };
      database = 'dbark_tabledraft_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-table-draft:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_tabledraft_[a-f0-9]{32}$/.test(database)) throw Error('草稿随机资源名无效');
      const db = quoting.identifier(database), table = db + '.`subject`';
      process.stdout.write(JSON.stringify({ 专项: '表格草稿', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port, 对象: ['subject'] }) + '\n');
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('草稿原观察线程未知');
      /** 原始读端口总是保留准确告警计数与完整原诊断；不会按SQL字串放行告警。 */
      const readObserver = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer';
        const result = await owner.step(() => modules.connection.execute<T>(observer!, statement, values));
        const count = await owner.step(() => modules.connection.execute<unknown[]>(observer!, 'SHOW COUNT(*) WARNINGS'));
        const warnings = await owner.step(() => modules.connection.execute<unknown[]>(observer!, 'SHOW WARNINGS'));
        return { ...result, count: count.rows, warnings: warnings.rows };
      };
      /** 普通查询、夹具控制和写入维持原零警告门，写入还必须精确登记。 */
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []): Promise<T> => {
        if (!/^(?:SELECT|SHOW)\b/i.test(statement) && !fixtureWrites.has(statement)) throw Error('草稿observer写入未登记');
        const result = await readObserver<T>(statement, values);
        assertTableDraftNoWarnings(result.count, result.warnings);
        expect(result.warnings).toEqual([]);
        if (!/^(?:SELECT|SHOW)\b/i.test(statement)) expect((result.rows as { warningStatus: number }).warningStatus).toBe(0);
        return result.rows;
      };
      const capability = tableDraftProcesslistNeedsCapability(observer.status.dialect, observer.status.version) ? await sql('SELECT @@performance_schema AS enabled') : undefined;
      const processlist = selectTableDraftProcesslist(observer.status.dialect, observer.status.version, capability);
      /** 唯一告警例外只属于此专用受控请求；其它SQL不能调用此路径。 */
      const readProcesslist = async (request: TableDraftProcesslistRequest) => {
        const query = tableDraftProcesslistQuery(processlist, request), result = await readObserver<unknown[]>(query.sql, query.values);
        assertTableDraftProcesslistWarnings(processlist, result.count, result.warnings);
        return result.rows;
      };
      const observerVisible = async () => assertTableDraftProcesslistVisible(await readProcesslist({ kind: 'ids', ids: [observerId!] }), observerId!);
      await observerVisible();
      /** 每次清理断言之前先证明原审计源可见，不能只凭P_S空表追认无残留。 */
      const auditEmpty = async (statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        await observerVisible();
        expect(await sql(statement, values)).toEqual([]);
      };
      const auditProcessesEmpty = async (request: TableDraftProcesslistRequest) => { await observerVisible(); expect(await readProcesslist(request)).toEqual([]); };
      engine = new modules.engine.Engine(event => events.push(event));
      /** 每个原命令只投递一次，等待原handle、原strict close、原流与pending同时完成。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>) => {
        audit.scope = command + ':' + crypto.randomUUID(); const offset = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T, error: undefined }; } catch (error) { return { value: undefined, error }; } });
        const actual = facts.slice(offset);
        for (const fact of actual) await owner.step(() => fact.closed);
        released.assertTableStatisticsReleased(actual, command !== 'connections.open');
        return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)'; expect(await sql(exists, [database])).toEqual([]);
      const createDatabase = `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`; fixtureWrites.add(createDatabase); databaseState = 'unknown'; await sql(createDatabase); databaseState = 'confirmed';
      const createTable = `CREATE TABLE ${table} (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,big_value BIGINT UNSIGNED NULL,amount DECIMAL(30,12) NULL,at_value DATETIME(6) NULL,nullable_text VARCHAR(32) NULL,payload BLOB NULL,doc JSON NULL,note VARCHAR(64) NOT NULL DEFAULT '默认值') ENGINE=InnoDB COMMENT='${marker}:subject'`;
      fixtureWrites.add(createTable); await sql(createTable);
      const seed = `INSERT INTO ${table} VALUES (9007199254740993,18446744073709551615,9007199254740993.123456789012,'2026-10-27 12:34:56.123456',NULL,X'00FF','{"n":18446744073709551615,"text":"中文😀"}','Alpha'),(9007199254740994,18446744073709551614,-9007199254740993.123456789011,'2026-10-27 12:34:56.123457','',X'','null','Beta'),(9007199254740995,NULL,NULL,NULL,NULL,NULL,NULL,'Gamma'),(9007199254740996,18446744073709551615,9007199254740993.123456789012,'2026-10-27 12:34:56.123456',NULL,NULL,NULL,'Precision')`;
      fixtureWrites.add(seed); await sql(seed);
      const exactRead = `SELECT CAST(id AS CHAR) AS id,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,CAST(at_value AS CHAR) AS at_value,nullable_text,HEX(payload) AS payload_hex,JSON_TYPE(doc) AS doc_kind,JSON_UNQUOTE(JSON_EXTRACT(doc,'$.n')) AS doc_n,note FROM ${table} ORDER BY id`;
      let baseline = await sql(exactRead);
      expect(baseline).toEqual([
        { id: '9007199254740993', big_value: '18446744073709551615', amount: '9007199254740993.123456789012', at_value: '2026-10-27 12:34:56.123456', nullable_text: null, payload_hex: '00FF', doc_kind: 'OBJECT', doc_n: '18446744073709551615', note: 'Alpha' },
        { id: '9007199254740994', big_value: '18446744073709551614', amount: '-9007199254740993.123456789011', at_value: '2026-10-27 12:34:56.123457', nullable_text: '', payload_hex: '', doc_kind: 'NULL', doc_n: null, note: 'Beta' },
        { id: '9007199254740995', big_value: null, amount: null, at_value: null, nullable_text: null, payload_hex: null, doc_kind: null, doc_n: null, note: 'Gamma' },
        { id: '9007199254740996', big_value: '18446744073709551615', amount: '9007199254740993.123456789012', at_value: '2026-10-27 12:34:56.123456', nullable_text: null, payload_hex: null, doc_kind: null, doc_n: null, note: 'Precision' },
      ]);
      const base = { connectionId: binding.profile.id, database, table: 'subject' };
      const readInfo = async () => { const result = await invoke<TableInfo>('metadata.table', { ...base, taskId: crypto.randomUUID() }); expect(result.error).toBeUndefined(); expect(result.value).toMatchObject({ database, name: 'subject', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'] }); return result.value!; };
      const readRows = async () => (await sql(`SELECT * FROM ${table} ORDER BY id`)).map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, quoting.serializeCell(value)])) as DataRow);
      const source = await readInfo(), originals = await readRows();
      expect(originals).toHaveLength(4); expect(originals[0]).toMatchObject({ id: '9007199254740993', big_value: '18446744073709551615', amount: '9007199254740993.123456789012', payload: { type: 'binary', base64: 'AP8=' }, nullable_text: null });
      expect(originals[1]).toMatchObject({ payload: { type: 'binary', base64: '' }, nullable_text: '' });
      const changes: RowChange[] = [{ kind: 'update', before: structuredClone(originals[0]), values: { id: '9007199254741993', note: '改键草稿' } }, { kind: 'delete', before: structuredClone(originals[1]) }, { kind: 'insert', values: { id: '9007199254741999' } }];
      const document: TableDraftDocument = { kind: 'dbark.table-draft', version: 1, endpointKey: '0'.repeat(64), target: base, metadataKey: metadata.tableCopyMetadataKey(source), changes };
      const encoded = codec.encodeTableDraft(document), decoded = codec.decodeTableDraft(encoded); expect(decoded).toEqual(document); expect(decoded.changes[2]).toEqual({ kind: 'insert', values: { id: '9007199254741999' } });
      const verify = (selected: Pick<TableDraftDocument, 'metadataKey' | 'changes'>) => invoke<{ verifiedChanges: number }>('table.draftVerify', { ...base, taskId: crypto.randomUUID(), metadataKey: selected.metadataKey, changes: selected.changes });
      const checked = await verify(decoded); expect(checked.error).toBeUndefined(); expect(checked.value).toEqual({ verifiedChanges: 3 }); expect(codec.encodeTableDraft(decoded)).toBe(encoded); expect(await sql(exactRead)).toEqual(baseline);
      // 专用第四行不影响原混合/并发/删除场景。每轮在修改前重读完整before，
      // 使其余字段与当时服务器完全相同，不能借上一轮已不匹配的字段掩盖精度丢失。
      const precisionId = '9007199254740996';
      const precisionCases = [
        { name: 'UINT64相邻值', column: 'big_value', before: '18446744073709551615', after: '18446744073709551614', literal: '18446744073709551614' },
        { name: 'DECIMAL末位', column: 'amount', before: '9007199254740993.123456789012', after: '9007199254740993.123456789013', literal: '9007199254740993.123456789013' },
        { name: 'DATETIME微秒', column: 'at_value', before: '2026-10-27 12:34:56.123456', after: '2026-10-27 12:34:56.123457', literal: "'2026-10-27 12:34:56.123457'" },
      ] as const;
      for (const sample of precisionCases) {
        const actualBefore = await sql(exactRead); expect(actualBefore).toEqual(baseline);
        const exactBefore = actualBefore.find(row => row.id === precisionId); expect(exactBefore).toBeDefined(); expect(exactBefore![sample.column]).toBe(sample.before);
        const current = (await readRows()).find(row => row.id === precisionId); expect(current).toBeDefined(); expect(current![sample.column]).toBe(sample.before);
        const selected: Pick<TableDraftDocument, 'metadataKey' | 'changes'> = { metadataKey: decoded.metadataKey, changes: [{ kind: 'update', before: structuredClone(current!), values: { note: '不得写入精度草稿' } }] };
        const fixedInput = structuredClone(selected);
        const mutate = `UPDATE ${table} SET ${quoting.identifier(sample.column)}=${sample.literal} WHERE id=${precisionId}`; fixtureWrites.add(mutate); await sql(mutate);
        const expectedAfter = baseline.map(row => row.id === precisionId ? { ...row, [sample.column]: sample.after } : row);
        const actualAfter = await sql(exactRead); expect(actualAfter).toEqual(expectedAfter);
        const rejected = await verify(selected); expect(rejected.error).toBeInstanceOf(Error); expect((rejected.error as Error).message).toContain('原始行已变化或不存在');
        expect(selected).toEqual(fixedInput); expect(await sql(exactRead)).toEqual(expectedAfter);
        process.stdout.write(JSON.stringify({ 专项: '表格草稿', 阶段: '精度单值拒绝', 类型: sample.name, 列: sample.column, 原行: exactBefore, 新行: actualAfter.find(row => row.id === precisionId), 原任务线程: rejected.facts.map(fact => fact.id), 产品DML: 0 }) + '\n');
        baseline = expectedAfter;
      }
      const duplicate = await verify({ metadataKey: decoded.metadataKey, changes: [{ kind: 'delete', before: structuredClone(originals[0]) }, { kind: 'update', before: structuredClone(originals[0]), values: { note: '重复草稿' } }] });
      expect(duplicate.error).toBeInstanceOf(Error); expect((duplicate.error as Error).message).toContain('同一原始行'); expect(await sql(exactRead)).toEqual(baseline);
      const externalUpdate = `UPDATE ${table} SET note='外部更新' WHERE id=9007199254740993`; fixtureWrites.add(externalUpdate); await sql(externalUpdate);
      const afterConcurrent = baseline.map((row, index) => index === 0 ? { ...row, note: '外部更新' } : row); expect(await sql(exactRead)).toEqual(afterConcurrent);
      const conflict = await verify(decoded); expect(conflict.error).toBeInstanceOf(Error); expect((conflict.error as Error).message).toContain('原始行已变化或不存在'); expect(codec.encodeTableDraft(decoded)).toBe(encoded); expect(await sql(exactRead)).toEqual(afterConcurrent);
      const externalDelete = `DELETE FROM ${table} WHERE id=9007199254740994`; fixtureWrites.add(externalDelete); await sql(externalDelete);
      const missing = await verify({ metadataKey: metadata.tableCopyMetadataKey(await readInfo()), changes: [{ kind: 'delete', before: structuredClone(originals[1]) }] });
      expect(missing.error).toBeInstanceOf(Error); expect((missing.error as Error).message).toContain('原始行已变化或不存在');
      const afterDelete = afterConcurrent.filter(row => row.id !== '9007199254740994'); expect(await sql(exactRead)).toEqual(afterDelete);
      const beforeDdl = await readInfo(), alter = `ALTER TABLE ${table} ADD COLUMN extra_col INT NULL DEFAULT NULL`; fixtureWrites.add(alter); await sql(alter);
      const stale = await verify({ metadataKey: metadata.tableCopyMetadataKey(beforeDdl), changes: [{ kind: 'insert', values: { id: '9007199254742999' } }] });
      expect(stale.error).toBeInstanceOf(Error); expect((stale.error as Error).message).toContain('表结构或可靠定位键已变化'); expect(await sql(exactRead)).toEqual(afterDelete);
      const freshInfo = await readInfo(), freshRows = await readRows(); expect(freshRows).toHaveLength(3); expect(freshRows.every(row => Object.hasOwn(row, 'extra_col') && row.extra_col === null)).toBe(true);
      const fresh = await verify({ metadataKey: metadata.tableCopyMetadataKey(freshInfo), changes: [{ kind: 'delete', before: structuredClone(freshRows[1]) }, { kind: 'insert', values: { id: '9007199254743999' } }] });
      expect(fresh.error).toBeUndefined(); expect(fresh.value).toEqual({ verifiedChanges: 2 }); expect(await sql(exactRead)).toEqual(afterDelete);
      const products = facts.filter(fact => fact.scope !== 'observer');
      for (const fact of products) expect(fact.commands.every(command => /^(?:SELECT|SHOW)\b/i.test(command.sql) || (watch.tableDraftReadControls as readonly string[]).includes(command.sql))).toBe(true);
      const verifierFacts = products.filter(fact => fact.scope.startsWith('table.draftVerify:')); expect(verifierFacts).toHaveLength(9);
      expect(verifierFacts.every(fact => fact.commands.some(command => command.sql === 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY') && fact.commands.some(command => command.sql === 'ROLLBACK AND NO CHAIN NO RELEASE'))).toBe(true);
      await owner.step(() => engine!.closeAll()); for (const fact of products) await owner.step(() => fact.closed); released.assertTableStatisticsReleased(products, false);
      const threadIds = [...new Set(products.map(fact => fact.id))]; expect(threadIds.every(id => Number.isSafeInteger(id) && id > 0)).toBe(true);
      if (threadIds.length) { await auditProcessesEmpty({ kind: 'ids', ids: threadIds }); await auditEmpty('SELECT trx_mysql_thread_id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id IN (' + threadIds.join(',') + ')'); }
      expect(await sql('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS marker FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(? AS BINARY) ORDER BY CAST(TABLE_NAME AS BINARY)', [database])).toEqual([{ name: 'subject', kind: 'BASE TABLE', marker: marker + ':subject' }]);
      await auditEmpty('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(TRIGGER_SCHEMA AS BINARY)=CAST(? AS BINARY)', [database]);
      await auditEmpty('SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE CAST(ROUTINE_SCHEMA AS BINARY)=CAST(? AS BINARY)', [database]);
      await auditEmpty('SELECT EVENT_NAME FROM information_schema.EVENTS WHERE CAST(EVENT_SCHEMA AS BINARY)=CAST(? AS BINARY)', [database]);
      if (databaseState !== 'confirmed') throw Error('草稿本例库归属未知，不执行清理'); const drop = 'DROP DATABASE ' + db; fixtureWrites.add(drop); await sql(drop); await auditEmpty(exists, [database]); databaseState = 'absent';
      await owner.step(() => helpers.closeDatabaseEncodingObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); released.assertTableStatisticsReleased(facts, false); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '表格草稿', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 所有者标记: marker, 原观察线程: observerId, 原任务线程: threadIds, 原任务线程数量: threadIds.length, 原任务线程残留: 0, 原任务事务残留: 0, 数据库残留: 0, 原流全部关闭: true, 复核任务数: verifierFacts.length, 产品DML: 0, 混合草稿核验: 3, 新结构草稿核验: 2, 精度单值拒绝: precisionCases.map(sample => sample.name), 拒绝: ['UINT64相邻值', 'DECIMAL末位', 'DATETIME微秒', '重复原行', '并发改行', '原行删除', '结构变化'], 未验: ['系统文件输入', '主进程端点绑定', 'GUI', '安装包', 'macOS', '真实锁取消', '百万行', 'COMMIT未知'] }) + '\n');
    } catch (error) {
      retained = true; owner.stop();
      process.stdout.write(JSON.stringify({ 专项: '表格草稿', 阶段: '保留', 数据库: database, 所有者标记: marker, 库状态: databaseState, 原连接: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose, closed: fact.stream.closed, commands: fact.commands.map(command => command.sql) })), 自动重试: false, 自动补清理: false }) + '\n');
      throw error;
    }
  });
});
