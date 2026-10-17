import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableCopyStructureGetOutput, TableCopyStructurePreviewOutput } from '../../src/shared/tableCopyStructure';
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
let generatedRows: Map<string, Record<string, unknown>[]>;
/** 精确解析产品只读目录中的编码名称，预期DDL由测试独立断言，驱动不调用产品规划器。 */
function nameOf(sql: string): string { const quoted = /^SHOW CREATE TABLE `db`\.`([^`]+)`/.exec(sql); if (quoted) return quoted[1]; const values = [...sql.matchAll(/X'([a-f0-9]*)'/g)].map(value => Buffer.from(value[1], 'hex').toString()); return values.at(-1)?.split('/').at(-1) ?? 't'; }
/** 仅替换数据库驱动边界，完整读取、任务、缓存、锁、取消和关闭都运行真实Engine。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence; let mode = initialMode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closing && definitions.has('t_copy')) await closing; if (closeFails) throw Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('模拟驱动失败')); return; }
      let rows: unknown = []; const name = nameOf(sql), source = definitions.get(name)!, context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
      if (sql === 'SET SESSION information_schema_stats_expiry = 0') rows = {};
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
async function get(revision = 1): Promise<TableCopyStructureGetOutput> { return engine.handle('schema.tableCopyStructure.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + sequence, connectionRevision: revision }); }
async function preview(snapshot: TableCopyStructureGetOutput, newName = 't_copy'): Promise<TableCopyStructurePreviewOutput> { return engine.handle('schema.tableCopyStructure.preview', { snapshotId: snapshot.snapshotId, newName, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCopyStructurePreviewOutput, extra: Record<string, unknown> = {}) { return engine.handle('schema.tableCopyStructure.apply', { previewToken: value.previewToken, taskId: 'apply-' + sequence, connectionRevision: 1, confirmation: 'db.' + value.newName, acknowledgements: value.requiredAcknowledgements, ...extra }); }
const writes = () => sent.filter(sql => /^(?:CREATE|ALTER|DROP|RENAME|INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(sql));
/** 独立原生语义fixture：固定目标定义不含表尾计数，不调用产品比较器生成期望。 */
function autoSource(value: string) {
  const bare = original.replace('bigint NOT NULL', 'bigint unsigned NOT NULL AUTO_INCREMENT').replace('DEFAULT NULL', "DEFAULT 'AUTO_INCREMENT=99'").replace('来源说明', 'AUTO_INCREMENT=88');
  copiedAutoDefinition = bare; definitions.set('t', value === '1' ? bare : bare.replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=' + value)); counters.set('t', value);
}
beforeEach(async () => {
  definitions = new Map([['t', original]]); ids = new Map([['t', '9007199254740995']]); generatedRows = new Map(); events = []; connections = []; sent = []; sequence = 0;
  version = '8.4.11'; uuid = '11111111-2222-3333-4444-555555555555'; os = 'Linux'; lower = 0; grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS, CREATE ON *.* TO 'unit'@'host'"]; dependency = ''; capability = { gipk: 0, autocommit: 1, partialRevokes: 0 }; nonempty = false; warning = 0; closeFails = false; fail = hold = undefined; held = undefined; afterCreate = undefined;
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

describe('复制结构普通生成列父红反例（真实Engine仅RAM驱动）', () => {
  it.each(['VIRTUAL', 'STORED'] as const)('%s普通生成列应沿既有链创建空表并完整核验', async storage => {
    ordinaryGenerated(storage); const source = await get(); expect(source.writable).toBe(true);
    const planned = await preview(source); expect(planned.sql).toBe('CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;');
    expect(await apply(planned)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(writes()).toEqual(['CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;']);
  });
  it.each(['8.0.46', '8.4.12', '5.7.44', '10.11.19'])('%s生成列仍只读，不外推其它版本', async value => {
    ordinaryGenerated('VIRTUAL'); version = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it.each(['方式', '表达式', '默认值', '列序', '类型', '目录缺项'])('目录%s矛盾或未知不形成写能力', async kind => {
    ordinaryGenerated('VIRTUAL'); const rows = generatedRows.get('t')!, generated = rows[2];
    if (kind === '方式') generated.extra = 'STORED GENERATED';
    if (kind === '表达式') generated.generationExpression = '`price` + `qty`';
    if (kind === '默认值') generated.defaultValue = '123';
    if (kind === '列序') generated.ordinal = 2;
    if (kind === '类型') generated.columnType = 'decimal(20,2)';
    if (kind === '目录缺项') delete generated.generationExpression;
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it('SHOW漏生成属性而EXTRA有生成标记不能误当普通列', async () => {
    ordinaryGenerated('VIRTUAL'); definitions.set('t', definitions.get('t')!.replace(/GENERATED ALWAYS AS \(.*\) VIRTUAL,PRIMARY/, 'DEFAULT NULL,PRIMARY'));
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it.each(['引用顺序', '末位精度'])('目录%s差异不能用数学等价或JS数值舍入抹平', async kind => {
    ordinaryGenerated('VIRTUAL'); const row = generatedRows.get('t')![2];
    row.generationExpression = String(row.generationExpression).replace(...(kind === '引用顺序' ? ['`qty` * `price`', '`price` * `qty`'] : ['9007199254740993.123456789012', '9007199254740993.123456789013']) as [string, string]);
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it('生成目录读取权限未知仅返回只读，不改权限或写表', async () => {
    ordinaryGenerated('STORED'); fail = /GENERATION_EXPRESSION AS generationExpression/;
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it('专属确认不可省略或以普通三项代替，旧令牌先消费不重放', async () => {
    ordinaryGenerated('VIRTUAL'); const p = await preview(await get()); expect(p.requiredAcknowledgements).toContain('generated-columns-copy');
    await expect(apply(p, { acknowledgements: p.requiredAcknowledgements.filter(value => value !== 'generated-columns-copy') })).rejects.toThrow();
    await expect(apply(p)).rejects.toThrow(); expect(writes()).toEqual([]);
  });
  it('预览后目录生成表达式变化拒绝旧能力，不能只比较SHOW摘要', async () => {
    ordinaryGenerated('VIRTUAL'); const p = await preview(await get()); generatedRows.get('t')![2].generationExpression = '`qty` + 1';
    await expect(apply(p)).rejects.toThrow(); expect(writes()).toEqual([]);
  });
  it.each(['来源', '目标'])('ACK后%s生成属性矛盾保留完成事实，不重放/ALTER/DROP补救', async kind => {
    ordinaryGenerated('STORED'); const p = await preview(await get()); afterCreate = () => { generatedRows.get(kind === '来源' ? 't' : 't_copy')![2].extra = 'VIRTUAL GENERATED'; };
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(writes()).toEqual(['CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;']);
    await expect(apply(p)).rejects.toThrow();
  });
  it.each(['partition', 'foreign', 'trigger', 'view'])('生成列不会豁免原%s依赖守卫', async value => {
    ordinaryGenerated('VIRTUAL'); dependency = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it('原始模式隐藏定义时，第二次读取不能掩盖只读边界', async () => {
    ordinaryGenerated('STORED'); initialMode = 'NO_FIELD_OPTIONS'; expect((await get()).writable).toBe(false);
  });
  it('返回的生成列表达式不能替换引擎持有计划或客户端SQL', async () => {
    ordinaryGenerated('VIRTUAL'); const source = await get(); expect(source.generatedColumns?.[0].storage).toBe('VIRTUAL'); source.generatedColumns![0].expression = '伪造表达式';
    const p = await preview(source); expect(p.generatedColumns?.[0].expression).toContain('9007199254740993.123456789012');
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('普通自增与不引用自增列的生成列共存，五项确认及准确计数仍完整', async () => {
    ordinaryGenerated('STORED'); const base = definitions.get('t')!.replace('(`qty`', '(`id` bigint NOT NULL AUTO_INCREMENT,`qty`').replace('PRIMARY KEY (`qty`)', 'PRIMARY KEY (`id`)');
    copiedAutoDefinition = base; definitions.set('t', base.replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=9007199254740993')); counters.set('t', '9007199254740993');
    const rows = generatedRows.get('t')!; rows.forEach(row => { row.ordinal = Number(row.ordinal) + 1; });
    rows.unshift({ name: 'id', ordinal: 1, dataType: 'bigint', columnType: 'bigint', nullable: 'NO', extra: 'auto_increment', defaultValue: null, generationExpression: '', charset: null, collation: null });
    const p = await preview(await get()); expect(p.requiredAcknowledgements).toHaveLength(5);
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, structureVerified: true, definitionVerified: true, counter: { state: 'matched', actualValue: '1' } });
  });
});

describe('真实Engine复制空表结构（仅替换驱动）', () => {
  it('读/预览零DDL，准确单次CREATE LIKE；源ID不变、新ID不同、完整定义和空表均核验', async () => {
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.sourceDdl).toBe(original);
    const plan = await preview(snapshot); expect(writes()).toEqual([]); expect(plan.sql).toBe('CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;');
    expect(await apply(plan)).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { tableId: '9007199254740997' } });
    expect(ids.get('t')).toBe(snapshot.tableId); expect(writes()).toEqual([plan.sql]); expect(sent.some(sql => /^SELECT (?:\*|COUNT)/.test(sql))).toBe(false); expect(sent.filter(sql => sql === 'SELECT 1 FROM `db`.`t_copy` LIMIT 1')).toHaveLength(1);
    await expect(apply(plan)).rejects.toThrow('已失效'); expect(connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['8.4.10', '8.4.12', '8.0.41', '11.4.5'])('版本%s只读，不扩版本能力', async value => { version = value; const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(writes()).toEqual([]); });
  it.each(['foreign', 'trigger', 'view', 'partition'])('%s依赖只读', async value => { dependency = value; expect((await get()).writable).toBe(false); expect(writes()).toEqual([]); });
  it.each(['uuid', 'os', 'lower', 'role', 'missing-create'])('%s未知映射或授权只读，不借ALTER/DROP/INSERT扩大能力', async kind => {
    if (kind === 'uuid') uuid = '未知UUID'; if (kind === 'os') os = 'Windows'; if (kind === 'lower') lower = 1;
    if (kind === 'role') grants.push("GRANT 'role' TO 'unit'@'host'"); if (kind === 'missing-create') grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'unit'@'host'"];
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it.each(['check', 'fulltext', 'physical', 'generated', 'hidden'])('%s未证明源结构只读', async kind => {
    if (kind === 'check') definitions.set('t', original.replace(',PRIMARY KEY', ',CONSTRAINT `positive` CHECK (`id` > 0),PRIMARY KEY'));
    if (kind === 'fulltext') definitions.set('t', original.replace('KEY `s_idx`', 'FULLTEXT KEY `s_idx`'));
    if (kind === 'physical') definitions.set('t', original + ' KEY_BLOCK_SIZE=8');
    if (kind === 'generated') definitions.set('t', original.replace('bigint NOT NULL', 'bigint GENERATED ALWAYS AS (1) STORED'));
    if (kind === 'hidden') definitions.set('t', original.replace('bigint NOT NULL', 'bigint NOT NULL INVISIBLE'));
    expect((await get()).writable).toBe(false); expect(writes()).toEqual([]);
  });
  it.each(['uuid', 'tableId', 'definition', 'grants', 'gipk', 'autocommit', 'partialRevokes', 'dependency'])('预览后%s变化零DDL，消费旧预览', async kind => {
    const plan = await preview(await get());
    if (kind === 'uuid') uuid = 'aaaaaaaa-2222-3333-4444-555555555555'; if (kind === 'tableId') ids.set('t', '99'); if (kind === 'definition') definitions.set('t', original.replace('varchar(80)', 'varchar(81)')); if (kind === 'grants') grants = ["GRANT SELECT ON *.* TO 'unit'@'host'"]; if (kind === 'gipk') capability.gipk = 1; if (kind === 'autocommit') capability.autocommit = 0; if (kind === 'partialRevokes') capability.partialRevokes = 1; if (kind === 'dependency') dependency = 'trigger';
    await expect(apply(plan)).rejects.toThrow(); await expect(apply(plan)).rejects.toThrow('已失效'); expect(writes()).toEqual([]);
  });
  it('同名表/视图在预览或执行前拒绝；不覆盖、不后缀改名', async () => {
    const snapshot = await get(); definitions.set('t_copy', '既有对象'); await expect(preview(snapshot)).rejects.toThrow('占用'); definitions.delete('t_copy'); const plan = await preview(snapshot); definitions.set('t_copy', '既有对象'); await expect(apply(plan)).rejects.toThrow('占用'); expect(definitions.get('t_copy')).toBe('既有对象'); expect(writes()).toEqual([]);
  });
  it('最终检查后的外部同名竞态由唯一CREATE拒绝，未知不重放或覆盖', async () => {
    const plan = await preview(await get()); hold = /^CREATE TABLE/; const pending = apply(plan).catch(error => error); await vi.waitFor(() => expect(held).toBeDefined()); definitions.set('t_copy', '外部新对象'); held!.complete();
    expect(await pending).toBeInstanceOf(Error); expect(definitions.get('t_copy')).toBe('外部新对象'); expect(writes()).toEqual([plan.sql]); expect(events.at(-1)?.tableCopyStructure).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(plan)).rejects.toThrow('失效');
  });
  it('错误确认先消费，且同快照两个预览只允许一次实际写', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot, 'other'); await expect(apply(first, { confirmation: ' db.t_copy' })).rejects.toThrow('确认'); await expect(apply(second)).rejects.toThrow('失效'); expect(writes()).toEqual([]);
    const fresh = await get(), a = await preview(fresh), b = await preview(fresh, 'other'); const results = await Promise.allSettled([apply(a), apply(b, { taskId: 'parallel' })]); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(writes()).toHaveLength(1);
  });
  it('不同快照并发仍受源/目标共享结构锁保护，首任务关闭前不放行', async () => {
    const first = await preview(await get()), second = await preview(await get(), 'other'); hold = /^CREATE TABLE/; const pending = apply(first); await vi.waitFor(() => expect(held).toBeDefined()); await expect(apply(second)).rejects.toThrow(/正在|执行|占用/); expect(writes()).toHaveLength(1); held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true });
  });
  it.each(['source', 'target', 'id', 'data', 'warning', 'read'])('DDL成功后%s核验异常保留完成事实，不清理新表或重放', async kind => {
    const plan = await preview(await get()); afterCreate = () => { if (kind === 'source') ids.set('t', '88'); if (kind === 'target') definitions.set('t_copy', definitions.get('t_copy')!.replace('varchar(80)', 'varchar(81)')); if (kind === 'id') ids.set('t_copy', ids.get('t')!); if (kind === 'data') nonempty = true; if (kind === 'warning') warning = 1; if (kind === 'read') fail = /^SHOW CREATE TABLE/; };
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.verificationError).toContain('已完成'); expect(definitions.has('t_copy')).toBe(true); expect(writes()).toEqual([plan.sql]);
  });
  it('取消等待原DDL终态和资源收尾，不自动再次发送', async () => {
    const plan = await preview(await get()); hold = /^CREATE TABLE/; const pending = apply(plan, { taskId: 'cancel-copy' }).catch(error => error); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'cancel-copy' }); expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)?.tableCopyStructure).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); expect(writes()).toEqual([plan.sql]); await expect(apply(plan)).rejects.toThrow('失效');
  });
  it('DDL成功后关闭失败仍发送可信完成进度，旧令牌不可再用', async () => {
    const plan = await preview(await get()); closeFails = true; await expect(apply(plan)).rejects.toThrow('关闭'); expect(events.at(-1)?.tableCopyStructure).toMatchObject({ ddlCompleted: true, definitionVerified: true }); await expect(apply(plan)).rejects.toThrow('失效'); expect(writes()).toHaveLength(1);
  });
  it('DDL已返回而真实关闭仍等待时，源和目标租约都不提前释放', async () => {
    const plan = await preview(await get()); closing = new Promise<void>(resolve => { releaseClosing = resolve; }); let settled = false;
    const pending = apply(plan).finally(() => { settled = true; }); await vi.waitFor(() => expect(events.at(-1)?.tableCopyStructure?.phase).toBe('releasing')); expect(settled).toBe(false);
    // 使用真实共享锁争用目标，即使来源与复制任务不同，也不能在关闭前开始结构变更。
    const locks = (engine as unknown as { structureExecutions: { acquire(connectionId: string, targets: { database: string; table: string }[]): () => void } }).structureExecutions;
    for (const table of ['t', 't_copy']) expect(() => locks.acquire(profile.id, [{ database: 'db', table }])).toThrow('执行');
    releaseClosing!(); closing = undefined; expect(await pending).toMatchObject({ ddlCompleted: true });
    for (const table of ['t', 't_copy']) locks.acquire(profile.id, [{ database: 'db', table }])(); expect(writes()).toHaveLength(1);
  });
  it('快照TTL、可信修订和释放边界均在DDL前拒绝', async () => {
    let plan = await preview(await get()); await expect(apply(plan, { connectionRevision: 2 })).rejects.toThrow('连接');
    const snapshot = await get(); plan = await preview(snapshot); await engine.handle('schema.tableCopyStructure.release', { snapshotId: snapshot.snapshotId }); await expect(apply(plan)).rejects.toThrow('失效');
    plan = await preview(await get()); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120001); await expect(apply(plan)).rejects.toThrow('失效'); expect(writes()).toEqual([]);
  });
  it.each(['42', '9007199254740993', '1'])('源计数%s：准确展示计划、保留自增属性及文字量，唯一CREATE后新计数明确为1', async value => {
    autoSource(value); const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.autoIncrement).toMatchObject({ sourceValue: value, expectedNewValue: '1', column: { name: 'id', maximum: '18446744073709551615' } });
    const plan = await preview(snapshot); expect(plan.autoIncrement).toEqual(snapshot.autoIncrement); expect(plan.requiredAcknowledgements).toContain('auto-increment-copy'); expect(writes()).toEqual([]);
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, structureVerified: true, definitionVerified: true, counter: { state: 'matched', sourceValue: value, expectedValue: '1', actualValue: '1' }, after: { autoIncrement: '1' } }); expect(definitions.get('t_copy')).toBe(copiedAutoDefinition!.replace('CREATE TABLE `t`', 'CREATE TABLE `t_copy`')); expect(counters.get('t')).toBe(value); expect(writes()).toEqual([plan.sql]);
  });
  it.each(['value', 'metadata'])('自增来源%s在预览后变化零DDL，旧计数不能被结构比较豁免', async kind => {
    autoSource('42'); const plan = await preview(await get()); counters.set('t', '43'); if (kind === 'value') definitions.set('t', definitions.get('t')!.replace('AUTO_INCREMENT=42', 'AUTO_INCREMENT=43'));
    await expect(apply(plan)).rejects.toThrow(); expect(writes()).toEqual([]); await expect(apply(plan)).rejects.toThrow('失效');
  });
  it.each(['expiry', 'number', 'missing', 'omitted-nondefault', 'column', 'permission', 'sessionIncrement', 'sessionOffset', 'globalIncrement', 'readOnly', 'mode'])('自增能力%s未知/非默认只读，不要求ALTER或修计数', async kind => {
    autoSource('42'); if (kind === 'mode') initialMode = 'NO_FIELD_OPTIONS'; if (kind === 'expiry') expiry = '86400'; if (kind === 'number') counters.set('t', 42); if (kind === 'missing') counters.set('t', null); if (kind === 'omitted-nondefault') definitions.set('t', definitions.get('t')!.replace(' AUTO_INCREMENT=42', '')); if (kind === 'column') columnTypeOverride = 'int'; if (kind === 'permission') grants = ["GRANT SELECT, SHOW VIEW, TRIGGER ON *.* TO 'unit'@'host'"]; if (Object.hasOwn(policy, kind)) policy[kind] = '2';
    let writable = false; try { writable = (await get()).writable; } catch { /* 缺失或非字符串计数可在完整读取层直接拒绝。 */ } expect(writable).toBe(false); expect(writes()).toEqual([]);
  });
  it('缺少自增专属确认先消费令牌，绝不发送CREATE或第二DDL', async () => {
    autoSource('42'); const plan = await preview(await get()); await expect(apply(plan, { acknowledgements: plan.requiredAcknowledgements.filter(value => value !== 'auto-increment-copy') })).rejects.toThrow('确认'); await expect(apply(plan)).rejects.toThrow('失效'); expect(writes()).toEqual([]);
  });
  it('自增来源同快照并发预览仍只允许一次CREATE', async () => {
    autoSource('42'); const snapshot = await get(), a = await preview(snapshot), b = await preview(snapshot, 'other');
    const results = await Promise.allSettled([apply(a), apply(b, { taskId: 'parallel-auto' })]); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(writes()).toEqual([a.sql]);
  });
  it('自增来源执行前同步取消零CREATE；成功ACK后取消保留完成但计数未核验', async () => {
    autoSource('42'); let plan = await preview(await get()), cancellation: Promise<unknown> | undefined;
    (engine as unknown as { emit: (event: TaskEvent) => void }).emit = event => { events.push(event); if (!cancellation && event.tableCopyStructure?.phase === 'executing') cancellation = engine.handle('query.cancel', { taskId: event.taskId }); };
    await expect(apply(plan)).rejects.toThrow(); await cancellation; expect(writes()).toEqual([]);
    cancellation = undefined; (engine as unknown as { emit: (event: TaskEvent) => void }).emit = event => { events.push(event); if (!cancellation && event.tableCopyStructure?.phase === 'verifying') cancellation = engine.handle('query.cancel', { taskId: event.taskId }); };
    plan = await preview(await get()); const result = await apply(plan); await cancellation; expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false, counter: { state: 'unverified' } }); expect(result.counter?.actualValue).toBeUndefined(); expect(writes()).toEqual([plan.sql]);
  });
  it.each(['2', '9007199254740994'])('新表准确计数%s不符时结构可独立核验，但不报告完整成功、不再发ALTER', async value => {
    autoSource('42'); const plan = await preview(await get()); afterCreate = () => { counters.set('t_copy', value); definitions.set('t_copy', definitions.get('t_copy')!.replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=' + value)); };
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, structureVerified: true, definitionVerified: false, counter: { state: 'different', actualValue: value, expectedValue: '1' } }); expect(writes()).toEqual([plan.sql]); expect(result.verificationError).toContain('已完成');
  });
  it.each(['sourceCounter', 'missingTargetCounter', 'lostAttribute', 'targetDefault', 'type'])('自增后核%s变化保留已创建事实，不能剔除列/默认值或伪造计数', async kind => {
    autoSource('42'); const plan = await preview(await get()); afterCreate = () => { if (kind === 'sourceCounter') { counters.set('t', '43'); definitions.set('t', definitions.get('t')!.replace('AUTO_INCREMENT=42', 'AUTO_INCREMENT=43')); } if (kind === 'missingTargetCounter') counters.set('t_copy', null); if (kind === 'lostAttribute') definitions.set('t_copy', definitions.get('t_copy')!.replace(' NOT NULL AUTO_INCREMENT', ' NOT NULL')); if (kind === 'targetDefault') definitions.set('t_copy', definitions.get('t_copy')!.replace('AUTO_INCREMENT=99', 'AUTO_INCREMENT=98')); if (kind === 'type') definitions.set('t_copy', definitions.get('t_copy')!.replace('bigint unsigned', 'bigint')); };
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); if (kind === 'missingTargetCounter') expect(result.counter?.state).toBe('unverified'); expect(writes()).toEqual([plan.sql]);
  });
});
