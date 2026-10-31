import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';

const io = vi.hoisted(() => ({ short: 0, zero: false, failClose: false, writes: 0, closes: 0, beforeOpen: undefined as ((path: string) => void) | undefined, afterOpen: undefined as ((path: string) => void) | undefined }));
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('新建SQLite单测必须使用本例真实Node子进程'); } } }));
/** 只包装真实目标FileHandle的短写/失败边界；seed与SQLite结果一律真实，不替换成功事实。 */
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: async (path: Parameters<typeof actual.open>[0], flags: Parameters<typeof actual.open>[1], mode?: Parameters<typeof actual.open>[2]) => {
    const selected = String(path).includes('dbark-sqlite-create-test-'); if (selected) io.beforeOpen?.(String(path));
    const handle = await actual.open(path, flags, mode); if (!selected) return handle; io.afterOpen?.(String(path));
    return new Proxy(handle, { get(target, key) {
      if (key === 'write') return async (buffer: Uint8Array, offset: number, length: number, position: number) => { io.writes++; if (io.zero) return { bytesWritten: 0, buffer }; return target.write(buffer, offset, io.short ? Math.min(length, io.short) : length, position); };
      if (key === 'close') return async () => { io.closes++; if (io.failClose) throw Error('本例原目标句柄close尚未确认'); await target.close(); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
});
import { closeSqliteDatabaseCreates, createSqliteDatabaseFile } from '../../src/main/sqliteDatabaseCreate';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; received: SqliteWorkerResponse[]; seed?: string; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], seedDirectories = new Set<string>(), processes: ProcessRecord[] = [];
let bundleDirectory: string, worker: string, retained = false;
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 准确进程/句柄均关闭后才清理本例独占目录；失败保留原件，不重跑。 */
function remove(directory: string, prefix: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith(prefix)).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed; io.failClose = false; io.beforeOpen = io.afterOpen = undefined; await closeSqliteDatabaseCreates();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  if (!failed) { for (const directory of directories.splice(0)) remove(directory, 'dbark-sqlite-create-test-'); for (const directory of seedDirectories) if (existsSync(directory)) remove(directory, 'dbark-sqlite-create-'); } else directories.length = 0;
  seedDirectories.clear(); io.short = io.writes = io.closes = 0; io.zero = false;
});
afterAll(() => { if (!retained) remove(bundleDirectory, 'dbark-sqlite-create-build-'); });
function destination(name = '中文🚢新建.sqlite'): string { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-test-')); directories.push(directory); return join(directory, name); }
/** 所有数据库调用均沿真实worker；仅退出故障例在真实完整性检查回执后终止原准确进程。 */
function transport(observe?: (message: SqliteWorkerResponse, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], received: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (message.kind === 'open') { record.seed = message.options.path; seedDirectories.add(dirname(record.seed)); } child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => { record.received.push(message); observe?.(message, record); listener(message); }; child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function create(path: string, options: { assertOwner?: () => void; createTransport?: () => SqliteProcessTransport } = {}) { return createSqliteDatabaseFile(path, { assertOwner: options.assertOwner ?? (() => {}), createTransport: options.createTransport ?? transport }); }
/** 独立Node连接核空schema/完整性及真实可写，不调用待验生成器证明自己。 */
function validEmpty(path: string): void { const db = new DatabaseSync(path); try { expect(db.prepare('SELECT count(*) AS n FROM sqlite_schema').get()!.n).toBe(0); expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok'); db.exec("CREATE TABLE proof(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO proof VALUES(1,'独立可写')"); expect(db.prepare('SELECT note FROM proof').get()!.note).toBe('独立可写'); } finally { db.close(); } }

describe('SQLite新建真实utility初始化、wx独占与准确收尾', () => {
  it('utility真实空schema/integrity/closeAck/exit及seed清理后才wx目标，短写完整且返回Main协议真实身份', async () => {
    const path = destination(); io.short = 17; io.beforeOpen = () => { expect(processes).toHaveLength(1); expect(processes[0].child.exitCode).toBe(0); expect(existsSync(processes[0].seed!)).toBe(false); expect(existsSync(dirname(processes[0].seed!))).toBe(false); };
    const created = await create(path), actual = statSync(path, { bigint: true }); expect(created).toEqual({ path: realpathSync(path), device: actual.dev, inode: actual.ino }); expect(io.writes).toBeGreaterThan(1); expect(io.closes).toBe(1); expect(actual.size).toBeLessThanOrEqual(65536n); if (process.platform !== 'win32') expect(actual.mode & 0o777n).toBe(0o600n);
    expect(processes[0].sent.filter(message => message.kind === 'execute').map(message => message.sql)).toEqual(['BEGIN IMMEDIATE; CREATE TABLE "__dbark_initialize" ("value" INTEGER); DROP TABLE "__dbark_initialize"; COMMIT', 'SELECT count(*) FROM main.sqlite_schema', 'PRAGMA integrity_check(1)']); expect(processes[0].sent.some(message => message.kind === 'closeAck')).toBe(true); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0); validEmpty(path);
  });

  it.each(['zero', 'bytes', 'directory'] as const)('已有目标%s立即拒绝且0fork，不覆盖内容或身份', async kind => {
    const path = destination('existing.sqlite'); if (kind === 'directory') mkdirSync(path); else writeFileSync(path, kind === 'zero' ? '' : '原件不可覆盖'); const before = lstatSync(path, { bigint: true });
    await expect(create(path)).rejects.toMatchObject({ code: 'EEXIST' }); expect(processes).toHaveLength(0); const after = lstatSync(path, { bigint: true }); expect(after.dev).toBe(before.dev); expect(after.ino).toBe(before.ino); if (kind !== 'directory') expect(readFileSync(path, 'utf8')).toBe(kind === 'zero' ? '' : '原件不可覆盖');
  });

  it('已有符号链接/Windows junction也0fork拒绝，不更改链接及其目标', async () => {
    const path = destination('link.sqlite'), original = join(dirname(path), 'owned-original'); mkdirSync(original); writeFileSync(join(original, 'sentinel'), '链接原件'); symlinkSync(original, path, process.platform === 'win32' ? 'junction' : 'dir'); const before = lstatSync(path, { bigint: true });
    await expect(create(path)).rejects.toMatchObject({ code: 'EEXIST' }); expect(processes).toHaveLength(0); expect(lstatSync(path, { bigint: true }).ino).toBe(before.ino); expect(readFileSync(join(original, 'sentinel'), 'utf8')).toBe('链接原件');
  });

  it.each(['-journal', '-wal', '-shm'])('已有%s命名空间0fork拒绝，日志sentinel原字节与dev/ino不变', async suffix => {
    const path = destination(), sidecar = path + suffix; writeFileSync(sidecar, '原日志不可触碰'); const before = lstatSync(sidecar, { bigint: true }); await expect(create(path)).rejects.toMatchObject({ code: 'EEXIST' }); expect(existsSync(path)).toBe(false); expect(processes).toHaveLength(0); expect(readFileSync(sidecar, 'utf8')).toBe('原日志不可触碰'); const after = lstatSync(sidecar, { bigint: true }); expect(after.dev).toBe(before.dev); expect(after.ino).toBe(before.ino);
  });

  it('seed打开期间原文档失效也正常关闭准确utility/清理seed，零目标创建', async () => {
    const path = destination(); let revoked = false; await expect(create(path, { assertOwner: () => { if (revoked) throw Error('原文档失效'); }, createTransport: () => transport(message => { if (message.kind === 'opened') revoked = true; }) })).rejects.toThrow('尚未创建目标'); expect(existsSync(path)).toBe(false); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0); expect(existsSync(processes[0].seed!)).toBe(false); expect(existsSync(dirname(processes[0].seed!))).toBe(false);
  });

  it('wx后迟到失效仍先完整写入/sync/close，保留合法文件但拒登记，不删除目标', async () => {
    const path = destination(); let revoked = false; io.short = 23; io.afterOpen = () => { revoked = true; }; await expect(create(path, { assertOwner: () => { if (revoked) throw Error('wx后原文档失效'); } })).rejects.toThrow('目标路径可能已有文件'); expect(io.writes).toBeGreaterThan(1); expect(io.closes).toBe(1); expect(existsSync(path)).toBe(true); validEmpty(path);
  });

  it('零写入明确报文件可能已创建，关闭原句柄且不自动删用户目标', async () => {
    const path = destination(); io.zero = true; await expect(create(path)).rejects.toThrow('目标路径可能已有文件'); expect(existsSync(path)).toBe(true); expect(statSync(path).size).toBe(0); expect(io.closes).toBe(1); expect(await processes[0].exited).toEqual({ code: 0, signal: null });
  });

  it('目标原FD close失败保留到显式drain，drain失败不假成功，再次准确close成功不改目标字节', async () => {
    const path = destination(); io.failClose = true; await expect(create(path)).rejects.toThrow('目标路径可能已有文件'); const bytes = readFileSync(path); await expect(closeSqliteDatabaseCreates()).rejects.toThrow('未确认关闭'); expect(readFileSync(path)).toEqual(bytes); io.failClose = false; await closeSqliteDatabaseCreates(); expect(readFileSync(path)).toEqual(bytes); const calls = io.closes; await closeSqliteDatabaseCreates(); expect(io.closes).toBe(calls); validEmpty(path);
  });

  it('完整性检查真实完成后原进程异常退出，绝不把exited当正常close而触碰目标', async () => {
    const path = destination(); await expect(create(path, { createTransport: () => transport((message, record) => { const last = record.sent.filter(value => value.kind === 'execute').at(-1); if (message.kind === 'completed' && last?.kind === 'execute' && last.sql === 'PRAGMA integrity_check(1)') record.child.kill(); }) })).rejects.toThrow('尚未创建目标'); expect(existsSync(path)).toBe(false); const exit = await processes[0].exited; expect(exit.code !== 0 || exit.signal !== null).toBe(true); expect(processes[0].received.filter(message => message.kind === 'completed')).toHaveLength(3); await closeSqliteDatabaseCreates();
  });

  it('seed初始化期间所选父目录被替换，原canonical身份复核拒绝，两个目录均无新主文件', async () => {
    const base = destination('unused'), parent = join(dirname(base), 'selected'), kept = join(dirname(base), 'kept'); mkdirSync(parent); const path = join(parent, 'new.sqlite'); let moved = false;
    await expect(create(path, { createTransport: () => transport(message => { if (!moved && message.kind === 'opened') { renameSync(parent, kept); mkdirSync(parent); moved = true; } }) })).rejects.toThrow('连接未保存'); expect(moved).toBe(true); expect(existsSync(path)).toBe(false); expect(existsSync(join(kept, 'new.sqlite'))).toBe(false); expect(await processes[0].exited).toEqual({ code: 0, signal: null });
  });

  it('wx后出现外来sidecar仍完整关闭新主文件但拒令牌，保主库和外来日志原件', async () => {
    const path = destination(); io.afterOpen = value => { writeFileSync(value + '-wal', '外来日志'); }; await expect(create(path)).rejects.toThrow('目标路径可能已有文件'); expect(readFileSync(path).subarray(0, 16)).toEqual(Buffer.from('SQLite format 3\0')); expect(readFileSync(path + '-wal', 'utf8')).toBe('外来日志'); expect(io.closes).toBe(1);
  });
});
