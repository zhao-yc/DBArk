import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import type { ResultExportData, ResultExportOptions, TaskEvent } from '../../src/shared/contracts';
import { resultExportColumns } from '../../src/shared/resultExport';
import { nativeAtomicFileIO, type AtomicFileIO } from '../../src/engine/atomicFile';
import { exportResultExcelFile } from '../../src/engine/resultExcelFile';
import { ResultFileTasks } from '../../src/engine/resultFileTasks';
import { readExcelRows, listExcelSheets } from '../../src/engine/excelFiles';

const database = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => database);
import { Engine } from '../../src/engine';

const folders: string[] = [];
/** 仅清理本测试创建的隔离目录及其文件，不递归触碰其他任务产物。 */
afterEach(async () => { expect(database.connect).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled(); vi.restoreAllMocks(); for (const folder of folders.splice(0)) { for (const file of await readdir(folder)) await rm(join(folder, file)); await rmdir(folder); } });
async function destination() { const base = join(process.cwd(), '.cache/result-excel-backend'); await mkdir(base, { recursive: true }); const folder = await mkdtemp(join(base, 'case-')); folders.push(folder); const path = join(folder, 'result.xlsx'); await writeFile(path, '原目标'); return path; }
/** 反序自有字段能检出误用Object.values或覆盖重复标题；精度与协议均为真实原值。 */
function data(): ResultExportData {
  const names = ['值', '值', '值 [2]', '', '__proto__', 'constructor', '=SUM(A1:A2)', '大整数', 'DECIMAL', '日期', 'number', '负零', 'NULL', '空串', '标记', '反斜线', '字节', '空字节', '布尔'];
  const values = ['原文', '第二', '第三', '空标题', '原型', '构造', '=HYPERLINK("https://example.invalid")', '18446744073709551615', '0.12345678901234567890', '2026-10-22 12:34:56.123456', 9007199254740991, -0, null, '', '\\N', '\\B:AA==', { type: 'binary', base64: 'AAH/' }, { type: 'binary', base64: '' }, true];
  return { columns: names.map((name, index) => ({ key: `k${index}`, name })), rows: [Object.fromEntries(values.map((value, index) => [`k${index}`, value]).reverse())], truncated: true } as ResultExportData;
}
function input(filePath: string, result = data()): ResultExportOptions & { filePath: string } { return { filePath, fileToken: '已授权导出', taskId: 'xlsx', format: 'xlsx', encoding: 'utf8', result }; }
/** 真实ExcelJS读回，绝不以ZIP存在或任务success代替单元格内容/类型核验。 */
async function workbook(path: string) { const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path); return book; }
/** 只替换指定系统调用，其余继续使用成熟真实原子文件IO。 */
function disk(overrides: Partial<AtomicFileIO> = {}): AtomicFileIO { return { ...nativeAtomicFileIO, ...overrides }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('已返回结果的真实流式XLSX写出', () => {
  it('真实文件保留唯一标题、列顺序、精度/日期/公式原文和dbark-v1协议', async () => {
    const path = await destination(), value = data(), events: TaskEvent[] = [];
    await expect(new ResultFileTasks(event => events.push(event)).run(input(path, value))).resolves.toEqual({ rows: 1 });
    const book = await workbook(path), sheet = book.getWorksheet('数据')!;
    expect(book.worksheets).toHaveLength(1); expect(sheet.columnCount).toBe(value.columns.length); expect(value.columns.map((_, index) => sheet.getCell(1, index + 1).text)).toEqual(resultExportColumns(value.columns).map(column => column.exportName));
    expect(value.columns.map((_, index) => sheet.getCell(2, index + 1).text)).toEqual(['原文', '第二', '第三', '空标题', '原型', '构造', '=HYPERLINK("https://example.invalid")', '18446744073709551615', '0.12345678901234567890', '2026-10-22 12:34:56.123456', '9007199254740991', '-0', '\\N', '', '\\\\N', '\\\\B:AA==', '\\B:AAH/', '\\B:', 'true']);
    // 成熟writer用单段inline richText写文本，ExcelJS读回的RichText仍须明确区别数字或公式类型。
    for (let column = 1; column < value.columns.length; column++) { expect(sheet.getCell(2, column).type).toBe(ExcelJS.ValueType.RichText); expect(sheet.getCell(2, column).formula).toBeUndefined(); }
    expect(sheet.getCell(1, 7).type).toBe(ExcelJS.ValueType.RichText); expect(sheet.getCell(1, 7).formula).toBeUndefined(); expect(sheet.getCell(2, 19).type).toBe(ExcelJS.ValueType.Boolean); expect(sheet.getCell(2, 19).value).toBe(true);
    expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100, rows: 1 }); expect(await readdir(dirname(path))).toEqual(['result.xlsx']);
    // 同一成熟导入器按dbark-v1读回，证明NULL/空串/字节与字面标记确实可区分。
    const [descriptor] = await listExcelSheets({ filePath: path }), rows = [];
    for await (const row of readExcelRows({ filePath: path, sheetId: descriptor.id, protocol: 'dbark-v1' })) rows.push(row);
    expect(rows).toHaveLength(1); expect(rows[0]['NULL']).toBeNull(); expect(rows[0]['空串']).toBe(''); expect(rows[0]['标记']).toBe('\\N'); expect(rows[0]['反斜线']).toBe('\\B:AA=='); expect(rows[0]['字节']).toEqual({ type: 'binary', base64: 'AAH/' }); expect(rows[0]['空字节']).toEqual({ type: 'binary', base64: '' });
  });
  it('工作表逐原行顺序写出，空结果仍有完整唯一标题，XML转义标量不被递归解码', async () => {
    const path = await destination(), result = { columns: [{ key: 'k', name: '_x0041_\r\n列' }], rows: [{ k: '后\r\n_x000D_😊\u007f' }, { k: '=前' }, { k: '' }], truncated: false };
    await new ResultFileTasks(() => {}).run(input(path, result)); const sheet = (await workbook(path)).getWorksheet(1)!;
    expect(sheet.getCell('A1').text).toBe('_x0041_\r\n列'); expect(sheet.getCell('A2').text).toBe('后\r\n_x000D_😊\u007f'); expect(sheet.getCell('A3').text).toBe('=前'); expect(sheet.getCell('A4').text).toBe('');
    await new ResultFileTasks(() => {}).run(input(path, { ...result, rows: [] })); expect((await workbook(path)).getWorksheet(1)!.rowCount).toBe(1);
  });
  it('单格32767边界真实读回不截断，协议前缀也占长度', async () => {
    const path = await destination(), result = { columns: [{ key: 'k', name: '列' }], rows: [{ k: 'x'.repeat(32767) }, { k: '\\' + 'x'.repeat(32765) }], truncated: false };
    await new ResultFileTasks(() => {}).run(input(path, result)); const sheet = (await workbook(path)).getWorksheet(1)!;
    expect(sheet.getCell('A2').text).toBe(result.rows[0].k); expect(sheet.getCell('A3').text).toBe('\\' + result.rows[1].k);
  });
  it('无需数据库连接或新SQL，实际Engine入口支持已返回快照并可query.cancel', async () => {
    const path = await destination(), events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
    await expect(engine.handle('files.exportResult', input(path))).resolves.toEqual({ rows: 1 }); await engine.closeAll(); expect(events.at(-1)?.status).toBe('completed');
    const cancelledPath = await destination(), cancelledEvents: TaskEvent[] = [], result = { columns: [{ key: 'k', name: '列' }], rows: Array.from({ length: 201 }, (_, index) => ({ k: String(index) })), truncated: false };
    const cancelling = new Engine(event => { cancelledEvents.push(event); if (event.status === 'running' && event.rows === 100) void cancelling.handle('query.cancel', { taskId: 'xlsx' }); });
    await expect(cancelling.handle('files.exportResult', input(cancelledPath, result))).rejects.toThrow('已取消'); await cancelling.closeAll(); expect(await readFile(cancelledPath, 'utf8')).toBe('原目标'); expect(cancelledEvents.at(-1)?.status).toBe('cancelled');
  });
});

