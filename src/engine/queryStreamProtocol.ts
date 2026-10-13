import { Types, type FieldPacket, type ResultSetHeader } from 'mysql2';
import type { ManagedConnection } from './connection';
import { serializeCell } from './sql';
import { resultExportColumns } from '../shared/resultExport';
import { queryStreamExportLimits as limits, type QueryExportFrame } from '../shared/queryStreamExport';

export interface QueryFrameOrdinals { results: number; rows: number; }
export interface QueryFrameConsumer {
  statementOrdinal: number; ordinals: QueryFrameOrdinals;
  consume(frame: QueryExportFrame): Promise<void>;
  checkCancelled(): void;
  stop(): Promise<void>;
  queuePeak?(rows: number, bytes: number): void;
}

/** 几何类型可能由驱动返回嵌套对象；先有界计量，不能等 JSON.stringify 大分配后才检查。 */
export function queryExportFieldBytes(value: unknown): number {
  // 常见标量走零遍历快路，百万行场景不为每个数字或字符串创建对象遍历状态。
  const scalar = Buffer.isBuffer(value) ? value.length : typeof value === 'string' ? Buffer.byteLength(value) : value === null ? 4 : ['number', 'boolean', 'bigint'].includes(typeof value) ? String(value).length : undefined;
  if (scalar !== undefined) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('导出遇到非有限数值，不能无损写入文件');
    if (scalar > limits.fieldBytes) throw new Error('单个原始导出字段不能超过 8 MiB');
    return scalar;
  }
  let bytes = 0, nodes = 0;
  const seen = new Set<object>();
  const add = (size: number) => { bytes += size; if (bytes > limits.fieldBytes) throw new Error('单个原始导出字段不能超过 8 MiB'); };
  const stringBytes = (text: string, json: boolean) => {
    add(Buffer.byteLength(text) + (json ? 2 : 0));
    if (json) for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92) add(1);
      else if (code < 32) add([8, 9, 10, 12, 13].includes(code) ? 1 : 5);
      else if ((code >= 0xd800 && code <= 0xdbff && !(text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff)) || (code >= 0xdc00 && code <= 0xdfff && !(text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff))) add(3);
    }
  };
  const visit = (cell: unknown, depth: number): void => {
    if (++nodes > 524288 || depth > 64) throw new Error('导出嵌套字段结构超过有界预算');
    if (typeof cell === 'string') { stringBytes(cell, depth > 0); return; }
    if (cell === null) { add(4); return; }
    if (typeof cell === 'number') { if (!Number.isFinite(cell)) throw new Error('导出遇到非有限数值，不能无损写入文件'); add(String(cell).length); return; }
    if (typeof cell === 'boolean' || typeof cell === 'bigint') { add(String(cell).length); return; }
    if (Buffer.isBuffer(cell)) { add(cell.length); return; }
    if (!cell || typeof cell !== 'object' || cell instanceof Date) throw new Error('驱动返回了不能无损序列化的字段类型');
    if (seen.has(cell)) throw new Error('驱动返回了循环字段结构');
    seen.add(cell); add(2);
    if (Array.isArray(cell)) { for (const item of cell) { add(1); visit(item, depth + 1); } }
    else { for (const key in cell) if (Object.hasOwn(cell, key)) { stringBytes(key, true); add(2); visit((cell as Record<string, unknown>)[key], depth + 1); } }
    seen.delete(cell);
  };
  visit(value, 0); return bytes;
}

