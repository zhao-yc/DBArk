import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import type { ResultExportOptions, TaskEvent } from '../../src/shared/contracts';
import { ResultFileTasks, type ResultFileIO } from '../../src/engine/resultFileTasks';

const folders: string[] = [];
/** 只清理由测试创建的文件与空文件夹，不递归删除外部目录。 */
afterEach(async () => { for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });
/** 目标预先带有内容，所有失败/取消用例都能检测到误覆盖。 */
async function destination(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'dbark-result-')); folders.push(folder);
  const path = join(folder, 'result'); await writeFile(path, '原文件'); return path;
}
/** 模拟最小可信请求，行键特意逆序，避免实现误用 Object.values。 */
function options(filePath: string, format: 'csv' | 'json' = 'json', encoding: ResultExportOptions['encoding'] = 'utf8'): ResultExportOptions & { filePath: string } {
  return { filePath, fileToken: 'selected', taskId: 'export', format, encoding, result: {
    columns: ['值', '值', '值 [2]', '__proto__', 'constructor', '', '数字', '小数', '二进制', '反斜线', '空串', '2', '1'].map((name, i) => ({ key: `c${i}`, name })),
    rows: [Object.fromEntries([null, '中文,\n"引号"', true, '原型', '构造', '空名', '18446744073709551615', '0.12345678901234567890', { type: 'binary', base64: 'AAH/' }, '\\N', '', '二', '一'].map((cell, i) => [`c${i}`, cell]).reverse())], truncated: true
  } };
}
/** 文件适配器默认仍使用真实磁盘，测试只替换指定的系统调用。 */
function disk(overrides: Partial<ResultFileIO> = {}): ResultFileIO {
  return { open: path => open(path, 'wx'), rename, remove: path => rm(path, { force: true }), ...overrides };
}
/** 可控延迟用于精确落在同步或重命名边界，不用时间等待猜测竞态。 */
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}

