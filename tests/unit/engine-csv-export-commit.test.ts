import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskEvent } from '../../src/shared/contracts';

const ports = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn(), files: new Map<string, Buffer>(), pause: '' as string, fail: '' as string, entered: undefined as (() => void) | undefined, resume: undefined as Promise<void> | undefined, renames: 0, handles: 0, dataQueries: 0 }));
vi.mock('../../src/engine/connection', () => ({ connect: ports.connect, execute: ports.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: ports.tableInfo }));
// 只替换驱动和文件端口，实际 Engine、串流、目录与取消协议全部运行；不接触真实导出文件。
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(),
  open: async (path: string) => {
    ports.files.set(path, Buffer.alloc(0)); ports.handles++; let closed = false;
    return {
      write: async (buffer: Buffer, offset: number, length: number) => { const size = Math.min(3, length); if (offset + size === buffer.length) await boundary('header'); ports.files.set(path, Buffer.concat([ports.files.get(path)!, buffer.subarray(offset, offset + size)])); return { bytesWritten: size }; },
      sync: () => boundary('sync'),
      close: async () => { if (closed) return; await boundary('close'); closed = true; ports.handles--; }
    };
  },
  rename: async (from: string, to: string) => { ports.renames++; await boundary('rename'); ports.files.set(to, ports.files.get(from)!); ports.files.delete(from); },
  rm: async (path: string) => { ports.files.delete(path); }
}));
import { Engine } from '../../src/engine';

/** 在指定真实异步边界暂停，独立控制取消到达时刻；失败只注入一次以便验证后续资源收尾。 */
async function boundary(stage: string): Promise<void> {
  if (ports.pause === stage) { ports.entered?.(); await ports.resume; }
  if (ports.fail === stage) { ports.fail = ''; throw Error(stage + '失败'); }
}
const profile = { id: 'csv-commit-ram', name: '离线文件提交', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const info = { database: 'db', name: 't', objectKind: 'table', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, defaultValue: null, extra: '', comment: '', generated: false }], indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', ddl: 'CREATE TABLE `t` (`id` bigint unsigned NOT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' };
let engine: Engine, events: TaskEvent[], release: (() => void) | undefined;
beforeEach(async () => {
  ports.files.clear(); ports.pause = ports.fail = ''; ports.entered = undefined; ports.resume = undefined; ports.renames = ports.handles = ports.dataQueries = 0; events = []; release = undefined;
  ports.connect.mockReset().mockImplementation(async () => {
    const connection = new EventEmitter(); Object.assign(connection, { threadId: 1, query: () => { ports.dataQueries++; return { stream: () => Readable.from([['18446744073709551615']], { objectMode: true }) }; }, destroy() {} });
    return { connection, profile, close: async () => {}, broken: false, sqlMode: '', serverStatus: 2, status: { dialect: 'mysql', version: '8.4.11' } };
  });
  ports.execute.mockReset().mockImplementation(async (_managed, sql: string) => { if (sql === 'START TRANSACTION WITH CONSISTENT SNAPSHOT') await boundary('transaction'); return { rows: [] }; }); ports.tableInfo.mockReset().mockImplementation(async () => structuredClone(info));
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile }); ports.files.set('ram-output', Buffer.from('原件'));
});
afterEach(async () => { release?.(); await engine.closeAll(); });
/** 三格式与CSV选列共用原files.export的提交边界，编码及序列化仍由产品代码完成。 */
async function input(selected: boolean, format = 'csv') {
  const catalog = selected ? await engine.handle('files.exportColumns', { connectionId: profile.id, database: 'db', table: 't', taskId: 'catalog', connectionRevision: 1 }) : undefined;
  return { connectionId: profile.id, database: 'db', table: 't', filePath: 'ram-output', taskId: 'export', format, encoding: 'utf8', includeData: true, includeStructure: false, connectionRevision: 1, ...(catalog ? { csvSelection: { catalogId: catalog.catalogId, columns: ['id'] } } : {}) };
}
/** 等待实际文件端口到达，再由用例触发真实 query.cancel，不靠定时器猜测竞态。 */
function pause(stage: string) { ports.pause = stage; ports.resume = new Promise<void>(resolve => { release = resolve; }); return new Promise<void>(resolve => { ports.entered = resolve; }); }
/** 同时核对原件、临时文件与句柄，避免只看取消状态而漏掉文件已被替换。 */
function preserved() { expect(ports.files.get('ram-output')!.toString()).toBe('原件'); expect([...ports.files.keys()]).toEqual(['ram-output']); expect(ports.handles).toBe(0); }
/** 独立固定的三格式完整字节，避免提交修复顺便改变编码、换行或高精度值。 */
function expectedBytes(format: string): Buffer { return Buffer.from(format === 'csv' ? 'id\r\n18446744073709551615\r\n' : format === 'json' ? '[\n{"id":"18446744073709551615"}\n]\n' : "-- DBArk SQL 导出；请在目标数据库执行\nSET NAMES utf8mb4;\nINSERT INTO `t` (`id`) VALUES (_utf8mb4 X'3138343436373434303733373039353531363135');\n", 'utf8'); }

