import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableCopyDataGetOutput, TableCopyDataPreviewOutput } from '../../src/shared/tableCopyData';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'copy-unit', name: '离线复制结构', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,PRIMARY KEY (`id`),KEY `s_idx` (`s`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='来源说明'";
let engine: Engine, definitions: Map<string, string>, ids: Map<string, string>, events: TaskEvent[], connections: ManagedConnection[], sent: string[], sequence: number;
let version: string, uuid: string, os: string, lower: number, grants: string[], dependency: string, capability: { gipk: number; autocommit: number; partialRevokes: number }, nonempty: boolean, warning: number, closeFails: boolean;
let fail: RegExp | undefined, hold: RegExp | undefined, held: { complete(error?: Error): void } | undefined, afterCreate: (() => void) | undefined;
let initialMode: string;
let counters: Map<string, unknown>, copiedAutoDefinition: string | undefined, expiry: string, columnTypeOverride: string | undefined, policy: Record<string, string>;
let closing: Promise<void> | undefined, releaseClosing: (() => void) | undefined;
let isolation = 'REPEATABLE-READ', binlogFormat = 'ROW', affectedRows: unknown = 2, insertWarning = 0, committing = false;
let generatedRows: Map<string, Record<string, unknown>[]>;
/** 精确解析产品只读目录中的编码名称，预期DDL由测试独立断言，驱动不调用产品规划器。 */
function nameOf(sql: string): string { const quoted = /^SHOW CREATE TABLE `db`\.`([^`]+)`/.exec(sql); if (quoted) return quoted[1]; const values = [...sql.matchAll(/X'([a-f0-9]*)'/g)].map(value => Buffer.from(value[1], 'hex').toString()); return values.at(-1)?.split('/').at(-1) ?? 't'; }
/** 仅替换数据库驱动边界，完整读取、任务、缓存、锁、取消和关闭都运行真实Engine。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence; let localIsolation = isolation; let mode = initialMode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closing && definitions.has('t_copy')) await closing; if (closeFails) throw Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('模拟驱动失败')); return; }
      let rows: unknown = []; const name = nameOf(sql), source = definitions.get(name)!, context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
      if (sql.startsWith('SELECT @@SESSION.transaction_isolation AS isolation,')) rows = [{ isolation: localIsolation, binlogFormat, logBin: 1 }];
      else if (sql === 'SELECT @@SESSION.transaction_isolation AS isolation') rows = [{ isolation: localIsolation }];
      else if (sql === 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED') localIsolation = 'READ-COMMITTED';
      else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') rows = [{ sqlMode: mode }];
      else if (sql === 'START TRANSACTION') rows = {};
      else if (sql === 'COMMIT') { committing = true; rows = { affectedRows: 0, warningStatus: 0 }; }
      else if (/^SELECT 1 FROM `db`\.`[^`]+` LIMIT 0$/.test(sql)) rows = [];
      else if (sql.startsWith('INSERT INTO')) rows = { affectedRows, warningStatus: insertWarning };
      else if (sql === 'SET SESSION information_schema_stats_expiry = 0') rows = {};
      else if (sql.startsWith('SELECT CAST(@@SESSION.information_schema_stats_expiry')) rows = [{ expiry }];
      else if (sql.startsWith('SELECT CAST(@@SESSION.auto_increment_increment')) rows = [{ ...policy }];
      else if (sql.startsWith('SET SESSION foreign_key_checks') || sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'offline', port: 3306, serverId: 7, currentUser: 'unit@host', connectionId: threadId, characterSetConnection: encoding, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
      else if (sql.startsWith('SELECT @@SESSION.sql_generate')) rows = [{ ...capability }];
      else if (sql.startsWith('SHOW CREATE TABLE')) { if (!source) { callback(Error('对象不存在')); return; } rows = [{ Table: name, 'Create Table': source }]; }
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal')) rows = generatedRows.get(name) ?? [];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, DATA_TYPE')) rows = generatedRows.get(name) ?? parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, dataType: column.type.raw.split(/[ (]/)[0], columnType: columnTypeOverride ?? column.type.raw, extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '' }));
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = generatedRows.get(name) ?? parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: readTableCommentDefinition(source, context).comment, autoIncrement: counters.get(name) ?? null }];
      else if (sql.startsWith('SELECT @@version_compile_os')) rows = [{ os, lowerNames: lower }];
      else if (sql.startsWith('SELECT PARTITION_NAME')) rows = [{ name: dependency === 'partition' ? 'p0' : null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: ids.get(name), name: 'db/' + name }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset: 'utf8mb4', characters: '2048', bytes: '8192', maxlen: 4 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.includes('FROM information_schema.INNODB_FOREIGN')) rows = dependency === 'foreign' ? [{ ID: 'db/fk' }] : [];
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = dependency === 'trigger' ? [{ TRIGGER_NAME: 'tr' }] : [];
      else if (sql.includes('FROM information_schema.VIEW_TABLE_USAGE')) rows = dependency === 'view' ? [{ VIEW_NAME: 'v' }] : [];
      else if (sql.startsWith('SELECT TABLE_NAME FROM information_schema.TABLES')) rows = definitions.has(name) ? [{ TABLE_NAME: name }] : [];
      else if (sql.startsWith('CREATE TABLE')) {
        const match = /^CREATE TABLE `db`\.`([^`]+)` LIKE `db`\.`t`;$/u.exec(sql); if (!match) { callback(Error('非法测试DDL')); return; }
        if (definitions.has(match[1])) { callback(Error('服务器同名冲突')); return; }
        definitions.set(match[1], (copiedAutoDefinition ?? definitions.get('t')!).replace('CREATE TABLE `t`', 'CREATE TABLE `' + match[1] + '`')); if (generatedRows.has('t')) generatedRows.set(match[1], structuredClone(generatedRows.get('t')!)); counters.set(match[1], copiedAutoDefinition ? '1' : null); ids.set(match[1], '9007199254740997'); afterCreate?.(); rows = { affectedRows: 0, warningStatus: warning };
      }
      else if (/^SELECT 1 FROM `db`\.`[^`]+` LIMIT 1$/.test(sql)) rows = nonempty ? [{ 1: 1 }] : [];
      else { callback(Error('未定义离线端口：' + sql)); return; }
      callback(null, rows, []);
    }); if (hold?.test(sql)) { held = { complete }; return; } complete();
  } }); signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableCopyDataGetOutput> { return engine.handle('schema.tableCopyData.get', { mode: 'structure-and-data', connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + sequence, connectionRevision: revision }); }
