import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, FilterRule, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { TableFilteredUpdateAssignment, TableFilteredUpdatePreviewOutput, TableFilteredUpdateApplyOutput } from '../../src/shared/tableFilteredUpdate';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as (() => void) | undefined, watch: undefined as ((managed: ManagedConnection, scope: string) => void) | undefined, connections: [] as ManagedConnection[], spools: [] as { directory: string; path: string; disposed: boolean }[] }));
/** 只观察原物理连接，原参数、callback、命令end和成功结果全部透传。 */
vi.mock('../../src/engine/connection', async original => {
  const actual = await original<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { if (!audit.check || !audit.watch || !audit.scope) throw Error('多字段实库缺少原owner'); audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.connections.push(managed); audit.watch(managed, scope); return managed; } };
});
/** 保存产品原spool路径并等待原dispose返回；不替换创建参数、文件内容或读取过程。 */
vi.mock('../../src/engine/tableFilteredUpdateSpool', async original => {
  const actual = await original<typeof import('../../src/engine/tableFilteredUpdateSpool')>(), create = actual.TableFilteredUpdateSpool.create.bind(actual.TableFilteredUpdateSpool);
  actual.TableFilteredUpdateSpool.create = async check => {
    audit.check?.(); const spool = await create(check), fact = { directory: spool.directory, path: spool.path, disposed: false }, dispose = spool.dispose.bind(spool); audit.spools.push(fact);
    spool.dispose = async () => { const result = await dispose(); fact.disposed = true; return result; }; return spool;
  }; return actual;
});

