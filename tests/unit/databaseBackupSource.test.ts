import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { databaseBackupKinds, type DatabaseBackupKind } from '../../src/shared/databaseBackup';
import { inspectDatabaseBackupSource, databaseBackupSourceSql, DatabaseBackupSourceLimitError, type DatabaseBackupSourceBinding, type DatabaseBackupSourceRead } from '../../src/engine/databaseBackupSource';
import { identifier, qualified } from '../../src/engine/sql';

type Row = Record<string, unknown>;
/** 标准服务器行只在 RAM 中返回；所有 SQL 经完整固定语句/安全引用比对，不提供数据库发送端口。 */
function fixture(family: 'mysql' | 'mariadb' = 'mysql', database = 'shop', table = 'items') {
  const binding: DatabaseBackupSourceBinding = { connectionId: 'ram', database, connectionRevision: 'revision-1', sourceLease: 'lease-1', endpoint: 'direct-pinned', threadId: 42 };
  const versions = { version: family === 'mysql' ? '8.4.11' : '11.4.13-MariaDB-ubu2404', versionComment: family === 'mysql' ? 'MySQL Community Server - GPL' : 'mariadb.org binary distribution' };
  const facts: Row = { hostname: 'ram-source', port: 3306, serverId: '1', currentUser: 'backup@localhost', currentRole: family === 'mysql' ? 'NONE' : null, connectionId: 42, sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', quoteShowCreate: 1, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', identifierCase: 0 };
  const gipk = { generatedPrimaryKeyVisible: 1 };
  const charset = 'utf8mb4', collation = family === 'mysql' ? 'utf8mb4_0900_ai_ci' : 'utf8mb4_uca1400_ai_ci';
  const grantRows = [`GRANT SELECT, SHOW VIEW, SHOW DATABASES, TRIGGER, EVENT, RELOAD, LOCK TABLES, PROCESS${family === 'mariadb' ? ', SHOW CREATE ROUTINE' : ''} ON *.* TO \`backup\`@\`localhost\``];
  const catalogs: Record<'schemas' | 'tables' | 'views' | 'triggers' | 'routines' | 'events', Row[]> = { schemas: [{ name: database, characterSet: charset, collation }], tables: [], views: [], triggers: [], routines: [], events: [] };
  const definitions = new Map<string, Row[]>(), rawDefinitions = new Map<string, string>(); let cancelled = false, complete = true;
  const show = { database: ['DATABASE', 'Create Database', 'Database'], table: ['TABLE', 'Create Table', 'Table'], view: ['VIEW', 'Create View', 'View'], trigger: ['TRIGGER', 'SQL Original Statement', 'Trigger'], procedure: ['PROCEDURE', 'Create Procedure', 'Procedure'], function: ['FUNCTION', 'Create Function', 'Function'], event: ['EVENT', 'Create Event', 'Event'] } as const;
  function define(kind: DatabaseBackupKind, name: string, sql: string) { const [verb, field, identity] = show[kind]; const statement = `SHOW CREATE ${verb} ${kind === 'database' ? identifier(name) : qualified(database, name)}`; definitions.set(statement, [{ [identity]: name, [field]: sql }]); rawDefinitions.set(`${kind}:${name}`, sql); }
  function add(kind: Exclude<DatabaseBackupKind, 'database'>, name: string, sql: string) {
    if (kind === 'table' || kind === 'view') { catalogs.tables.push({ name, objectType: kind === 'table' ? 'BASE TABLE' : 'VIEW', engine: kind === 'table' ? 'InnoDB' : null }); if (kind === 'view') catalogs.views.push({ name, definer: 'owner@localhost' }); }
    else if (kind === 'procedure' || kind === 'function') catalogs.routines.push({ name, routineType: kind.toUpperCase(), definer: 'owner@localhost' });
    else catalogs[kind === 'trigger' ? 'triggers' : 'events'].push({ name, tableName: table, definer: 'owner@localhost' });
    define(kind, name, sql);
  }
  define('database', database, `CREATE DATABASE ${identifier(database)} /*!40100 DEFAULT CHARACTER SET ${charset} COLLATE ${collation} */${family === 'mysql' ? " /*!80016 DEFAULT ENCRYPTION='N' */" : ''}`);
  add('table', table, `CREATE TABLE ${identifier(table)} (\`id\` int NOT NULL,\`note\` varchar(64) DEFAULT NULL COMMENT 'REFERENCES evil.p 仅为文本',PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  const calls: DatabaseBackupSourceRead[] = [];
  const read = vi.fn(async (statement: DatabaseBackupSourceRead) => {
    calls.push(structuredClone(statement)); let rows: Row[];
    if (!statement.id.startsWith('show-') && statement.sql !== databaseBackupSourceSql[statement.id as keyof typeof databaseBackupSourceSql]) throw Error('RAM拒绝偏离固定语句');
    if (statement.id === 'version') rows = [versions];
    else if (statement.id === 'facts') rows = [facts];
    else if (statement.id === 'uuid') rows = [{ serverUuid: '11111111-2222-3333-4444-555555555555' }];
    else if (statement.id === 'gipk') rows = [gipk];
    else if (statement.id === 'grants') rows = grantRows.map(value => ({ 'Grants for backup@localhost': value }));
    else if (statement.id.startsWith('show-')) { const found = definitions.get(statement.sql); if (!found) throw Error('RAM拒绝未定义的SHOW'); rows = found; }
    else rows = catalogs[statement.id as keyof typeof catalogs];
    return { rows: structuredClone(rows), complete };
  });
  const context = { read, checkCancelled: () => { if (cancelled) throw Error('RAM任务取消'); } };
  return { family, database, table, binding, versions, facts, gipk, grantRows, catalogs, definitions, rawDefinitions, calls, read, context, define, add, cancel: () => { cancelled = true; }, truncate: () => { complete = false; } };
}

describe('B01 固定只读源检查（RAM SQL）', () => {
  it('MySQL完整全局权限下保留完整数据库/表摘要，零其它类别可证明，但不伪造锁覆盖', async () => {
    const f = fixture(); f.grantRows.push("GRANT PROXY ON ''@'' TO `backup`@`localhost` WITH GRANT OPTION"); const result = await inspectDatabaseBackupSource(f.context, f.binding);
    expect(result.evidence.objects).toHaveLength(2); expect(Object.values(result.evidence.visibility)).toEqual(databaseBackupKinds.map(() => 'proven'));
    expect(Object.values(result.evidence.permissions).every(value => value === 'proven')).toBe(true); expect(result.evidence.externalDependencies).toEqual([]);
    expect(result.evidence.lockCapability.ddlCoverage).toEqual(Object.fromEntries(databaseBackupKinds.map(kind => [kind, 'unknown']))); expect(result.actualLockHeld).toBe(false);
    expect(result.evidence.lockCapability.versionValidated).toBe('');
    expect(result.facts.serverUuid).toBe('11111111-2222-3333-4444-555555555555'); expect(result.facts.currentUser).toBe('backup@localhost');
    expect(result.evidence.objects.find(object => object.kind === 'table')?.definitionSha256).toBe(createHash('sha256').update(f.rawDefinitions.get(`table:${f.table}`)!).digest('hex'));
    const serialized = JSON.stringify(result); for (const definition of f.rawDefinitions.values()) expect(serialized).not.toContain(definition);
    expect(serialized).not.toContain(f.grantRows[0]); expect(serialized).not.toContain(createHash('sha256').update(f.grantRows[0]).digest('hex'));
    for (const statement of f.calls) { expect(statement.sensitiveResult).toBe(true); expect(statement.maxBytes).toBeGreaterThan(0); expect(statement.maxRows).toBeLessThanOrEqual(10001); expect(statement.sql).not.toMatch(/^(?:USE|SET|GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i); }
  });
  it('数据库值参数化，SHOW名称使用既有安全引用，特殊标识符和文本不被当依赖或SQL片段', async () => {
    const f = fixture('mysql', "d`b.'%_--", 'i`tem.with.dot'), result = await inspectDatabaseBackupSource(f.context, f.binding);
    expect(result.evidence.externalDependencies).toEqual([]);
    for (const statement of f.calls.filter(value => ['schemas', 'tables', 'views', 'triggers', 'routines', 'events'].includes(value.id))) { expect(statement.params).toEqual([f.database]); expect(statement.sql).not.toContain(f.database); expect(statement.sql).toContain('BINARY ?'); }
    expect(f.calls.find(statement => statement.id === 'show-table')?.sql).toBe("SHOW CREATE TABLE `d``b.'%_--`.`i``tem.with.dot`");
  });
  it.each(['role', 'revoke', 'schema-only', 'grantee', 'mysql-all', 'auth-suffix', 'missing-event'])('权限 %s 不能把零目录当作完整可见范围', async kind => {
    const f = fixture(kind === 'auth-suffix' ? 'mariadb' : 'mysql');
    if (kind === 'role') f.facts.currentRole = '`reader_role`';
    if (kind === 'revoke') f.grantRows.push('REVOKE SELECT ON `hidden`.* FROM `backup`@`localhost`');
    if (kind === 'schema-only') { f.grantRows[0] = 'GRANT SELECT ON `shop`.* TO `backup`@`localhost`'; f.catalogs.tables = []; }
    if (kind === 'grantee') f.grantRows[0] = f.grantRows[0].replace('`backup`@`localhost`', '`someone`@`localhost`');
    if (kind === 'mysql-all') f.grantRows[0] = 'GRANT ALL PRIVILEGES ON *.* TO `backup`@`localhost`';
    if (kind === 'auth-suffix') f.grantRows[0] = "GRANT ALL PRIVILEGES ON *.* TO 'backup'@'localhost' IDENTIFIED BY PASSWORD '*仅RAM假值'";
    if (kind === 'missing-event') f.grantRows[0] = f.grantRows[0].replace('EVENT, ', '');
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.visibility.event).toBe('unknown'); expect(result.blockers.length).toBeGreaterThan(0); expect(result.evidence.objects).toHaveLength(kind === 'schema-only' ? 1 : 2);
    if (kind === 'schema-only') expect(result.evidence.visibility.table).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('仅RAM假值'); expect(result.evidence.permissions.events).not.toBe('proven');
  });
  it('MariaDB准确组合的干净全局ALL可证明权限，实例仅声明端点/会话，不杜撰UUID', async () => {
    const f = fixture('mariadb'); f.grantRows[0] = "GRANT ALL PRIVILEGES ON *.* TO 'backup'@'localhost' WITH GRANT OPTION";
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.version).toBe('11.4.13'); expect(result.evidence.permissions.routines).toBe('proven'); expect(result.evidence.externalDependencies).toEqual([]);
    expect(result.facts.serverUuid).toBeNull(); expect(result.facts.identityAssurance).toBe('mariadb-session-and-endpoint'); expect(f.calls.some(value => value.id === 'uuid' || value.id === 'gipk')).toBe(false);
  });
  it('MySQL隐藏生成不可见主键时不把SHOW当前输出当作完整定义，也不发送SET修复', async () => {
    const f = fixture(); f.gipk.generatedPrimaryKeyVisible = 0; const result = await inspectDatabaseBackupSource(f.context, f.binding);
    expect(result.facts.generatedPrimaryKeyVisible).toBe(false); expect(result.evidence.visibility.table).toBe('unknown'); expect(result.blockers.some(value => value.code === 'session-definition-incomplete')).toBe(true); expect(f.calls.some(value => value.sql.startsWith('SET'))).toBe(false);
  });
  it.each(['old-version', 'fork', 'maria-impostor'])('版本 %s 不冒充准确支持组合，也不继续发送可能不支持的会话SQL', async kind => {
    const f = fixture(); if (kind === 'old-version') f.versions.version = '8.0.46'; else if (kind === 'fork') f.versions.versionComment = 'Percona Server'; else { f.versions.version = '11.4.13-NotMariaDB'; f.versions.versionComment = '未知发行版'; }
    await expect(inspectDatabaseBackupSource(f.context, f.binding)).rejects.toThrow('准确组合'); expect(f.calls.map(value => value.id)).toEqual(['version']);
  });
  it('各类复杂对象均读取SHOW并保留摘要/DEFINER，未知依赖明确阻断而非跳过', async () => {
    const f = fixture();
    for (const kind of ['view', 'trigger', 'procedure', 'function', 'event'] as const) f.add(kind, `object_${kind}`, `CREATE ${kind.toUpperCase()} 定义仅在RAM`);
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.objects).toHaveLength(7); expect(result.definers).toHaveLength(5); expect(result.definers.every(item => item.account === 'owner@localhost')).toBe(true);
    for (const kind of databaseBackupKinds) expect(result.evidence.objects.some(object => object.kind === kind && object.definitionSha256)).toBe(true);
    expect(result.evidence.externalDependencies).toHaveLength(5); expect(result.blockers.some(item => item.code === 'dependencies-unproven')).toBe(true); expect(JSON.stringify(result)).not.toContain('定义仅在RAM');
  });
  it.each(['cross-database-fk', 'generated', 'tablespace', 'encoding-mismatch'])('依赖 %s 明确保留未知，不能用正则漏检后声称独立恢复', async kind => {
    const f = fixture(); let sql = f.rawDefinitions.get(`table:${f.table}`)!;
    if (kind === 'cross-database-fk') sql = 'CREATE TABLE `items` (`id` int,CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `outside.db`.`p` (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
    if (kind === 'generated') sql = 'CREATE TABLE `items` (`id` int,`g` int GENERATED ALWAYS AS (`id`+1) STORED) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
    if (kind === 'tablespace') sql += ' TABLESPACE `external_space`';
    if (kind === 'encoding-mismatch') f.catalogs.schemas[0].collation = 'another_collation'; else f.define('table', f.table, sql);
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.externalDependencies.length).toBeGreaterThan(0); expect(result.evidence.objects).toHaveLength(2);
  });
  it('未知SEQUENCE等类型留在显式未分类清单，完整范围降为未知，不冒充普通表', async () => {
    const f = fixture('mariadb'); f.catalogs.tables.push({ name: 'seq', objectType: 'SEQUENCE', engine: 'InnoDB' });
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.unclassified).toEqual([{ name: 'seq', objectType: 'SEQUENCE' }]); expect(result.evidence.visibility.table).toBe('unknown'); expect(result.evidence.externalDependencies.some(value => value.includes('seq'))).toBe(true);
    expect(f.calls.some(value => value.sql.includes('SHOW CREATE SEQUENCE'))).toBe(false);
  });
  it('缺定义及失败只返回安全阻断，原始驱动错误/SQL/认证内容不透传', async () => {
    const f = fixture(), original = f.read.getMockImplementation()!;
    f.read.mockImplementation(async statement => { if (statement.id === 'show-table') throw Error('RAW_SQL_AND_AUTH_仅RAM'); return original(statement); });
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.objects.find(value => value.kind === 'table')?.definitionSha256).toBeNull(); expect(result.evidence.visibility.table).toBe('unknown'); expect(JSON.stringify(result)).not.toContain('RAW_SQL_AND_AUTH');
  });
  it.each(['objects', 'bytes', 'truncated'])('预算 %s 超限拒绝整批，不返回截断结果', async kind => {
    const f = fixture();
    if (kind === 'objects') f.catalogs.tables = Array.from({ length: 10000 }, (_, index) => ({ name: `t${index}`, objectType: 'BASE TABLE', engine: 'InnoDB' }));
    if (kind === 'bytes') f.define('table', f.table, 'x'.repeat(2 * 1024 * 1024 + 1));
    if (kind === 'truncated') f.truncate();
    await expect(inspectDatabaseBackupSource(f.context, f.binding)).rejects.toBeInstanceOf(DatabaseBackupSourceLimitError);
  });
  it('前后实例、会话或全局权限变化拒绝证据，不误绑旧租约', async () => {
    const f = fixture(), original = f.read.getMockImplementation()!; let count = 0;
    f.read.mockImplementation(async statement => { if (statement.id === 'facts' && ++count === 2) f.facts.hostname = 'changed-instance'; return original(statement); });
    await expect(inspectDatabaseBackupSource(f.context, f.binding)).rejects.toThrow('变化');
    const g = fixture(), read = g.read.getMockImplementation()!; let grants = 0;
    g.read.mockImplementation(async statement => { if (statement.id === 'grants' && ++grants === 2) g.grantRows[0] = 'GRANT USAGE ON *.* TO `backup`@`localhost`'; return read(statement); });
    await expect(inspectDatabaseBackupSource(g.context, g.binding)).rejects.toThrow('权限证据');
  });
  it('输入名称/物理会话/引用模式验证，源检查不发送SET去修复；取消不接纳晚到结果', async () => {
    const invalid = fixture(); invalid.binding.database = 'bad\0name'; await expect(inspectDatabaseBackupSource(invalid.context, invalid.binding)).rejects.toThrow('NUL'); expect(invalid.read).not.toHaveBeenCalled();
    const mismatch = fixture(); mismatch.facts.connectionId = 43; await expect(inspectDatabaseBackupSource(mismatch.context, mismatch.binding)).rejects.toThrow('物理会话');
    const mode = fixture(); mode.facts.quoteShowCreate = 0; const result = await inspectDatabaseBackupSource(mode.context, mode.binding); expect(result.evidence.visibility.table).toBe('unknown'); expect(mode.calls.every(value => !value.sql.startsWith('SET'))).toBe(true);
    const cancelled = fixture(), original = cancelled.read.getMockImplementation()!; cancelled.read.mockImplementation(async statement => { const rows = await original(statement); if (statement.id === 'tables') cancelled.cancel(); return rows; });
    await expect(inspectDatabaseBackupSource(cancelled.context, cancelled.binding)).rejects.toThrow('任务取消'); expect(cancelled.calls.some(value => value.id === 'show-table')).toBe(false);
  });
  it('Root准确版本锁能力才能接纳；检查始终不表示实际已持锁，输入别名不能异步换库', async () => {
    const f = fixture(), original = f.read.getMockImplementation()!;
    f.binding.lockCapability = { evidenceId: 'root-capability', family: 'mysql', version: '8.4.11', profileId: 'mysql-8.4-global-read-lock-v1', ddlCoverage: Object.fromEntries(databaseBackupKinds.map(kind => [kind, 'proven'])) as never };
    f.read.mockImplementation(async statement => { f.binding.database = 'mutated'; return original(statement); });
    const result = await inspectDatabaseBackupSource(f.context, f.binding); expect(result.evidence.database).toBe('shop'); expect(Object.values(result.evidence.lockCapability.ddlCoverage).every(value => value === 'proven')).toBe(true); expect(result.actualLockHeld).toBe(false);
    const g = fixture(); g.binding.endpoint = 'unproven'; g.binding.lockCapability = { ...f.binding.lockCapability, version: '8.4.10' }; const unproven = await inspectDatabaseBackupSource(g.context, g.binding);
    expect(Object.values(unproven.evidence.lockCapability.ddlCoverage).every(value => value === 'unknown')).toBe(true); expect(unproven.blockers.some(value => value.code === 'endpoint-unproven')).toBe(true);
  });
});
