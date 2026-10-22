import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableCreateApplyOutput, TableCreateDraft, TableCreateGetOutput, TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import type { DatabaseEncodingConnectionFact, DatabaseEncodingLifetime } from '../helpers/databaseDefaultEncodingIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 真连接及回调透传，只观察本例原对象；未显式双门时不载入数据库模块。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { if (!audit.watch || !audit.check || !audit.scope) throw Error('列级编码实库没有原owner'); audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed; } };
});
/** 默认及列表仅登记定义；此用途双门精确为1才可读取目标配置。 */
export function tableCreateColumnEncodingEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=') || value === 'list') && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST === '1';
}
/** 原协议的小整数只能是准确number或规范原串；不转换观测值。 */
export function tableCreateColumnEncodingInteger(actual: unknown, expected: number): boolean {
  return Number.isSafeInteger(expected) && expected > 0 && (actual === expected || actual === String(expected));
}
let lifetime: DatabaseEncodingLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('新建表列级完整编码六实例实库（默认关闭，逐端口独立进程）', () => {
  it('真实目录配对、生成列和普通外键、精确字节及8.4按列字符集前缀预算', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableCreateColumnEncodingEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('列级编码原验收保留现场，不自动重跑');
    const helpers = await import('../helpers/databaseDefaultEncodingIntegration');
    const binding = helpers.bindDatabaseEncodingTarget(() => { const raw = process.env; if (Object.hasOwn(raw, helpers.databaseEncodingGate) || Object.hasOwn(raw, 'DBARK_TABLE_CREATE_GENERATED_TEST')) throw Error('列级编码不能借其它实库用途并行'); return { ...raw, [helpers.databaseEncodingGate]: raw.DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST }; }, 'create-column-encoding-' + context.task.id);
    const owner = lifetime = helpers.databaseEncodingLifetime(context, binding, () => { retained = true; }), facts: DatabaseEncodingConnectionFact[] = [], events: TaskEvent[] = [];
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined, allowedSql: string | undefined;
    let database = '', marker = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(helpers.watchDatabaseEncodingConnection(managed, scope, owner, () => allowedSql)); };
    try {
      // 先完成原connection的importOriginal，再显式载入同一模块图的真实Engine。
      const modules = await owner.step(helpers.loadDatabaseEncodingModules), crypto = await owner.step(() => import('node:crypto')), quoting = await owner.step(() => import('../../src/engine/sql'));
      database = 'dbark_ccenc_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-create-column-encoding:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_ccenc_[a-f0-9]{32}$/.test(database)) throw Error('列级编码独占资源计划不合法');
      const db = quoting.identifier(database), target = (name: string) => db + '.' + quoting.identifier(name), expectedTables = ['parent', 'subject'];
      process.stdout.write(JSON.stringify({ 专项: '新建表列级编码', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port, 表: [...expectedTables, ...(binding.version === '8.4.11' ? ['prefixed'] : [])] }) + '\n');
      const fixtureWrites = new Set<string>();
      /** observer的写入也必须属于本例准确SQL计划；Engine另受原预览SQL白名单。 */
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | null | Buffer)[] = []) => {
        if (/^(?:CREATE|DROP|INSERT|UPDATE|DELETE|ALTER|REPLACE|USE|SET)\b/i.test(statement) && !fixtureWrites.has(statement)) throw Error('列级编码observer拒绝未登记写入');
        audit.scope = 'observer'; return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined; helpers.assertDatabaseEncodingIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('列级编码原观察线程未知');
      engine = new modules.engine.Engine(event => events.push(event));
      /** 每个真实任务原终态后还必须等其原流close，不能超时换连接或重投。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        audit.scope = crypto.randomUUID(); allowedSql = expectedSql; const offset = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(offset); for (const fact of actual) await owner.step(() => fact.closed); helpers.assertDatabaseEncodingReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      const createDb = `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`; fixtureWrites.add(createDb); databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(createDb)).warningStatus).toBe(0); databaseState = 'confirmed';
      const parent = `CREATE TABLE ${target('parent')} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:parent'`, parentRow = `INSERT INTO ${target('parent')} (id) VALUES (3)`; fixtureWrites.add(parent); fixtureWrites.add(parentRow); await sql(parent); await sql(parentRow);
      const get = (prefix = false) => invoke<TableCreateGetOutput>('schema.tableCreate.get', { connectionId: binding.profile.id, database, includeEncodings: true, includeGeneratedFacts: true, ...(prefix ? { includePrefixFacts: true } : {}), taskId: crypto.randomUUID(), connectionRevision: 1 });
      const preview = (snapshot: TableCreateGetOutput, input: TableCreateDraft) => invoke<TableCreatePreviewOutput>('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: input, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = (value: TableCreatePreviewOutput, send: boolean, confirmation = database + '.' + value.target.table) => invoke<TableCreateApplyOutput>('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation, acknowledgements: value.requiredAcknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, send ? value.sql : undefined);
      const operations: { name: string; verified: boolean; ddlCount: number; rowCount: number }[] = [];
      for (const name of ['subject', ...(binding.version === '8.4.11' ? ['prefixed'] : [])]) {
        const prefix = name === 'prefixed', got = await get(prefix); expect(got.error).toBeUndefined(); const snapshot = got.value!; expect(snapshot.generatedAccess).toEqual({ editable: true }); expect(snapshot.encodings?.reasons).toEqual([]); expect(snapshot.encodings?.digest).toMatch(/^[a-f0-9]{64}$/);
        // 必须从本次完整真实目录精确选择，不从名字前缀或配置推造配对。
        const candidates = snapshot.encodings!.candidates, unicode = candidates.find(pair => pair.charset === 'utf8mb4' && pair.collation === 'utf8mb4_bin'), western = candidates.find(pair => pair.charset === 'latin1' && pair.collation === 'latin1_bin'), tablePair = candidates.find(pair => pair.charset === 'utf8mb4' && pair.collation === 'utf8mb4_general_ci'); expect(unicode).toBeDefined(); expect(western).toBeDefined(); expect(tablePair).toBeDefined();
        const input: TableCreateDraft = { database, name, engine: 'InnoDB', charset: tablePair!.charset, collation: tablePair!.collation, comment: marker + ':' + name, columns: [
          { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, autoIncrement: false, comment: '' }, { name: 'qty', type: 'INT', nullable: true, autoIncrement: false, comment: '' },
          { name: 'u8', type: 'VARCHAR(100)', nullable: true, autoIncrement: false, comment: '逐列Unicode', collation: { ...unicode! } },
          { name: 'latin', type: prefix ? 'VARCHAR(4000)' : 'VARCHAR(100)', nullable: true, autoIncrement: false, comment: '逐列单字节', collation: { ...western! } },
          { name: 'memo', type: 'TEXT', nullable: true, autoIncrement: false, comment: '逐列长文本', collation: { ...unicode! } },
          { name: 'computed', type: 'DECIMAL(20,2)', nullable: true, autoIncrement: false, comment: '精确生成', generated: { storage: 'STORED', expression: 'qty * 1.00' } },
        ], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_qty', unique: false, columns: ['qty'] }, ...(prefix ? [{ name: 'ix_latin', unique: false, keyParts: [{ columnName: 'latin', prefixLength: 3072 }] }] : [])], foreignKeys: prefix ? [] : [{ name: 'fk_qty', columns: ['qty'], referencedDatabase: database, referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }] };
        if (prefix) { const over = structuredClone(input); over.indexes[2] = { name: 'ix_latin', unique: false, keyParts: [{ columnName: 'latin', prefixLength: 3073 }] }; const refused = await preview(snapshot, over); expect(refused.error).toBeInstanceOf(Error); expect(refused.facts.flatMap(fact => fact.writes)).toEqual([]); }
        const planned = await preview(snapshot, input); expect(planned.error).toBeUndefined(); const value = planned.value!; expect(planned.facts.flatMap(fact => fact.writes)).toEqual([]);
        expect(value.columnEncodings).toEqual({ catalogDigest: snapshot.encodings!.digest, selections: [{ ordinal: 2, name: 'u8', ...unicode! }, { ordinal: 3, name: 'latin', ...western! }, { ordinal: 4, name: 'memo', ...unicode! }] }); expect(value.sql).toContain('CHARACTER SET latin1 COLLATE latin1_bin'); expect(value.sql).toContain('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); expect(value.sql.includes('ROW_FORMAT=DYNAMIC')).toBe(prefix); expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'create-only-no-replay', 'generated-column-computation']);
        const rejected = await apply(value, false, database + '.' + name + ' '); expect(rejected.error).toBeInstanceOf(Error); expect(rejected.facts).toEqual([]); expect((await apply(value, false)).error).toBeInstanceOf(Error);
        const confirmed = await preview(snapshot, input); expect(confirmed.error).toBeUndefined(); const plan = confirmed.value!, result = await apply(plan, true);
        // 断言前保留实际完成/核验/收尾事实；不输出凭据、SQL正文或原始驱动错误。
        process.stdout.write(JSON.stringify({ 专项: '新建表列级编码', 阶段: '原CREATE结果', 目标: { database, table: name }, ddlSubmitted: result.value?.ddlSubmitted ?? null, ddlCompleted: result.value?.ddlCompleted ?? null, definitionVerified: result.value?.definitionVerified ?? null, resourcesReleased: result.value?.resourcesReleased ?? null, warnings: result.value?.warnings ?? null }) + '\n');
        expect(result.error).toBeUndefined(); expect(result.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(result.facts.flatMap(fact => fact.writes)).toEqual([plan.sql]); expect((await apply(plan, false)).error).toBeInstanceOf(Error);
        const show = await sql(`SHOW CREATE TABLE ${target(name)}`); expect(show).toHaveLength(1); expect(typeof show[0]['Create Table']).toBe('string'); const observedShow = show[0]['Create Table'] as string; expect(observedShow).toContain(marker + ':' + name);
        expect(observedShow).toMatch(/`u8`\s+varchar\(100\)(?:\s+CHARACTER SET utf8mb4)?\s+COLLATE utf8mb4_bin\b/i); expect(observedShow).toMatch(new RegExp('`latin`\\s+varchar\\(' + (prefix ? '4000' : '100') + '\\)\\s+CHARACTER SET latin1\\s+COLLATE latin1_bin\\b', 'i')); expect(observedShow).toMatch(/`memo`\s+text(?:\s+CHARACTER SET utf8mb4)?\s+COLLATE utf8mb4_bin\b/i);
        const columns = await sql('SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, name]); expect(columns.map(row => row.COLUMN_NAME)).toEqual(['id', 'qty', 'u8', 'latin', 'memo', 'computed']); columns.forEach((row, index) => { expect(tableCreateColumnEncodingInteger(row.ORDINAL_POSITION, index + 1)).toBe(true); expect(row.COLUMN_DEFAULT === null || binding.dialect === 'mariadb' && row.COLUMN_DEFAULT === 'NULL').toBe(true); if (index !== 5) expect(row.GENERATION_EXPRESSION === null || row.GENERATION_EXPRESSION === '').toBe(true); else { expect(typeof row.GENERATION_EXPRESSION).toBe('string'); expect(row.GENERATION_EXPRESSION).not.toBe(''); } });
        expect(columns[2]).toMatchObject({ COLUMN_TYPE: 'varchar(100)', IS_NULLABLE: 'YES', CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin', EXTRA: '', COLUMN_COMMENT: '逐列Unicode' }); expect(columns[3]).toMatchObject({ COLUMN_TYPE: prefix ? 'varchar(4000)' : 'varchar(100)', IS_NULLABLE: 'YES', CHARACTER_SET_NAME: 'latin1', COLLATION_NAME: 'latin1_bin', EXTRA: '', COLUMN_COMMENT: '逐列单字节' }); expect(columns[4]).toMatchObject({ COLUMN_TYPE: 'text', IS_NULLABLE: 'YES', CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin', EXTRA: '', COLUMN_COMMENT: '逐列长文本' }); expect(columns[5]).toMatchObject({ COLUMN_TYPE: 'decimal(20,2)', IS_NULLABLE: 'YES', CHARACTER_SET_NAME: null, COLLATION_NAME: null, EXTRA: 'STORED GENERATED', COLUMN_COMMENT: '精确生成' });
        const insert = `INSERT INTO ${target(name)} (id,qty,u8,latin,memo) VALUES (18446744073709551615,3,?,?,?),(9007199254740993,NULL,NULL,NULL,NULL)`; fixtureWrites.add(insert); const inserted = await sql<{ affectedRows: number; warningStatus: number }>(insert, ['中文🙂', 'Caféÿ', '逐列编码']); expect(inserted.affectedRows).toBe(2); expect(inserted.warningStatus).toBe(0);
        const actual = await sql(`SELECT CAST(id AS CHAR) AS id,CAST(qty AS CHAR) AS qty,u8,latin,memo,HEX(u8) AS u8hex,HEX(latin) AS latinhex,HEX(memo) AS memohex,CAST(OCTET_LENGTH(u8) AS CHAR) AS u8bytes,CAST(OCTET_LENGTH(latin) AS CHAR) AS latinbytes,CAST(OCTET_LENGTH(memo) AS CHAR) AS memobytes,CAST(computed AS CHAR) AS computed FROM ${target(name)} ORDER BY ${quoting.identifier(name)}.id`);
        expect(actual).toEqual([{ id: '9007199254740993', qty: null, u8: null, latin: null, memo: null, u8hex: null, latinhex: null, memohex: null, u8bytes: null, latinbytes: null, memobytes: null, computed: null }, { id: '18446744073709551615', qty: '3', u8: '中文🙂', latin: 'Caféÿ', memo: '逐列编码', u8hex: 'E4B8ADE69687F09F9982', latinhex: '436166E9FF', memohex: 'E98090E58897E7BC96E7A081', u8bytes: '10', latinbytes: '5', memobytes: '12', computed: '3.00' }]);
        // 目录名字之外独立核真实bin语义；只读已插入原行，不增加数据或任务。
        const matchLatin = `SELECT CAST(COUNT(*) AS CHAR) AS count FROM ${target(name)} WHERE latin = ?`;
        expect(await sql(matchLatin, ['Caféÿ'])).toEqual([{ count: '1' }]); expect(await sql(matchLatin, ['caféÿ'])).toEqual([{ count: '0' }]);
        const indexes = await sql('SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX', [database, name]);
        const checked = indexes.map(row => { expect(tableCreateColumnEncodingInteger(row.SEQ_IN_INDEX, 1)).toBe(true); const prefixed = prefix && row.INDEX_NAME === 'ix_latin'; if (prefixed) expect(tableCreateColumnEncodingInteger(row.SUB_PART, 3072)).toBe(true); else expect(row.SUB_PART).toBeNull(); return { ...row, SEQ_IN_INDEX: 1, ...(prefixed ? { SUB_PART: 3072 } : {}) }; }); expect(checked).toEqual([{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, SUB_PART: null }, ...(prefix ? [{ INDEX_NAME: 'ix_latin', COLUMN_NAME: 'latin', SEQ_IN_INDEX: 1, SUB_PART: 3072 }] : []), { INDEX_NAME: 'ix_qty', COLUMN_NAME: 'qty', SEQ_IN_INDEX: 1, SUB_PART: null }]);
        operations.push({ name, verified: result.value!.definitionVerified, ddlCount: result.facts.flatMap(fact => fact.writes).length, rowCount: actual.length }); if (prefix) expectedTables.push(name);
      }
      await owner.step(() => engine!.closeAll()); for (const fact of facts.filter(fact => fact.scope !== 'observer')) await owner.step(() => fact.closed); helpers.assertDatabaseEncodingReleased(facts.filter(fact => fact.scope !== 'observer'), false);
      const threadIds = [...new Set(facts.filter(fact => fact.scope !== 'observer').map(fact => fact.id))]; expect(threadIds.every(id => Number.isSafeInteger(id) && id > 0)).toBe(true); if (threadIds.length) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + threadIds.join(',') + ')')).toEqual([]);
      const owned = await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database]); expect(owned).toEqual(expectedTables.sort().map(name => ({ name, marker: marker + ':' + name })));
      expect(await sql(`SELECT CAST(id AS CHAR) AS id FROM ${target('parent')} ORDER BY ${quoting.identifier('parent')}.id`)).toEqual([{ id: '3' }]);
      // 随机库出现本例未创建的触发器/例程/事件即保留现场，不能仅凭表marker就DROP整库。
      expect(await sql('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ? ORDER BY BINARY TRIGGER_NAME', [database])).toEqual([]);
      expect(await sql('SELECT ROUTINE_NAME,ROUTINE_TYPE FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA=BINARY ? ORDER BY BINARY ROUTINE_NAME', [database])).toEqual([]);
      expect(await sql('SELECT EVENT_NAME FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA=BINARY ? ORDER BY BINARY EVENT_NAME', [database])).toEqual([]);
      if (databaseState !== 'confirmed') throw Error('列级编码库归属未确认，保留现场'); const drop = 'DROP DATABASE ' + db; fixtureWrites.add(drop); await sql(drop); expect(await sql(exists, [database])).toEqual([]); databaseState = 'absent';
      await owner.step(() => helpers.closeDatabaseEncodingObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); helpers.assertDatabaseEncodingReleased(facts, false); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '新建表列级编码', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 原观察线程: observerId, 操作: operations, 原任务线程: threadIds, 原任务线程数量: threadIds.length, 原任务线程残留: 0, 已清理数据库: database, 数据库残留: 0, 原流全部关闭: true, 未验: ['原生界面', '安装包', 'Mac', '目录权限/漂移/取消仅RAM定义，本轮实库未注入'] }) + '\n');
    } catch (error) { retained = true; owner.stop(); throw error; }
  });
});