/** 一次发送、一帧背压；停止消费时先结束实际命令，再交还同一会话，绝不自动重放。 */
export async function consumeQueryFrames(managed: ManagedConnection, sql: string, wire: 'text' | 'binary', consumer: QueryFrameConsumer): Promise<void> {
  consumer.checkCancelled();
  const connection = managed.connection;
  const queue: { frame: QueryExportFrame; bytes: number }[] = [];
  let bufferedRows = 0, bufferedBytes = 0;
  let wake: (() => void) | undefined, ended = false, failure: unknown, stopping = false;
  let active: { index: number; ordinal: number; columns: number } | undefined;
  let implicit = 0;
  let terminal!: () => void;
  const terminalPromise = new Promise<void>(resolve => { terminal = resolve; });
  const signal = () => { wake?.(); wake = undefined; };
  const finish = () => { ended = true; terminal(); signal(); };
  const fail = (error: unknown) => { failure ??= error; signal(); };
  /** 每一行都暂停驱动，队列最多一个数据行（大行独立受限）及边界帧，不积压旧列定义。 */
  const push = (frame: QueryExportFrame, bytes = 0) => {
    if (!stopping) {
      queue.push({ frame, bytes });
      if (frame.kind === 'row') { bufferedRows++; bufferedBytes += bytes; consumer.queuePeak?.(bufferedRows, bufferedBytes); }
      connection.pause(); signal();
    }
  };
  const closeRows = (warningCount?: number) => { if (active) { push({ kind: 'rows-end', resultOrdinal: active.ordinal, ...(warningCount !== undefined ? { warningCount } : {}) }); active = undefined; } };
  const ordinal = () => {
    if (consumer.ordinals.results >= limits.results) throw new Error('完整导出结果数量不能超过 200（包含状态结果）');
    return ++consumer.ordinals.results;
  };
  const onFields = (fields: FieldPacket[] | undefined, index?: number) => {
    if (stopping || !fields) return;
    try {
      closeRows();
      if (fields.length > limits.columns) throw new Error('单个导出结果不能超过 1024 列');
      if (wire === 'text' && fields.some(field => field.columnType === Types.FLOAT || field.columnType === Types.DOUBLE)) throw new Error('文本严格模式遇到 FLOAT/DOUBLE，不能保证完整浮点精度；SQL 可能已执行，请核对后明确选择二进制模式重新执行');
      const resultOrdinal = ordinal();
      const resultIndex = index ?? implicit; implicit = resultIndex + 1;
      const columns = resultExportColumns(fields.map((field, position) => ({ key: `c${position}`, name: field.name })));
      const types = Types as unknown as Record<number, string>;
      active = { index: resultIndex, ordinal: resultOrdinal, columns: fields.length };
      push({ kind: 'rows-start', resultOrdinal, statementOrdinal: consumer.statementOrdinal, rowResultOrdinal: ++consumer.ordinals.rows, columns: columns.map((column, position) => ({ ...column, position: position + 1, type: String(types[fields[position].columnType ?? -1] ?? fields[position].columnType ?? '未知') })) });
    } catch (error) { connection.pause(); fail(error); }
  };
  const onResult = (value: unknown[] | ResultSetHeader, index?: number) => {
    if (stopping) return;
    try {
      if (!Array.isArray(value)) {
        closeRows(); implicit = (index ?? implicit) + 1;
        push({ kind: 'status', resultOrdinal: ordinal(), statementOrdinal: consumer.statementOrdinal, affectedRows: value.affectedRows, insertId: String(value.insertId), warningCount: value.warningStatus });
        return;
      }
      if (!active || (index !== undefined && index !== active.index) || value.length !== active.columns) throw new Error('结果行与协议列定义不一致，已停止完整导出');
      let rowBytes = 0;
      for (const cell of value) {
        const bytes = queryExportFieldBytes(cell);
        rowBytes += Buffer.isBuffer(cell) ? Math.ceil(bytes / 3) * 4 + 32 : bytes;
        if (rowBytes > limits.rowBytes) throw new Error('单个原始导出行不能超过 16 MiB');
      }
      push({ kind: 'row', resultOrdinal: active.ordinal, values: value.map(serializeCell) }, rowBytes);
    } catch (error) { connection.pause(); fail(error); }
  };
  const onConnectionError = (error: unknown) => { fail(error); finish(); };
  /** SSH 通道可能只有可读端 EOF，驱动不会再发命令终包或 error；物理断线也必须唤醒消费者。 */
  const onConnectionEnd = () => {
    managed.broken = true;
    if (!ended) fail(new Error('数据库连接已断开，完整导出未完成；未自动重连或重放 SQL'));
    finish();
  };
  /** 现有补丁的行 EOF 不带 sql 字段；在原始协议边界结束当前行集并保留警告数。 */
  const onSessionState = (packet: { sql?: string; warningStatus?: number }) => {
    if (!stopping && packet.sql === undefined && active) closeRows(packet.warningStatus);
  };
  connection.on('error', onConnectionError);
  connection.on('end', onConnectionEnd);
  connection.on('dbark:session-state', onSessionState);
  let command: ReturnType<typeof connection.query> | undefined;
  try {
    // 协议策略在发送前已确定；不使用 ER_UNSUPPORTED_PS 触发文本回退。
    command = wire === 'binary' ? connection.execute({ sql, rowsAsArray: true }) : connection.query({ sql, rowsAsArray: true });
    command.on('fields', onFields).on('result', onResult).on('error', fail).once('end', () => { if (!stopping && !failure) closeRows(); finish(); });
    for (;;) {
      consumer.checkCancelled();
      if (failure) throw failure;
      const entry = queue.shift();
      if (entry) {
        try { await consumer.consume(entry.frame); }
        finally { if (entry.frame.kind === 'row') { bufferedRows--; bufferedBytes -= entry.bytes; } }
        continue;
      }
      if (ended) break;
      // resume 可同步解析之前已接收的包，必须先登记唤醒者，避免遗漏边界事件。
      await new Promise<void>(resolve => { wake = resolve; connection.resume(); if (queue.length || ended || failure) signal(); });
    }
  } catch (error) {
    stopping = true; queue.length = 0;
    // 文件失败与用户取消均须消费终包；丢弃后续行但保留真实服务器事务/模式事件。
    const stop = ended || !command ? Promise.resolve() : consumer.stop();
    connection.resume();
    await stop;
    if (command && !managed.broken) await terminalPromise;
    throw error;
  } finally {
    connection.resume();
    connection.removeListener('error', onConnectionError);
    connection.removeListener('end', onConnectionEnd);
    connection.removeListener('dbark:session-state', onSessionState);
    command?.removeListener('fields', onFields); command?.removeListener('result', onResult); command?.removeListener('error', fail);
  }
}
