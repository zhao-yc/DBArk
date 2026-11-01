import { describe, expect, it, vi } from 'vitest';
import { SqliteRawFrameDecoder, consumeSqliteRawFrames, SqliteRawFrameError } from '../../src/engine/sqlite/rawFrames';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';

/** 构造独立协议样本，损坏长度和序号不经过产品编码器。 */
function u32(value: number) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function frame(sequence: bigint | number, ...data: Uint8Array[]) { const header = Buffer.alloc(12); header.write('DBF1'); header.writeBigUInt64LE(BigInt(sequence), 4); return Buffer.concat([header, ...data]); }
const row = (columns: number) => Buffer.concat([Buffer.from([0x10]), u32(columns)]);
const cell = (type: number, encoding: number, bytes: Uint8Array) => Buffer.concat([Buffer.from([0x11, type, encoding]), u32(bytes.length), bytes]);
const done = Buffer.from([0x13]), end = Buffer.from([0x12]);
const failure = (code: number) => Buffer.concat([Buffer.from([0x14]), u32(code)]);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('SQLite有界原字节帧解析与消费者确认', () => {
  it.each([1, 2, 3])('编码%s的BOM/NUL/Unicode/真实替代字符跨一字节帧仍只解码原值', encoding => {
    const text = '\uFEFF前\0🚢\uFFFD后', bytes = Buffer.from(text, encoding === 1 ? 'utf8' : 'utf16le'); if (encoding === 3) bytes.swap16();
    const decoder = new SqliteRawFrameDecoder(), header = Buffer.concat([row(1), Buffer.from([0x11, 3, encoding]), u32(bytes.length)]);
    const events = decoder.accept(frame(1, header, bytes.subarray(0, 1))).events;
    for (let index = 1; index < bytes.length; index++) events.push(...decoder.accept(frame(index + 1, bytes.subarray(index, index + 1))).events);
    events.push(...decoder.accept(frame(bytes.length + 1, end, done)).events);
    expect(events).toEqual([{ kind: 'row', columns: 1 }, { kind: 'value', column: 0, value: text }, { kind: 'rowEnd' }, { kind: 'done' }]);
  });
  it('列按位置保留，空BLOB/空TEXT/NULL不混淆，非零byteOffset可读', () => {
    const packet = frame(1, row(3), cell(4, 0, Buffer.alloc(0)), cell(3, 1, Buffer.alloc(0)), cell(5, 0, Buffer.alloc(0)), end, done);
    const data = Buffer.concat([Buffer.alloc(7), packet, Buffer.alloc(2)]).subarray(7, 7 + packet.length);
    expect(new SqliteRawFrameDecoder().accept(data).events).toEqual([{ kind: 'row', columns: 3 }, { kind: 'value', column: 0, value: { type: 'binary', base64: '' } }, { kind: 'value', column: 1, value: '' }, { kind: 'value', column: 2, value: null }, { kind: 'rowEnd' }, { kind: 'done' }]);
  });
  it.each([0n, 2n, 9007199254740992n])('拒绝首帧错误序号%s', sequence => { expect(() => new SqliteRawFrameDecoder().accept(frame(sequence, done))).toThrow(SqliteRawFrameError); });
  it('拒绝重放、跳帧及终态后的数据，不把旧帧落到新行', () => {
    for (const sequence of [1, 3]) { const decoder = new SqliteRawFrameDecoder(); decoder.accept(frame(1, row(1))); expect(() => decoder.accept(frame(sequence, end))).toThrow(SqliteRawFrameError); }
    const decoder = new SqliteRawFrameDecoder(); decoder.accept(frame(1, done)); expect(() => decoder.accept(frame(2, done))).toThrow(SqliteRawFrameError);
  });
  it('坏长度/类型/编码/行边界明确拒绝，失败后原错误保持', () => {
    const oversized = Buffer.concat([Buffer.from([0x11, 3, 1]), u32(sqliteDriverLimits.valueBytes + 1)]);
    for (const body of [Buffer.from([0x99]), row(0), row(1025), Buffer.from([0x10, 1]), Buffer.concat([row(1), oversized]), Buffer.concat([row(1), cell(0, 0, Buffer.alloc(0))]), Buffer.concat([row(1), cell(5, 1, Buffer.alloc(0))]), Buffer.concat([row(1), cell(1, 0, Buffer.alloc(7))]), Buffer.concat([row(1), end]), Buffer.concat([row(1), done]), Buffer.concat([done, done])]) {
      const decoder = new SqliteRawFrameDecoder(); let original: unknown;
      try { decoder.accept(frame(1, body)); } catch (error) { original = error; }
      expect(original).toBeInstanceOf(SqliteRawFrameError); expect(() => decoder.accept(frame(2, done))).toThrow(original as Error);
    }
  });
  it('原TEXT坏字节不变成值事件，部分行不伪造成完整行', () => {
    const decoder = new SqliteRawFrameDecoder(); expect(() => decoder.accept(frame(1, row(1), cell(3, 1, Buffer.from([0x80]))))).toThrowError(expect.objectContaining({ code: 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' }));
    const native = new SqliteRawFrameDecoder().accept(frame(1, row(1), failure(0x7fff0001)));
    expect(native.terminal).toBe(true); expect(native.events).toEqual([{ kind: 'row', columns: 1 }, { kind: 'error', code: 0x7fff0001 }]);
  });
  it('等待第一帧消费者确认时不读取第二帧', async () => {
    const reached = deferred(), ack = deferred(), readFrame = vi.fn().mockReturnValueOnce(frame(1, row(1), cell(5, 0, Buffer.alloc(0)), end)).mockReturnValueOnce(frame(2, done));
    const onFrame = vi.fn(async () => { if (onFrame.mock.calls.length === 1) { reached.resolve(); await ack.promise; } });
    const reading = consumeSqliteRawFrames({ readFrame }, { check: () => {}, onFrame });
    await reached.promise; await new Promise<void>(resolve => setImmediate(resolve)); expect(readFrame).toHaveBeenCalledTimes(1); ack.resolve(); await reading;
    expect(readFrame).toHaveBeenCalledTimes(2); expect(onFrame).toHaveBeenCalledTimes(2);
  });
  it.each(['before', 'ack'] as const)('%s取消不推进下一帧，不自动重放或收尾别人的来源', async phase => {
    const reached = deferred(), ack = deferred(), cancelled = Error('准确任务已取消'); let cancel = phase === 'before';
    const readFrame = vi.fn(() => frame(1, row(1))), reading = consumeSqliteRawFrames({ readFrame }, { check: () => { if (cancel) throw cancelled; }, onFrame: async () => { reached.resolve(); await ack.promise; } });
    const result = reading.catch(error => error);
    if (phase === 'ack') { await reached.promise; cancel = true; ack.resolve(); }
    expect(await result).toBe(cancelled); expect(readFrame).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  });
  it.each([1555, 0x7fff0001, 0x7fff0002])('原生失败%s只发送一帧，确认后保持错误类别', async code => {
    const readFrame = vi.fn(() => frame(1, failure(code))), onFrame = vi.fn();
    await expect(consumeSqliteRawFrames({ readFrame }, { check: () => {}, onFrame })).rejects.toMatchObject(code === 1555 ? { errcode: 1555 } : { code: code === 0x7fff0001 ? 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' : 'SQLITE_RAW_VALUE_INVALID' });
    expect(readFrame).toHaveBeenCalledTimes(1); expect(onFrame).toHaveBeenCalledTimes(1);
  });
  it('原生失败与消费者拒绝同时保留，不能覆盖准确错误码', async () => {
    const ack = Error('消费者拒绝'), readFrame = vi.fn(() => frame(1, failure(1555)));
    try { await consumeSqliteRawFrames({ readFrame }, { check: () => {}, onFrame: () => { throw ack; } }); throw Error('应拒绝'); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors[0]).toMatchObject({ errcode: 1555 }); expect((error as AggregateError).errors[1]).toBe(ack); }
    expect(readFrame).toHaveBeenCalledTimes(1);
  });
  it('非法批次预算在调用来源前拒绝', async () => {
    for (const budget of [{ rows: 0 }, { rows: 201 }, { bytes: 63 }, { bytes: sqliteDriverLimits.valueBytes + 1 }]) {
      const readFrame = vi.fn(); await expect(consumeSqliteRawFrames({ readFrame }, { ...budget, check: () => {}, onFrame: () => {} })).rejects.toBeInstanceOf(SqliteRawFrameError); expect(readFrame).not.toHaveBeenCalled();
    }
  });
  it('显式放弃未完成单值后不能恢复旧半行', () => {
    const decoder = new SqliteRawFrameDecoder();
    decoder.accept(frame(1, row(1), Buffer.from([0x11, 4, 0]), u32(sqliteDriverLimits.valueBytes), Buffer.from([0])));
    decoder.dispose(); expect(() => decoder.accept(frame(2, Buffer.from([0])))).toThrow(SqliteRawFrameError);
  });
  it('消费者修改回包不能覆盖已观察的原生错误码或成功终态', async () => {
    const success = vi.fn(() => frame(1, done));
    await consumeSqliteRawFrames({ readFrame: success }, { check: () => {}, onFrame: result => { result.terminal = false; result.events.length = 0; } });
    expect(success).toHaveBeenCalledTimes(1);
    const error = vi.fn(() => frame(1, failure(1555)));
    await expect(consumeSqliteRawFrames({ readFrame: error }, { check: () => {}, onFrame: result => { for (const event of result.events) if (event.kind === 'error') event.code = 1; result.events.length = 0; result.terminal = false; } })).rejects.toMatchObject({ errcode: 1555 });
    expect(error).toHaveBeenCalledTimes(1);
  });
});
