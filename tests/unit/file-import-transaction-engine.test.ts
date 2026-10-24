import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import { fileImportTransactionMode, fileImportTransactionModeSchema } from '../../src/shared/fileImportTransaction';
const io = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), metadata: vi.fn(), close: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: io.connect, execute: io.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: io.metadata }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'transaction-offline', name: '离线', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'none', group: '', color: '#123456' };
const target = { connectionId: profile.id, database: '隔离库', table: '目标' };
let engine: Engine, folder: string, events: TaskEvent[], hook: ((event: TaskEvent) => void) | undefined;
type Response = { rows: any; fields: never[] };
let step: ((managed: ManagedConnection, sql: string, params: any[]) => Promise<Response | undefined> | Response | undefined) | undefined;
/** 替身只跨驱动边界；生产Engine、流式文件、类型转换和事务控制均真实执行。 */
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dbark-import-transaction-')); events = []; hook = undefined; step = undefined;
  io.close.mockReset().mockResolvedValue(undefined);
  io.connect.mockReset().mockImplementation(async () => {
    const connection = Object.assign(new EventEmitter(), { threadId: 42, destroy: vi.fn() });
    return { profile, connection, broken: false, sqlMode: '', serverStatus: 2, transactionStateKnown: true, status: { dialect: 'mysql', version: '8.4.0', connectionId: 42 }, close: io.close };
  });
  const info: TableInfo = { ...target, database: target.database, name: target.table, objectKind: 'table', engine: 'InnoDB', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '', defaultValue: null, comment: '' }, { name: 'amount', type: 'decimal(30,12)', nullable: true, generated: false, extra: '', defaultValue: null, comment: '' }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
  io.metadata.mockReset().mockResolvedValue(info);
  io.execute.mockReset().mockImplementation(async (managed: ManagedConnection, sql: string, params: any[] = []): Promise<Response> => {
    const overridden = await step?.(managed, sql, params); if (overridden) return overridden;
    if (sql === 'START TRANSACTION') managed.serverStatus = 3;
    if (sql === 'COMMIT' || sql === 'ROLLBACK') managed.serverStatus = 2;
    managed.transactionStateKnown = true;
    return { rows: sql.startsWith('SELECT 1 FROM') ? [] : sql.startsWith('SHOW WARNINGS') ? [{ Code: 1265 }] : { affectedRows: sql.startsWith('INSERT') ? 1 : 0, warningStatus: 0, serverStatus: managed.serverStatus }, fields: [] };
  });
  engine = new Engine(event => { events.push(event); hook?.(event); }); await engine.handle('connections.open', { id: profile.id, profile }); io.close.mockClear();
});
afterEach(async () => { hook = undefined; await engine.closeAll(); for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); });
/** CSV和JSON手写源文本，不调用产品导出器构造被测预期值。 */
async function input(count: number, format: 'csv' | 'json' = 'csv', invalidLast = false) {
  const rows = Array.from({ length: count }, (_, i) => [String(i + 1), invalidLast && i === count - 1 ? '不是数值' : '123456789012345678.123456789012']);
  const filePath = join(folder, 'source.' + format), content = format === 'csv' ? 'id,amount\n' + rows.map(row => row.join(',')).join('\n') : JSON.stringify(rows.map(([id, amount]) => ({ id, amount })));
  await writeFile(filePath, content); return { ...target, filePath, format, encoding: 'utf8', mapping: { id: 'id', amount: 'amount' }, taskId: '本例导入' };
}
function commands() { return io.execute.mock.calls.map(([, sql]) => sql as string); }
function inserts() { return io.execute.mock.calls.filter(([, sql]) => String(sql).startsWith('INSERT')); }

describe('文件导入事务模式严格规则', () => {
  it('枚举仅两项，省略=batch，非CSV/JSON显式携带和继承/访问器配置拒绝', () => {
    expect(fileImportTransactionMode('csv', {})).toBe('batch'); expect(fileImportTransactionMode('json', { transactionMode: 'atomic' })).toBe('atomic');
    for (const value of [undefined, null, '', 'auto', 1, true]) { expect(fileImportTransactionModeSchema.safeParse(value).success).toBe(false); expect(() => fileImportTransactionMode('csv', { transactionMode: value })).toThrow('事务模式'); }
    for (const format of ['sql', 'xlsx']) for (const value of [undefined, 'batch', 'atomic']) expect(() => fileImportTransactionMode(format, { transactionMode: value })).toThrow('事务模式');
    expect(() => fileImportTransactionMode('csv', Object.create({ transactionMode: 'atomic' }))).toThrow('事务模式');
    let reads = 0; const raw = {}; Object.defineProperty(raw, 'transactionMode', { enumerable: true, get() { reads++; return 'atomic'; } }); expect(() => fileImportTransactionMode('csv', raw)).toThrow(); expect(reads).toBe(0);
  });
  it('非法选项在建连、元数据、文件读取和事务前拒绝', async () => {
    io.connect.mockClear(); const raw = { ...target, filePath: join(folder, '不存在'), format: 'csv', encoding: 'utf8', taskId: '非法', mapping: {} };
    for (const transactionMode of [undefined, '无效', null]) await expect(engine.handle('files.import', { ...raw, transactionMode })).rejects.toThrow('事务模式');
    for (const format of ['sql', 'xlsx']) await expect(engine.handle('files.import', { ...raw, format, transactionMode: 'atomic' })).rejects.toThrow('事务模式');
    await expect(engine.handle('excel.import', { ...raw, transactionMode: 'atomic' })).rejects.toThrow('事务模式');
    expect(io.connect).not.toHaveBeenCalled(); expect(io.metadata).not.toHaveBeenCalled(); expect(io.execute).not.toHaveBeenCalled();
  });
});

