import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DatabaseDropTasks } from '../../src/engine/databaseDropTasks';
import { readDatabaseDrop, proveDatabaseDropPrivileges, assertDatabaseDropUnchanged } from '../../src/engine/databaseDropRead';
import type { StructureTaskContext, StructureTaskHost, StructureTaskOptions } from '../../src/engine/structureDefinition';
import { databaseDropAcknowledgements, databaseDropIdentifier, isProtectedDatabaseDropName, validateDatabaseDropName, type DatabaseDropGetOutput } from '../../src/shared/databaseDrop';

type Row = Record<string, unknown>;
const mode = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };

/** 仅替换驱动和短会话宿主；实际读目录、权限证明、令牌及发送代码保持生产实现。 */
function fixture(database = 'sample') {
  let clock = 1000, schemaExists = true, version = '8.4.11', dialect: 'mysql' | 'mariadb' = 'mysql', physicalId = '9007199254740993';
  let grants = ["GRANT ALL PRIVILEGES ON *.* TO 'tester'@'host'"], warningStatus = 0, ddlError: Error | undefined, fail: RegExp | undefined, cancelled = false, tableWidth = 1;
  let tables: Row[] = [], routines: Row[] = [], triggers: Row[] = [], events: Row[] = [], incoming: Row[] = [];
  let onQuery: ((sql: string) => void) | undefined, afterDrop: (() => void) | undefined, closing: (() => Promise<void>) | undefined;
  const sent: string[] = [], options: StructureTaskOptions[] = []; let closes = 0, checks = 0;
  const table = (name = 'subject', kind = 'BASE TABLE'): Row => ({ name, kind, engine: kind === 'VIEW' ? null : 'InnoDB', collation: kind === 'VIEW' ? null : 'utf8mb4_bin', options: kind === 'VIEW' ? null : '' });
  const attributes = { definer: 'tester@host', sqlMode: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', databaseCollation: 'utf8mb4_bin' };
  const objectName = (sql: string): string => [...sql.matchAll(/`((?:``|[^`])*)`/g)].at(-1)![1].replaceAll('``', '`');
  const context = (): StructureTaskContext => {
    let sessionMode = '';
    const connection = Object.assign(new EventEmitter(), { threadId: 7, query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
      sent.push(sql); onQuery?.(sql);
      if (fail?.test(sql)) { callback(new Error('真实驱动失败')); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT VERSION()')) rows = [{ version, sqlMode: sessionMode, hostname: 'isolated', port: 3306, serverId: 0, currentUser: 'tester@host', connectionId: 7, lowerNames: 0, os: 'Linux' }];
      else if (sql === 'SELECT @@server_uuid AS uuid') rows = [{ uuid: '11111111-2222-3333-4444-555555555555' }];
      else if (sql.startsWith('SET SESSION sql_mode')) { sessionMode = /'([^']*)'/.exec(sql)![1]; rows = { affectedRows: 0 }; }
      else if (sql.startsWith('SET ')) rows = { affectedRows: 0 };
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode')) rows = [{ sqlMode: sessionMode, quoteShowCreate: 1, charset: 'utf8mb4', collation: 'utf8mb4_bin', foreignChecks: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ showGipk: 1 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(Grants => ({ Grants }));
      else if (sql.includes('FROM information_schema.SCHEMATA')) rows = schemaExists ? [{ name: database, charset: 'utf8mb4', collation: 'utf8mb4_bin' }] : [];
      else if (sql.startsWith('SHOW CREATE DATABASE')) rows = schemaExists ? [{ Database: database, 'Create Database': 'CREATE DATABASE ' + databaseDropIdentifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' }] : [];
      else if (sql.includes('FROM information_schema.TABLES')) rows = tables.map(row => ({ ...row }));
      else if (sql.includes('FROM information_schema.ROUTINES')) rows = routines.map(row => ({ ...row }));
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = triggers.map(row => ({ ...row }));
      else if (sql.includes('FROM information_schema.EVENTS')) rows = events.map(row => ({ ...row }));
      else if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) rows = incoming.map(row => ({ ...row }));
      else if (/FROM information_schema.INNODB_(?:SYS_)?TABLES/.test(sql)) rows = tables.filter(row => row.engine === 'InnoDB').map(row => ({ id: physicalId, name: database + '/' + row.name }));
      else if (sql.startsWith('SHOW CREATE TABLE')) { const name = objectName(sql); rows = [{ Table: name, 'Create Table': `CREATE TABLE \`${name.replaceAll('`', '``')}\` (\`id\` int, \`value\` varchar(${tableWidth})) ENGINE=InnoDB` }]; }
      else if (sql.startsWith('SHOW CREATE VIEW')) { const name = objectName(sql); rows = [{ View: name, 'Create View': `CREATE VIEW \`${name}\` AS select 1`, character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_bin' }]; }
      else if (sql.startsWith('SHOW CREATE PROCEDURE')) { const name = objectName(sql); rows = [{ Procedure: name, 'Create Procedure': `CREATE PROCEDURE \`${name}\`() BEGIN SELECT 1; END`, sql_mode: '' }]; }
      else if (sql.startsWith('SHOW CREATE FUNCTION')) { const name = objectName(sql); rows = [{ Function: name, 'Create Function': `CREATE FUNCTION \`${name}\`() RETURNS int DETERMINISTIC RETURN 1`, sql_mode: '' }]; }
      else if (sql.startsWith('SHOW CREATE TRIGGER')) { const name = objectName(sql); rows = [{ Trigger: name, 'SQL Original Statement': `CREATE TRIGGER \`${name}\` BEFORE INSERT ON subject FOR EACH ROW SET NEW.id=1`, sql_mode: '' }]; }
      else if (sql.startsWith('SHOW CREATE EVENT')) { const name = objectName(sql); rows = [{ Event: name, 'Create Event': `CREATE EVENT \`${name}\` ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1`, sql_mode: '' }]; }
      else if (sql.startsWith('DROP DATABASE')) { if (ddlError) { callback(ddlError); return; } schemaExists = false; rows = { affectedRows: tables.length, warningStatus }; afterDrop?.(); }
      else { callback(new Error('未定义测试SQL：' + sql)); return; }
      callback(null, rows, []);
    } });
    return { managed: { connection, broken: false, status: { version, dialect } } as unknown as StructureTaskContext['managed'], report() {}, commandStarted: () => () => {}, checkCancelled() { checks++; if (cancelled) throw Error('任务已取消'); } };
  };
  const host: StructureTaskHost = { async run(_connectionId, _taskId, action, option) { options.push(option); try { return await action(context()); } finally { closes++; await closing?.(); } } };
  const tasks = new DatabaseDropTasks(host, () => clock);
  const get = (): Promise<DatabaseDropGetOutput> => tasks.get({ connectionId: 'connection', database, taskId: 'get' }, 1);
  const preview = async () => tasks.preview({ snapshotId: (await get()).snapshotId, taskId: 'preview' }, 1);
  const apply = async (previewToken: string, confirmation = database, acknowledgements: string[] = [...databaseDropAcknowledgements], revision = 1) => tasks.apply({ previewToken, confirmation, acknowledgements, taskId: 'apply' }, revision);
  return { tasks, context, get, preview, apply, sent, options, table, attributes,
    get closes() { return closes; }, get checks() { return checks; }, get ddl() { return sent.filter(sql => sql.startsWith('DROP DATABASE')); },
    set version(value: string) { version = value; dialect = value.includes('MariaDB') ? 'mariadb' : 'mysql'; }, set grants(value: string[]) { grants = value; },
    set tables(value: Row[]) { tables = value; }, set routines(value: Row[]) { routines = value; }, set triggers(value: Row[]) { triggers = value; }, set events(value: Row[]) { events = value; }, set incoming(value: Row[]) { incoming = value; },
    set physicalId(value: string) { physicalId = value; }, set tableWidth(value: number) { tableWidth = value; }, set warningStatus(value: number) { warningStatus = value; }, set ddlError(value: Error | undefined) { ddlError = value; }, set fail(value: RegExp | undefined) { fail = value; }, set cancelled(value: boolean) { cancelled = value; }, set clock(value: number) { clock = value; },
    set onQuery(value: ((sql: string) => void) | undefined) { onQuery = value; }, set afterDrop(value: (() => void) | undefined) { afterDrop = value; }, set closing(value: (() => Promise<void>) | undefined) { closing = value; }, set schemaExists(value: boolean) { schemaExists = value; },
  };
}

describe('删除数据库名称和权限证明', () => {
  it.each(['示例数据库', '库`名字', 'a b', "a'b", 'db_1', 'αβ'])('保留合法名称%s并准确双写反引号', name => {
    expect(validateDatabaseDropName(name)).toBe(name); expect(databaseDropIdentifier(name)).toBe('`' + name.replaceAll('`', '``') + '`');
  });
  it.each(['', 'a\0b', 'a/b', 'a\\b', 'a.b', 'a ', '😀', 'a'.repeat(65)])('拒绝服务器非法名称且不修剪%s', name => { expect(() => validateDatabaseDropName(name)).toThrow(); });
  it.each(['mysql', 'MYSQL', 'information_schema', 'Performance_Schema', 'sys'])('系统库%s始终受保护', name => { expect(isProtectedDatabaseDropName(name)).toBe(true); });
  it('明确全局可见性与精确库DROP，不把PROCESS或表授权当完整可见性', () => {
    const visible = "GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, PROCESS ON *.* TO 'tester'@'host'";
    expect(proveDatabaseDropPrivileges([visible, "GRANT DROP ON `sample`.* TO 'tester'@'host'"], 'sample', mode)).toBe(true);
    expect(proveDatabaseDropPrivileges(["GRANT PROCESS ON *.* TO 'tester'@'host'", "GRANT ALL ON `sample`.* TO 'tester'@'host'"], 'sample', mode)).toBe(false);
    expect(proveDatabaseDropPrivileges([visible, "GRANT DROP ON `sample`.`subject` TO 'tester'@'host'"], 'sample', mode)).toBe(false);
    expect(proveDatabaseDropPrivileges([visible], 'sample', mode, false)).toBe(true);
    expect(proveDatabaseDropPrivileges([visible], 'sample', mode)).toBe(false);
  });
  it('已转义的精确库模式可以证明DROP，通配模式、角色和部分撤销拒绝', () => {
    const visible = "GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, PROCESS ON *.* TO 'tester'@'host'";
    expect(proveDatabaseDropPrivileges([visible, "GRANT DROP ON `db\\_1`.* TO 'tester'@'host'"], 'db_1', mode)).toBe(true);
    for (const grant of ["GRANT DROP ON `db_1`.* TO 'tester'@'host'", "GRANT DROP ON `db%`.* TO 'tester'@'host'", "GRANT `role` TO 'tester'@'host'", "REVOKE SELECT ON `private`.* FROM 'tester'@'host'"]) expect(proveDatabaseDropPrivileges([visible, grant], 'db_1', mode)).toBe(false);
  });
});

describe('数据库删除真实读取器与一次性任务（RAM驱动，无实库）', () => {
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB-ubu2204', '11.4.13-MariaDB-ubu2404'])('指定版本%s空库也需完整目录证明而非伪造OID', async version => {
    const f = fixture(); f.version = version; const snapshot = await f.get();
    expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.counts).toEqual({ tables: 0, views: 0, procedures: 0, functions: 0, triggers: 0, events: 0 }); expect(snapshot.catalogDigest).toMatch(/^[a-f0-9]{64}$/); expect(snapshot).not.toHaveProperty('databaseId');
    const next = await f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview' }, 1); expect(f.ddl).toEqual([]);
    const output = await f.apply(next.previewToken); expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true } }); expect(f.ddl).toEqual(['DROP DATABASE `sample`;']); expect(f.closes).toBe(3);
    expect(f.options.at(-1)).toMatchObject({ purpose: 'databaseDrop', executionDatabase: 'sample' });
  });
  it('六类对象逐一完整SHOW CREATE，两次读取再预览，提交只有一条原生DROP', async () => {
    const f = fixture('库`名字'); f.tables = [f.table(), f.table('v', 'VIEW')];
    f.routines = [{ ...f.attributes, name: 'p', kind: 'PROCEDURE', securityType: 'DEFINER' }, { ...f.attributes, name: 'fn', kind: 'FUNCTION', securityType: 'DEFINER' }];
    f.triggers = [{ ...f.attributes, name: 'tr', tableName: 'subject', timing: 'BEFORE', event: 'INSERT', actionOrder: 1 }];
    f.events = [{ ...f.attributes, name: 'ev', timeZone: 'SYSTEM', kind: 'RECURRING', status: 'DISABLED', completion: 'PRESERVE', executeAt: null, intervalValue: '1', intervalField: 'DAY', starts: '2026-01-01 00:00:00', ends: null }];
    const snapshot = await f.get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.counts).toEqual({ tables: 1, views: 1, procedures: 1, functions: 1, triggers: 1, events: 1 });
    for (const kind of ['TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']) expect(f.sent.filter(sql => sql.startsWith('SHOW CREATE ' + kind + ' '))).toHaveLength(2);
    const preview = await f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview' }, 1); expect(preview.sql).toBe('DROP DATABASE `库``名字`;');
    expect(await f.apply(preview.previewToken)).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(f.ddl).toHaveLength(1);
    expect(f.sent.some(sql => /DROP TABLE|DROP VIEW|SET.*foreign_key_checks\s*=\s*0|REVOKE|SELECT \*/.test(sql))).toBe(false);
  });
  it('基本表缺少CREATE_OPTIONS仍拒绝，真实视图的NULL只限视图使用', async () => {
    const f = fixture(); f.tables = [{ ...f.table(), options: null }]; const result = await f.get();
    expect(result.writable).toBe(false); expect(result.reasons.join('；')).toContain('目录不完整'); expect(f.ddl).toHaveLength(0);
  });
  it.each(['mysql', 'information_schema', 'performance_schema', 'sys'])('系统库%s只能查看，零DDL且不读取对象清单', async name => {
    const f = fixture(name), snapshot = await f.get(); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.join()).toContain('系统');
    await expect(f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview' }, 1)).rejects.toThrow(); expect(f.ddl).toHaveLength(0); expect(f.sent.some(sql => sql.includes('FROM information_schema.TABLES'))).toBe(false);
  });
  it.each(['5.7.43', '8.0.45', '8.4.10', '10.11.18-MariaDB', '11.4.12-MariaDB', '9.0.1'])('未证明版本%s不能生成可执行预览', async version => { const f = fixture(); f.version = version; const s = await f.get(); expect(s.writable).toBe(false); await expect(f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'preview' }, 1)).rejects.toThrow(); expect(f.ddl).toHaveLength(0); });
  it.each(['SHOW CREATE PROCEDURE', 'SHOW CREATE FUNCTION', 'SHOW CREATE VIEW', 'SHOW CREATE TRIGGER', 'SHOW CREATE EVENT'])('无法读取%s不得把不可见定义当作空库', async kind => {
    const f = fixture(); f.tables = [f.table('v', 'VIEW')]; f.routines = [{ ...f.attributes, name: 'p', kind: 'PROCEDURE', securityType: 'DEFINER' }, { ...f.attributes, name: 'fn', kind: 'FUNCTION', securityType: 'DEFINER' }]; f.triggers = [{ ...f.attributes, name: 'tr', tableName: 'subject', timing: 'BEFORE', event: 'INSERT', actionOrder: 1 }]; f.events = [{ ...f.attributes, name: 'ev', timeZone: 'SYSTEM', kind: 'RECURRING', status: 'DISABLED', completion: 'PRESERVE', executeAt: null, intervalValue: '1', intervalField: 'DAY', starts: '2026-01-01', ends: null }];
    f.fail = new RegExp('^' + kind); const snapshot = await f.get(); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.join()).toContain('驱动失败'); expect(f.ddl).toHaveLength(0);
  });
  it('外库入向外键只读，内部依赖不伪造外向修复或关闭检查', async () => {
    const f = fixture(); f.incoming = [{ databaseName: 'other', tableName: 'child', name: 'fk', referencedTable: 'subject', ordinal: 1 }]; const s = await f.get(); expect(s.writable).toBe(false); expect(s.reasons.join()).toContain('其它数据库'); await expect(f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'preview' }, 1)).rejects.toThrow(); expect(f.ddl).toHaveLength(0);
  });
  it.each(['definition', 'physical', 'object-list', 'privileges'])('预览后%s漂移拒绝发送并消费全部兄弟', async change => {
    const f = fixture(); f.tables = [f.table()]; const snapshot = await f.get(), first = await f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'p1' }, 1), second = await f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'p2' }, 1);
    if (change === 'definition') f.tableWidth = 2; if (change === 'physical') f.physicalId = '9007199254740994'; if (change === 'object-list') f.tables = [f.table(), f.table('new_table')]; if (change === 'privileges') f.grants = ["GRANT PROCESS ON *.* TO 'tester'@'host'"];
    await expect(f.apply(first.previewToken)).rejects.toThrow(); await expect(f.apply(second.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(0);
  });
  it('单轮目录读取期间漂移只读，不用最后一次读取覆盖前一次事实', async () => {
    const f = fixture(); f.tables = [f.table()]; let reads = 0; f.onQuery = sql => { if (sql.startsWith('SHOW CREATE TABLE') && ++reads === 2) f.tableWidth = 3; };
    const s = await f.get(); expect(s.writable).toBe(false); expect(s.reasons.join()).toContain('读取期间变化'); expect(f.ddl).toHaveLength(0);
  });
  it('目录预算4096拒绝溢出，不静默截断或扫描数据', async () => { const f = fixture(); f.tables = Array.from({ length: 4097 }, (_, i) => f.table('t' + i)); const s = await f.get(); expect(s.writable).toBe(false); expect(s.reasons.join()).toContain('4096'); expect(f.ddl).toHaveLength(0); });
  it.each(['confirmation', 'acks', 'revision'])('%s不匹配先消费同来源全部令牌且零DDL', async kind => {
    const f = fixture(), s = await f.get(), a = await f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'a' }, 1), b = await f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'b' }, 1);
    await expect(f.apply(a.previewToken, kind === 'confirmation' ? 'sample ' : 'sample', kind === 'acks' ? [] : [...databaseDropAcknowledgements], kind === 'revision' ? 2 : 1)).rejects.toThrow();
    await expect(f.apply(b.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(0);
  });
  it('DDL原始驱动错误保留对象结果未知且不可重放，不补发DROP', async () => {
    const f = fixture(), p = await f.preview(), error = Object.assign(new Error('数据库部分删除后失败'), { errno: 1010, code: 'ER_DB_DROP_RMDIR', sqlState: 'HY000' }); f.ddlError = error;
    await expect(f.apply(p.previewToken)).rejects.toBe(error); await expect(f.apply(p.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(1); expect(f.options.at(-1)?.progress).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
  });
  it.each(['read-error', 'cancel', 'warnings', 'recreated', 'permissions'])('成功ACK后%s只改变核验状态，不能抹掉DDL已完成或自动重放', async change => {
    const f = fixture(), p = await f.preview();
    if (change === 'warnings') f.warningStatus = 1;
    f.afterDrop = () => { if (change === 'read-error') f.fail = /FROM information_schema.SCHEMATA/; if (change === 'cancel') f.cancelled = true; if (change === 'recreated') f.schemaExists = true; if (change === 'permissions') f.grants = ["GRANT USAGE ON *.* TO 'tester'@'host'"]; };
    expect(await f.apply(p.previewToken)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); expect(f.options.at(-1)?.progress).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); await expect(f.apply(p.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(1);
  });
  it('提交前取消零DDL，取消不会复活已消费的兄弟预览', async () => { const f = fixture(), p = await f.preview(); f.cancelled = true; await expect(f.apply(p.previewToken)).rejects.toThrow('取消'); f.cancelled = false; await expect(f.apply(p.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(0); });
  it('release、过期及连接释放使预览失效', async () => {
    for (const release of ['snapshot', 'preview', 'connection', 'expired']) {
      const f = fixture(), s = await f.get(), p = await f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'preview' }, 1);
      if (release === 'snapshot') f.tasks.releaseTokens({ snapshotId: s.snapshotId }); if (release === 'preview') f.tasks.releaseTokens({ previewToken: p.previewToken }); if (release === 'connection') f.tasks.releaseConnection('connection'); if (release === 'expired') f.clock = 121001;
      await expect(f.apply(p.previewToken)).rejects.toThrow('已失效或已使用'); expect(f.ddl).toHaveLength(0);
    }
  });
  it('真实宿主收尾等待期间释放连接不得迟到发布get快照', async () => {
    const f = fixture(); let finish!: () => void, closing = false; const gate = new Promise<void>(resolve => { finish = resolve; }); f.closing = async () => { closing = true; await gate; };
    const pending = f.get(), rejected = expect(pending).rejects.toThrow('未发布迟到快照'); await Promise.resolve(); await Promise.resolve();
    // 等待真实宿主finally进入收尾；不通过跳过产品读取来制造迟到发布。
    while (!closing) await Promise.resolve(); f.tasks.releaseConnection('connection'); finish(); await rejected; expect(f.ddl).toHaveLength(0);
  });
  it('宿主收尾等待期间释放来源不得迟到发布preview', async () => {
    const f = fixture(), s = await f.get(); let finish!: () => void, closing = false; const gate = new Promise<void>(resolve => { finish = resolve; }); f.closing = async () => { closing = true; await gate; };
    const pending = f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'preview' }, 1), rejected = expect(pending).rejects.toThrow('未发布迟到'); while (!closing) await Promise.resolve(); f.tasks.releaseTokens({ snapshotId: s.snapshotId }); finish(); await rejected; expect(f.ddl).toHaveLength(0);
  });
  it('等待读取期间释放已消费来源阻止apply最终发送', async () => {
    const f = fixture(), s = await f.get(), p = await f.tasks.preview({ snapshotId: s.snapshotId, taskId: 'preview' }, 1); let released = false;
    f.onQuery = sql => { if (!released && sql.startsWith('SELECT VERSION()')) { released = true; f.tasks.releaseTokens({ snapshotId: s.snapshotId }); } };
    await expect(f.apply(p.previewToken)).rejects.toThrow('来源已释放'); expect(f.ddl).toHaveLength(0);
  });
  it('独立读取器摘要比较拒绝定义相同但物理表替换，空库不虚构独立ID', async () => { const f = fixture(); f.tables = [f.table()]; const first = await readDatabaseDrop(f.context(), { connectionId: 'connection', database: 'sample' }); f.physicalId = '9007199254740999'; const next = await readDatabaseDrop(f.context(), { connectionId: 'connection', database: 'sample' }); expect(() => assertDatabaseDropUnchanged(first, next)).toThrow('已变化'); });
});
