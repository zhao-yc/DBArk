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
let closing: Promise<void> | undefined, releaseClosing: (() => void) | undefined;
/** 精确解析产品只读目录中的编码名称，预期DDL由测试独立断言，驱动不调用产品规划器。 */
function nameOf(sql: string): string { const quoted = /^SHOW CREATE TABLE `db`\.`([^`]+)`/.exec(sql); if (quoted) return quoted[1]; const values = [...sql.matchAll(/X'([a-f0-9]*)'/g)].map(value => Buffer.from(value[1], 'hex').toString()); return values.at(-1)?.split('/').at(-1) ?? 't'; }
/** 仅替换数据库驱动边界，完整读取、任务、缓存、锁、取消和关闭都运行真实Engine。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence; let mode = '', quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closing && definitions.has('t_copy')) await closing; if (closeFails) throw Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('模拟驱动失败')); return; }
      let rows: unknown = []; const name = nameOf(sql), source = definitions.get(name)!, context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
      if (sql.startsWith('SET SESSION foreign_key_checks') || sql.startsWith('SET SESSION show_gipk')) rows = {};
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
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: readTableCommentDefinition(source, context).comment, autoIncrement: source.includes('AUTO_INCREMENT') ? '9' : null }];
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
        definitions.set(match[1], definitions.get('t')!.replace('CREATE TABLE `t`', 'CREATE TABLE `' + match[1] + '`')); ids.set(match[1], '9007199254740997'); afterCreate?.(); rows = { affectedRows: 0, warningStatus: warning };
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
beforeEach(async () => {
  definitions = new Map([['t', original]]); ids = new Map([['t', '9007199254740995']]); events = []; connections = []; sent = []; sequence = 0;
  version = '8.4.11'; uuid = '11111111-2222-3333-4444-555555555555'; os = 'Linux'; lower = 0; grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS, CREATE ON *.* TO 'unit'@'host'"]; dependency = ''; capability = { gipk: 0, autocommit: 1, partialRevokes: 0 }; nonempty = false; warning = 0; closeFails = false; fail = hold = undefined; held = undefined; afterCreate = undefined;
  closing = undefined; releaseClosing = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { releaseClosing?.(); closing = undefined; closeFails = false; hold = undefined; held?.complete(Error('离线收尾')); await engine.closeAll(); vi.restoreAllMocks(); });

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
  it.each(['auto', 'check', 'fulltext', 'physical', 'generated', 'hidden'])('%s未证明源结构只读', async kind => {
    if (kind === 'auto') definitions.set('t', original.replace('bigint NOT NULL', 'bigint NOT NULL AUTO_INCREMENT'));
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
});
