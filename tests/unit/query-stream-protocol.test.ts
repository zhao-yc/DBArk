import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mysql2';
import { consumeQueryFrames, queryExportFieldBytes, type QueryFrameConsumer } from '../../src/engine/queryStreamProtocol';
import type { ManagedConnection } from '../../src/engine/connection';
import { queryExportWireProtocol, type QueryExportFrame } from '../../src/shared/queryStreamExport';
import { validateCommand } from '../../src/shared/validation';

type Packet = [string, ...unknown[]];
/** 模拟驱动暂停后不再解析包、恢复可同步出包；不将此测试代替真实协议兼容验收。 */
function fixture(packets: Packet[]) {
  const connection = new EventEmitter() as EventEmitter & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
  const command = new EventEmitter(); let paused = false, pumping = false;
  const pending = [...packets];
  const pump = () => { if (pumping) return; pumping = true; try { while (!paused && pending.length) { const [event, ...args] = pending.shift()!; command.emit(event, ...args); } } finally { pumping = false; } };
  connection.pause = vi.fn(() => { paused = true; }); connection.resume = vi.fn(() => { paused = false; pump(); });
  const start = () => { queueMicrotask(pump); return command; };
  connection.query = vi.fn(start); connection.execute = vi.fn(start);
  const managed = { connection, broken: false } as unknown as ManagedConnection;
  const frames: QueryExportFrame[] = [], peaks: number[] = [];
  const consumer: QueryFrameConsumer = { statementOrdinal: 2, ordinals: { results: 0, rows: 0 }, checkCancelled: () => undefined, consume: async frame => { frames.push(frame); }, queuePeak: rows => peaks.push(rows), stop: vi.fn(async () => { pending.splice(0, pending.length, ['end']); }) };
  return { managed, command, connection, consumer, frames, peaks, pending };
}
const fields = (name: string, index: number, type = Types.VAR_STRING): Packet => ['fields', [{ name, columnType: type }], index];

