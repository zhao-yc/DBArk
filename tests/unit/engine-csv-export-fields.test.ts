import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { CsvExportFieldsOutput } from '../../src/shared/csvExportFields';
import { validateCommand } from '../../src/shared/validation';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'csv-fields', name: '离线CSV投影', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const odd = 'odd,`name';
const values: Record<string, unknown> = { id: '18446744073709551615', price: '123456789012345678901234.123456', stamp: '2026-10-17 12:34:56.123456', duration: '-838:59:59.999999', raw: Buffer.from([0, 255]), nullable: null, [odd]: '\\N,"中文\r\n下一行', precise: 1.0000000000000002 };
let engine: Engine, directory: string, info: TableInfo, project: string[], queries: { sql: string; binary: boolean }[], controls: string[], closes: ReturnType<typeof vi.fn>[], events: TaskEvent[], gate: (() => void) | undefined, pause: boolean, reached: boolean, failStream: boolean;
/** 只替换数据库边界，真实Engine、文件编码、流背压、临时文件和原子替换全部运行。 */
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-csv-fields-')); queries = []; controls = []; closes = []; events = []; gate = undefined; pause = reached = failStream = false;
  const types = ['bigint unsigned', 'decimal(30,6)', 'datetime(6)', 'time(6)', 'varbinary(20)', 'varchar(20)', 'varchar(80)', 'double'];
  const names = Object.keys(values); project = names;
  info = { database: 'db', name: 't', objectKind: 'table', columns: names.map((name, i) => ({ name, type: types[i], nullable: name !== 'id', defaultValue: null, extra: '', comment: '', generated: false })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', ddl: 'CREATE TABLE `t` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`price` decimal(30,6),`stamp` datetime(6),`duration` time(6),`raw` varbinary(20),`nullable` varchar(20),`odd,``name` varchar(80),`precise` double,PRIMARY KEY (`id`)) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4' };
  mocks.connect.mockReset().mockImplementation(async () => {
    const connection = new EventEmitter(), close = vi.fn(async () => {}); closes.push(close);
    const query = (options: { sql: string }, binary: boolean) => { queries.push({ sql: options.sql, binary }); return { stream: () => Readable.from((async function* () { yield project.map(name => values[name]); if (failStream) throw Error('流失败'); if (pause) { reached = true; await new Promise<void>(resolve => { gate = resolve; }); yield project.map(name => values[name]); } })(), { objectMode: true }) }; };
    Object.assign(connection, { threadId: closes.length, query: (options: { sql: string }) => query(options, false), execute: (options: { sql: string }) => query(options, true) });
    return { profile, connection, close, broken: false, sqlMode: '', serverStatus: 2, status: { dialect: 'mysql', version: '8.4.11' } };
  });
  mocks.execute.mockReset().mockImplementation(async (_managed, sql: string) => { controls.push(sql); if (sql.startsWith('KILL')) gate?.(); return { rows: [] }; });
  mocks.tableInfo.mockReset().mockImplementation(async () => structuredClone(info));
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { gate?.(); vi.useRealTimers(); vi.restoreAllMocks(); await engine.closeAll(); for (const name of await readdir(directory)) await rm(join(directory, name), { force: true }); await rmdir(directory); });
async function catalog(): Promise<CsvExportFieldsOutput> { return engine.handle('files.exportColumns', { connectionId: profile.id, database: 'db', table: 't', taskId: 'catalog-' + closes.length, connectionRevision: 7 }); }
/** 独立期望投影喂给驱动，SQL本身另作精确断言，不能由被测SQL生成期望。 */
async function exportFile(columns?: string[], options: Record<string, unknown> = {}) {
  const snapshot = columns ? await catalog() : undefined; project = columns ?? info.columns.map(column => column.name);
  return engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'result'), taskId: 'export', format: 'csv', encoding: 'utf8', includeStructure: true, includeData: true, ...(snapshot ? { csvSelection: { catalogId: snapshot.catalogId, columns } } : {}), connectionRevision: 7, ...options });
}
describe('CSV表导出字段投影（真实文件与离线驱动）', () => {
  it.each(['utf8', 'utf16le', 'gb18030'])('%s顺序和精确值保持，未选列不进SQL或文件，原目标原子替换', async encoding => {
    const selected = ['price', odd, 'raw', 'id', 'nullable', 'stamp', 'duration']; await writeFile(join(directory, 'result'), '原件');
    expect(await exportFile(selected, { encoding })).toEqual({ rows: 1 });
    expect(queries).toEqual([{ sql: 'SELECT `price`, `odd,``name`, `raw`, `id`, `nullable`, `stamp`, `duration` FROM `db`.`t`', binary: false }]);
    expect(controls.slice(0, 3)).toEqual(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION WITH CONSISTENT SNAPSHOT', 'SELECT 1 FROM `db`.`t` LIMIT 0']);
    const bytes = await readFile(join(directory, 'result')), text = iconv.decode(bytes, encoding);
    expect(parse(text, { bom: true })).toEqual([selected, ['123456789012345678901234.123456', '\\\\N,"中文\r\n下一行', 'base64:AP8=', '18446744073709551615', '\\N', '2026-10-17 12:34:56.123456', '-838:59:59.999999']]);
    expect(text).toContain('\r\n'); if (encoding === 'utf16le') expect([...bytes.subarray(0, 2)]).toEqual([255, 254]);
    expect(await readdir(directory)).toEqual(['result']); expect(events.at(-1)?.status).toBe('completed'); expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
  });
  it('所选浮点列沿原二进制协议保留相邻值；省略新参数CSV仍全列', async () => {
    await exportFile(['precise']); expect(queries.at(-1)?.binary).toBe(true); expect(await readFile(join(directory, 'result'), 'utf8')).toBe('precise\r\n1.0000000000000002\r\n');
    project = info.columns.map(column => column.name);
    await engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'legacy'), taskId: 'legacy', format: 'csv', encoding: 'utf8', includeStructure: true, includeData: true });
    const rows = parse(await readFile(join(directory, 'legacy'), 'utf8')); expect(rows[0]).toEqual(info.columns.map(column => column.name)); expect(rows[1][0]).toBe('18446744073709551615'); expect(rows[1][1]).toBe('123456789012345678901234.123456'); expect(queries.at(-1)?.binary).toBe(true);
  });
  it.each(['type', 'name', 'order', 'definition', 'target', 'revision'])('%s变化拒绝目录，旧文件完整保留且没有partial或数据查询', async kind => {
    const snapshot = await catalog(); await writeFile(join(directory, 'result'), '原件');
    if (kind === 'type') info.columns[1].type = 'decimal(20,2)'; if (kind === 'name') info.columns[1].name = 'changed'; if (kind === 'order') info.columns.reverse(); if (kind === 'definition') info.ddl = info.ddl.replace('decimal(30,6)', 'decimal(30,5)');
    await expect(engine.handle('files.export', { connectionId: profile.id, database: kind === 'target' ? 'other' : 'db', table: 't', filePath: join(directory, 'result'), taskId: 'export', format: 'csv', encoding: 'utf8', includeStructure: false, includeData: true, csvSelection: { catalogId: snapshot.catalogId, columns: ['id'] }, connectionRevision: kind === 'revision' ? 8 : 7 })).rejects.toThrow(/目录|变化|目标/);
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe('原件'); expect(await readdir(directory)).toEqual(['result']); expect(queries).toEqual([]);
  });
  it('只有表尾自增计数变化仍可投影，不把数据插入误当字段变化', async () => {
    const snapshot = await catalog(); info.ddl = info.ddl.replace('AUTO_INCREMENT=42', 'AUTO_INCREMENT=43'); project = ['id'];
    await expect(engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'result'), taskId: 'export', format: 'csv', encoding: 'utf8', includeStructure: false, includeData: true, csvSelection: { catalogId: snapshot.catalogId, columns: project }, connectionRevision: 7 })).resolves.toEqual({ rows: 1 });
  });
  it('对象目录未知时读取任务失败，不产生默认全列或可执行令牌', async () => {
    info.objectKind = undefined; await expect(catalog()).rejects.toThrow('未知'); expect(events.at(-1)?.status).toBe('failed'); expect(queries).toEqual([]);
  });
  it.each([[], ['id', 'id'], ['missing']].map(columns => ({ columns })))('非法投影$columns拒绝且令牌消费，不产生文件', async ({ columns }) => {
    const snapshot = await catalog(), input = { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'result'), taskId: 'export', format: 'csv', encoding: 'utf8', includeStructure: false, includeData: true, csvSelection: { catalogId: snapshot.catalogId, columns }, connectionRevision: 7 };
    await expect(engine.handle('files.export', input)).rejects.toThrow(); await expect(engine.handle('files.export', { ...input, taskId: 'retry' })).rejects.toThrow('失效'); expect(await readdir(directory)).toEqual([]);
  });
  it('取消与流失败都保留原件并移除partial，仍使用原进度和独立任务', async () => {
    await writeFile(join(directory, 'result'), '原件'); pause = true; const pending = exportFile(['id']).catch(reason => reason);
    await vi.waitFor(() => expect(reached).toBe(true)); await engine.handle('query.cancel', { taskId: 'export' }); expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled');
    expect(await readFile(join(directory, 'result'), 'utf8')).toBe('原件'); expect(await readdir(directory)).toEqual(['result']);
    pause = false; failStream = true; await expect(exportFile(['id'], { taskId: 'failed-stream' })).rejects.toThrow('流失败'); expect(await readFile(join(directory, 'result'), 'utf8')).toBe('原件'); expect(await readdir(directory)).toEqual(['result']);
  });
  it('目录释放/过期后不能导出，公开边界不接受修订或客户端路径', async () => {
    const snapshot = await catalog(); await engine.handle('files.releaseExportColumns', { catalogId: snapshot.catalogId });
    await expect(engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'result'), taskId: 'export', format: 'csv', encoding: 'utf8', includeData: true, csvSelection: { catalogId: snapshot.catalogId, columns: ['id'] }, connectionRevision: 7 })).rejects.toThrow('失效');
    const expiring = await catalog(), now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 120000);
    await expect(engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: join(directory, 'result'), taskId: 'expired', format: 'csv', encoding: 'utf8', includeData: true, csvSelection: { catalogId: expiring.catalogId, columns: ['id'] }, connectionRevision: 7 })).rejects.toThrow('失效');
    expect(() => validateCommand('files.exportColumns', { connectionId: 'c', database: 'db', table: 't', taskId: 't', connectionRevision: 7 })).toThrow();
    expect(() => validateCommand('files.export', { connectionId: 'c', database: 'db', table: 't', taskId: 't', fileToken: 'f', filePath: 'private', format: 'csv', encoding: 'utf8', includeData: true, includeStructure: true })).toThrow();
  });
  it.each(['json', 'sql'])('%s省略新参数保持全列，提供CSV参数则拒绝，不混用结果导出', async format => {
    await exportFile(undefined, { format }); expect(queries.at(-1)?.sql).toContain('`price`');
    const snapshot = await catalog(); await expect(exportFile(undefined, { format, taskId: 'wrong-format', csvSelection: { catalogId: snapshot.catalogId, columns: ['id'] } })).rejects.toThrow('CSV');
    const resultInput = { fileToken: 'f', format: 'csv', encoding: 'utf8', taskId: 't', result: { columns: [{ key: 'c0', name: 'id' }], rows: [{ c0: '18446744073709551615' }], truncated: false } };
    expect(() => validateCommand('files.exportResult', resultInput)).not.toThrow();
    expect(() => validateCommand('files.exportResult', { ...resultInput, csvSelection: { catalogId: snapshot.catalogId, columns: ['id'] } })).toThrow();
  });
});