describe('独立结果文件任务', () => {
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('CSV %s 保留列序、重复列、NULL/空串、大数与二进制协议', async encoding => {
    const path = await destination(); const events: TaskEvent[] = [];
    await new ResultFileTasks(event => events.push(event)).run(options(path, 'csv', encoding));
    const content = iconv.decode(await readFile(path), encoding); const rows = parse(content, { bom: true });
    expect(rows[0]).toEqual(['值', '值 [3]', '值 [2]', '__proto__', 'constructor', '列 [6]', '数字', '小数', '二进制', '反斜线', '空串', '2', '1']);
    expect(rows[1]).toEqual(['\\N', '中文,\n"引号"', 'true', '原型', '构造', '空名', '18446744073709551615', '0.12345678901234567890', 'base64:AAH/', '\\\\N', '', '二', '一']);
    expect(events.at(-1)).toMatchObject({ status: 'completed', rows: 1, progress: 100 });
    expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('JSON %s 保持精度、原型同名键、二进制及列值不覆盖', async encoding => {
    const path = await destination(); await new ResultFileTasks(() => {}).run(options(path, 'json', encoding));
    const text = iconv.decode(await readFile(path), encoding); const row = JSON.parse(text)[0];
    expect(row['值']).toBeNull(); expect(row['值 [3]']).toBe('中文,\n"引号"'); expect(row['值 [2]']).toBe(true);
    expect(Object.hasOwn(row, '__proto__')).toBe(true); expect(row['__proto__']).toBe('原型'); expect(row.constructor).toBe('构造');
    expect(row['数字']).toBe('18446744073709551615'); expect(row['小数']).toBe('0.12345678901234567890');
    expect(row['二进制']).toEqual({ type: 'binary', base64: 'AAH/' }); expect(row['空串']).toBe(''); expect(row['反斜线']).toBe('\\N');
    expect(text.indexOf('"2":"二"')).toBeLessThan(text.indexOf('"1":"一"'));
  });
  it('短写覆盖所有剩余字节，UTF-16 的中文字节不会被截断', async () => {
    const path = await destination(); let calls = 0;
    const io = disk({ open: async path => {
      const file = await open(path, 'wx');
      return { sync: () => file.sync(), close: () => file.close(), write: (buffer, offset, length) => { calls++; return file.write(buffer, offset, Math.min(3, length)); } };
    } });
    await new ResultFileTasks(() => {}, io).run(options(path, 'json', 'utf16le'));
    expect(JSON.parse(iconv.decode(await readFile(path), 'utf16le'))[0]['__proto__']).toBe('原型'); expect(calls).toBeGreaterThan(50);
  });
  it('零字节写入失败保留已有文件并移除临时文件', async () => {
    const path = await destination(); const events: TaskEvent[] = [];
    const io = disk({ open: async path => { const file = await open(path, 'wx'); return { write: async () => ({ bytesWritten: 0 }), sync: () => file.sync(), close: () => file.close() }; } });
    await expect(new ResultFileTasks(event => events.push(event), io).run(options(path))).rejects.toThrow('无法继续');
    expect(await readFile(path, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']); expect(events.at(-1)?.status).toBe('failed');
  });
  it('同步等待期间取消，退出等待关闭清理且不会替换目标', async () => {
    const path = await destination(); const entered = deferred(), release = deferred(); const events: TaskEvent[] = [];
    const io = disk({ open: async path => { const file = await open(path, 'wx'); return { write: (buffer, offset, length) => file.write(buffer, offset, length), close: () => file.close(), sync: async () => { entered.resolve(); await release.promise; await file.sync(); } }; } });
    const tasks = new ResultFileTasks(event => events.push(event), io); const running = tasks.run(options(path)); const failure = expect(running).rejects.toThrow('已取消');
    await entered.promise; let closed = false; const closing = tasks.closeAll().then(() => { closed = true; });
    expect(closed).toBe(false); release.resolve(); await failure; await closing;
    expect(await readFile(path, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']); expect(tasks.has('export')).toBe(false); expect(events.at(-1)?.status).toBe('cancelled');
    await expect(tasks.run({ ...options(path), taskId: 'new' })).rejects.toThrow('正在退出');
  });
  it('重命名失败同样保留已有目标，且临时文件会清理', async () => {
    const path = await destination(); const io = disk({ rename: async () => { throw new Error('模拟磁盘拒绝替换'); } });
    await expect(new ResultFileTasks(() => {}, io).run(options(path))).rejects.toThrow('拒绝替换');
    expect(await readFile(path, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
  it('进入原子替换后迟到取消不误报失败，closeAll 仍等待替换完成', async () => {
    const path = await destination(); const entered = deferred(), release = deferred(); const events: TaskEvent[] = [];
    const io = disk({ rename: async (source, target) => { entered.resolve(); await release.promise; await rename(source, target); } });
    const tasks = new ResultFileTasks(event => events.push(event), io); const running = tasks.run(options(path)); await entered.promise;
    tasks.cancel('export'); const closing = tasks.closeAll(); release.resolve(); await running; await closing;
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1); expect(events.at(-1)?.status).toBe('completed');
  });
  it('同编号并发请求不产生第二个文件；不同编号可独立取消', async () => {
    const path = await destination(); const entered = deferred(), release = deferred(); const openFile = vi.fn(async (target: string) => { entered.resolve(); await release.promise; return open(target, 'wx'); });
    const tasks = new ResultFileTasks(() => {}, disk({ open: openFile })); const running = tasks.run(options(path)); const failure = expect(running).rejects.toThrow('已取消'); await entered.promise;
    await expect(tasks.run(options(path))).rejects.toThrow('任务已在执行'); tasks.cancel('other'); expect(tasks.has('export')).toBe(true); tasks.cancel('export'); release.resolve(); await failure;
    expect(openFile).toHaveBeenCalledTimes(1); expect(await readFile(path, 'utf8')).toBe('原文件');
  });
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s 无法无损表示的 CSV 字符明确失败而不替换成问号', async encoding => {
    const path = await destination(); const input = options(path, 'csv', encoding); input.result.rows[0].c1 = '\uD800';
    await expect(new ResultFileTasks(() => {}).run(input)).rejects.toThrow('无法无损'); expect(await readFile(path, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['result']);
  });
  it('JSON 可用转义无损保存孤立代理项，正常代理对仍能写出 UTF-16', async () => {
    const path = await destination(); const input = options(path, 'json', 'utf16le'); input.result.rows[0].c1 = '\uD800'; input.result.rows[0].c0 = '😊';
    await new ResultFileTasks(() => {}).run(input); const row = JSON.parse(iconv.decode(await readFile(path), 'utf16le'))[0];
    expect(row['值 [3]']).toBe('\uD800'); expect(row['值']).toBe('😊');
  });
  it('无数据结果导出有效空 JSON 数组和 CSV 标题', async () => {
    const path = await destination(); const input = options(path); input.result.rows = [];
    await new ResultFileTasks(() => {}).run(input); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]);
    await new ResultFileTasks(() => {}).run({ ...input, format: 'csv' }); expect(parse(await readFile(path, 'utf8'))).toHaveLength(1);
  });
});