describe.each([{ format: 'csv', selected: false, label: '默认全列CSV' }, { format: 'csv', selected: true, label: '选列CSV' }, { format: 'json', selected: false, label: 'JSON' }, { format: 'sql', selected: false, label: 'SQL' }])('表文件提交取消：$label', ({ selected, format }) => {
  it.each(['header', 'transaction'])('%s等待期间接受取消后零次发送数据SELECT，不替换且清理partial与句柄', async stage => {
    const request = await input(selected, format), entered = pause(stage), pending = engine.handle('files.export', request).catch(reason => reason);
    await entered; await engine.handle('query.cancel', { taskId: 'export' }); release!();
    expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(ports.dataQueries).toBe(0); expect(ports.renames).toBe(0); preserved();
    await engine.handle('query.cancel', { taskId: 'export' }); expect(ports.dataQueries).toBe(0);
  });
  it('正常导出维持既有格式完整字节与单次替换', async () => {
    expect(await engine.handle('files.export', await input(selected, format))).toEqual({ rows: 1 }); expect(ports.files.get('ram-output')).toEqual(expectedBytes(format)); expect(ports.renames).toBe(1); expect(ports.handles).toBe(0); expect([...ports.files.keys()]).toEqual(['ram-output']);
  });
  it.each(['sync', 'close'])('%s等待期间取消保留原件且零次rename，重复取消不重放', async stage => {
    const request = await input(selected, format), entered = pause(stage), pending = engine.handle('files.export', request).catch(reason => reason);
    await entered; await engine.handle('query.cancel', { taskId: 'export' }); release!();
    expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(ports.renames).toBe(0); preserved();
    await engine.handle('query.cancel', { taskId: 'export' }); expect(ports.renames).toBe(0);
  });
  it('rename进行中取消不谎报取消，等待唯一替换结果后完成', async () => {
    const request = await input(selected, format), entered = pause('rename'), pending = engine.handle('files.export', request);
    await entered; await engine.handle('query.cancel', { taskId: 'export' }); await engine.handle('query.cancel', { taskId: 'export' });
    expect(events.at(-1)?.status).toBe('running'); expect(ports.files.get('ram-output')!.toString()).toBe('原件'); expect(ports.renames).toBe(1);
    release!(); expect(await pending).toEqual({ rows: 1 }); expect(events.at(-1)?.status).toBe('completed'); expect(ports.renames).toBe(1); expect(ports.handles).toBe(0);
    expect([...ports.files.keys()]).toEqual(['ram-output']); expect(ports.files.get('ram-output')).toEqual(expectedBytes(format));
    await engine.handle('query.cancel', { taskId: 'export' }); expect(ports.renames).toBe(1);
    if (selected) { await expect(engine.handle('files.export', { ...request, taskId: 'retry' })).rejects.toThrow('失效'); expect(ports.renames).toBe(1); }
  });
  it('rename进行中取消遇到替换失败，报告failed并保留原件，不重试rename', async () => {
    const request = await input(selected, format), entered = pause('rename'); ports.fail = 'rename'; const pending = engine.handle('files.export', request).catch(reason => reason);
    await entered; await engine.handle('query.cancel', { taskId: 'export' }); release!();
    expect(await pending).toMatchObject({ message: 'rename失败' }); expect(events.at(-1)?.status).toBe('failed'); expect(ports.renames).toBe(1); preserved();
  });
  it.each(['sync', 'close'])('%s失败不发布成功或替换，句柄和partial收尾', async stage => {
    ports.fail = stage; await expect(engine.handle('files.export', await input(selected, format))).rejects.toThrow(stage + '失败');
    expect(events.at(-1)?.status).toBe('failed'); expect(ports.renames).toBe(0); preserved();
  });
});