describe('XLSX整份预检和原目标保护', () => {
  it.each(['length', 'xml', 'header', 'binary', 'encoding', 'csv', 'sql'])('%s在临时文件打开前整份拒绝，旧目标字节不变', async kind => {
    const path = await destination(), request = input(path), opened = vi.fn(nativeAtomicFileIO.open);
    if (kind === 'length') request.result.rows[0].k1 = 'x'.repeat(32768); else if (kind === 'xml') request.result.rows[0].k18 = '\ud800'; else if (kind === 'header') request.result.columns[18].name = '\u0000'; else if (kind === 'binary') request.result.rows[0].k16 = { type: 'binary', base64: 'AB==' }; else if (kind === 'encoding') request.encoding = 'utf16le'; else if (kind === 'csv') request.csvDelimiter = ','; else request.sql = undefined;
    const tasks = new ResultFileTasks(() => {}, disk({ open: opened })); await expect(tasks.run(request)).rejects.toThrow();
    expect(opened).not.toHaveBeenCalled(); expect(tasks.has('xlsx')).toBe(false); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(dirname(path))).toEqual(['result.xlsx']);
  });
  it('直接helper也在真实encodeExcelCell全量准入后才打开，非规范Base64不能晚写部分文件', async () => {
    const path = await destination(), opened = vi.fn(nativeAtomicFileIO.open), result = data(); result.rows.push({ ...result.rows[0], k16: { type: 'binary', base64: 'AB==' } });
    await expect(exportResultExcelFile({ filePath: path, result, checkCancelled() {}, onCommitStart() {}, io: disk({ open: opened }) })).rejects.toThrow('无效二进制'); expect(opened).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toBe('原目标');
  });
  it('真实短写完整消费，仍可由ExcelJS读回全部原值', async () => {
    const path = await destination(); let calls = 0;
    const io = disk({ open: async path => { const handle = await nativeAtomicFileIO.open(path); return { ...handle, async write(buffer, offset, length) { calls++; return handle.write(buffer, offset, Math.min(113, length)); } }; } });
    await new ResultFileTasks(() => {}, io).run(input(path)); expect((await workbook(path)).getWorksheet(1)!.getCell('H2').text).toBe('18446744073709551615'); expect(calls).toBeGreaterThan(10); expect(await readdir(dirname(path))).toEqual(['result.xlsx']);
  });
  it.each(['zero-write', 'write', 'sync', 'rename'])('%s失败只清本任务临时文件，原目标与任务门可重新使用', async kind => {
    const path = await destination(), events: TaskEvent[] = []; let closed = 0;
    const io = disk({ open: async path => { const handle = await nativeAtomicFileIO.open(path); return { ...handle, async write(buffer, offset, length) { if (kind === 'zero-write') return { bytesWritten: 0 }; if (kind === 'write') throw Error('注入写入失败'); return handle.write(buffer, offset, length); }, async sync() { if (kind === 'sync') throw Error('注入同步失败'); await handle.sync(); }, async close() { closed++; await handle.close(); } }; }, rename: async (from, to) => { if (kind === 'rename') throw Error('注入替换失败'); await rename(from, to); } });
    const tasks = new ResultFileTasks(event => events.push(event), io); await expect(tasks.run(input(path))).rejects.toThrow();
    expect(closed).toBeGreaterThan(0); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(dirname(path))).toEqual(['result.xlsx']); expect(tasks.has('xlsx')).toBe(false); expect(events.at(-1)?.status).toBe('failed');
    await new ResultFileTasks(() => {}).run(input(path)); expect((await workbook(path)).getWorksheet(1)!.getCell('H2').text).toBe('18446744073709551615');
  });
  it('同步等待期间closeAll取消并等原文件关闭，之后不能接新任务', async () => {
    const path = await destination(), entered = deferred(), release = deferred(), events: TaskEvent[] = []; let closed = false;
    const io = disk({ open: async path => { const handle = await nativeAtomicFileIO.open(path); return { ...handle, async sync() { entered.resolve(); await release.promise; await handle.sync(); }, async close() { await handle.close(); closed = true; } }; } });
    const tasks = new ResultFileTasks(event => events.push(event), io), running = tasks.run(input(path)), rejected = expect(running).rejects.toThrow('已取消'); await entered.promise;
    let settled = false; const closing = tasks.closeAll().then(() => { settled = true; }); expect(settled).toBe(false); release.resolve(); await rejected; await closing;
    expect(closed).toBe(true); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(dirname(path))).toEqual(['result.xlsx']); expect(events.at(-1)?.status).toBe('cancelled'); await expect(tasks.run({ ...input(path), taskId: '新任务' })).rejects.toThrow('正在退出');
  });
  it('原子rename开始后迟到取消不会误报撤销，closeAll仍等待真实替换', async () => {
    const path = await destination(), entered = deferred(), release = deferred(), events: TaskEvent[] = [], io = disk({ rename: async (from, to) => { entered.resolve(); await release.promise; await rename(from, to); } });
    const tasks = new ResultFileTasks(event => events.push(event), io), running = tasks.run(input(path)); await entered.promise; tasks.cancel('xlsx'); let closed = false; const closing = tasks.closeAll().then(() => { closed = true; }); expect(closed).toBe(false);
    release.resolve(); await running; await closing; expect((await workbook(path)).getWorksheet(1)!.getCell('H2').text).toBe('18446744073709551615'); expect(events.at(-1)?.status).toBe('completed'); expect(await readdir(dirname(path))).toEqual(['result.xlsx']);
  });
});