async function preview(snapshot: TableCopyDataGetOutput, newName = 't_copy'): Promise<TableCopyDataPreviewOutput> { return engine.handle('schema.tableCopyData.preview', { mode: 'structure-and-data', snapshotId: snapshot.snapshotId, newName, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCopyDataPreviewOutput, extra: Record<string, unknown> = {}) { return engine.handle('schema.tableCopyData.apply', { mode: 'structure-and-data', previewToken: value.previewToken, taskId: 'apply-' + sequence, connectionRevision: 1, confirmation: 'db.' + value.newName, acknowledgements: value.requiredAcknowledgements, ...extra }); }
const writes = () => sent.filter(sql => /^(?:CREATE|ALTER|DROP|RENAME|INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(sql));
/** 独立原生语义fixture：固定目标定义不含表尾计数，不调用产品比较器生成期望。 */
function autoSource(value: string) {
  const bare = original.replace('bigint NOT NULL', 'bigint unsigned NOT NULL AUTO_INCREMENT').replace('DEFAULT NULL', "DEFAULT 'AUTO_INCREMENT=99'").replace('来源说明', 'AUTO_INCREMENT=88');
  copiedAutoDefinition = bare; definitions.set('t', value === '1' ? bare : bare.replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=' + value)); counters.set('t', value);
}
beforeEach(async () => {
  definitions = new Map([['t', original]]); ids = new Map([['t', '9007199254740995']]); generatedRows = new Map(); events = []; connections = []; sent = []; sequence = 0;
  isolation = 'REPEATABLE-READ'; binlogFormat = 'ROW'; affectedRows = 2; insertWarning = 0; committing = false;
  version = '8.4.11'; uuid = '11111111-2222-3333-4444-555555555555'; os = 'Linux'; lower = 0; grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS, CREATE, INSERT ON *.* TO 'unit'@'host'"]; dependency = ''; capability = { gipk: 0, autocommit: 1, partialRevokes: 0 }; nonempty = false; warning = 0; closeFails = false; fail = hold = undefined; held = undefined; afterCreate = undefined;
  initialMode = ''; counters = new Map([['t', null]]); copiedAutoDefinition = undefined; expiry = '0'; columnTypeOverride = undefined; policy = { sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '2', readOnly: '0', superReadOnly: '0', innodbReadOnly: '0', forceRecovery: '0' };
  closing = undefined; releaseClosing = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { releaseClosing?.(); closing = undefined; closeFails = false; hold = undefined; held?.complete(Error('离线收尾')); await engine.closeAll(); vi.restoreAllMocks(); });

/** 固定SHOW及独立目录事实，不从产品生成列表达式投影器生成预期。 */
function ordinaryGenerated(storage: 'VIRTUAL' | 'STORED') {
  const expression = '(`qty` * `price`) + 9007199254740993.123456789012';
  definitions.set('t', `CREATE TABLE \`t\` (\`qty\` int NOT NULL,\`price\` decimal(30,12) NOT NULL,\`total\` decimal(50,12) GENERATED ALWAYS AS (${expression}) ${storage},PRIMARY KEY (\`qty\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='来源说明'`);
  generatedRows.set('t', [
    { name: 'qty', ordinal: 1, dataType: 'int', columnType: 'int', nullable: 'NO', extra: '', defaultValue: null, generationExpression: '', charset: null, collation: null },
    { name: 'price', ordinal: 2, dataType: 'decimal', columnType: 'decimal(30,12)', nullable: 'NO', extra: '', defaultValue: null, generationExpression: '', charset: null, collation: null },
    { name: 'total', ordinal: 3, dataType: 'decimal', columnType: 'decimal(50,12)', nullable: 'YES', extra: storage + ' GENERATED', defaultValue: null, generationExpression: '(' + expression + ')', charset: null, collation: null },
  ]);
}

describe('同库复制结构及数据，真实Engine仅RAM驱动', () => {
  it('get/preview零DDL及DML，显式列列表只在服务器复制，COMMIT之后才成功', async () => {
    const source = await get(); expect(source.writable).toBe(true); const plan = await preview(source);
    expect(writes()).toEqual([]); expect(sent.some(sql => /^SELECT 1 FROM/.test(sql))).toBe(false);
    expect(plan.mode).toBe('structure-and-data'); expect(plan.sql).toBe('CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;\nINSERT INTO `db`.`t_copy` (`id`, `s`) SELECT `id`, `s` FROM `db`.`t`;');
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, dataCompleted: true, affectedRows: '2', definitionVerified: true });
    expect(writes()).toEqual(['CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;', 'INSERT INTO `db`.`t_copy` (`id`, `s`) SELECT `id`, `s` FROM `db`.`t`;']);
    expect(sent.indexOf('START TRANSACTION')).toBeGreaterThan(sent.findIndex(sql => sql.startsWith('CREATE TABLE')));
    expect(sent.indexOf('COMMIT')).toBeGreaterThan(sent.findIndex(sql => sql.startsWith('INSERT INTO')));
    expect(sent).toContain("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_ALL_TABLES'");
    expect(committing).toBe(true); expect(connections.slice(1).every(connection => vi.mocked(connection.close).mock.calls.every(call => call[0]?.strict === true))).toBe(true);
    expect(events.filter(event => event.tableCopyData?.ddlCompleted && !event.tableCopyData?.dataCompleted).length).toBeGreaterThan(0);
    expect(events.at(-1)?.tableCopyData).toMatchObject({ dataCompleted: true, commitSubmitted: true, outcome: 'succeeded' });
  });
  it.each(['8.0.46', '8.4.12', '8.4.11-custom', '9.0.0'])('准确版本之外%s只读', async value => { version = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]); });
  it.each(['VIRTUAL', 'STORED'] as const)('%s生成列只读，不继承空表开放范围', async storage => { ordinaryGenerated(storage); const source = await get(); expect(source.writable).toBe(false); await expect(preview(source)).rejects.toThrow(); expect(writes()).toEqual([]); });
  it.each(['foreign', 'trigger', 'view', 'partition'])('%s依赖或特殊表只读', async value => { dependency = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]); });
  it('有CREATE无INSERT只读', async () => { grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS, CREATE ON *.* TO 'unit'@'host'"]; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]); });
  it.each(['STATEMENT', 'MIXED'])('%s日志模式只读', async value => { binlogFormat = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]); });
  it('准确大整数自增由显式列复制并保留0模式，下一计数不伪称1或源计数', async () => { autoSource('18446744073709551614'); const source = await get(); expect(source.writable).toBe(true); const result = await apply(await preview(source)); expect(result.dataCompleted).toBe(true); expect(writes()[1]).toContain('(`id`, `s`) SELECT `id`, `s`'); expect(result).not.toHaveProperty('counter'); });
  it.each(['结构', '编号', 'UUID', '能力', '同名'])('预览后%s变化拒绝且消费令牌', async kind => {
    const plan = await preview(await get()); if (kind === '结构') definitions.set('t', original.replace('来源说明', '已变化')); if (kind === '编号') ids.set('t', '99'); if (kind === 'UUID') uuid = '99999999-2222-3333-4444-555555555555'; if (kind === '能力') binlogFormat = 'STATEMENT'; if (kind === '同名') definitions.set('t_copy', original);
    await expect(apply(plan)).rejects.toThrow(); await expect(apply(plan)).rejects.toThrow('失效'); expect(writes()).toEqual([]);
  });
  it.each([{ mode: 'structure-only' }, { connectionRevision: 2 }, { confirmation: 'db.t_copy ' }, { acknowledgements: ['ddl-implicit-commit', 'copy-empty-scope', 'external-ddl-window'] }])('模式、修订及精确数据确认不符不发送 $mode', async extra => { const plan = await preview(await get()); await expect(apply(plan, extra)).rejects.toThrow(); expect(writes()).toEqual([]); await expect(apply(plan)).rejects.toThrow('失效'); });
  it('双击与同快照兄弟预览只能执行一次', async () => { const source = await get(), first = await preview(source), sibling = await preview(source, 't_other'); await apply(first); await expect(apply(first)).rejects.toThrow('失效'); await expect(apply(sibling)).rejects.toThrow('失效'); expect(writes()).toHaveLength(2); });
  it.each([/^INSERT INTO/, /^COMMIT$/])('数据发送或提交ACK失败%s保留DDL完成事实，不补DROP/重放', async value => { const plan = await preview(await get()); fail = value; await expect(apply(plan)).rejects.toThrow(); expect(definitions.has('t_copy')).toBe(true); expect(events.at(-1)?.tableCopyData).toMatchObject({ ddlCompleted: true, dataSubmitted: true, dataCompleted: false, outcome: 'unknown' }); expect(writes().filter(sql => sql.startsWith('INSERT'))).toHaveLength(1); expect(writes().some(sql => sql.startsWith('DROP'))).toBe(false); await expect(apply(plan)).rejects.toThrow('失效'); });
  it('CREATE ACK丢失不标记建表已确认，不进入数据语句', async () => { const plan = await preview(await get()); fail = /^CREATE TABLE/; await expect(apply(plan)).rejects.toThrow(); expect(events.at(-1)?.tableCopyData).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, dataSubmitted: false, outcome: 'unknown' }); expect(writes()).toHaveLength(1); });
  it('建表成功有警告仍记录DDL完成，不复制数据', async () => { const plan = await preview(await get()); warning = 1; await expect(apply(plan)).rejects.toThrow(); expect(events.at(-1)?.tableCopyData).toMatchObject({ ddlCompleted: true, dataSubmitted: false }); expect(writes()).toHaveLength(1); });
  it.each([Number.MAX_SAFE_INTEGER + 1, -1, '2'])('不把不可靠affectedRows %s当准确行数或提交证据', async value => { const plan = await preview(await get()); affectedRows = value; await expect(apply(plan)).rejects.toThrow(); expect(sent).not.toContain('COMMIT'); expect(events.at(-1)?.tableCopyData?.dataCompleted).toBe(false); });
  it('INSERT成功有警告不提交，保留目标供核查', async () => { const plan = await preview(await get()); insertWarning = 1; await expect(apply(plan)).rejects.toThrow(); expect(sent).not.toContain('COMMIT'); expect(writes()).toHaveLength(2); });
  it('建表后取消在数据前阻断，保留空表', async () => { const plan = await preview(await get()); afterCreate = () => { void engine.handle('query.cancel', { taskId: 'apply-' + (sequence - 1) }); }; /* 发送回调时连接序号已加一，任务编号绑定调用前序号。 */ await expect(apply(plan)).rejects.toThrow(); expect(definitions.has('t_copy')).toBe(true); expect(writes()).toHaveLength(1); });
  it('数据语句取消等待真实回调及专属关闭，ACK不先释放任务', async () => {
    const plan = await preview(await get()), taskId = 'apply-' + sequence; hold = /^INSERT INTO/;
    const pending = apply(plan); const rejected = expect(pending).rejects.toThrow(); await vi.waitFor(() => expect(held).toBeDefined());
    let finished = false; pending.catch(() => {}).finally(() => { finished = true; });
    mock.execute.mockImplementation(async () => ({ rows: [] })); const cancellation = engine.handle('query.cancel', { taskId });
    await Promise.resolve(); expect(finished).toBe(false); expect(connections.at(-1)?.close).not.toHaveBeenCalled();
    held!.complete(Error('服务器命令中断终态')); await cancellation; await rejected;
    expect(sent).not.toContain('COMMIT'); expect(events.at(-1)?.tableCopyData).toMatchObject({ ddlCompleted: true, dataCompleted: false });
  });
  it('提交成功后严格close失败保留已提交事实，不能降格成未发送', async () => { const plan = await preview(await get()); closeFails = true; await expect(apply(plan)).rejects.toThrow('关闭'); expect(events.at(-1)?.tableCopyData).toMatchObject({ dataCompleted: true, commitSubmitted: true, outcome: 'succeeded' }); expect(writes()).toHaveLength(2); });
});
