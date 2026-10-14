import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTableStructureExportable, definitionOmittingSqlModes } from '../../src/shared/tableColumnPatches';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'structure-export', name: '结构导出保护', group: '', color: '#123456', dialect: 'mariadb', host: 'invalid', port: 3306, user: 'test' };
const unsafe = "CREATE TABLE t(v varchar(80) DEFAULT concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89')) ENGINE=InnoDB";
let directory: string, engine: Engine, events: TaskEvent[], closes: ReturnType<typeof vi.fn>[], mode: string | undefined, dialect: 'mysql' | 'mariadb', source: string, objectKind: 'table' | 'view' | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-structure-export-')); events = []; closes = []; mode = ''; dialect = 'mariadb'; source = unsafe; objectKind = 'table';
  mocks.connect.mockReset().mockImplementation(async () => {
    const connection = new EventEmitter(), close = vi.fn(async () => undefined); closes.push(close);
    Object.assign(connection, { threadId: 1, query: () => ({ stream: () => Readable.from([['既有数据']]) }) });
    return { profile, connection, close, broken: false, sqlMode: mode, serverStatus: 2, status: { dialect, version: dialect === 'mariadb' ? '10.11.19' : '8.4.11' } };
  });
  mocks.execute.mockReset().mockResolvedValue({ rows: { affectedRows: 0, serverStatus: 2 } });
  mocks.tableInfo.mockReset().mockImplementation(async () => ({ objectKind, ddl: source, columns: [{ name: 'v', type: 'varchar(80)', generated: false }] }));
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  await engine.closeAll();
  // 仅删除本例目录内普通文件，rmdir 不递归；意外子目录不会被扩大清理。
  for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory);
});
/** 只替换驱动元数据，生产导出临时文件、原子替换和任务路径直接执行。 */
async function exportFile(format: 'sql' | 'csv' | 'json', includeStructure: boolean, includeData = true) {
  return engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', taskId: 'export', filePath: join(directory, 'result'), format, encoding: 'utf8', includeStructure, includeData });
}

