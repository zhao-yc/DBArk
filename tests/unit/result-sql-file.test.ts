import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { randomUUID } from 'node:crypto';
import { ResultFileTasks, type ResultFileIO } from '../../src/engine/resultFileTasks';
import type { ResultExportOptions, TaskEvent } from '../../src/shared/contracts';
import { resultSqlMain } from '../fixtures/result-sql-export';
const database = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => database);
import { Engine } from '../../src/engine';
const folders: string[] = [], engines: Engine[] = [];
afterEach(async () => { for (const engine of engines.splice(0)) await engine.closeAll(); expect(database.connect).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled(); for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });
/** 每个用例只在自己创建的临时目录操作，已有目标内容可检查取消或失败误覆盖。 */
async function destination() { const folder = await mkdtemp(join(tmpdir(), 'dbark-result-sql-')); folders.push(folder); const path = join(folder, 'result.sql'); await writeFile(path, '原目标'); return path; }
function input(path: string): ResultExportOptions & { filePath: string } {
  return { filePath: path, fileToken: 'native', taskId: randomUUID(), format: 'sql', encoding: 'utf8', result: { columns: [{ key: 'a', name: '重复' }, { key: 'b', name: '重复' }, { key: 'c', name: '' }], rows: [{ c: { type: 'binary', base64: 'AP8=' }, b: "中😊'\\\n\0", a: null }, { a: '18446744073709551615', b: '', c: { type: 'binary', base64: '' } }], truncated: true }, sql: { previewId: randomUUID(), target: { database: 'db', table: 't`x', columns: [{ key: 'a', name: 'n' }, { key: 'b', name: 's' }, { key: 'c', name: 'b' }] }, confirmation: 'db.t`x', acknowledged: true } };
}
const expected = "-- 已返回结果快照；仅生成INSERT，不执行SQL。\nINSERT INTO `db`.`t``x` (`n`, `s`, `b`) VALUES (NULL, _utf8mb4 X'e4b8adf09f988a275c0a00', X'00ff');\nINSERT INTO `db`.`t``x` (`n`, `s`, `b`) VALUES (_utf8mb4 X'3138343436373434303733373039353531363135', _utf8mb4 X'', X'');\n";
const disk = (overrides: Partial<ResultFileIO> = {}): ResultFileIO => ({ open: path => open(path, 'wx'), rename, remove: path => rm(path, { force: true }), ...overrides });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('结果INSERT真实文件与主进程链路', () => {
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s实际字节与手工独立期望一致，原数据不改写', async encoding => {
    const path = await destination(), value = input(path); value.encoding = encoding; const saved = structuredClone(value.result);
    await new ResultFileTasks(() => {}).run(value);
    const bytes = await readFile(path); expect(bytes).toEqual(iconv.encode((encoding === 'utf16le' ? '\uFEFF' : '') + expected, encoding)); expect(value.result).toEqual(saved); expect(await readdir(folders.at(-1)!)).toEqual(['result.sql']);
  });
  it('真实严格IPC→Main原文派发→一次性令牌→Engine文件任务，无连接或SQL执行', async () => {
    const path = await destination(), value = input(path), events: TaskEvent[] = [], engine = new Engine(event => events.push(event)); engines.push(engine);
    const calls: string[] = [], main = resultSqlMain(path, async (command, input) => { calls.push(command); return engine.handle(command as any, input); });
    const preview = await main.invoke('files.previewResultSql', { result: value.result, target: value.sql!.target, encoding: value.encoding }); expect(preview.sql).toBe(expected); expect(calls).toEqual([]);
    const file = await main.invoke('files.choose', { purpose: 'export', format: 'sql', resultSqlPreviewId: preview.previewId });
    const request = { fileToken: file.token, taskId: value.taskId, format: value.format, encoding: value.encoding, result: value.result, sql: { ...value.sql!, previewId: preview.previewId } };
    expect(await main.invoke('files.exportResult', request)).toEqual({ rows: 2 }); expect(await readFile(path, 'utf8')).toBe(expected);
    await expect(main.invoke('files.exportResult', { ...request, taskId: randomUUID() })).rejects.toThrow('失效'); expect(calls).toEqual(['files.exportResult']); expect(events.at(-1)?.status).toBe('completed'); expect(main.files.size).toBe(0);
  });
  it.each(['cancel', 'owner'] as const)('Main路径授权等待中%s，已消费令牌但零Engine投递且保原文件', async mode => {
    const path = await destination(), value = input(path), entered = deferred(), permit = deferred(), request = vi.fn(async () => ({})), release = vi.fn();
    const main = resultSqlMain(path, request, async () => { entered.resolve(); await permit.promise; return release; });
    const preview = await main.invoke('files.previewResultSql', { result: value.result, target: value.sql!.target, encoding: value.encoding }), file = await main.invoke('files.choose', { purpose: 'export', format: 'sql', resultSqlPreviewId: preview.previewId });
    const running = main.invoke('files.exportResult', { fileToken: file.token, taskId: value.taskId, format: value.format, encoding: value.encoding, result: value.result, sql: { ...value.sql!, previewId: preview.previewId } }); const failure = expect(running).rejects.toThrow(); await entered.promise;
    if (mode === 'cancel') await main.invoke('query.cancel', { taskId: value.taskId }); else main.state.current = false;
    permit.resolve(); await failure; expect(request).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce(); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(main.files.size).toBe(0);
  });
  it('短写逐字节完成，不丢UTF-8或半个SQL语句', async () => {
    const path = await destination(), io = disk({ open: async path => { const file = await open(path, 'wx'); return { write: (buffer, offset, length) => file.write(buffer, offset, Math.min(7, length)), sync: () => file.sync(), close: () => file.close() }; } });
    await new ResultFileTasks(() => {}, io).run(input(path)); expect(await readFile(path, 'utf8')).toBe(expected);
  });
  it.each(['sync-cancel', 'rename-failure', 'write-failure'] as const)('%s保留原目标并清理临时文件和任务', async mode => {
    const path = await destination(), value = input(path), entered = deferred(), permit = deferred(), events: TaskEvent[] = [];
    const io = disk({ open: async path => { const file = await open(path, 'wx'); return { write: async (buffer, offset, length) => mode === 'write-failure' ? { bytesWritten: 0 } : file.write(buffer, offset, length), sync: async () => { if (mode === 'sync-cancel') { entered.resolve(); await permit.promise; } await file.sync(); }, close: () => file.close() }; }, ...(mode === 'rename-failure' ? { rename: async () => { throw Error('合成替换失败'); } } : {}) });
    const tasks = new ResultFileTasks(event => events.push(event), io), running = tasks.run(value), failure = expect(running).rejects.toThrow();
    if (mode === 'sync-cancel') { await entered.promise; tasks.cancel(value.taskId); permit.resolve(); }
    await failure; await tasks.closeAll(); expect(tasks.has(value.taskId)).toBe(false); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(folders.at(-1)!)).toEqual(['result.sql']); expect(events.at(-1)?.status).toBe(mode === 'sync-cancel' ? 'cancelled' : 'failed');
  });
  it('Engine进度250行处同步取消，closeAll等待清理，不重新查询已返回快照', async () => {
    const path = await destination(), value = input(path); value.result.rows = Array(501).fill(value.result.rows[0]);
    const events: TaskEvent[] = [], engine = new Engine(event => { events.push(event); if (event.rows === 250) void engine.handle('query.cancel', { taskId: value.taskId }); }); engines.push(engine);
    await expect(engine.handle('files.exportResult', value)).rejects.toThrow('已取消'); await engine.closeAll(); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(events.at(-1)?.status).toBe('cancelled'); expect(await readdir(folders.at(-1)!)).toEqual(['result.sql']);
  });
  it('工具进程也在文件创建前拒绝未知SQL映射或缺失确认，不依赖界面验证', async () => {
    const path = await destination(), value = input(path), io = disk(), fileOpen = vi.spyOn(io, 'open');
    for (const sql of [undefined, { ...value.sql, acknowledged: false }, { ...value.sql, target: undefined }, { ...value.sql, confirmation: 'wrong' }]) await expect(new ResultFileTasks(() => {}, io).run({ ...value, sql } as any)).rejects.toThrow('失效');
    expect(fileOpen).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(folders.at(-1)!)).toEqual(['result.sql']);
  });
});
