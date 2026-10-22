import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableRenameGetOutput, TableRenamePreviewOutput } from '../../src/shared/tableRename';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
import type { RenameViewDefinition } from '../../src/engine/tableRenameViewDependencies';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'comment-unit', name: '注释单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, charset: string, catalogMismatch: boolean, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
let injectedUnknownClose = false;
let afterAlterMode: string | undefined;
let currentName: string, occupied: boolean, dependency: string, grants: string[], afterPhysicalId: string | undefined;
let held: { complete(error?: Error): void } | undefined;
let closeGate: (() => Promise<void>) | undefined;
let legacyViews: RenameViewDefinition[], missingLegacyViews: boolean;
/** 仅替换驱动；真实Engine、目录校验、预览、执行、取消和关闭路径均运行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let sqlMode = mode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect, connectionId: threadId }, close: vi.fn(async () => { if (closeGate) await closeGate(); if (closeFails) { injectedUnknownClose = true; throw new Error('关闭失败'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝'), { errno: 1227 })); return; }
      let rows: unknown = [];
      const context = { dialect, mode: { noBackslashEscapes: sqlMode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: sqlMode.includes('ANSI_QUOTES') } };
      if (sql.startsWith('SET SESSION foreign_key_checks')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) sqlMode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit-server' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: currentName, 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: catalogMismatch ? '目录不符' : readTableCommentDefinition(source, context).comment, autoIncrement: '9007199254740993' }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: physicalId, name: 'db/' + currentName }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset, characters: '2048', bytes: charset === 'utf8mb4' ? '8192' : '6144', maxlen: charset === 'utf8mb4' ? 4 : 3 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.includes('FROM information_schema.INNODB_FOREIGN') || sql.includes('FROM information_schema.INNODB_SYS_FOREIGN')) rows = dependency === 'foreign' ? [{ ID: 'db/foreign' }] : [];
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = dependency === 'trigger' ? [{ TRIGGER_NAME: 'tr' }] : [];
      else if (sql.includes('FROM information_schema.VIEW_TABLE_USAGE')) rows = dependency === 'view' ? [{ VIEW_NAME: 'v' }] : [];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS viewName')) {
        const definitions = sql.includes('information_schema.VIEWS'), hexes = [...sql.matchAll(/X'([0-9a-f]*)'/g)].map(item => Buffer.from(item[1], 'hex').toString()), last = hexes.length ? { database: hexes[0], table: hexes[2] } : undefined;
        rows = (definitions && missingLegacyViews ? [] : legacyViews).slice().sort((a, b) => Buffer.compare(Buffer.from(a.database), Buffer.from(b.database)) || Buffer.compare(Buffer.from(a.table), Buffer.from(b.table))).filter(value => !last || Buffer.compare(Buffer.from(value.database), Buffer.from(last.database)) > 0 || value.database === last.database && Buffer.compare(Buffer.from(value.table), Buffer.from(last.table)) > 0).slice(0, 129).map(value => ({ databaseName: value.database, viewName: value.table, ...(definitions ? { definition: value.definition, charset: value.charset, collation: value.collation } : {}) }));
      }
      else if (sql.startsWith('SHOW CREATE VIEW')) {
        const names = [...sql.matchAll(/`((?:``|[^`])*)`/g)].map(item => item[1].replaceAll('``', '`')), view = legacyViews.find(value => value.database === names[0] && value.table === names[1]);
        if (!view) { callback(Error('未登记真实视图')); return; }
        rows = [{ View: view.table, 'Create View': `CREATE ALGORITHM=UNDEFINED DEFINER=\`u\`@\`h\` SQL SECURITY DEFINER VIEW \`${view.table}\` AS ${view.definition}`, character_set_client: view.charset, collation_connection: view.collation }];
      }
      else if (sql.startsWith('SELECT TABLE_NAME FROM information_schema.TABLES')) {
        const literals = [...sql.matchAll(/X'([0-9a-f]*)'/g)].map(item => Buffer.from(item[1], 'hex').toString());
        rows = literals[1] === currentName || occupied ? [{ TABLE_NAME: literals[1] }] : [];
      }
      else if (sql.startsWith('RENAME TABLE')) {
        const name = / TO \x60db\x60.\x60([^\x60]+)\x60;/.exec(sql)![1];
        source = source.replace('CREATE TABLE \x60' + currentName + '\x60', 'CREATE TABLE \x60' + name + '\x60'); currentName = name;
        if (afterAlterMode !== undefined) sqlMode = afterAlterMode;
        if (afterPhysicalId !== undefined) physicalId = afterPhysicalId;
        rows = { affectedRows: 0, warningStatus: warningCount };
      }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1234, Message: '服务器警告' }];
      else { callback(new Error('未定义测试驱动语句：' + sql)); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) { held = { complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableRenameGetOutput> { return engine.handle('schema.tableRename.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableRenameGetOutput, newName = 'renamed'): Promise<TableRenamePreviewOutput> { return engine.handle('schema.tableRename.preview', { snapshotId: snapshot.snapshotId, newName, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableRenamePreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableRename.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements }); }
beforeEach(async () => {
  injectedUnknownClose = false; closeGate = undefined; legacyViews = []; missingLegacyViews = false;
  currentName = 't'; occupied = false; dependency = ''; grants = ["GRANT ALL PRIVILEGES ON *.* TO 'test'@'host'"]; afterPhysicalId = undefined;
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; charset = 'utf8mb3'; catalogMismatch = false; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false; afterAlterMode = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFails = false; hold = undefined; held?.complete(new Error('单元收尾'));
  // 此旧RAM端口没有资源facade；注入关闭未知后，恢复开关不能替代物理终态证明。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.useRealTimers();
});

describe('真实Engine表重命名生命周期（只替换驱动）', () => {
  it('真实短会话关闭等待期间连接配置释放，不能迟到发布新的可写快照', async () => {
    let finish!: () => void, closing = false; const gate = new Promise<void>(resolve => { finish = resolve; }); closeGate = async () => { closing = true; await gate; };
    const pending = get(), rejected = expect(pending).rejects.toThrow('读取期间'); await vi.waitFor(() => expect(closing).toBe(true));
    await engine.handle('__connections.prepareSave', { id: profile.id, profile, transportChanged: false }); closeGate = undefined; finish(); await rejected;
    expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(0); expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it('发送后原驱动错误使同快照全部其它预览失效，不能重放未知RENAME', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot, 'other'); fail = /^RENAME TABLE/;
    await expect(apply(first, 'unknown-first')).rejects.toThrow('驱动拒绝'); fail = undefined;
    await expect(apply(second, 'unknown-replay')).rejects.toThrow('已失效或已使用'); expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(1); expect(source).toBe(original);
  });
  it('员工3原反例：全局只读目录权限＋来源ALTER/DROP＋目标CREATE/INSERT，不要求来源CREATE/INSERT', async () => {
    grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'test'@'host'", "GRANT ALTER, DROP ON `db`.`t` TO 'test'@'host'", "GRANT CREATE, INSERT ON `db`.`renamed` TO 'test'@'host'"];
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(sent.filter(item => item.sql.startsWith('RENAME TABLE'))).toHaveLength(0);
    const result = await apply(await preview(snapshot)); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(result.after?.physicalIdentity).toMatch(/^[a-f0-9]{64}$/);
  });
  it('员工3原反例：新表只有CREATE/INSERT，RENAME后仍可只读完整核验，不追加ALTER/DROP', async () => {
    grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'test'@'host'", "GRANT ALTER, DROP, CREATE, INSERT ON `db`.`t` TO 'test'@'host'", "GRANT CREATE, INSERT ON `db`.`renamed` TO 'test'@'host'"];
    const next = await preview(await get()), beforeId = physicalId, result = await apply(next);
    expect(currentName).toBe('renamed'); expect(physicalId).toBe(beforeId); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(sent.filter(item => item.sql.startsWith('RENAME TABLE'))).toHaveLength(1);
  });
  it('严格反向：get可以展示，明确新名后缺少目标CREATE/INSERT必须拒绝，零DDL', async () => {
    grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'test'@'host'", "GRANT ALTER, DROP ON `db`.`t` TO 'test'@'host'"];
    const snapshot = await get(); expect(snapshot.writable).toBe(true); await expect(preview(snapshot)).rejects.toThrow('目标CREATE/INSERT'); expect(sent.filter(item => item.sql.startsWith('RENAME TABLE'))).toHaveLength(0);
  });
  it('严格反向：预览后目标INSERT被撤销，提交仍拒绝且消费令牌', async () => {
    const next = await preview(await get()); grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'test'@'host'", "GRANT ALTER, DROP ON `db`.`t` TO 'test'@'host'", "GRANT CREATE ON `db`.`renamed` TO 'test'@'host'"];
    await expect(apply(next)).rejects.toThrow('目标CREATE/INSERT'); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用'); expect(sent.filter(item => item.sql.startsWith('RENAME TABLE'))).toHaveLength(0);
  });
  it('严格反向：后核验丢失目录可见权限仍不能报告完整核验，保留DDL完成事实', async () => {
    const next = await preview(await get()); hold = /^RENAME TABLE/; const pending = apply(next); await vi.waitFor(() => expect(held).toBeDefined());
    grants = ["GRANT SELECT, SHOW VIEW ON *.* TO 'test'@'host'"]; held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(events.at(-1)?.tableRename).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
  });
  it('后核验只读：执行后全部写授权均已移除，完整目录和原生身份仍足以核验', async () => {
    const next = await preview(await get()); hold = /^RENAME TABLE/; const pending = apply(next); await vi.waitFor(() => expect(held).toBeDefined());
    grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS ON *.* TO 'test'@'host'"]; held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });
  it('只读预览零DDL，精确一条RENAME，原生身份和完整定义后核验，令牌不可重放', async () => {
    const snapshot = await get(); expect(snapshot).toMatchObject({ writable: true, tableId: physicalId });
    const next = await preview(snapshot); expect(next.sql).toBe('RENAME TABLE `db`.`t` TO `db`.`renamed`;');
    expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(0);
    expect(await apply(next)).toMatchObject({ definitionVerified: true, ddlCompleted: true, newTarget: { table: 'renamed' }, after: { tableId: physicalId } });
    expect(source).toBe(original.replace('CREATE TABLE `t`', 'CREATE TABLE `renamed`'));
    expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(1);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
    expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['preview', 'apply'] as const)('%s检查实际目标冲突，源表不变且没有DDL', async stage => {
    const snapshot = await get(), next = stage === 'apply' ? await preview(snapshot) : undefined; occupied = true;
    await expect(stage === 'apply' ? apply(next!) : preview(snapshot)).rejects.toThrow('占用');
    expect(source).toBe(original); expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(0);
    if (next) await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['physical', 'source', 'mode', 'revision', 'acks', 'privileges', 'dependency'] as const)('%s变化拒绝旧令牌，失败也消费令牌', async kind => {
    const next = await preview(await get());
    if (kind === 'physical') physicalId = '9007199254740996';
    if (kind === 'source') source = source.replace('varchar(80)', 'varchar(81)');
    if (kind === 'mode') mode = 'NO_BACKSLASH_ESCAPES';
    if (kind === 'privileges') grants = ["GRANT SELECT ON `db`.* TO 'test'@'host'"];
    if (kind === 'dependency') dependency = 'foreign';
    await expect(apply(next, 'apply', kind === 'revision' ? 2 : 1, kind === 'acks' ? [] : next.requiredAcknowledgements)).rejects.toThrow();
    expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(0);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['foreign', 'view', 'trigger'])('依赖%s明确只读，不生成执行预览', async value => {
    dependency = value; const snapshot = await get(); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.length).toBeGreaterThan(0);
    await expect(preview(snapshot)).rejects.toThrow();
  });
  it.each(['5.6.51', '5.7.43', '8.0.29', '9.0.1', '10.5.29-MariaDB', '10.11.18-MariaDB', '11.4.12-MariaDB'])('未证明版本%s不猜测可写', async value => {
    version = value; dialect = value.includes('MariaDB') ? 'mariadb' : 'mysql'; const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow();
  });
  it.each(['5.7.44', '10.11.19-MariaDB', '11.4.13-MariaDB'])('真实旧基线%s完整读取系统100+无关视图后可往返，物理ID和完整正文保留', async value => {
    version = value; dialect = value.includes('MariaDB') ? 'mariadb' : 'mysql'; legacyViews = Array.from({ length: 135 }, (_, index) => ({ database: 'sys', table: 'v' + String(index).padStart(3, '0'), definition: "select 't' as `t` from `performance_schema`.`threads`", charset: 'utf8mb4', collation: 'utf8mb4_bin' }));
    const next = await preview(await get()); expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { tableId: physicalId } });
    expect(sent.some(item => item.sql.includes('INNODB_SYS_FOREIGN'))).toBe(true); expect(sent.some(item => item.sql.includes('VIEW_TABLE_USAGE'))).toBe(false); expect(sent.filter(item => item.sql.startsWith('SHOW CREATE VIEW'))).toHaveLength(135 * 4);
    expect(source).toBe(original.replace('CREATE TABLE `t`', 'CREATE TABLE `renamed`')); expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(1); expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['direct', 'indirect', 'unknown', 'missing'] as const)('旧库%s全局视图依赖或不完整证明均只读，不发送RENAME', async issue => {
    version = '10.11.19-MariaDB'; dialect = 'mariadb';
    legacyViews = [{ database: 'other', table: 'v', definition: issue === 'unknown' ? "select * from json_table('{}','$' columns(x int path '$')) q" : issue === 'indirect' ? 'select * from other.v2' : issue === 'missing' ? 'select * from other.harmless' : 'select * from db.t', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    if (issue === 'indirect') legacyViews.push({ ...legacyViews[0], table: 'v2', definition: 'select * from db.t' }); if (issue === 'missing') missingLegacyViews = true;
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(sent.some(item => item.sql.startsWith('RENAME'))).toBe(false);
  });
  it.each(['physical', 'mode', 'warnings', 'read-failure'] as const)('OK包后%s异常保留DDL已完成，禁止完整核验和重放', async kind => {
    const next = await preview(await get());
    if (kind === 'physical') afterPhysicalId = '9007199254740996';
    if (kind === 'mode') afterAlterMode = 'ANSI_QUOTES';
    if (kind === 'warnings') warningCount = 1;
    if (kind === 'read-failure') { hold = /^RENAME TABLE/; const pending = apply(next); await vi.waitFor(() => expect(held).toBeDefined()); fail = /^SHOW CREATE TABLE/; held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: false }); }
    else expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(events.at(-1)?.tableRename).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('发出RENAME后取消等待真实终态，不能用KILL成功声称未执行', async () => {
    const next = await preview(await get()); hold = /^RENAME TABLE/;
    const pending = apply(next, 'cancel-ddl').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await engine.handle('query.cancel', { taskId: 'cancel-ddl' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled', tableRename: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(sent.filter(item => item.sql.startsWith('RENAME'))).toHaveLength(1); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('共享源/目标租约阻断第二次结构操作，关闭失败仍保留执行事实', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot, 'other'); hold = /^RENAME TABLE/;
    const pending = apply(first, 'first').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await expect(apply(second, 'second')).rejects.toThrow('已失效或已使用'); closeFails = true; held!.complete(); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)?.tableRename).toMatchObject({ ddlCompleted: true }); await expect(apply(second, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('release、过期及连接关闭使快照与预览失效', async () => {
    const snapshot = await get(), next = await preview(snapshot); await engine.handle('schema.tableRename.release', { snapshotId: snapshot.snapshotId }); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    vi.useFakeTimers({ toFake: ['Date'] }); const expired = await preview(await get()); vi.setSystemTime(Date.now() + 120001); await expect(apply(expired, 'expired')).rejects.toThrow('已失效或已使用');
    const closed = await preview(await get()); await engine.handle('connections.close', { id: profile.id }); await expect(apply(closed, 'closed')).rejects.toThrow('已失效或已使用');
  });
});