describe('自动含结构 SQL 导出的保真防线', () => {
  it.each(['mysql', 'mariadb'] as const)('%s 二进制文本默认拒绝结构导出且纯数据仍可写，原文件无损', async value => {
    dialect = value; source = "CREATE TABLE t(v varbinary(20) DEFAULT '\\0?') ENGINE=InnoDB";
    await writeFile(join(directory, 'result'), '二进制结构原件');
    await expect(exportFile('sql', true)).rejects.toThrow('原始字节');
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe('二进制结构原件'); expect(await readdir(directory)).toEqual(['result']);
    expect(await exportFile('sql', false)).toEqual({ rows: 1 });
    expect(await readFile(join(directory, 'result'), 'utf8')).not.toContain('CREATE TABLE');
  });

  it.each(['mysql', 'mariadb'] as const)('%s 真实 metadata 的非枚举标记阻止旧设计器重建二进制默认，明确 HEX 不误拦', async value => {
    dialect = value; const metadata = await vi.importActual<typeof import('../../src/engine/metadata')>('../../src/engine/metadata');
    source = "CREATE TABLE t(v varbinary(20) DEFAULT '\\0?') ENGINE=InnoDB";
    mocks.execute.mockImplementation(async (_connection, sql: string) => ({ rows: sql.includes('information_schema.COLUMNS') ? [{ name: 'v', type: 'varbinary(20)', nullable: 'YES', defaultValue: value === 'mysql' ? '\0' : "'\\0?'", extra: '', comment: '' }] : sql.includes('information_schema.TABLES') ? [{ tableType: 'BASE TABLE', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }] : sql.startsWith('SELECT @@SESSION.sql_mode') ? [{ mode: '' }] : sql.startsWith('SHOW CREATE') ? [{ 'Create Table': source }] : [] }));
    const managed = await mocks.connect(profile), info = await metadata.tableInfo(managed, 'db', 't'); await managed.close();
    expect(Object.getOwnPropertyDescriptor(info, 'unsupportedDesign')).toMatchObject({ value: true, enumerable: false });
    mocks.tableInfo.mockImplementation(metadata.tableInfo);
    await expect(engine.handle('schema.preview', { connectionId: profile.id, design: { database: 'db', originalName: 't' } })).rejects.toThrow('请使用 SQL');
    source = "CREATE TABLE t(v varbinary(20) DEFAULT X'00ff') ENGINE=InnoDB";
    const next = await mocks.connect(profile), safe = await metadata.tableInfo(next, 'db', 't'); await next.close();
    expect(Object.getOwnPropertyDescriptor(safe, 'unsupportedDesign')?.value).toBe(false);
  });
  it('Maria 风险结构拒绝，真实原文件保留、没有 partial、任务失败且连接释放', async () => {
    await writeFile(join(directory, 'result'), '既有目标');
    await expect(exportFile('sql', true)).rejects.toThrow('已拒绝含结构 SQL 导出');
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe('既有目标'); expect(await readdir(directory)).toEqual(['result']);
    expect(events.at(-1)?.status).toBe('failed'); expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
  });
  it.each(['sql', 'csv', 'json'] as const)('相同风险表的纯数据 %s 导出保持可用', async format => {
    await expect(exportFile(format, false)).resolves.toEqual({ rows: 1 });
    const text = await readFile(join(directory, 'result'), 'utf8'); expect(text).toContain(format === 'sql' ? Buffer.from('既有数据').toString('hex') : '既有数据'); expect(text).not.toContain('CREATE TABLE');
    expect(await readdir(directory)).toEqual(['result']); expect(events.at(-1)?.status).toBe('completed');
  });
  it.each([undefined, 'ANSI_QUOTES,ANSI', 'NO_FIELD_OPTIONS', 'NO_TABLE_OPTIONS', 'NO_KEY_OPTIONS'])('不可信或隐藏定义模式 %s 不写最终结构文件', async value => {
    mode = value; source = 'CREATE TABLE t(v int)'; await writeFile(join(directory, 'result'), '原件');
    await expect(exportFile('sql', true, false)).rejects.toThrow(/模式|隐藏/);
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe('原件'); expect(await readdir(directory)).toEqual(['result']);
  });
  it.each(['mysql', 'mariadb'] as const)('普通安全 %s 表结构仍原样导出', async value => {
    dialect = value; source = "CREATE TABLE t(v varchar(20) DEFAULT '安全') ENGINE=InnoDB";
    await expect(exportFile('sql', true, false)).resolves.toEqual({ rows: 0 });
    expect(await readFile(join(directory, 'result'), 'utf8')).toContain(source + ';');
  });
  it('可信视图保留完整原定义并导出真实数据，隐藏模式仍不能绕过', async () => {
    objectKind = 'view'; source = "CREATE ALGORITHM=UNDEFINED DEFINER=`test`@`localhost` SQL SECURITY DEFINER VIEW `t` AS SELECT '既有数据' AS `v`";
    await expect(exportFile('sql', true)).resolves.toEqual({ rows: 1 });
    const text = await readFile(join(directory, 'result'), 'utf8'); expect(text).toContain(source + ';'); expect(text).toContain("INSERT INTO `t` (`v`) VALUES (_utf8mb4 X'e697a2e69c89e695b0e68dae')");
    mode = 'ANSI'; await expect(exportFile('sql', true)).rejects.toThrow('隐藏'); expect(await readFile(join(directory, 'result'), 'utf8')).toBe(text);
  });
  it('未知对象种类不能以空 engine 或 CREATE VIEW 字符串伪装绕过保护', async () => {
    objectKind = undefined; source = 'CREATE VIEW t AS SELECT 1 AS v'; await writeFile(join(directory, 'result'), '原件');
    await expect(exportFile('sql', true)).rejects.toThrow('无法确认服务器对象'); expect(await readFile(join(directory, 'result'), 'utf8')).toBe('原件');
  });
  it.each([['BASE TABLE', 'table'], ['VIEW', 'view'], ['UNKNOWN', undefined]] as const)('真实 metadata 投影只按 I_S.TABLE_TYPE %s 判定，不用 engine 推测', async (tableType, expected) => {
    const metadata = await vi.importActual<typeof import('../../src/engine/metadata')>('../../src/engine/metadata');
    mocks.execute.mockImplementation(async (_connection, sql: string) => ({ rows: sql.includes('information_schema.COLUMNS') ? [{ name: 'v', type: 'varchar(20)', nullable: 'YES', defaultValue: null, extra: '', comment: '' }] : sql.includes('information_schema.TABLES') ? [{ tableType, engine: null, charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }] : sql.startsWith('SELECT @@SESSION.sql_mode') ? [{ mode: '' }] : sql.startsWith('SHOW CREATE') ? [{ [tableType === 'VIEW' ? 'Create View' : 'Create Table']: tableType === 'VIEW' ? 'CREATE VIEW t AS SELECT 1 AS v' : 'CREATE TABLE t(v varchar(20))' }] : [] }));
    const managed = await mocks.connect(profile); const info = await metadata.tableInfo(managed, 'db', 't'); await managed.close();
    expect(info.objectKind).toBe(expected); expect(info.engine).toBe('');
  });
  it.each(['BASE TABLE', 'VIEW'])('真实 metadata 对 %s 只为基本表缺失字符集解析目录别名，视图 NULL 保留', async tableType => {
    const metadata = await vi.importActual<typeof import('../../src/engine/metadata')>('../../src/engine/metadata');
    mocks.execute.mockImplementation(async (_connection, sql: string) => ({ rows:
      sql.startsWith("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema'") ? ['COLLATION_NAME', 'CHARACTER_SET_NAME', 'FULL_COLLATION_NAME'].map(name => ({ name })) :
      sql.startsWith('SELECT a.CHARACTER_SET_NAME') ? [{ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' }] :
      sql.includes('information_schema.COLUMNS') ? [{ name: 'v', type: 'varchar(20)', nullable: 'YES', defaultValue: null, extra: '', comment: '' }] :
      sql.includes('information_schema.TABLES') ? [{ tableType, engine: tableType === 'VIEW' ? null : 'InnoDB', charset: null, collation: tableType === 'VIEW' ? null : 'utf8mb4_uca1400_ai_ci', comment: '' }] :
      sql.startsWith('SELECT @@SESSION.sql_mode') ? [{ mode: '' }] : sql.startsWith('SHOW CREATE') ? [{ [tableType === 'VIEW' ? 'Create View' : 'Create Table']: tableType === 'VIEW' ? 'CREATE VIEW t AS SELECT 1 AS v' : 'CREATE TABLE t(v varchar(20))' }] : [] }));
    const managed = await mocks.connect(profile), info = await metadata.tableInfo(managed, 'db', 't'); await managed.close();
    expect(info.charset).toBe(tableType === 'VIEW' ? undefined : 'utf8mb4');
    expect(mocks.execute.mock.calls.filter(([, sql]) => sql.startsWith('SELECT a.CHARACTER_SET_NAME'))).toHaveLength(tableType === 'VIEW' ? 0 : 1);
  });
  it('纯 guard 覆盖兼容聚合集合、opaque 默认与词法模式，不猜修复原 SQL', () => {
    const document = parseTableColumnDefinition('CREATE TABLE t(v int)', { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
    for (const mode of definitionOmittingSqlModes) expect(() => assertTableStructureExportable(document, mode)).toThrow('隐藏');
    const opaque = parseTableColumnDefinition("CREATE TABLE t(v varchar(80) DEFAULT _utf8mb4'abc' COLLATE utf8mb4_bin)", { dialect: 'mariadb', mode: { ansiQuotes: false, noBackslashEscapes: false } });
    expect(opaque.columns[0].default.kind).toBe('opaque'); expect(() => assertTableStructureExportable(opaque, '')).toThrow('不能证明重建保真');
    const quoted = parseTableColumnDefinition('CREATE TABLE "t" ("v" varchar(30) DEFAULT \'a\\b\')', { dialect: 'mariadb', mode: { ansiQuotes: true, noBackslashEscapes: true } });
    expect(() => assertTableStructureExportable(quoted, 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES')).not.toThrow();
  });
});
