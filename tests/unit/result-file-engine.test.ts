import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TaskEvent } from '../../src/shared/contracts';

const database = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => database);
import { Engine } from '../../src/engine';
import { ResultExportSelection, resultExportData } from '../../src/renderer/resultExport';

const folders: string[] = [];
/** 用例退出只删除自己生成的文件，独立断言数据库驱动从未被触发。 */
afterEach(async () => {
  expect(database.connect).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled();
  for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); }
});
/** 工具进程入口接受可信路径；令牌授权由另一组主进程边界用例验证。 */
async function input(rows = 1) {
  const folder = await mkdtemp(join(tmpdir(), 'dbark-result-engine-')); folders.push(folder); const filePath = join(folder, 'result'); await writeFile(filePath, '原文件');
  return { fileToken: 'selected', filePath, format: 'json', encoding: 'utf8', taskId: 'returned-result', result: { columns: [{ key: 'c0', name: '值' }], rows: Array.from({ length: rows }, (_, index) => ({ c0: String(index) })), truncated: false } };
}

describe('结果导出在工具进程中的任务生命周期', () => {
  it.each(['csv', 'json'])('勾选快照%s导出取消仍保原文件，既有任务不触发数据库', async format => {
    const value = await input(1002), source = { ...value.result, columns: value.result.columns.map(column => ({ ...column, type: 'TEXT' })), elapsedMs: 0, statement: '' };
    const selection = new ResultExportSelection(), binding = selection.bind(source, ['returned'])!;
    selection.select(binding, { scope: binding, rows: source.rows, columns: source.columns, indices: new Set(source.rows.map((_, index) => index).filter(index => index % 2 === 0)) });
    const selectedInput = { ...value, result: resultExportData(selection.snapshot(binding)), format };
    const engine = new Engine(event => { if (event.rows === 250) void engine.handle('query.cancel', { taskId: value.taskId }); });
    await expect(engine.handle('files.exportResult', selectedInput)).rejects.toThrow('已取消'); await engine.closeAll();
    expect(await readFile(value.filePath, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
  it('没有配置和会话也能导出，关闭不存在的连接不会中断独立文件任务', async () => {
    const value = await input(); const events: TaskEvent[] = []; const engine = new Engine(event => events.push(event));
    await engine.handle('connections.close', { id: 'disconnected' }); await expect(engine.handle('files.exportResult', value)).resolves.toEqual({ rows: 1 });
    expect(JSON.parse(await readFile(value.filePath, 'utf8'))).toEqual([{ 值: '0' }]); expect(events.at(-1)?.status).toBe('completed'); await engine.closeAll();
  });
  it('query.cancel 取消独立文件任务，保留目标并释放任务与临时文件', async () => {
    const value = await input(501); const events: TaskEvent[] = [];
    const engine = new Engine(event => { events.push(event); if (event.rows === 250) void engine.handle('query.cancel', { taskId: value.taskId }); });
    await expect(engine.handle('files.exportResult', value)).rejects.toThrow('已取消'); await engine.closeAll();
    expect(await readFile(value.filePath, 'utf8')).toBe('原文件'); expect(events.at(-1)?.status).toBe('cancelled'); expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
  it('closeAll 同时负责文件取消和清理，不伪造数据库连接或控制连接', async () => {
    const value = await input(501); let closing: Promise<void> | undefined;
    const engine = new Engine(event => { if (event.status === 'running' && event.rows === 250) closing = engine.closeAll(); });
    await expect(engine.handle('files.exportResult', value)).rejects.toThrow('已取消'); await closing;
    expect(await readFile(value.filePath, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
});
