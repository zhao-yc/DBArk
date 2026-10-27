import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { FileImportResult } from '../../src/shared/sqlFileImport';
import { sqlFileImportReceiptSchema } from '../../src/shared/sqlFileImport';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => driver);
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'sql-file-offline', name: '离线', dialect: 'mysql', host: 'never.invalid', port: 1, user: 'none', group: '', color: '#123456' };
let engine: Engine, directory: string, events: TaskEvent[], managed: any;
/** 仅替换数据库端口；真实文件解码、Engine文件入口、任务和关闭链均保留。 */
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-sql-file-')); events = [];
  managed = { connection: Object.assign(new EventEmitter(), { threadId: 42 }), profile, broken: false, sqlMode: '', serverStatus: 2, transactionStateKnown: true, status: { dialect: 'mysql', version: '8.4.11' }, close: vi.fn().mockResolvedValue(undefined) };
  driver.connect.mockReset().mockResolvedValue(managed);
  driver.execute.mockReset().mockImplementation(async () => { managed.serverStatus = 2; managed.transactionStateKnown = true; return { rows: { affectedRows: 0, serverStatus: 2, warningStatus: 0 }, fields: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
  vi.spyOn(engine as any, 'streamQuery').mockImplementation(async (_task: unknown, sql: unknown) => { if (String(sql).includes('BAD')) throw Error('合成语法错误'); return [{ columns: [], rows: [], affectedRows: 1, truncated: false }]; });
});
afterEach(async () => { await engine.closeAll(); await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
/** 通过正式files.import端口注入本例唯一文件。 */
async function run(source: string): Promise<FileImportResult> {
  const filePath = join(directory, 'source.sql'); await writeFile(filePath, source);
  const result: FileImportResult = await engine.handle('files.import', { connectionId: profile.id, database: 'isolated', filePath, format: 'sql', encoding: 'utf8', taskId: 'sql-file-task', mapping: {} });
  sqlFileImportReceiptSchema.parse(result.sql); return result;
}

describe('SQL文件导入原失败回归', () => {
  it('ROLLBACK拒绝不得继续声称未提交事务已回滚', async () => {
    driver.execute.mockRejectedValue(Error('合成回滚ACK丢失'));
    const result = await run('BAD;');
    expect(result.errors.join('')).not.toContain('未提交事务已回滚');
    expect(result.sql).toMatchObject({ termination: 'failed', rollback: { state: 'unconfirmed' }, failure: { phase: 'execute', statement: { ordinal: 1 } } });
  });
  it('重复语句按原scanner范围定位第二条，BOM/CRLF和UTF16列不得靠indexOf猜测', async () => {
    const result = await run('\uFEFFSELECT 1;\r\n  BAD;\r\n');
    expect(result.sql).toMatchObject({ completedStatements: 1, positionBasis: 'decoded-utf16', failure: { phase: 'execute', statement: { ordinal: 2, location: { start: { offset: 13, line: 2, column: 3 }, end: { offset: 16, line: 2, column: 6 } } } } });
  });
  it('初始模式读取失败也返回结构化终态，不丢失任务身份', async () => {
    vi.spyOn(engine as any, 'sqlMode').mockRejectedValue(Error('合成模式未知'));
    const result = await run('SELECT 1;');
    expect(result.sql).toMatchObject({ taskId: 'sql-file-task', termination: 'failed', completedStatements: 0, failure: { phase: 'initial-mode' } });
  });
  it('成功后模式刷新失败属于原语句刷新，不伪报下一条执行失败', async () => {
    vi.spyOn(engine as any, 'sqlMode').mockResolvedValueOnce({ noBackslashEscapes: false, ansiQuotes: false }).mockRejectedValueOnce(Error('合成刷新失败'));
    const result = await run('SELECT 1; SELECT 2;');
    expect(result.sql).toMatchObject({ completedStatements: 1, serverReportedAffectedRows: 1, failure: { phase: 'mode-refresh', statement: { ordinal: 1 } } });
  });
});

describe('SQL文件回滚与晚收尾事实', () => {
  it('真实关闭函数收到QUIT回调错误后必须保留cleanupWarning，不能由非strict吞掉', async () => {
    const real = await vi.importActual<typeof import('../../src/engine/connection')>('../../src/engine/connection');
    const stream = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn(), end: vi.fn(), close: vi.fn() });
    stream.destroy.mockImplementation(() => { stream.closed = true; stream.emit('close'); });
    Object.assign(managed.connection, {
      stream,
      end: (callback: (error?: Error | null) => void) => queueMicrotask(() => callback(Error('原QUIT私密错误正文'))),
      destroy: vi.fn(() => stream.destroy()),
    });
    managed.close.mockImplementation((options?: { strict?: boolean }) => real.closeMysqlConnection(managed.connection, options?.strict === true, false, 1000));
    const result = await run('SELECT 1;');
    expect(result.sql).toMatchObject({ termination: 'completed', completedStatements: 1, transaction: 'closed' });
    expect(stream.closed).toBe(true); expect(result.sql?.cleanupWarning).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('原QUIT私密错误正文');
    expect((engine as any).streamQuery).toHaveBeenCalledTimes(1);
  });
  it('真实QUIT回调和flush完成仍须等待本例传输物理close，不能提前返回导入回执', async () => {
    const real = await vi.importActual<typeof import('../../src/engine/connection')>('../../src/engine/connection');
    let acknowledged!: () => void;
    const endAcknowledged = new Promise<void>(resolve => { acknowledged = resolve; });
    const stream = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn(), end: vi.fn(), close: vi.fn() });
    const release = () => { if (!stream.closed) { stream.closed = true; stream.emit('close'); } };
    stream.destroy.mockImplementation(release);
    stream.end.mockImplementation((callback: (error?: Error) => void) => callback());
    // 模拟SSH Channel：本地close调用本身不代表远端CLOSE已到。
    stream.close.mockImplementation(() => {});
    Object.assign(managed.connection, {
      stream,
      end: (callback: (error?: Error | null) => void) => queueMicrotask(() => { callback(null); acknowledged(); }),
      destroy: vi.fn(release),
    });
    managed.close.mockImplementation((options?: { strict?: boolean }) => real.closeMysqlConnection(managed.connection, options?.strict === true, false, 1000));
    const pending = run('SELECT 1;'); let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await endAcknowledged;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(stream.closed).toBe(false); expect(settled).toBe(false);
    } finally { release(); await pending; }
    const result = await pending;
    expect(result.sql).toMatchObject({ termination: 'completed', completedStatements: 1, transaction: 'closed' });
    expect(result.sql?.cleanupWarning).toBeUndefined();
  });
  it.each(['warning', 'missing-status', 'open', 'array'] as const)('ROLLBACK的%s不是真实关闭确认', async kind => {
    driver.execute.mockImplementation(async () => {
      managed.serverStatus = kind === 'open' ? 3 : 2; managed.transactionStateKnown = true;
      return { rows: kind === 'array' ? [] : { affectedRows: 0, warningStatus: kind === 'warning' ? 1 : 0, ...(kind === 'missing-status' ? {} : { serverStatus: managed.serverStatus }) }, fields: [] };
    });
    const result = await run('BAD;'); expect(result.sql?.rollback.state).toBe('unconfirmed');
    expect(driver.execute.mock.calls.filter(([, sql]) => sql === 'ROLLBACK')).toHaveLength(1);
  });
  it('EOF未闭合事务保留legacy rows0，原ROLLBACK ACK与累计计数分别记录', async () => {
    vi.mocked((engine as any).streamQuery).mockImplementation(async () => { managed.serverStatus = 3; return [{ affectedRows: 2 }]; });
    const result = await run('INSERT INTO t VALUES (1);');
    expect(result.rows).toBe(0); expect(result.errors.join('')).toContain('未提交事务');
    expect(result.sql).toMatchObject({ termination: 'failed', completedStatements: 1, serverReportedAffectedRows: 2, failure: { phase: 'finalize' }, rollback: { state: 'confirmed' }, transaction: 'closed' });
    expect(result.errors.join('')).not.toMatch(/此前提交的\s*\d+\s*行/);
  });
  it('影响计数溢出为null，不能截断或转成假0', async () => {
    vi.mocked((engine as any).streamQuery).mockResolvedValue([{ affectedRows: Number.MAX_SAFE_INTEGER }, { affectedRows: 1 }]);
    const result = await run('SELECT 1;'); expect(result.sql?.serverReportedAffectedRows).toBeNull();
  });
  it('物理关闭晚失败不抹掉已完整执行事实，不自动重发', async () => {
    managed.close.mockRejectedValueOnce(Error('不得泄露的本机路径'));
    const result = await run('SELECT 1;');
    expect(result.sql).toMatchObject({ termination: 'completed', completedStatements: 1, rollback: { state: 'not-needed' }, transaction: 'closed' });
    expect(result.sql?.cleanupWarning).toBeTruthy(); expect(JSON.stringify(result)).not.toContain('不得泄露');
    expect((engine as any).streamQuery).toHaveBeenCalledTimes(1);
  });
  it('取消仍正常返回结构化回执、cancelled事件并释放任务，不抛失原阶段', async () => {
    vi.mocked((engine as any).streamQuery).mockImplementation(async (task: any) => { task.cancelled = true; throw Error('原语句已中断'); });
    const result = await run('SELECT SLEEP(30); SELECT 2;');
    expect(result.sql).toMatchObject({ termination: 'cancelled', completedStatements: 0, failure: { phase: 'execute', statement: { ordinal: 1 } }, rollback: { state: 'confirmed' } });
    expect(events.at(-1)?.status).toBe('cancelled'); expect((engine as any).tasks.size).toBe(0);
    expect((engine as any).streamQuery).toHaveBeenCalledTimes(1);
  });
  it('取消控制收尾拒绝保留回执且任务不泄漏，不抢发ROLLBACK', async () => {
    vi.mocked((engine as any).streamQuery).mockImplementation(async (task: any) => {
      task.cancelled = true; task.cancelPending = Promise.reject(Error('原控制关闭失败')); void task.cancelPending.catch(() => undefined); throw Error('原语句中断');
    });
    const result = await run('SELECT SLEEP(30);');
    expect(result.sql).toMatchObject({ termination: 'cancelled', rollback: { state: 'unconfirmed' } }); expect(result.sql?.cleanupWarning).toBeTruthy();
    expect(driver.execute).not.toHaveBeenCalled(); expect((engine as any).tasks.size).toBe(0); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('文件读取错误不泄露路径，也不虚构执行失败编号', async () => {
    const result: FileImportResult = await engine.handle('files.import', { connectionId: profile.id, database: 'isolated', filePath: join(directory, '不存在且含私密标记.sql'), format: 'sql', encoding: 'utf8', taskId: 'missing', mapping: {} });
    sqlFileImportReceiptSchema.parse(result.sql);
    expect(result.sql?.failure).toMatchObject({ phase: 'read' }); expect(result.sql?.failure?.statement).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(directory); expect(JSON.stringify(result)).not.toContain('私密标记');
  });
  it('原命令ERR先到end后到，ROLLBACK必须等待真实end且丢弃部分CALL影响计数', async () => {
    vi.mocked((engine as any).streamQuery).mockRestore();
    let signal!: () => void, end!: () => void, ended = false;
    const errored = new Promise<void>(resolve => { signal = resolve; });
    Object.assign(managed.connection, { query: vi.fn(() => {
      const command = new EventEmitter();
      end = () => { ended = true; command.emit('end'); };
      queueMicrotask(() => {
        command.emit('result', { affectedRows: 7, insertId: 0, warningStatus: 0, serverStatus: 2 }, 0);
        command.emit('error', Object.assign(Error('例程后半段失败'), { code: 'ER_SIGNAL_EXCEPTION', errno: 1644, sqlState: '45000' })); signal();
      }); return command;
    }) });
    driver.execute.mockImplementation(async () => { expect(ended).toBe(true); managed.serverStatus = 2; managed.transactionStateKnown = true; return { rows: { affectedRows: 0, serverStatus: 2, warningStatus: 0 }, fields: [] }; });
    const pending = run('CALL p(); SELECT 2;'); await errored;
    expect(driver.execute).not.toHaveBeenCalled(); end(); const result = await pending;
    expect(result.sql).toMatchObject({ completedStatements: 0, serverReportedAffectedRows: 0, rollback: { state: 'confirmed' } });
    expect(managed.connection.query).toHaveBeenCalledTimes(1);
  });
  it('完整ACK后取消不抹掉已完成语句，不伪报下一语句执行失败', async () => {
    vi.mocked((engine as any).streamQuery).mockRestore();
    Object.assign(managed.connection, { query: vi.fn(() => {
      const command = new EventEmitter(); queueMicrotask(() => {
        managed.serverStatus = 2; managed.transactionStateKnown = true;
        command.emit('result', { affectedRows: 4, insertId: 0, warningStatus: 0, serverStatus: 2 }, 0);
        (engine as any).tasks.get('sql-file-task').cancelled = true; command.emit('end');
      }); return command;
    }) });
    const result = await run('INSERT INTO t VALUES (1); SELECT 2;');
    expect(result.sql).toMatchObject({ termination: 'cancelled', completedStatements: 1, serverReportedAffectedRows: 4, failure: { phase: 'finalize' } });
    expect(result.sql?.failure?.statement).toBeUndefined(); expect(events.at(-1)?.status).toBe('cancelled');
    expect(managed.connection.query).toHaveBeenCalledTimes(1);
  });
});
