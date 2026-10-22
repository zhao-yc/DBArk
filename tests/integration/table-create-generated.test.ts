import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableCreateApplyOutput, TableCreateDraft, TableCreateGetOutput, TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import type { DatabaseEncodingConnectionFact, DatabaseEncodingLifetime } from '../helpers/databaseDefaultEncodingIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 仅旁观原连接及原资源回调；真实Engine和所有实际数据库响应不被替换。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { if (!audit.watch || !audit.check || !audit.scope) throw Error('新表生成列实库没有原owner'); audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed; } };
});

/** 默认及列表只登记定义；两个用途门均精确为1才允许进入目标绑定和驱动加载。 */
export function tableCreateGeneratedEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=') || value === 'list') && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_CREATE_GENERATED_TEST === '1';
}
/** 目录小整数只接受准确数字或其规范十进制原串，不转换观测值，不接纳前导零/小数/空白。 */
export function tableCreateGeneratedMetadataInteger(actual: unknown, expected: number): boolean {
  return Number.isSafeInteger(expected) && expected > 0 && (actual === expected || actual === String(expected));
}
let lifetime: DatabaseEncodingLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('新建表多生成列六实例实库（逐端口独立进程）', () => {
  it('真实CREATE含普通主键索引外键、VIRTUAL/STORED、精确写入和严格收尾；8.4另验前缀兼容', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableCreateGeneratedEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('新表生成列原验收仍保留现场，不自动重跑');
    // 复用已验证六端口/TLS/实际身份合同，但本用途有独立门，不借其它专项同时执行。
    const helpers = await import('../helpers/databaseDefaultEncodingIntegration');
    const binding = helpers.bindDatabaseEncodingTarget(() => { const raw = process.env; if (Object.hasOwn(raw, helpers.databaseEncodingGate)) throw Error('新表生成列实库不能同时配置数据库编码用途'); return { ...raw, [helpers.databaseEncodingGate]: raw.DBARK_TABLE_CREATE_GENERATED_TEST }; }, 'create-generated-' + context.task.id);
    const owner = lifetime = helpers.databaseEncodingLifetime(context, binding, () => { retained = true; }), facts: DatabaseEncodingConnectionFact[] = [], events: TaskEvent[] = [];
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined, allowedSql: string | undefined;
    let database = '', marker = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(helpers.watchDatabaseEncodingConnection(managed, scope, owner, () => allowedSql)); };
    try {
      // 原connection模块先完成importOriginal，再显式加载实际Engine，不能并行导入旁观遗漏的模块图。
      const modules = await owner.step(helpers.loadDatabaseEncodingModules), crypto = await owner.step(() => import('node:crypto')), quoting = await owner.step(() => import('../../src/engine/sql'));
      database = 'dbark_cgen_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-create-generated:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_cgen_[a-f0-9]{32}$/.test(database)) throw Error('新表生成列资源计划无效');
      const db = quoting.identifier(database), target = (name: string) => db + '.' + quoting.identifier(name), expectedTables = ['parent', 'subject'];
      process.stdout.write(JSON.stringify({ 专项: '新建表生成列', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port, 表: [...expectedTables, ...(binding.version === '8.4.11' ? ['prefixed'] : [])] }) + '\n');
      const fixtureWrites = new Set<string>();
      /** observer只允许明确登记的本库夹具写入；Engine写入另受原精确预览SQL审计。 */
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | null | Buffer)[] = []) => {
        if (/^(?:CREATE|DROP|INSERT|UPDATE|DELETE|ALTER|REPLACE|USE|SET)\b/i.test(statement) && !fixtureWrites.has(statement)) throw Error('新表生成列observer拒绝未登记写入');
        audit.scope = 'observer'; return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined; helpers.assertDatabaseEncodingIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('新表生成列原观察线程未知');
      engine = new modules.engine.Engine(event => events.push(event));
      /** 等原任务结果及该次实际所有流close；失败不重新连接或重投操作。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        audit.scope = crypto.randomUUID(); allowedSql = expectedSql; const offset = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(offset); for (const fact of actual) await owner.step(() => fact.closed); helpers.assertDatabaseEncodingReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      const createDb = `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`; fixtureWrites.add(createDb); databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(createDb)).warningStatus).toBe(0); databaseState = 'confirmed';
      const parent = `CREATE TABLE ${target('parent')} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:parent'`, parentRow = `INSERT INTO ${target('parent')} (id) VALUES (3)`; fixtureWrites.add(parent); fixtureWrites.add(parentRow); await sql(parent); await sql(parentRow);
      const design = (name: string, withForeign: boolean, withPrefix: boolean): TableCreateDraft => ({ database, name, engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: marker + ':' + name, columns: [
        { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, autoIncrement: false, comment: '' },
        { name: 'qty', type: 'INT', nullable: true, autoIncrement: false, comment: '' },
        { name: 'price', type: 'DECIMAL(20,6)', nullable: true, autoIncrement: false, comment: '' },
        { name: 'note', type: 'VARCHAR(100)', nullable: true, autoIncrement: false, comment: '' },
        { name: 'virtual_total', type: 'DECIMAL(30,6)', nullable: true, autoIncrement: false, comment: '虚拟结果', generated: { storage: 'VIRTUAL', expression: '+(qty * price)' } },
        { name: 'stored_total', type: 'DECIMAL(30,6)', nullable: true, autoIncrement: false, comment: '存储结果', generated: { storage: 'STORED', expression: 'qty * price + 1.000000' } },
      ], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_qty', unique: false, columns: ['qty'] }, ...(withPrefix ? [{ name: 'ix_note', unique: false, keyParts: [{ columnName: 'note', prefixLength: 10 }] }] : [])], foreignKeys: withForeign ? [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: database, referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }] : [] });
      const get = async (withPrefix = false) => { const result = await invoke<TableCreateGetOutput>('schema.tableCreate.get', { connectionId: binding.profile.id, database, includeGeneratedFacts: true, includeEncodings: true, ...(withPrefix ? { includePrefixFacts: true } : {}), taskId: crypto.randomUUID(), connectionRevision: 1 }); expect(result.error).toBeUndefined(); expect(result.value?.generatedAccess).toEqual({ editable: true }); expect(result.facts).toHaveLength(1); return result.value!; };
      const preview = (snapshot: TableCreateGetOutput, input: TableCreateDraft) => invoke<TableCreatePreviewOutput>('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: input, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = (value: TableCreatePreviewOutput, send: boolean, acks = value.requiredAcknowledgements) => invoke<TableCreateApplyOutput>('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation: database + '.' + value.target.table, acknowledgements: acks, taskId: crypto.randomUUID(), connectionRevision: 1 }, send ? value.sql : undefined);
      const operations: { name: string; verified: boolean; ddlCount: number; rowCount: number }[] = [];
      const cases: readonly (readonly [string, boolean, boolean])[] = [['subject', true, false], ...(binding.version === '8.4.11' ? [['prefixed', false, true] as const] : [])];
      for (const [name, withForeign, withPrefix] of cases) {
        const input = design(name, withForeign, withPrefix), snapshot = await get(withPrefix), planned = await preview(snapshot, input); expect(planned.error).toBeUndefined(); const value = planned.value!;
        expect(value.sql).toContain('GENERATED ALWAYS AS'); expect(value.sql).toContain('VIRTUAL'); expect(value.sql).toContain('STORED'); expect(value.sql).toContain('PRIMARY KEY (`id`)'); expect(value.sql.includes('FOREIGN KEY')).toBe(withForeign); expect(value.sql.includes('ROW_FORMAT=DYNAMIC')).toBe(withPrefix); expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'create-only-no-replay', 'generated-column-computation']); expect(planned.facts.flatMap(fact => fact.writes)).toEqual([]);
        // 缺第三确认的独立预览先消费；正常执行必须重新预览，不能补确认重放旧令牌。
        const rejected = await apply(value, false, value.requiredAcknowledgements.filter(id => id !== 'generated-column-computation')); expect(rejected.error).toBeInstanceOf(Error); expect(rejected.facts).toEqual([]); expect((await apply(value, false)).error).toBeInstanceOf(Error);
        const confirmed = await preview(snapshot, input); expect(confirmed.error).toBeUndefined(); const plan = confirmed.value!, result = await apply(plan, true); expect(result.error).toBeUndefined(); expect(result.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(result.facts.flatMap(fact => fact.writes)).toEqual([plan.sql]); expect((await apply(plan, false)).error).toBeInstanceOf(Error);
        const show = await sql(`SHOW CREATE TABLE ${target(name)}`); expect(show).toHaveLength(1); expect(show[0]['Create Table']).toContain(marker + ':' + name);
        const catalog = await sql('SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, name]); expect(catalog.map(row => row.COLUMN_NAME)).toEqual(['id', 'qty', 'price', 'note', 'virtual_total', 'stored_total']);
        catalog.forEach((row, index) => expect(tableCreateGeneratedMetadataInteger(row.ORDINAL_POSITION, index + 1)).toBe(true));
        expect(catalog[4]).toMatchObject({ COLUMN_NAME: 'virtual_total', COLUMN_TYPE: 'decimal(30,6)', IS_NULLABLE: 'YES', EXTRA: 'VIRTUAL GENERATED', COLUMN_COMMENT: '虚拟结果' }); expect(catalog[5]).toMatchObject({ COLUMN_NAME: 'stored_total', COLUMN_TYPE: 'decimal(30,6)', IS_NULLABLE: 'YES', EXTRA: 'STORED GENERATED', COLUMN_COMMENT: '存储结果' });
        const insert = `INSERT INTO ${target(name)} (id,qty,price,note) VALUES (18446744073709551615,3,9007199254.123456,?),(9007199254740993,NULL,NULL,?)`; fixtureWrites.add(insert); expect((await sql<{ affectedRows: number; warningStatus: number }>(insert, ['中文🙂', ''])).affectedRows).toBe(2);
        const actual = await sql(`SELECT CAST(id AS CHAR) AS id,CAST(qty AS CHAR) AS qty,CAST(price AS CHAR) AS price,note,CAST(virtual_total AS CHAR) AS virtual_total,CAST(stored_total AS CHAR) AS stored_total FROM ${target(name)} ORDER BY ${quoting.identifier(name)}.id`);
        expect(actual).toEqual([{ id: '9007199254740993', qty: null, price: null, note: '', virtual_total: null, stored_total: null }, { id: '18446744073709551615', qty: '3', price: '9007199254.123456', note: '中文🙂', virtual_total: '27021597762.370368', stored_total: '27021597763.370368' }]);
        const indexes = await sql('SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX', [database, name]);
        // 先严格检查原协议值，再仅规范已证小整数用于独立固定期望；spread保留未知字段，不能偷偷丢列。
        const checkedIndexes = indexes.map(row => { expect(tableCreateGeneratedMetadataInteger(row.SEQ_IN_INDEX, 1)).toBe(true); const prefix = withPrefix && row.INDEX_NAME === 'ix_note'; if (prefix) expect(tableCreateGeneratedMetadataInteger(row.SUB_PART, 10)).toBe(true); else expect(row.SUB_PART).toBeNull(); return { ...row, SEQ_IN_INDEX: 1, ...(prefix ? { SUB_PART: 10 } : {}) }; });
        expect(checkedIndexes).toEqual([{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, SUB_PART: null }, ...(withPrefix ? [{ INDEX_NAME: 'ix_note', COLUMN_NAME: 'note', SEQ_IN_INDEX: 1, SUB_PART: 10 }] : []), { INDEX_NAME: 'ix_qty', COLUMN_NAME: 'qty', SEQ_IN_INDEX: 1, SUB_PART: null }]);
        operations.push({ name, verified: result.value!.definitionVerified, ddlCount: result.facts.flatMap(fact => fact.writes).length, rowCount: actual.length }); if (name === 'prefixed') expectedTables.push(name);
      }
      await owner.step(() => engine!.closeAll()); for (const fact of facts.filter(fact => fact.scope !== 'observer')) await owner.step(() => fact.closed); helpers.assertDatabaseEncodingReleased(facts.filter(fact => fact.scope !== 'observer'), false);
      const threadIds = [...new Set(facts.filter(fact => fact.scope !== 'observer').map(fact => fact.id))]; expect(threadIds.every(id => Number.isSafeInteger(id) && id > 0)).toBe(true); if (threadIds.length) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + threadIds.join(',') + ')')).toEqual([]);
      const owned = await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY TABLE_NAME', [database]); expect(owned).toEqual(expectedTables.sort().map(name => ({ name, marker: marker + ':' + name })));
      if (databaseState !== 'confirmed') throw Error('新表生成列库归属未确认，不执行清理'); const drop = 'DROP DATABASE ' + db; fixtureWrites.add(drop); await sql(drop); expect(await sql(exists, [database])).toEqual([]); databaseState = 'absent';
      await owner.step(() => helpers.closeDatabaseEncodingObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); helpers.assertDatabaseEncodingReleased(facts, false); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '新建表生成列', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 原观察线程: observerId, 操作: operations, 原任务线程残留: 0, 已清理数据库: database, 数据库残留: 0, 原流全部关闭: true, 未验: ['原生界面', '安装包', 'Mac', '权限失败和取消仅RAM专项，本轮实库未注入'] }) + '\n');
    } catch (error) { retained = true; owner.stop(); throw error; }
  });
});