describe('完整导出协议消费', () => {
  it('预处理参数只发送一次，真实命令结束释放登记且不会等待异步消费完成', async () => {
    const value=fixture([fields('x',0),['result',['中文'],0],['end']]);
    const ended=vi.fn();value.consumer.commandStarted=vi.fn(()=>ended);
    const consume=value.consumer.consume;
    value.consumer.consume=async frame=>{await consume(frame);if(frame.kind==='row'){value.command.emit('end');expect(ended).toHaveBeenCalledOnce();}};
    await consumeQueryFrames(value.managed,'SELECT ?','binary',value.consumer,['中文']);
    expect(value.connection.execute).toHaveBeenCalledExactlyOnceWith({sql:'SELECT ?',rowsAsArray:true},['中文']);
    expect(value.consumer.commandStarted).toHaveBeenCalledOnce();expect(ended).toHaveBeenCalledOnce();expect(value.connection.query).not.toHaveBeenCalled();
  });
  it('带参数不能回退文本协议，发送前拒绝且不登记命令',async()=>{
    const value=fixture([]);value.consumer.commandStarted=vi.fn(()=>vi.fn());
    await expect(consumeQueryFrames(value.managed,'SELECT ?','text',value.consumer,['x'])).rejects.toThrow('不能回退');
    expect(value.connection.query).not.toHaveBeenCalled();expect(value.connection.execute).not.toHaveBeenCalled();expect(value.consumer.commandStarted).not.toHaveBeenCalled();
  });
  it('驱动几何对象先有界计量，嵌套/Unicode逃逸/大字段不能绕过原始预算', () => {
    const geometry = { x: 1.1, y: 2.2, coordinates: [[0, 1], [3, 4]] };
    expect(queryExportFieldBytes(geometry)).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify(geometry)));
    expect(queryExportFieldBytes({ text: '\0\n"\\\ud800' })).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify({ text: '\0\n"\\\ud800' })));
    expect(() => queryExportFieldBytes({ coordinates: ['x'.repeat(8 * 1024 * 1024)] })).toThrow('8 MiB');
    const cycle: unknown[] = []; cycle.push(cycle); expect(() => queryExportFieldBytes(cycle)).toThrow('循环');
    expect(() => queryExportFieldBytes(undefined)).toThrow('不能无损');
  });
  it('慢写时暂停真实事件泵，旧结果行不借用新列，CALL无索引状态包独立', async () => {
    const fixtureValue = fixture([fields('first', 0), ['result', ['一'], 0], fields('second', 1), ['result', ['二'], 1], ['fields', undefined], ['result', { affectedRows: 0, insertId: 0, warningStatus: 0 }], ['end']]);
    const { consumer, frames, peaks, managed, pending } = fixtureValue;
    let release!: () => void, arrived!: () => void;
    const ready = new Promise<void>(resolve => { arrived = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
    consumer.consume = async frame => { frames.push(frame); if (frame.kind === 'row' && frame.resultOrdinal === 1) { arrived(); await blocked; } };
    const running = consumeQueryFrames(managed, 'CALL p()', 'binary', consumer);
    await ready;
    expect(frames.map(frame => frame.kind)).toEqual(['rows-start', 'row']);
    expect(pending[0]).toEqual(fields('second', 1));
    release(); await running;
    expect(frames.map(frame => [frame.kind, frame.resultOrdinal])).toEqual([['rows-start', 1], ['row', 1], ['rows-end', 1], ['rows-start', 2], ['row', 2], ['rows-end', 2], ['status', 3]]);
    expect(peaks).toEqual([1, 1]); expect(consumer.stop).not.toHaveBeenCalled();
    expect(fixtureValue.connection.query).not.toHaveBeenCalled(); expect(fixtureValue.connection.execute).toHaveBeenCalledTimes(1);
  });
  it.each([Types.FLOAT, Types.DOUBLE])('文本协议遇到浮点类型%i在字段边界拒绝，并收尾命令', async type => {
    const value = fixture([fields('f', 0, type), ['result', [1], 0], ['end']]);
    await expect(consumeQueryFrames(value.managed, 'SELECT f', 'text', value.consumer)).rejects.toThrow('FLOAT/DOUBLE');
    expect(value.consumer.stop).toHaveBeenCalledOnce(); expect(value.frames).toEqual([]);
  });
  it('原始巨型字段在Base64分配之前拒绝，结果超预算不会报告完整成功', async () => {
    const value = fixture([fields('blob', 0), ['result', [Buffer.alloc(8 * 1024 * 1024 + 1)], 0], ['end']]);
    await expect(consumeQueryFrames(value.managed, 'SELECT payload', 'binary', value.consumer)).rejects.toThrow('8 MiB');
    expect(value.frames.filter(frame => frame.kind === 'row')).toEqual([]);
    const many = fixture([fields('x', 0), ['end']]); many.consumer.ordinals.results = 200;
    await expect(consumeQueryFrames(many.managed, 'SELECT 1', 'text', many.consumer)).rejects.toThrow('200');
  });
  it('写入失败须等实际命令终包，不能提前释放协议监听器', async () => {
    const value = fixture([fields('x', 0), ['result', ['x'], 0], ['end']]);
    let stopping!: () => void; const requested = new Promise<void>(resolve => { stopping = resolve; });
    value.consumer.stop = vi.fn(async () => { value.pending.length = 0; stopping(); });
    value.consumer.consume = async () => { throw new Error('磁盘已满'); };
    let settled = false;
    const running = consumeQueryFrames(value.managed, 'SELECT x', 'text', value.consumer).finally(() => { settled = true; });
    const failed = expect(running).rejects.toThrow('磁盘已满');
    await requested; await Promise.resolve(); expect(settled).toBe(false);
    value.command.emit('end'); await failed;
    expect(value.managed.connection.listenerCount('error')).toBe(0);
  });
  it('不支持prepare只发送一次二进制命令，错误不会自动切换text重放', async () => {
    const error = Object.assign(new Error('不支持准备'), { code: 'ER_UNSUPPORTED_PS' });
    const value = fixture([['error', error], ['end']]);
    await expect(consumeQueryFrames(value.managed, 'UNSUPPORTED SQL', 'binary', value.consumer)).rejects.toThrow('不支持准备');
    expect(value.connection.execute).toHaveBeenCalledOnce(); expect(value.connection.query).not.toHaveBeenCalled();
  });
  it('SSH 仅发送连接 EOF 而无命令 error/end 时立即失败，不等待永远不会到达的终包', async () => {
    const value = fixture([]);
    const running = consumeQueryFrames(value.managed, 'SELECT SLEEP(30)', 'text', value.consumer);
    const failed = expect(running).rejects.toThrow('数据库连接已断开');
    value.connection.emit('end'); await failed;
    expect(value.managed.broken).toBe(true); expect(value.consumer.stop).not.toHaveBeenCalled();
    expect(value.connection.query).toHaveBeenCalledOnce(); expect(value.connection.execute).not.toHaveBeenCalled();
    expect(value.connection.listenerCount('end')).toBe(0); expect(value.connection.listenerCount('error')).toBe(0);
    expect(value.command.listenerCount('result')).toBe(0);
  });
  it('行EOF警告属于当前结果，协议边界先结束行集且不被下一结果覆盖', async () => {
    const value = fixture([fields('x', 0), ['result', ['x'], 0]]);
    const consume = value.consumer.consume;
    value.consumer.consume = async frame => {
      await consume(frame);
      if (frame.kind === 'row') { value.connection.emit('dbark:session-state', { warningStatus: 2, serverStatus: 2,sql:'SELECT x' }); value.command.emit('end'); }
    };
    await consumeQueryFrames(value.managed, 'SELECT x', 'text', value.consumer);
    expect(value.frames.at(-1)).toEqual({ kind: 'rows-end', resultOrdinal: 1, warningCount: 2 });
    expect(value.connection.listenerCount('dbark:session-state')).toBe(0);
  });
});