/** 默认和--list先短路，不能读取认证、载入Engine或把旧专项门当作新资源授权。 */
export function tableFilteredUpdateMultiIntegrationEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_FILTERED_UPDATE_MULTI_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
// 保留失败原句柄的强引用；没有自动恢复、续期、清库或重跑入口。
const retainedHandles: unknown[] = [];
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('多字段全部筛选行真实Engine专项（新资源授权默认关闭）', () => {
  it('61/81多字段单事务、快照新增隔离、最末行冲突整批回滚及非法后字段零DML', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableFilteredUpdateMultiIntegrationEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('多字段实库已有失败现场，禁止后续自动SQL或重跑'); complete = false;
    const life = await import('../helpers/tableValueOptionsIntegration');
    // 仅复用六实例身份与TLS校验；原专项门必须关闭，新门独立检查且漂移后永久停链。
    let drifted = false;
    const read = () => { const env = process.env; if (drifted || env.DBARK_INTEGRATION_ENABLED !== '1' || env.DBARK_TABLE_FILTERED_UPDATE_MULTI_TEST !== '1' || ['DBARK_TABLE_VALUE_OPTIONS_TEST', 'DBARK_TABLE_FILTERED_UPDATE_TEST', 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST', 'DBARK_TABLE_FILTERED_EXPORT_TEST', 'DBARK_FILTERED_SELECT_TEST', 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED', 'DBARK_RESULT_INSERT_TEST', 'DBARK_CSV_HEADER_TEST', 'DBARK_FILE_IMPORT_TRANSACTION_TEST'].some(key => Boolean(env[key]))) { drifted = true; throw Error('多字段实库新双门或独立用途漂移'); } return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: '1' }; };
    const binding = life.bindTableValueOptionsTarget(read, 'filtered-multi-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], events: TaskEvent[] = [], sent: { sql: string; values: readonly unknown[]; scope: string }[] = [];
    let database = '', marker = '', logPath = '', phase = '准备', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent', observer: ManagedConnection | undefined;
    audit.check = owner.check; audit.spools.length = 0;
    const fs = await owner.step(() => import('node:fs/promises')), path = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os')), crypto = await owner.step(() => import('node:crypto')), util = await owner.step(() => import('node:util'));
    try {
      const nonce = crypto.randomBytes(6).toString('hex'); database = 'dbark_filteredmulti_' + nonce; marker = 'dbark-filteredmulti:' + nonce;
      if (!/^dbark_filteredmulti_[a-f0-9]{12}$/.test(database)) throw Error('多字段随机库身份无效');
      const db = '`' + database + '`', subject = db + '.`subject`', own = db + '.`__owner`', literal = (value: string) => "_utf8mb4 X'" + Buffer.from(value).toString('hex') + "'";
      const exact = new Map<string, readonly unknown[][]>(), add = (scope: string, sql: string, values: unknown[] = []) => { const key = JSON.stringify([scope, sql]); exact.set(key, [...exact.get(key) ?? [], values]); };
      const observerSql = (sql: string, values: unknown[] = []) => { add('observer', sql, values); return sql; };
      const snapshot = 'SELECT `id`, `selected`, `note`, `amount`, `payload`, `nullable_text`, `stamp`, `side_note`, CAST(UNIX_TIMESTAMP(`stamp`) AS CHAR) AS `__dbark_epoch_0` FROM ' + subject;
      const update = 'UPDATE ' + subject + ' SET `note` = ?, `amount` = ?, `payload` = ?, `nullable_text` = ? WHERE `id` <=> ? AND BINARY CONVERT(`selected` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND BINARY CONVERT(`note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND `amount` <=> ? AND `payload` <=> ? AND BINARY CONVERT(`nullable_text` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND `stamp` <=> ? AND BINARY CONVERT(`side_note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND UNIX_TIMESTAMP(`stamp`) <=> CAST(? AS DECIMAL(20,6))';
      const metadata = [
        'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
        'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
        'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
      ];
      const zoneSql = 'SELECT @@SESSION.time_zone AS timeZone,@@system_time_zone AS systemTimeZone,CAST(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) AS CHAR) AS utcOffset';
      const productRead = [zoneSql, 'SELECT @@SESSION.sql_mode AS sqlMode', 'SELECT @@SESSION.sql_mode AS mode LIMIT 4097', 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone', 'SHOW GRANTS', 'SHOW WARNINGS LIMIT 21', 'SHOW CREATE TABLE ' + subject,
        'SELECT @@version AS version,@@hostname AS hostname,CAST(@@port AS CHAR) AS port,CAST(@@server_id AS CHAR) AS serverId,CURRENT_USER() AS currentUser,CAST(CONNECTION_ID() AS CHAR) AS connectionId,CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate,@@character_set_connection AS charset,@@collation_connection AS collation,' + (binding.dialect === 'mysql' ? '@@server_uuid' : 'NULL') + ' AS uuid',
        'SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(CONVERT(X\'' + Buffer.from(database).toString('hex') + '\' USING utf8mb4) AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(CONVERT(X\'7375626a656374\' USING utf8mb4) AS BINARY) LIMIT 2',
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST(' + literal(database) + ' AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(' + literal('subject') + ' AS BINARY) LIMIT 1'];
      const watch = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      audit.watch = (managed, scope) => { owner.check(); facts.push(watch.watchTableFilteredExportConnection(managed, scope, owner, { assert(sql, values) { owner.check(); if (!exact.get(JSON.stringify([scope, sql]))?.some(expected => util.isDeepStrictEqual(expected, values))) throw Error('多字段实库拒绝未登记SQL或原参数'); sent.push({ sql, values: values.map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value), scope }); } })); };
      const modules = await owner.step(life.loadTableValueOptionsModules), keys = await owner.step(() => import('../../src/shared/tableCopySource')), shared = await owner.step(() => import('../../src/shared/tableFilteredUpdate'));
      const engine = new modules.engine.Engine(event => { events.push(event); }); retainedHandles.push(engine);
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => { observerSql(statement, values); return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows; };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile)); retainedHandles.push(observer);
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      const zone = await sql(zoneSql); expect(zone).toHaveLength(1); const timeZone = String(zone[0].timeZone); if (!/^[-A-Za-z0-9_+/:.]{1,100}$/.test(timeZone)) throw Error('多字段原会话时区未知');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      // 首个CREATE前独占落盘并fsync安全资源名、标记和目标，不记录用户、密码或CA内容。
      logPath = path.join(os.tmpdir(), 'dbark-filteredmulti-' + nonce + '.jsonl'); const log = await owner.step(() => fs.open(logPath, 'wx', 0o600));
      try { await owner.step(() => log.writeFile(JSON.stringify({ 专项: '多字段筛选填充', 阶段: '创建前资源登记', 数据库: database, 标记: marker, 对象: ['__owner', 'subject'], 目标: binding.profile.host, 端口: binding.profile.port, 自动重跑: false }) + '\n')); await owner.step(() => log.sync()); } finally { await log.close(); }
      process.stdout.write(JSON.stringify({ 专项: '多字段筛选填充', 数据库: database, 标记: marker, 安全资源日志: logPath }) + '\n');
      phase = '创建本例资源'; databaseState = 'unknown'; await sql('CREATE DATABASE ' + db + ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); databaseState = 'confirmed';
      await sql('CREATE TABLE ' + own + " (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='" + marker + ":owner'"); await sql('INSERT INTO ' + own + ' VALUES (?)', [marker]);
      await sql('CREATE TABLE ' + subject + " (id INT NOT NULL PRIMARY KEY,selected VARCHAR(8) NOT NULL,note TEXT NOT NULL,amount DECIMAL(30,12) NOT NULL,payload BLOB NOT NULL,nullable_text TEXT NULL,stamp TIMESTAMP(6) NULL DEFAULT NULL,side_note VARCHAR(80) NOT NULL) ENGINE=InnoDB COMMENT='" + marker + ":subject'");
      /** 手工整数、原字节和精确文本造数；不调用产品筛选器/SQL编译器构造期望。 */
      const row = (id: number) => ({ id, selected: id <= 61 || id === 82 ? 'yes' : 'no', note: '原值中文🚢-' + id, amount: '123456789012345678.' + String(id).padStart(12, '0'), payload: Buffer.from([0, 255, id]), nullable: id % 2 ? '可空原值-' + id : null, epoch: '1700000000.' + String(id).padStart(6, '0'), side: '旁列-' + id });
      const state = Array.from({ length: 81 }, (_, index) => row(index + 1));
      const insert = 'INSERT INTO ' + subject + ' (id,selected,note,amount,payload,nullable_text,stamp,side_note) VALUES (?,?,?,?,?,?,FROM_UNIXTIME(?),?)';
      const insertRow = async (value: ReturnType<typeof row>) => { expect(await sql(insert, [value.id, value.selected, value.note, value.amount, value.payload, value.nullable, value.epoch, value.side])).toMatchObject({ affectedRows: 1, warningStatus: 0 }); };
      for (const value of state) await insertRow(value);
      const readRows = 'SELECT id,selected,HEX(note) AS noteHex,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(nullable_text) AS nullableHex,CAST(UNIX_TIMESTAMP(stamp) AS CHAR) AS epoch,DATE_FORMAT(stamp,\'%Y-%m-%d %H:%i:%s.%f\') AS wall,HEX(side_note) AS sideHex FROM ' + subject + ' ORDER BY id ASC';
      const observe = (value: ReturnType<typeof row>) => ({ id: value.id, selected: value.selected, noteHex: Buffer.from(value.note).toString('hex').toUpperCase(), amount: value.amount, payloadHex: value.payload.toString('hex').toUpperCase(), nullableHex: value.nullable === null ? null : Buffer.from(value.nullable).toString('hex').toUpperCase(), epoch: value.epoch, sideHex: Buffer.from(value.side).toString('hex').toUpperCase() });
      const baseline = await sql(readRows), walls = new Map(baseline.map(value => [Number(value.id), value.wall]));
      const assertState = async () => { const actual = await sql(readRows); expect(actual.map(({ wall: _wall, ...value }) => value)).toEqual(state.map(observe)); for (const value of actual) if (walls.has(Number(value.id))) expect(value.wall).toBe(walls.get(Number(value.id))); };
      await assertState(); const definitions = await sql('SHOW CREATE TABLE ' + subject), ownerDefinition = await sql('SHOW CREATE TABLE ' + own);
      /** 原RPC及其原物理连接关闭后再验收；预期业务拒绝只作为数据返回，不重签owner期限。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, scope: string) => {
        audit.scope = scope; const offset = facts.length; const result = await owner.step(async () => { try { return { value: await engine.handle(command, input) as T }; } catch (error) { return { error }; } });
        const current = facts.slice(offset); for (const fact of current) await owner.step(() => fact.closed); life.assertTableValueOptionsReleased(current, true); return { ...result, current, scope };
      };
      for (const statement of metadata) add('metadata', statement, [database, 'subject']); add('metadata', 'SELECT @@SESSION.sql_mode AS mode'); add('metadata', 'SHOW CREATE TABLE ' + subject);
      const meta = await invoke<TableInfo>('metadata.table', { connectionId: binding.profile.id, profile: binding.profile, taskId: crypto.randomUUID(), database, table: 'subject' }, 'metadata'); expect(meta.error).toBeUndefined(); const info = meta.value!;
      const fill = { note: "整组精确中文🚢\n'\\\0", amount: '987654321098765432.123456789012', payload: Buffer.from([0, 255, 128, 39, 92]), nullable: null };
      const assignments = (value: typeof fill): TableFilteredUpdateAssignment[] => [{ column: 'note', value: value.note }, { column: 'amount', value: value.amount }, { column: 'payload', value: { type: 'binary', base64: value.payload.toString('base64') } }, { column: 'nullable_text', value: value.nullable }];
      const product = (scope: string) => { for (const statement of productRead) add(scope, statement); for (const statement of metadata) { let index = 0; add(scope, statement.replace(/\?/g, () => literal([database, 'subject'][index++])) + ' LIMIT 4097'); } add(scope, 'SELECT 1 FROM ' + subject + ' LIMIT 0'); };
      const preview = async (label: string, value: typeof fill, narrow = false, invalid = false) => {
        phase = '预览-' + label; const scope = 'preview-' + label; product(scope); for (const statement of ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE', snapshot + ' WHERE ((`selected` = ' + literal('yes') + ')' + (narrow ? ' AND (`id` <= CAST(' + literal('81') + ' AS DECIMAL(65,0)))' : '') + ') ORDER BY `id` ASC']) add(scope, statement);
        const filters: FilterRule[] = [{ column: 'selected', operator: '=', value: 'yes' }, ...(narrow ? [{ column: 'id', operator: '<=' as const, value: '81' }] : [])], group = assignments(value); if (invalid) group.push({ column: 'id', value: '1' });
        return invoke<TableFilteredUpdatePreviewOutput>('table.filteredUpdate.preview', { connectionId: binding.profile.id, profile: binding.profile, connectionRevision: 1, database, table: 'subject', taskId: crypto.randomUUID(), metadataKey: keys.tableCopyMetadataKey(info), filters, filterMode: 'all', sort: [{ column: 'id', direction: 'ASC' }], assignments: group }, scope);
      };
      const apply = async (label: string, expected: TableFilteredUpdatePreviewOutput, value: typeof fill, frozen: typeof state) => {
        phase = '提交-' + label; const scope = 'apply-' + label; product(scope); for (const statement of ['START TRANSACTION', 'ROLLBACK', 'COMMIT']) add(scope, statement);
        const mode = [...new Set([...(observer!.sqlMode ?? '').split(',').filter(Boolean), 'STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO'])].sort().join(','); add(scope, "SET SESSION sql_mode = '" + mode + "'"); add(scope, "SET SESSION time_zone = '" + timeZone + "'");
        for (const old of frozen) add(scope, update, [value.note, value.amount, value.payload, value.nullable, old.id, old.selected, old.note, old.amount, old.payload, old.nullable, walls.get(old.id), old.side, old.epoch]);
        const taskId = crypto.randomUUID(), result = await invoke<TableFilteredUpdateApplyOutput>('table.filteredUpdate.apply', { connectionId: binding.profile.id, profile: binding.profile, connectionRevision: 1, taskId, previewToken: expected.previewToken, confirmation: shared.tableFilteredUpdateConfirmation(expected), acknowledged: true }, scope); return { ...result, taskId, statements: sent.filter(item => item.scope === scope) };
      };
      const assertSpools = async () => { for (const spool of audit.spools) { expect(spool.disposed).toBe(true); for (const name of [spool.path, spool.directory]) expect(await owner.step(async () => { try { await fs.lstat(name); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; } })).toBe(true); } };
      const first = await preview('成功', fill); expect(first.error).toBeUndefined(); expect(first.value).toMatchObject({ columns: ['note', 'amount', 'payload', 'nullable_text'], rows: 61, shownRows: 10, assignmentDigest: crypto.createHash('sha256').update(JSON.stringify(assignments(fill).map(({ column, value }) => [column, value]))).digest('hex') });
      const frozen = state.slice(0, 61).map(value => ({ ...value, payload: Buffer.from(value.payload) })), late = row(82); await insertRow(late); state.push(late);
      const success = await apply('成功', first.value!, fill, frozen); expect(success.error).toBeUndefined(); expect(success.value).toMatchObject({ rows: 61, columns: ['note', 'amount', 'payload', 'nullable_text'], commitAcknowledged: true });
      expect(success.statements.filter(item => item.sql === update)).toHaveLength(61); expect(success.current.flatMap(fact => fact.commands).filter(item => item.sql.startsWith('UPDATE ')).every(item => item.sql === update && item.method === 'execute')).toBe(true); expect(success.statements.filter(item => item.sql === 'COMMIT')).toHaveLength(1); expect(success.statements.filter(item => item.sql === 'ROLLBACK')).toHaveLength(0);
      for (let index = 0; index < 61; index++) Object.assign(state[index], fill); await assertState(); await assertSpools();
      const failedFill = { ...fill, note: '后字段冲突不应提交', amount: '222222222222222222.222222222222' }, second = await preview('末行冲突', failedFill, true); expect(second.error).toBeUndefined(); expect(second.value!.rows).toBe(61);
      const beforeConflict = state.slice(0, 61).map(value => ({ ...value, payload: Buffer.from(value.payload) })); expect((await sql<{ affectedRows: number }>('UPDATE ' + subject + ' SET side_note=? WHERE id=? AND side_note=?', ['他人末行修改', 61, state[60].side])).affectedRows).toBe(1); state[60].side = '他人末行修改';
      const conflict = await apply('末行冲突', second.value!, failedFill, beforeConflict); expect(conflict.error).toBeInstanceOf(Error); expect(conflict.statements.filter(item => item.sql === update)).toHaveLength(61); expect(conflict.statements.filter(item => item.sql === 'COMMIT')).toHaveLength(0); expect(conflict.statements.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(events.some(event => event.taskId === conflict.taskId && event.tableFilteredUpdate?.rows === 60 && event.tableFilteredUpdate.rollbackAcknowledged && event.tableFilteredUpdate.transactionProtected && event.tableFilteredUpdate.outcome === 'rolled-back')).toBe(true); await assertState(); await assertSpools();
      const spoolCount = audit.spools.length, invalid = await preview('非法后字段', fill, true, true); expect(invalid.error).toBeInstanceOf(Error); expect(sent.filter(item => item.scope === invalid.scope).some(item => item.sql.startsWith('UPDATE ') || item.sql.startsWith(snapshot))).toBe(false); expect(audit.spools).toHaveLength(spoolCount); expect(audit.spools).toHaveLength(2); await assertState();
      phase = '原资源收尾'; await owner.step(() => engine.closeAll()); await assertSpools();
      for (const fact of facts.filter(value => value.managed !== observer)) { life.assertTableValueOptionsReleased([fact], true); expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]); expect(await sql('SELECT trx_mysql_thread_id AS id FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?', [fact.id])).toEqual([]); }
      expect(await sql('SHOW CREATE TABLE ' + subject)).toEqual(definitions); expect(await sql('SHOW CREATE TABLE ' + own)).toEqual(ownerDefinition); expect(await sql('SELECT marker FROM ' + own)).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual([{ name: '__owner' }, { name: 'subject' }]);
      for (const [directory, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + directory + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]); if (databaseState !== 'confirmed') throw Error('原库归属未确认，禁止清理');
      databaseState = 'unknown'; await sql('DROP DATABASE ' + db); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]); await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(value => value.managed === observer)!.closed); life.assertTableValueOptionsReleased(facts.filter(value => value.managed === observer), true);
      const summary = { 专项: '多字段筛选填充', 阶段: '完成', 数据库: database, 标记: marker, 端口: binding.profile.port, 原始行数: 81, 原匹配: 61, 新增匹配行未更新: true, 整组提交行数: 61, 末行冲突前更新: 60, 冲突整批回滚: true, 非法后字段零DML: true, COMMIT次数: sent.filter(item => item.sql === 'COMMIT').length, spool原路径已删除: audit.spools.length, 库及原线程残留: 0, 未验: ['Main与GUI', '取消', 'COMMIT ACK丢失', '安装包', 'Mac'] };
      await owner.step(() => fs.appendFile(logPath, JSON.stringify(summary) + '\n')); owner.finish(); complete = true; retainedHandles.length = 0; audit.connections.length = 0; process.stdout.write(JSON.stringify(summary) + '\n');
    } catch (error) {
      retained = true; owner.stop(); const failure = { 专项: '多字段筛选填充', 阶段: '停链保留', 当前阶段: phase, 数据库: database, 标记: marker, 数据库状态: databaseState, 保留原句柄数: audit.connections.length, 原连接: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeReturned: fact.closeReturned, sawClose: fact.sawClose })), 末尾原SQL: sent.slice(-8).map(({ scope, sql }) => ({ scope, sql })), 原spool: audit.spools, 自动清库: false, 自动重跑: false };
      if (logPath) await fs.appendFile(logPath, JSON.stringify(failure) + '\n').catch(() => undefined); process.stdout.write(JSON.stringify(failure) + '\n'); throw error;
    }
  });
});
