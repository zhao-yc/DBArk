import { closeSync, fstatSync, openSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants, DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { sqliteDriverLimits as limits, sqliteExportTextFunction, type SqliteColumn, type SqliteExecutionOptions, type SqliteOpenOptions, type SqliteStatementResult, type SqliteValue, type SqliteWorkerRequest, type SqliteWorkerResponse } from './protocol';

interface Port { send(message: SqliteWorkerResponse): void; exit(code: number): void; }
interface Execution { id: string; cancelled: boolean; fault?: DriverFailure; waiting?: { frame: number; resolve(): void }; results: SqliteStatementResult[]; bytes: number; }
class DriverFailure extends Error { constructor(readonly code: string, message: string) { super(message); } }
const invalid = () => new DriverFailure('SQLITE_INVALID_REQUEST', 'SQLite请求格式、预算或生命周期无效');
const cancelled = () => new DriverFailure('SQLITE_CANCELLED', 'SQLite任务已请求取消');
const validUnicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const unicode = (value: string) => !value.includes('\0') && validUnicode(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && unicode(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** PRAGMA可能在prepare阶段执行；首版只放行明确只读项，不能等结果header后再确认副作用。 */
function readablePragma(first: string | null, second: string | null): boolean {
  const name = first?.toLowerCase();
  if (!name) return false;
  if (['table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list', 'integrity_check', 'quick_check', 'foreign_key_check'].includes(name)) return true;
  // FTS5读取正文会在内部读取data_version；只允许无赋值形式，不扩大任何写授权。
  return second === null && ['database_list', 'table_list', 'compile_options', 'foreign_keys', 'query_only', 'schema_version', 'data_version', 'user_version', 'page_count', 'page_size', 'freelist_count', 'encoding', 'journal_mode'].includes(name);
}

/** 仅跳过SQLite明确的空白、分号和注释；语句边界始终由原生prepare/sourceSQL决定。 */
function skipTrivia(sql: string, offset = 0): number {
  while (offset < sql.length) {
    if (/[ \t\r\n\v\f;]/.test(sql[offset])) { offset++; continue; }
    if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset + 2); offset = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', offset)) { const end = sql.indexOf('*/', offset + 2); offset = end < 0 ? sql.length : end + 2; continue; }
    break;
  }
  return offset;
}

/** 输入值不经JSON转换数值；INTEGER限制为SQLite真实有符号64位范围。 */
function parameter(value: unknown): SQLInputValue {
  if (value === null) return null;
  if (typeof value === 'string') { if (!validUnicode(value) || Buffer.byteLength(value) > limits.valueBytes) throw invalid(); return value; }
  if (!object(value)) throw invalid();
  if (value.type === 'integer' && typeof value.value === 'string' && /^-?(?:0|[1-9]\d{0,18})$/.test(value.value)) {
    const parsed = BigInt(value.value); if (parsed < -9223372036854775808n || parsed > 9223372036854775807n || parsed.toString() !== value.value) throw invalid(); return parsed;
  }
  if (value.type === 'real' && typeof value.value === 'string' && value.value.length <= 64 && (['-0', 'Infinity', '-Infinity'].includes(value.value) || /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.value))) {
    const parsed = Number(value.value); if (Number.isNaN(parsed) || !Number.isFinite(parsed) && !['Infinity', '-Infinity'].includes(value.value)) throw invalid(); return parsed;
  }
  if (value.type === 'binary' && typeof value.base64 === 'string' && value.base64.length <= Math.ceil(limits.valueBytes / 3) * 4) {
    const bytes = Buffer.from(value.base64, 'base64'); if (bytes.length > limits.valueBytes || bytes.toString('base64') !== value.base64) throw invalid(); return bytes;
  }
  throw invalid();
}

/** 按运行时存储值编码，不根据列亲和性猜测TEXT、INTEGER、REAL或BLOB。 */
function cell(value: unknown): SqliteValue {
  if (value === null) return null;
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (typeof value === 'number' && !Number.isNaN(value)) return { type: 'real', value: Object.is(value, -0) ? '-0' : String(value) };
  if (typeof value === 'string' && Buffer.byteLength(value) <= limits.valueBytes) return value;
  if (value instanceof Uint8Array && value.byteLength <= limits.valueBytes) return { type: 'binary', base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  throw new DriverFailure('SQLITE_VALUE_INVALID', 'SQLite返回值类型或字段大小超出允许范围');
}

/** 一个对象只管理一个物理SQLite会话；普通消息取消和原生执行终态分开确认。 */
export class SqliteWorkerCore {
  private db?: DatabaseSync;
  private active?: Execution;
  private frame = 0;
  private closing = false;
  private closingId?: string;
  private readOnly = false;
  constructor(private readonly port: Port) {}

  /** ACK和取消在消息栈内同步生效，不能排在正在等待ACK的SQL后面。 */
  receive(raw: unknown): void {
    if (!object(raw)) { this.failure('', invalid()); return; }
    const id = identifier(raw.id) ? raw.id : '';
    if (!id || typeof raw.kind !== 'string') { this.failure(id, invalid()); return; }
    const request = raw as unknown as SqliteWorkerRequest;
    if (request.kind === 'closeAck') { if (this.closing && request.id === this.closingId) this.port.exit(0); return; }
    if (request.kind === 'ack') {
      const active = this.active; if (!active || active.id !== request.id || !active.waiting) return;
      if (request.frame !== active.waiting.frame) { active.fault = invalid(); active.waiting.resolve(); return; }
      active.waiting.resolve(); return;
    }
    if (request.kind === 'cancel') {
      const active = this.active; if (active?.id === request.id) { active.cancelled = true; active.waiting?.resolve(); } return;
    }
    if (this.closing || this.active) {
      const failure = new DriverFailure('SQLITE_BUSY', 'SQLite会话已有活动操作');
      // 同编号违规不能先发失败再让原执行继续；先唤醒原ACK并在统一finally后报告一次。
      if (this.active?.id === request.id) { this.active.fault = failure; this.active.waiting?.resolve(); }
      else this.failure(request.id, failure);
      return;
    }
    if (request.kind === 'open') { this.open(request.id, request.options); return; }
    if (request.kind === 'execute' || request.kind === 'streamRead') {
      if (!this.db) { this.failure(request.id, new DriverFailure('SQLITE_NOT_OPEN', 'SQLite会话尚未打开')); return; }
      // 帧属于本次执行；父端每个新operation从0等待，旧执行ACK仍按id隔离。
      this.frame = 0;
      const active: Execution = { id: request.id, cancelled: false, results: [], bytes: 0 }; this.active = active;
      void this.execute(active, request).catch(() => { this.port.exit(1); }); return;
    }
    if (request.kind === 'close') {
      this.closing = true;
      try { this.db?.close(); this.db = undefined; this.closingId = request.id; this.port.send({ kind: 'closed', id: request.id }); }
      catch { this.closing = false; this.failure(request.id, new DriverFailure('SQLITE_CLOSE_FAILED', 'SQLite会话关闭未确认')); }
      return;
    }
    this.failure(id, invalid());
  }

  /** 失去父端时尽力关闭；真正的强制退出与资源证明由持有进程句柄的父端负责。 */
  disconnected(): void {
    this.closing = true;
    if (this.active) { this.active.cancelled = true; this.active.waiting?.resolve(); }
    try { this.db?.close(); } catch {} finally { this.db = undefined; this.port.exit(0); }
  }

  /** 从原生连接读取真实事务位；读取失败则退出，由父端报告未知，不能伪造false。 */
  private transaction(): boolean { if (!this.db) return false; const value = this.db.isTransaction; if (typeof value !== 'boolean') throw invalid(); return value; }

  /** 原生错误正文可能包含SQL、路径或参数；对外仅发送固定的安全中文提示。 */
  private failure(id: string, failure: DriverFailure, completedStatements = 0): void {
    try { this.port.send({ kind: 'failed', id, code: failure.code, message: failure.message, transaction: this.transaction(), completedStatements }); }
    catch { this.port.exit(1); }
  }

  /** 只接受现存绝对普通文件；URI mode=rw/ro禁止SQLite默认的缺文件自动创建。 */
  private open(id: string, options: SqliteOpenOptions): void {
    if (this.db) { this.failure(id, invalid()); return; }
    let descriptor: number | undefined, opened: DatabaseSync | undefined;
    try {
      if (!object(options) || typeof options.path !== 'string' || !unicode(options.path) || !isAbsolute(options.path) || typeof options.readOnly !== 'boolean' || !integer(options.busyTimeoutMs, 0, 5000)) throw invalid();
      const path = realpathSync(options.path); descriptor = openSync(path, options.readOnly ? 'r' : 'r+');
      const before = fstatSync(descriptor, { bigint: true }); if (!before.isFile()) throw invalid();
      const uri = pathToFileURL(path); uri.searchParams.set('mode', options.readOnly ? 'ro' : 'rw');
      opened = new DatabaseSync(uri.href, { readOnly: options.readOnly, timeout: options.busyTimeoutMs, allowExtension: false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, defensive: true });
      const after = statSync(path, { bigint: true }); if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) throw invalid();
      opened.enableLoadExtension(false); opened.enableDefensive(true);
      opened.limits.length = Math.min(opened.limits.length, limits.valueBytes);
      opened.limits.sqlLength = Math.min(opened.limits.sqlLength, limits.sqlBytes);
      opened.limits.column = Math.min(opened.limits.column, limits.columns);
      opened.limits.variableNumber = Math.min(opened.limits.variableNumber, limits.columns);
      if (!integer(opened.limits.length, 1, limits.valueBytes) || !integer(opened.limits.sqlLength, 1, limits.sqlBytes) || !integer(opened.limits.column, 1, limits.columns)) throw invalid();
      opened.exec('PRAGMA foreign_keys=ON');
      const foreignKeys = opened.prepare('PRAGMA foreign_keys').get(); if (!foreignKeys || Object.values(foreignKeys)[0] !== 1) throw invalid();
      // 强制读取真实主库头；只读取sqlite_version常量不能替代文件格式验证。
      const schema = opened.prepare('PRAGMA main.schema_version').get(); if (!schema || typeof Object.values(schema)[0] !== 'number') throw invalid();
      const versionRow = opened.prepare('SELECT sqlite_version() AS version').get();
      if (!versionRow || typeof versionRow.version !== 'string' || versionRow.version.length > 100) throw invalid();
      if (options.readOnly) {
        const encoding = Object.values(opened.prepare('PRAGMA encoding').get() ?? {})[0];
        const label = encoding === 'UTF-8' ? 'utf-8' : encoding === 'UTF-16le' ? 'utf-16le' : encoding === 'UTF-16be' ? 'utf-16be' : undefined;
        if (!label) throw invalid();
        // ignoreBOM=true保留真实U+FEFF，不能把字段开头BOM当文件标记剥离；fatal禁止静默替换坏字节。
        const decoder = new TextDecoder(label, { fatal: true, ignoreBOM: true });
        opened.function(sqliteExportTextFunction, { deterministic: true, directOnly: true, useBigIntArguments: true }, (text, bytes) => {
          try {
            if (typeof text !== 'string' || !(bytes instanceof Uint8Array) || decoder.decode(bytes) !== text) throw Error('文本原字节与原文不一致');
            return text;
          } catch {
            const failure = new DriverFailure('SQLITE_TEXT_ENCODING_UNREPRESENTABLE', 'SQLite源TEXT包含无效编码或无法无损表示的文本，完整导出已停止，原目标文件保持不变');
            if (this.active) this.active.fault = failure;
            throw failure;
          }
        });
      }
      // 读写连接也须在原生prepare之前拦截副作用PRAGMA；多句参数检查和消费者ACK都发生得更晚。
      // 所有连接只拥有Main选中的单个磁盘库；ATTACH/DETACH及VACUUM INTO不能另取文件能力。
      opened.setAuthorizer((action, first, second) => {
        if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
        if (action === constants.SQLITE_PRAGMA) return readablePragma(first, second) ? constants.SQLITE_OK : constants.SQLITE_DENY;
        if (!options.readOnly) return constants.SQLITE_OK;
        if ([constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE, constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT].includes(action)) return constants.SQLITE_OK;
        return constants.SQLITE_DENY;
      });
      this.db = opened; this.readOnly = options.readOnly; opened = undefined;
      this.port.send({ kind: 'opened', id, version: versionRow.version, transaction: this.transaction(), readOnly: options.readOnly });
    } catch (error) {
      try { opened?.close(); } catch {}
      this.failure(id, error instanceof DriverFailure ? error : new DriverFailure('SQLITE_OPEN_FAILED', 'SQLite文件打开失败或当前运行时不支持所需原生能力'));
    } finally { if (descriptor !== undefined) { try { closeSync(descriptor); } catch { this.port.exit(1); } } }
  }

  /** 每个帧先登记原序号再发送，ACK或取消只唤醒本帧；唤醒后重新核验取消状态。 */
  private async sendFrame(active: Execution, body: { kind: 'statement'; index: number; sql: string; columns: SqliteColumn[] } | { kind: 'batch'; index: number; rows: SqliteValue[][] }): Promise<void> {
    this.check(active); const frame = ++this.frame;
    await new Promise<void>((resolve, reject) => {
      active.waiting = { frame, resolve };
      try { this.port.send({ ...body, id: active.id, frame }); } catch (error) { reject(error); }
    });
    active.waiting = undefined; this.check(active);
  }

  /** 同步原生调用期间不能消费取消消息；这里只保证批次之间真实让出事件循环。 */
  private async yield(active: Execution): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); this.check(active); }
  private check(active: Execution): void { if (active.fault) throw active.fault; if (this.active !== active || active.cancelled || this.closing) throw cancelled(); }

  /** total_changes差值包括触发器实际影响行，COMMIT等控制语句不会复用上次changes。 */
  private changes(): bigint {
    const query = this.db!.prepare('SELECT total_changes()'); query.setReadBigInts(true); query.setReturnArrays(true);
    const row = query.get() as unknown; if (!Array.isArray(row) || typeof row[0] !== 'bigint') throw invalid(); return row[0];
  }

  /** 在任何用户step前完成参数和单语句约束；脚本每条仅消费原生确认的准确前缀。 */
  private async execute(active: Execution, request: Extract<SqliteWorkerRequest, { kind: 'execute' | 'streamRead' }>): Promise<void> {
    try {
      const { sql, options } = request;
      const stream = request.kind === 'streamRead';
      if (stream && !this.readOnly) throw new DriverFailure('SQLITE_STREAM_REQUIRES_READONLY', 'SQLite完整流读取只允许物理只读连接');
      if (typeof sql !== 'string' || !unicode(sql) || Buffer.byteLength(sql) > limits.sqlBytes || !object(options) || !integer(options.batchRows, 1, limits.batchRows)
        || !stream && (!integer(options.maxRows, 1, limits.rows) || !integer(options.maxBytes, 1, limits.resultBytes))) throw invalid();
      if (request.parameters !== undefined && (!Array.isArray(request.parameters) || request.parameters.length > limits.columns)) throw invalid();
      const parameters = request.parameters?.map(parameter);
      if (parameters && parameters.reduce<number>((bytes, value) => bytes + (typeof value === 'string' ? Buffer.byteLength(value) : value instanceof Uint8Array ? value.byteLength : 16), 0) > limits.resultBytes) throw invalid();
      let offset = skipTrivia(sql);
      if (stream && (!Array.isArray(request.parameters) || !/^SELECT\b/i.test(sql.slice(offset)))) throw new DriverFailure('SQLITE_STREAM_REQUIRES_SELECT', 'SQLite完整流读取只接受单条SELECT');
      if (parameters && offset === sql.length) throw invalid();
      while (offset < sql.length) {
        this.check(active); if (active.results.length >= limits.statements) throw invalid();
        const remaining = sql.slice(offset), statement = this.db!.prepare(remaining), prefix = statement.sourceSQL;
        if (typeof prefix !== 'string' || !prefix.length || !remaining.startsWith(prefix)) throw invalid();
        offset = skipTrivia(sql, offset + prefix.length);
        if (parameters && offset !== sql.length) throw new DriverFailure('SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', '带参数的SQLite执行只能包含一条完整语句，尚未执行任何语句');
        const result = await this.statement(active, statement, prefix, parameters ?? [], stream ? { maxRows: 1, maxBytes: 1, batchRows: options.batchRows } : options as SqliteExecutionOptions, stream);
        active.results.push(result); this.port.send({ kind: 'statementEnd', id: active.id, result });
        // 包括零行DDL和控制语句；脚本不能靠连续同步语句饿死父端取消消息。
        await this.yield(active);
      }
      this.check(active); this.port.send({ kind: 'completed', id: active.id, result: { statements: active.results, transaction: this.transaction() } });
    } catch (error) {
      if (active.fault) this.failure(active.id, active.fault, active.results.length);
      else if (active.cancelled && !this.closing) this.port.send({ kind: 'cancelled', id: active.id, transaction: this.transaction(), completedStatements: active.results.length });
      else if (!this.closing) {
        // 原生整数错误码可用于后续诊断；错误正文可能含SQL、路径或参数，仍禁止回传。
        const nativeCode = object(error) && integer(error.errcode, 0, 2147483647) ? 'SQLITE_NATIVE_' + error.errcode : 'SQLITE_EXECUTION_FAILED';
        this.failure(active.id, error instanceof DriverFailure ? error : new DriverFailure(nativeCode, 'SQLite语句执行失败，已停止后续语句；未自动回滚或重放'), active.results.length);
      }
    } finally { active.waiting = undefined; if (this.active === active) this.active = undefined; }
  }

  /** 结果达到预算后仍drain原语句，避免RETURNING写入因提前return而只执行一部分。 */
  private async statement(active: Execution, statement: StatementSync, sql: string, parameters: SQLInputValue[], options: SqliteExecutionOptions, stream = false): Promise<SqliteStatementResult> {
    statement.setReadBigInts(true); statement.setReturnArrays(true);
    const columns = statement.columns(); if (columns.length > limits.columns) throw invalid();
    const before = this.changes(), index = active.results.length;
    await this.sendFrame(active, { kind: 'statement', index, sql, columns });
    this.check(active);
    let iterator: Iterator<unknown[]> | undefined, rows = 0, truncated = false, retaining = true, steps = 0, batch: SqliteValue[][] = [], batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return; const output = batch; batch = []; batchBytes = 0; rows += output.length;
      await this.sendFrame(active, { kind: 'batch', index, rows: output }); await this.yield(active);
    };
    try {
      iterator = statement.iterate(...parameters) as unknown as Iterator<unknown[]>;
      while (true) {
        this.check(active); const item = iterator.next(); if (item.done) break;
        if (!Array.isArray(item.value) || item.value.length !== columns.length) throw invalid();
        if (stream) {
          const values = item.value.map(cell), bytes = Buffer.byteLength(JSON.stringify(values)) + 1;
          if (bytes > limits.valueBytes || !Number.isSafeInteger(active.bytes + bytes) || !Number.isSafeInteger(rows + batch.length + 1)) throw new DriverFailure('SQLITE_STREAM_FRAME_LIMIT', 'SQLite完整流读取单帧或累计计数超过安全预算');
          if (batch.length && batchBytes + bytes > limits.valueBytes) await flush();
          batch.push(values); batchBytes += bytes; active.bytes += bytes;
          if (batch.length >= options.batchRows || batchBytes >= limits.valueBytes) await flush();
        } else if (!retaining || rows + batch.length >= options.maxRows || active.bytes >= options.maxBytes) { truncated = true; retaining = false; }
        else {
          const values = item.value.map(cell), bytes = Buffer.byteLength(JSON.stringify(values)) + 1;
          if (active.bytes + bytes > options.maxBytes) { truncated = true; retaining = false; }
          else {
            if (batch.length && batchBytes + bytes > limits.valueBytes) await flush();
            batch.push(values); batchBytes += bytes; active.bytes += bytes;
            if (batch.length >= options.batchRows || batchBytes >= limits.valueBytes) await flush();
          }
        }
        if (++steps % 200 === 0) await this.yield(active);
      }
      await flush(); this.check(active);
    } finally { iterator?.return?.(); }
    const changed = this.changes() - before; if (changed < 0n) throw invalid();
    return { index, rows, truncated, changes: changed.toString(), transaction: this.transaction() };
  }
}