describe('完整导出IPC与协议预选', () => {
  const mode = { noBackslashEscapes: false, ansiQuotes: false };
  it.each(['SHOW WARNINGS', 'SELECT @@warning_count', 'SELECT @@error_count', 'SELECT ROW_COUNT()', 'SELECT FOUND_ROWS()', 'START TRANSACTION', 'ROLLBACK', 'GET DIAGNOSTICS @n=NUMBER', 'PREPARE p FROM @sql', 'EXECUTE p', 'DEALLOCATE PREPARE p'])('在发送前将%s选为text', sql => { expect(queryExportWireProtocol(sql, 'binary-explicit', mode)).toBe('text'); });
  it('词法跳过字符串和普通注释，版本注释与四候选歧义遵循共享规则', () => {
    expect(queryExportWireProtocol("SELECT 'SHOW WARNINGS', /* ROLLBACK */ 1", 'binary-explicit', mode)).toBe('binary');
    expect(queryExportWireProtocol('/*!50000 SHOW WARNINGS */', 'binary-explicit', mode)).toBe('text');
    expect(() => queryExportWireProtocol("SELECT 'a\\', :ghost -- '\n", 'binary-explicit', { ...mode, noBackslashEscapesKnown: false })).toThrow('歧义');
  });
  it('JSON和CSV容器全部或单CSV指定行结果，禁止外部路径与结果数组夹带', () => {
    const input = { sessionId: 's', taskId: 't', sql: 'SELECT 1', fileToken: 'f', format: 'json', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } };
    expect(validateCommand('query.exportStream', input)).toEqual(input);
    expect(validateCommand('query.exportStream', { ...input, format: 'csv-zip' })).toEqual({ ...input, format: 'csv-zip' });
    expect(() => validateCommand('query.exportStream', { ...input, format: 'csv-zip', resultSelection: { kind: 'row-result', ordinal: 1 } })).toThrow('全部');
    expect(() => validateCommand('query.exportStream', { ...input, filePath: 'x' })).toThrow();
    expect(() => validateCommand('query.exportStream', { ...input, format: 'csv' })).toThrow('指定');
    expect(() => validateCommand('query.exportStream', { ...input, resultSelection: { kind: 'row-result', ordinal: 1 } })).toThrow('全部');
    expect(() => validateCommand('query.exportStream', { ...input, parameters: [{ name: 'x', type: 'integer', value: '1;DROP' }] })).toThrow();
  });
});