describe('整文件原子事务真实Engine调度', () => {
  it.each(['csv', 'json'] as const)('%s的502行只有EOF后一次COMMIT，MDL在目录前、精度保持且500进度仅待提交', async format => {
    const result = await engine.handle('files.import', { ...await input(502, format), transactionMode: 'atomic' });
    expect(result).toEqual({ rows: 502, errors: [] }); expect(commands().filter(sql => sql === 'COMMIT')).toHaveLength(1); expect(commands().filter(sql => sql === 'START TRANSACTION')).toHaveLength(1);
    expect(commands().slice(0, 2)).toEqual(['START TRANSACTION', 'SELECT 1 FROM `隔离库`.`目标` LIMIT 0']); expect(commands().at(-1)).toBe('COMMIT'); expect(inserts()).toHaveLength(502);
    expect(inserts()[0][2]).toEqual(['1', '123456789012345678.123456789012']); expect(inserts()[501][2][0]).toBe('502');
    expect(io.metadata.mock.invocationCallOrder[0]).toBeGreaterThan(io.execute.mock.invocationCallOrder[1]);
    expect(events.find(event => event.message.includes('已写入 500 行'))).toMatchObject({ rows: 0, message: '已写入 500 行，整文件仍待提交；尚未确认任何行提交' }); expect(io.close).toHaveBeenCalledWith({ strict: true });
  });
  it.each([undefined, 'batch'] as const)('省略或batch=%j保持500行批次，502尾错只回滚当前1行', async transactionMode => {
    const result = await engine.handle('files.import', { ...await input(502, 'csv', true), ...(transactionMode ? { transactionMode } : {}) });
    expect(result.rows).toBe(500); expect(result.errors[0]).toContain('当前批 1 行已回滚'); expect(inserts()).toHaveLength(501);
    expect(commands().filter(sql => sql === 'COMMIT')).toHaveLength(1); expect(commands().filter(sql => sql === 'START TRANSACTION')).toHaveLength(2); expect(commands().at(-1)).toBe('ROLLBACK'); expect(io.close).toHaveBeenCalledWith();
  });
  it('旧batch COMMIT成功callback可省略状态字段，atomic不能借上一条缓存伪造INSERT事务位', async () => {
    step = (_managed, sql) => sql === 'COMMIT' ? { rows: { affectedRows: 0, warningStatus: 0 }, fields: [] } : undefined;
    expect(await engine.handle('files.import', await input(1))).toEqual({ rows: 1, errors: [] });
    step = (_managed, sql) => sql.startsWith('INSERT') ? { rows: { affectedRows: 1, warningStatus: 0 }, fields: [] } : undefined;
    const result = await engine.handle('files.import', { ...await input(1), taskId: '缺原包状态', transactionMode: 'atomic' });
    expect(result.rows).toBe(0); expect(result.errors[0]).toContain('不能宣称已回滚'); expect(commands().filter(sql => sql === 'COMMIT')).toHaveLength(1);
  });
  it.each(['csv', 'json'] as const)('%s流末类型错回滚完整501行，不提前提交或预读后丢首条', async format => {
    const result = await engine.handle('files.import', { ...await input(502, format, true), transactionMode: 'atomic' });
    expect(result.rows).toBe(0); expect(result.errors[0]).toContain('整文件目标表事务已确认回滚'); expect(inserts()).toHaveLength(501); expect(commands()).not.toContain('COMMIT'); expect(commands().at(-1)).toBe('ROLLBACK');
  });
  it('真实第500进度取消无需新控制连接或KILL，整文件回滚后才拒绝', async () => {
    let cancellation: Promise<any> | undefined; hook = event => { if (event.message.includes('已写入 500 行')) cancellation = engine.handle('query.cancel', { taskId: event.taskId }); };
    await expect(engine.handle('files.import', { ...await input(502), transactionMode: 'atomic' })).rejects.toThrow('整文件目标表事务已确认回滚'); await cancellation;
    expect(inserts()).toHaveLength(500); expect(commands()).not.toContain('COMMIT'); expect(commands().at(-1)).toBe('ROLLBACK'); expect(commands().some(sql => sql.startsWith('KILL'))).toBe(false); expect(io.connect).toHaveBeenCalledTimes(2); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it.each(['warning', 'database', 'parse'] as const)('%s失败只回滚不提交，警告仍先读取原诊断', async kind => {
    const raw = await input(3); if (kind === 'parse') await writeFile(raw.filePath, 'id,amount\n1,"未闭合');
    let count = 0; step = (_managed, sql) => { if (sql.startsWith('INSERT') && ++count === 2) { if (kind === 'database') throw Error('合成唯一冲突'); if (kind === 'warning') return { rows: { affectedRows: 1, warningStatus: 1, serverStatus: 3 }, fields: [] }; } };
    const result = await engine.handle('files.import', { ...raw, transactionMode: 'atomic' }); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('已确认回滚'); expect(commands()).not.toContain('COMMIT'); expect(commands().at(-1)).toBe('ROLLBACK');
    if (kind === 'warning') expect(commands().slice(-2)).toEqual(['SHOW WARNINGS LIMIT 32', 'ROLLBACK']);
  });
  it.each(['throw', 'missing', 'in-transaction'] as const)('COMMIT %s结果未知不补ROLLBACK，不自动重放', async kind => {
    step = (_managed, sql) => { if (sql === 'COMMIT') { if (kind === 'throw') throw Error('合成提交ACK丢失'); return { rows: { affectedRows: 0, warningStatus: 0, ...(kind === 'in-transaction' ? { serverStatus: 3 } : {}) }, fields: [] }; } };
    const result = await engine.handle('files.import', { ...await input(2), transactionMode: 'atomic' }); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('提交结果未确认'); expect(result.errors[0]).toContain('不能宣称已回滚'); expect(commands().filter(sql => sql === 'COMMIT')).toHaveLength(1); expect(commands()).not.toContain('ROLLBACK'); expect(inserts()).toHaveLength(2);
  });
  it.each(['throw', 'missing', 'still-open'] as const)('ROLLBACK %s没有完整ACK则保守报告未知', async kind => {
    step = (_managed, sql) => { if (sql === 'ROLLBACK') { if (kind === 'throw') throw Error('合成回滚失败'); return { rows: { warningStatus: 0, ...(kind === 'still-open' ? { serverStatus: 3 } : {}) }, fields: [] }; } };
    const result = await engine.handle('files.import', { ...await input(2, 'csv', true), transactionMode: 'atomic' }); expect(result.rows).toBe(0); expect(result.errors[0]).toContain('回滚结果未确认'); expect(result.errors[0]).not.toContain('整文件目标表事务已确认回滚'); expect(commands().filter(sql => sql === 'ROLLBACK')).toHaveLength(1);
  });
  it('MDL权限失败与事务连续性丢失不降级，也不发送后续INSERT', async () => {
    step = (_managed, sql) => { if (sql.startsWith('SELECT 1 FROM')) throw Error('拒绝SELECT'); return undefined; };
    let result = await engine.handle('files.import', { ...await input(1), transactionMode: 'atomic' }); expect(result.errors[0]).toContain('SELECT 权限'); expect(inserts()).toHaveLength(0);
    step = (managed, sql) => { if (sql.startsWith('INSERT')) { managed.serverStatus = 2; return { rows: { affectedRows: 1, warningStatus: 0, serverStatus: 2 }, fields: [] }; } };
    result = await engine.handle('files.import', { ...await input(2), taskId: '状态丢失', transactionMode: 'atomic' }); expect(result.errors[0]).toContain('不能宣称已回滚'); expect(inserts()).toHaveLength(1); expect(commands()).not.toContain('COMMIT');
  });
  it('COMMIT发送后取消不KILL，ACK后严格关闭失败仍保留已提交行数且不重放', async () => {
    step = async (_managed, sql) => { if (sql === 'COMMIT') await engine.handle('query.cancel', { taskId: '本例导入' }); return undefined; };
    io.close.mockRejectedValueOnce(Error('合成严格关闭失败'));
    const result = await engine.handle('files.import', { ...await input(2), transactionMode: 'atomic' }); expect(result.rows).toBe(2); expect(result.errors[0]).toContain('已确认导入提交'); expect(result.errors[0]).toContain('不要重复导入'); expect(commands().some(sql => sql.startsWith('KILL'))).toBe(false); expect(commands()).not.toContain('ROLLBACK');
  });
  it('取消控制连接收尾失败不会覆盖已提交500或伪称当前批已回滚', async () => {
    let insertsSeen = 0; step = async (_managed, sql) => { if (sql.startsWith('INSERT') && ++insertsSeen === 501) { io.close.mockRejectedValueOnce(Error('原取消控制关闭失败')); await engine.handle('query.cancel', { taskId: '本例导入' }).catch(() => undefined); throw Error('本例INSERT中断'); } if (sql === 'ROLLBACK') throw Error('本例回滚ACK丢失'); return undefined; };
    await expect(engine.handle('files.import', await input(502))).rejects.toThrow(/已确认提交 500 行.*回滚结果未确认.*取消控制收尾失败/u);
    expect(commands().filter(sql => sql === 'COMMIT')).toHaveLength(1); expect(commands().filter(sql => sql === 'ROLLBACK')).toHaveLength(1); expect(events.at(-1)?.message).toContain('已确认提交 500 行');
  });
});
