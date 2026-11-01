import { sqliteDriverLimits as limits, type SqliteValue } from './protocol';
import { decodeSqliteRawValue, SqliteRawValueError } from './rawValue';

export type SqliteRawFrameEvent =
  | { kind: 'row'; columns: number }
  | { kind: 'value'; column: number; value: SqliteValue }
  | { kind: 'rowEnd' }
  | { kind: 'done' }
  | { kind: 'error'; code: number };
export interface SqliteRawDecodedFrame { sequence: number; events: SqliteRawFrameEvent[]; terminal: boolean; }
export class SqliteRawFrameError extends Error {
  /** 仅保留错误码，原SQL、值和路径不进入错误正文。 */
  constructor(readonly errcode?: number) { super(errcode === undefined ? 'SQLite原字节批次协议或生命周期无效' : 'SQLite原生语句执行失败，未自动回滚或重放'); }
}
const invalid = () => new SqliteRawFrameError();

/** 校验后仅保留一个跨帧单值；不累计全结果或整行，预算由上层任务持续核对。 */
export class SqliteRawFrameDecoder {
  private sequence = 0;
  private ended = false;
  private failed = false;
  private failure: unknown;
  private columns: number | undefined;
  private column = 0;
  private value?: { type: number; encoding: number; bytes: Uint8Array; offset: number };

  /** 原子头部+可分段载荷；序号、列数、类型、编码、长度和终态均独立复核。 */
  accept(frame: Uint8Array): SqliteRawDecodedFrame {
    if (this.failed) throw this.failure; if (this.ended) throw invalid();
    try {
      if (!(frame instanceof Uint8Array) || frame.length < 13 || frame.length > limits.valueBytes || frame[0] !== 68 || frame[1] !== 66 || frame[2] !== 70 || frame[3] !== 49) throw invalid();
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength), rawSequence = view.getBigUint64(4, true);
      if (rawSequence > BigInt(Number.MAX_SAFE_INTEGER) || rawSequence !== BigInt(this.sequence + 1)) throw invalid();
      this.sequence = Number(rawSequence); const events: SqliteRawFrameEvent[] = []; let offset = 12;
      const u32 = () => { if (offset + 4 > frame.length) throw invalid(); const value = view.getUint32(offset, true); offset += 4; return value; };
      const completeValue = () => {
        const value = this.value!; events.push({ kind: 'value', column: this.column++, value: decodeSqliteRawValue(value) }); this.value = undefined;
      };
      while (offset < frame.length) {
        if (this.value) {
          const count = Math.min(this.value.bytes.length - this.value.offset, frame.length - offset);
          this.value.bytes.set(frame.subarray(offset, offset + count), this.value.offset); this.value.offset += count; offset += count;
          if (this.value.offset === this.value.bytes.length) completeValue();
          continue;
        }
        const kind = frame[offset++];
        if (kind === 0x10) {
          if (this.columns !== undefined) throw invalid(); const columns = u32();
          if (columns < 1 || columns > limits.columns) throw invalid(); this.columns = columns; this.column = 0; events.push({ kind: 'row', columns });
        } else if (kind === 0x11) {
          if (this.columns === undefined || this.column >= this.columns || offset + 6 > frame.length) throw invalid();
          const type = frame[offset++], encoding = frame[offset++], length = u32();
          if (length > limits.valueBytes || type < 1 || type > 5 || (type === 3 ? encoding < 1 || encoding > 3 : encoding !== 0) || (type === 1 || type === 2) && length !== 8 || type === 5 && length !== 0) throw invalid();
          this.value = { type, encoding, bytes: new Uint8Array(length), offset: 0 }; if (!length) completeValue();
        } else if (kind === 0x12) {
          if (this.columns === undefined || this.column !== this.columns) throw invalid(); this.columns = undefined; this.column = 0; events.push({ kind: 'rowEnd' });
        } else if (kind === 0x13 || kind === 0x14) {
          if (kind === 0x13 && this.columns !== undefined) throw invalid();
          if (kind === 0x14) { const code = u32(); if (!code || code > 2147483647) throw invalid(); events.push({ kind: 'error', code }); }
          else events.push({ kind: 'done' });
          if (offset !== frame.length) throw invalid(); this.ended = true; this.columns = undefined; this.value = undefined;
        } else throw invalid();
      }
      return { sequence: this.sequence, events, terminal: this.ended };
    } catch (error) { this.failed = true; this.failure = error; this.value = undefined; throw error; }
  }

  /** 取消或确认失败时立即放弃未完成单值，不依赖后续读取或GC完成逻辑收尾。 */
  dispose(): void { this.value = undefined; this.columns = undefined; this.ended = true; }
}

/** 将原生固定文本／单值失败还原成已有错误，不把它们伪装成成功完成。 */
function terminalError(code: number): Error {
  if (code === 0x7fff0001) return new SqliteRawValueError('SQLITE_TEXT_ENCODING_UNREPRESENTABLE');
  if (code === 0x7fff0002) return new SqliteRawValueError('SQLITE_RAW_VALUE_INVALID');
  return new SqliteRawFrameError(code);
}

/** 每帧等待消费者确认；取消检查覆盖读取前和ACK后，原生进程强取消仍由会话持有者管理。 */
export async function consumeSqliteRawFrames(source: { readFrame(rows: number, bytes: number): Uint8Array }, options: {
  rows?: number; bytes?: number; check(): void; onFrame(frame: SqliteRawDecodedFrame): Promise<void> | void;
}): Promise<void> {
  const rows = options.rows ?? 200, bytes = options.bytes ?? 65536;
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > 200 || !Number.isSafeInteger(bytes) || bytes < 64 || bytes > limits.valueBytes) throw invalid();
  const decoder = new SqliteRawFrameDecoder();
  try { while (true) {
    options.check(); const frame = decoder.accept(source.readFrame(rows, bytes));
    // 回调只确认消费，不能通过修改事件对象覆盖已观察的原生失败或终态。
    const failure = frame.events.find(event => event.kind === 'error');
    const failureCode = failure?.kind === 'error' ? failure.code : undefined, terminal = frame.terminal;
    try { await options.onFrame(frame); }
    catch (error) { if (failureCode !== undefined) throw new AggregateError([terminalError(failureCode), error], 'SQLite原生失败及消费者确认失败均保留'); throw error; }
    if (failureCode !== undefined) throw terminalError(failureCode);
    options.check(); if (terminal) return;
    // 即使消费者同步确认，仍让出循环以消费取消消息；不能靠连续同步帧饿死父端。
    await new Promise<void>(resolve => setImmediate(resolve));
  } } finally { decoder.dispose(); }
}
