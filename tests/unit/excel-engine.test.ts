import { Readable } from 'node:stream';
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { CellValue, ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';
import { exportExcelFile, previewExcelSheet, readExcelRows } from '../../src/engine/excelFiles';

const profile: ConnectionProfile = { id: 'excel', name: '离线模拟', group: '', color: '#123456', dialect: 'mysql', host: 'test.invalid', port: 3306, user: 'test' };
const columns = [{ name: 'id', type: 'bigint unsigned' }, { name: '金额', type: 'decimal(30,12)' }, { name: '时间', type: 'datetime(6)' }, { name: '内容', type: 'text' }, { name: '字节', type: 'blob' }];
const raw = ['18446744073709551615', '123456789012345678.123456789012', '2026-10-15 10:20:30.123456', '=SUM(A1)', Buffer.from([0, 1, 255])];
let info: TableInfo, engine: Engine, events: TaskEvent[], source: unknown[][], selects: string[], inserts: CellValue[][], eventHook: ((event: TaskEvent) => void) | undefined;
const folders: string[] = [];
/** 仅构造驱动边界，文件、映射、事务调度、任务及 XLSX 编解码均使用生产实现。 */
beforeEach(async () => {
  source = [raw]; selects = []; inserts = []; events = []; eventHook = undefined;
  info = { database: '隔离库', name: '表', columns: columns.map(column => ({ ...column, nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', ddl: '', objectKind: 'table' };
  mocks.tableInfo.mockReset().mockImplementation(async () => info);
  mocks.execute.mockReset().mockImplementation(async (_managed, sql: string, params: CellValue[]) => { if (sql.startsWith('INSERT')) inserts.push(params); return { rows: { affectedRows: 1, serverStatus: 2, warningStatus: 0 }, fields: [] }; });
  mocks.connect.mockReset().mockImplementation(async () => ({ profile, sqlMode: '', serverStatus: 2, status: { dialect: 'mysql', version: '模拟' }, broken: false,
    connection: { threadId: 42, query: (options: { sql: string }) => { selects.push(options.sql); return { stream: () => Readable.from(source) }; } }, close: vi.fn(async () => undefined) } as unknown as ManagedConnection));
  engine = new Engine(event => { events.push(event); eventHook?.(event); }); await engine.handle('connections.open', { id: profile.id, profile });
});
/** 清理只针对本测试创建的独立目录，不触碰其他克隆和测试文件。 */
afterEach(async () => { await engine.closeAll(); for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });
async function path() { const base = join(process.cwd(), '.cache/f02-excel/engine-tmp'); await mkdir(base, { recursive: true }); const folder = await mkdtemp(join(base, 'case-')); folders.push(folder); return join(folder, '表.xlsx'); }
const target = { connectionId: profile.id, database: '隔离库', table: '表', fileToken: '授权文件' };
/** 真实文件先做预览，然后使用同一指纹从正式引擎入口提交。 */
async function importInput(filePath: string, rows: CellValue[][] = [raw.map(value => Buffer.isBuffer(value) ? { type: 'binary' as const, base64: value.toString('base64') } : value) as CellValue[]]) {
  async function* values() { yield* rows; }
  await exportExcelFile({ filePath, columns, rows: values(), onCommitStart() {} });
  const sample = await previewExcelSheet({ filePath, sheetId: '1', protocol: 'dbark-v1' });
  return { ...target, filePath, sheetId: '1', protocol: 'dbark-v1', taskId: '导入', fingerprint: sample.fingerprint, mapping: columns.map(column => ({ source: column.name, target: column.name })) };
}

describe('Excel 正式引擎接线', () => {
  it.each([
    ['decimal(5,2)', '1.239', 1], ['varchar(2)', '三个字', 3], ['tinyint unsigned', '-1', 0], ['datetime(3)', '2026-10-15 10:20:30.123456', 2],
  ] as [string, string, number][])('写入前拒绝 %s 的有损目标转换，不提交当前批', async (type, value, column) => {
    const row: CellValue[] = ['1', '1', null, '', null]; row[column] = value;
    const input = await importInput(await path(), [row]); info.columns[column].type = type;
    const result = await engine.handle('excel.import', input); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('不能无损导入');
    expect(inserts).toEqual([]); expect(mocks.execute.mock.calls.some(call => call[1] === 'COMMIT')).toBe(false); expect(mocks.execute.mock.calls.at(-1)?.[1]).toBe('ROLLBACK');
  });
  it('INSERT 警告在下一 SQL 前读取诊断并回滚，不把告警行计为成功', async () => {
    const input = await importInput(await path());
    mocks.execute.mockImplementation(async (_managed, sql: string, params: CellValue[]) => {
      if (sql.startsWith('INSERT')) { inserts.push(params); return { rows: { affectedRows: 1, serverStatus: 2, warningStatus: 1 }, fields: [] }; }
      if (sql.startsWith('SHOW WARNINGS')) return { rows: [{ Level: 'Note', Code: 1265, Message: '不应回显的字段值' }], fields: [] };
      return { rows: { affectedRows: 0, serverStatus: 2, warningStatus: 0 }, fields: [] };
    });
    const result = await engine.handle('excel.import', input); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('当前批 1 行已回滚'); expect(result.errors[0]).toContain('1265'); expect(result.errors[0]).not.toContain('不应回显');
    const sql = mocks.execute.mock.calls.map(call => call[1]); const inserted = sql.findIndex(item => item.startsWith('INSERT')); expect(sql.slice(inserted + 1)).toEqual(['SHOW WARNINGS LIMIT 32', 'ROLLBACK']);
  });
  it('第 501 行转换警告只回滚第二批，保留已确认的前 500 行', async () => {
    const rows = Array.from({ length: 502 }, (_, index) => [String(index), '1', null, '', null] as CellValue[]), input = await importInput(await path(), rows);
    mocks.execute.mockImplementation(async (_managed, sql: string, params: CellValue[]) => {
      if (sql.startsWith('INSERT')) { inserts.push(params); return { rows: { affectedRows: 1, serverStatus: 2, warningStatus: inserts.length === 501 ? 1 : 0 }, fields: [] }; }
      if (sql.startsWith('SHOW WARNINGS')) return { rows: [{ Level: 'Warning', Code: 1264 }], fields: [] };
      return { rows: { affectedRows: 0, serverStatus: 2, warningStatus: 0 }, fields: [] };
    });
    const result = await engine.handle('excel.import', input); expect(result.rows).toBe(500); expect(result.errors[0]).toContain('第 501'); expect(result.errors[0]).toContain('当前批 1 行已回滚'); expect(inserts).toHaveLength(501);
    expect(mocks.execute.mock.calls.filter(call => call[1] === 'COMMIT')).toHaveLength(1); expect(mocks.execute.mock.calls.at(-1)?.[1]).toBe('ROLLBACK');
  });
  it.each(['csv', 'json'])('%s 复用链路保留精确值和无键表导入，并同样拒绝服务器警告', async format => {
    const filePath = await path(), record = { id: '18446744073709551615', 金额: '123456789012345678.123456789012', 时间: '2026-10-15 10:20:30.123456', 内容: '=SUM(A1)', 字节: { type: 'binary', base64: 'AAH/' } };
    await writeFile(filePath, format === 'json' ? JSON.stringify([record]) : 'id,金额,时间,内容,字节\r\n18446744073709551615,123456789012345678.123456789012,2026-10-15 10:20:30.123456,=SUM(A1),base64:AAH/\r\n');
    info.editableKey = [];
    const input = { ...target, filePath, format, encoding: 'utf8', taskId: '兼容导入', mapping: Object.fromEntries(columns.map(column => [column.name, column.name])) };
    await expect(engine.handle('files.import', input)).resolves.toEqual({ rows: 1, errors: [] }); expect(inserts[0]).toEqual(raw);
    mocks.execute.mockImplementation(async (_managed, sql: string) => ({ rows: sql.startsWith('SHOW WARNINGS') ? [{ Code: 1265 }] : { affectedRows: 1, serverStatus: 2, warningStatus: sql.startsWith('INSERT') ? 1 : 0 }, fields: [] }));
    const result = await engine.handle('files.import', { ...input, taskId: '兼容告警' }); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('拒绝提交'); expect(mocks.execute.mock.calls.at(-1)?.[1]).toBe('ROLLBACK');
  });
  it('元数据任务覆盖建连取消，迟到连接关闭且不读取目标列', async () => {
    const late = await mocks.connect.mock.results[0].value as ManagedConnection; let deliver!: (value: ManagedConnection) => void, signal!: AbortSignal;
    mocks.connect.mockImplementationOnce((_profile, _database, abort) => { signal = abort; return new Promise<ManagedConnection>(resolve => { deliver = resolve; }); });
    const running = engine.handle('metadata.table', { ...target, taskId: '目标元数据' }); const rejected = expect(running).rejects.toThrow('已取消');
    const stopping = engine.handle('query.cancel', { taskId: '目标元数据' }); expect(signal.aborted).toBe(true); deliver(late); await rejected; await stopping;
    expect(mocks.tableInfo).not.toHaveBeenCalled(); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('元数据取消等待目录查询真实终态及专用连接清理', async () => {
    let finishQuery!: (reason: Error) => void, finishClose!: () => void;
    const query = new Promise<never>((_resolve, reject) => { finishQuery = reject; }), closing = new Promise<void>(resolve => { finishClose = resolve; });
    const managed = await mocks.connect.mock.results[0].value as ManagedConnection;
    const close = vi.fn(() => closing); mocks.connect.mockResolvedValueOnce({ ...managed, close }); mocks.tableInfo.mockReturnValueOnce(query);
    const running = engine.handle('metadata.table', { ...target, taskId: '元数据收尾' }); const rejected = expect(running).rejects.toThrow('目录已终止');
    await vi.waitFor(() => expect(mocks.tableInfo).toHaveBeenCalled()); let finished = false;
    const stopping = engine.handle('query.cancel', { taskId: '元数据收尾' }).then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.execute.mock.calls.some(call => call[1] === 'KILL CONNECTION 42')).toBe(true));
    expect(finished).toBe(false); expect(close).not.toHaveBeenCalled(); finishQuery(Error('目录已终止'));
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith({ strict: true })); expect(finished).toBe(false);
    finishClose(); await rejected; await stopping; expect(finished).toBe(true);
  });
  it.each(['missing', 'diagnostic'])('警告信息 %s 不完整时也不允许 COMMIT 或重放写入', async mode => {
    const input = await importInput(await path());
    mocks.execute.mockImplementation(async (_managed, sql: string, params: CellValue[]) => {
      if (sql.startsWith('INSERT')) { inserts.push(params); return { rows: { affectedRows: 1, serverStatus: 2, ...(mode === 'missing' ? {} : { warningStatus: 1 }) }, fields: [] }; }
      if (sql.startsWith('SHOW WARNINGS')) { if (mode === 'diagnostic') throw Error('诊断读取失败'); return { rows: [], fields: [] }; }
      return { rows: { affectedRows: 0, serverStatus: 2, warningStatus: 0 }, fields: [] };
    });
    const result = await engine.handle('excel.import', input); expect(result.rows).toBe(0); expect(result.errors).toHaveLength(1); expect(inserts).toHaveLength(1);
    expect(mocks.execute.mock.calls.some(call => call[1] === 'COMMIT')).toBe(false); expect(mocks.execute.mock.calls.at(-1)?.[1]).toBe('ROLLBACK');
  });
  it.each(['cancel', 'disconnect', 'exit'])('%s 覆盖建连阶段，迟到成功连接必须关闭且不读取数据', async route => {
    const late = await mocks.connect.mock.results[0].value as ManagedConnection;
    const closeCount = (late.close as ReturnType<typeof vi.fn>).mock.calls.length;
    let deliver!: (managed: ManagedConnection) => void, signal: AbortSignal | undefined;
    mocks.connect.mockImplementationOnce((_profile, _database, abort: AbortSignal) => { signal = abort; return new Promise<ManagedConnection>(resolve => { deliver = resolve; }); });
    const pending = engine.handle('excel.export', { ...target, filePath: await path(), taskId: '建连取消' }); const rejected = expect(pending).rejects.toThrow('建连阶段已取消');
    const stopping = route === 'cancel' ? engine.handle('query.cancel', { taskId: '建连取消' }) : route === 'disconnect' ? engine.handle('connections.close', { id: profile.id }) : engine.closeAll();
    expect(signal?.aborted).toBe(true); deliver(late); await stopping; await rejected;
    expect(selects).toEqual([]); expect(inserts).toEqual([]); expect(events.at(-1)?.status).toBe('cancelled');
    expect((late.close as ReturnType<typeof vi.fn>).mock.calls.length).toBe(closeCount + 1);
  });
  it('导出取消停止实际查询，原文件保持并清理 partial', async () => {
    const filePath = await path(); await writeFile(filePath, '原目标'); source = Array.from({ length: 5001 }, () => raw);
    let stopping: Promise<unknown> | undefined;
    eventHook = event => { if (event.taskId === '流取消' && event.rows === 100) stopping = engine.handle('query.cancel', { taskId: event.taskId }); };
    await expect(engine.handle('excel.export', { ...target, filePath, taskId: '流取消', scope: 'all' })).rejects.toThrow('已取消'); await stopping;
    expect(mocks.execute.mock.calls.some(call => call[1] === 'KILL QUERY 42')).toBe(true);
    expect(await readFile(filePath, 'utf8')).toBe('原目标'); expect(await readdir(folders.at(-1)!)).toEqual(['表.xlsx']); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('取消预览等待文件句柄释放，无数据库连接也可独立读取', async () => {
    const input = await importInput(await path()); const connectCount = mocks.connect.mock.calls.length;
    const reading = engine.handle('excel.preview', { ...input, taskId: '读取取消' }); const rejected = expect(reading).rejects.toThrow('已取消');
    await engine.handle('query.cancel', { taskId: '读取取消' }); await rejected;
    expect(events.at(-1)?.status).toBe('cancelled'); expect(mocks.connect.mock.calls.length).toBe(connectCount);
    await expect(engine.handle('excel.sheets', { filePath: input.filePath, taskId: '重新读取' })).resolves.toHaveLength(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('有限样本导出有 LIMIT，精确值与二进制通过真实 XLSX 往返', async () => {
    const filePath = await path(); await expect(engine.handle('excel.export', { ...target, filePath, taskId: '导出', scope: 'sample' })).resolves.toEqual({ rows: 1 });
    expect(selects[0]).toContain('ORDER BY `id` LIMIT 1000');
    const rows = []; for await (const row of readExcelRows({ filePath, sheetId: '1', protocol: 'dbark-v1' })) rows.push(row);
    expect(rows[0]).toEqual(Object.fromEntries(columns.map((column, index) => [column.name, Buffer.isBuffer(raw[index]) ? { type: 'binary', base64: (raw[index] as Buffer).toString('base64') } : raw[index]])));
    expect(mocks.execute.mock.calls.map(call => call[1])).toEqual(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION WITH CONSISTENT SNAPSHOT', 'ROLLBACK']);
    expect(events.at(-1)?.status).toBe('completed');
  });
  it('完整范围流式超过样本上限，不附 LIMIT，不拼接全部数据至内存', async () => {
    source = Array.from({ length: 1201 }, () => raw); const filePath = await path();
    await expect(engine.handle('excel.export', { ...target, filePath, taskId: '完整', scope: 'all' })).resolves.toEqual({ rows: 1201 });
    expect(selects[0]).not.toContain('LIMIT'); expect(events.some(event => event.rows === 1200)).toBe(true);
  });
  it('导入沿用参数化插入与事务，数值日期不经过 Number/Date', async () => {
    const input = await importInput(await path());
    await expect(engine.handle('excel.import', input)).resolves.toEqual({ rows: 1, errors: [] });
    expect(inserts[0]).toEqual(raw); expect(mocks.execute.mock.calls.map(call => call[1]).at(-1)).toBe('COMMIT');
  });
  it('预览后改写文件时在 START TRANSACTION 前拒绝', async () => {
    const input = await importInput(await path()); await importInput(input.filePath, [['2', '1', null, '变化', null]]);
    await expect(engine.handle('excel.import', input)).rejects.toThrow('自预览后已发生变化'); expect(inserts).toEqual([]); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('公式缓存被预检拒绝，不能先导入前 20 行', async () => {
    const input = await importInput(await path()); const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('数据'); sheet.addRow(columns.map(column => column.name));
    for (let i = 0; i < 30; i++) sheet.addRow(['1']); sheet.getCell('A31').value = { formula: '1+1', result: 2 }; await book.xlsx.writeFile(input.filePath);
    await expect(engine.handle('excel.import', input)).rejects.toThrow('公式'); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['generated', 'key', 'engine'])('目标 %s 边界在任何事务写入前拦截', async mode => {
    const input = await importInput(await path()); if (mode === 'generated') info.columns[0].generated = true; if (mode === 'key') info.editableKey = []; if (mode === 'engine') info.engine = 'MyISAM';
    await expect(engine.handle('excel.import', input)).rejects.toThrow(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('第二批失败明确保留前 500 行、回滚当前批并报告失败任务', async () => {
    const rows = Array.from({ length: 502 }, (_, index) => [String(index), '1', null, '数据', null] as CellValue[]); const input = await importInput(await path(), rows);
    mocks.execute.mockImplementation(async (_managed, sql: string, params: CellValue[]) => { if (sql.startsWith('INSERT')) { if (inserts.length === 501) throw Error('模拟重复键'); inserts.push(params); } return { rows: { affectedRows: 1, serverStatus: 2, warningStatus: 0 }, fields: [] }; });
    const result = await engine.handle('excel.import', input); expect(result.rows).toBe(500); expect(result.errors[0]).toContain('当前批 1 行已回滚'); expect(result.errors[0]).toContain('第 502'); expect(events.at(-1)?.status).toBe('failed');
  });
  it('流中途失败保留原目标并释放快照与临时文件', async () => {
    const filePath = await path(); await writeFile(filePath, '原目标'); source = [['不允许的数字', 1, null, '', null]];
    await expect(engine.handle('excel.export', { ...target, filePath, taskId: '失败' })).rejects.toThrow('原始文本');
    expect(await readFile(filePath, 'utf8')).toBe('原目标'); expect(await readdir(folders.at(-1)!)).toEqual(['表.xlsx']); expect(mocks.execute.mock.calls.at(-1)?.[1]).toBe('ROLLBACK');
  });
});
