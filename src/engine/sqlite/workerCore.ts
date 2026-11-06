import { closeSync, fstatSync, openSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants, DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { copySqliteNamedParameters, copySqliteCreateGuard, copySqliteWorkerOpenOptions, sqliteCopySourceSchema, sqliteDriverLimits as limits, sqliteExportTextFunction, type SqliteCreateGuard, type SqliteColumn, type SqliteExecutionOptions, type SqliteWorkerOpenOptions, type SqliteStatementResult, type SqliteValue, type SqliteWorkerRequest, type SqliteWorkerResponse } from './protocol';
import { queryResultTitle, queryResultTitlePrefixLimit } from '../../shared/queryResultTitle';
import { copySqliteRebuildComparisonInput, copySqliteRebuildComparisonResult, compareSqliteRebuildTables, SqliteRebuildComparisonError } from './rebuildComparison';
import { queryParameterLimits } from '../../shared/queryParameters';
import { sqliteNamedParameterNames } from './parameters';
import { createSqliteNativeInvoke, resolveSqliteNativeResource, sqliteNativeFunction } from './nativeRuntime';
import { SqliteRawStatement, type SqliteRawInvoke } from './rawStatement';
import { consumeSqliteRawFrames } from './rawFrames';
import { SqliteRawValueError } from './rawValue';

interface Port { send(message: SqliteWorkerResponse): void; exit(code: number): void; }
interface Execution { id: string; cancelled: boolean; fault?: DriverFailure; waiting?: { frame: number; resolve(): void }; results: SqliteStatementResult[]; bytes: number; }
class DriverFailure extends Error { constructor(readonly code: string, message: string) { super(message); } }
const invalid = () => new DriverFailure('SQLITE_INVALID_REQUEST', 'SQLite请求格式、预算或生命周期无效');
const cancelled = () => new DriverFailure('SQLITE_CANCELLED', 'SQLite任务已请求取消');
const invalidNamedParameters = () => new DriverFailure('SQLITE_NAMED_PARAMETERS_INVALID', 'SQLite整组命名绑定、名称集合或参数预算无效，尚未执行任何用户语句');
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
  // FTS5的data_version和ALTER保护模式均只允许无赋值读取，不扩大任何PRAGMA写授权。
  return second === null && ['database_list', 'table_list', 'collation_list', 'compile_options', 'foreign_keys', 'query_only', 'legacy_alter_table', 'ignore_check_constraints', 'schema_version', 'data_version', 'user_version', 'page_count', 'page_size', 'freelist_count', 'encoding', 'journal_mode'].includes(name);
}

/** 仅跳过SQLite明确的空白、分号和注释；语句边界始终由原生prepare/sourceSQL决定。 */
function skipTrivia(sql: string, offset = 0, afterDelimiter?: (offset: number) => void): number {
  while (offset < sql.length) {
    if (sql[offset] === ';') { offset++; afterDelimiter?.(offset); continue; }
    if (/[ \t\r\n\f]/.test(sql[offset])) { offset++; continue; }
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

/** 整个模板与整组值在任何user prepare前复核；只用原生绑定，参数绝不拼入SQL或错误正文。 */
function namedParameters(sql: string, input: unknown): Record<string, SQLInputValue> {
  try {
    const source = copySqliteNamedParameters(input), names = sqliteNamedParameterNames(sql).map(name => ':' + name), keys = Object.keys(source);
    if (names.length > queryParameterLimits.names || names.length !== keys.length || names.some(name => !Object.hasOwn(source, name))) throw invalidNamedParameters();
    const bound = Object.create(null) as Record<string, SQLInputValue>; let total = 0;
    for (const key of keys) {
      const value = parameter(source[key]), bytes = value === null ? 0 : typeof value === 'string' ? Buffer.byteLength(value) : value instanceof Uint8Array ? value.byteLength : Buffer.byteLength(Object.is(value, -0) ? '-0' : String(value));
      if (bytes > queryParameterLimits.valueBytes || total + bytes > queryParameterLimits.totalBytes) throw invalidNamedParameters();
      total += bytes; bound[key] = value;
    }
    return bound;
  } catch { throw invalidNamedParameters(); }
}

/** 一个对象只管理一个物理SQLite会话；普通消息取消和原生执行终态分开确认。 */
export class SqliteWorkerCore {
  private db?: DatabaseSync;
  private active?: Execution;
  private frame = 0;
  private closing = false;
  private closingId?: string;
  private readOnly = false;
  private rebuildWriter = false;
  private restoringRebuildFlags = false;
  private guardedCreate?: { owner: Execution; guard: SqliteCreateGuard; matched: boolean };
  private nativeInvoke?: SqliteRawInvoke;
  private preparingNativeControl = false;
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
    if (request.kind === 'execute' || request.kind === 'streamRead' || request.kind === 'rebuildCompare') {
      if (!this.db) { this.failure(request.id, new DriverFailure('SQLITE_NOT_OPEN', 'SQLite会话尚未打开')); return; }
      // 帧属于本次执行；父端每个新operation从0等待，旧执行ACK仍按id隔离。
      this.frame = 0;
      const active: Execution = { id: request.id, cancelled: false, results: [], bytes: 0 }; this.active = active;
      void (request.kind === 'rebuildCompare' ? this.rebuildCompare(active, request) : this.execute(active, request)).catch(() => { this.port.exit(1); }); return;
    }
    if (request.kind === 'close') {
      if (this.rebuildWriter && this.transaction()) { this.failure(request.id, new DriverFailure('SQLITE_REBUILD_TRANSACTION_ACTIVE', 'SQLite重建事务尚未明确收束，正常关闭被拒绝；请先显式ROLLBACK或COMMIT')); return; }
      this.closing = true;
      try {
        if (this.rebuildWriter) this.restoreRebuildFlags();
        this.db?.close(); this.db = undefined; this.nativeInvoke = undefined; this.closingId = request.id; this.port.send({ kind: 'closed', id: request.id, ...(this.rebuildWriter ? { rebuildRestored: true as const } : {}) });
      }
      catch { this.closing = false; this.failure(request.id, new DriverFailure('SQLITE_CLOSE_FAILED', 'SQLite会话关闭未确认')); }
      return;
    }
    this.failure(id, invalid());
  }

  /** 失去父端时尽力关闭；真正的强制退出与资源证明由持有进程句柄的父端负责。 */
  disconnected(): void {
    this.closing = true;
    if (this.active) { this.active.cancelled = true; this.active.waiting?.resolve(); }
    try { this.db?.close(); } catch {} finally { this.db = undefined; this.nativeInvoke = undefined; this.port.exit(0); }
  }

  /** 从原生连接读取真实事务位；读取失败则退出，由父端报告未知，不能伪造false。 */
  private transaction(): boolean { if (!this.db) return false; const value = this.db.isTransaction; if (typeof value !== 'boolean') throw invalid(); return value; }

  /** 原生错误正文可能包含SQL、路径或参数；对外仅发送固定的安全中文提示。 */
  private failure(id: string, failure: DriverFailure, completedStatements = 0): void {
    try { this.port.send({ kind: 'failed', id, code: failure.code, message: failure.message, transaction: this.transaction(), completedStatements }); }
    catch { this.port.exit(1); }
  }

  /** 只接受现存绝对普通文件；URI mode=rw/ro禁止SQLite默认的缺文件自动创建。 */
  private open(id: string, rawOptions: SqliteWorkerOpenOptions): void {
    if (this.db) { this.failure(id, invalid()); return; }
    let descriptor: number | undefined, sourceDescriptor: number | undefined, opened: DatabaseSync | undefined;
    try {
      const options = copySqliteWorkerOpenOptions(rawOptions), rebuild = options.mode === 'table-rebuild';
      if (!object(options) || typeof options.path !== 'string' || !unicode(options.path) || !isAbsolute(options.path) || typeof options.readOnly !== 'boolean' || !integer(options.busyTimeoutMs, 0, 5000)) throw invalid();
      const path = realpathSync.native(options.path); descriptor = openSync(path, options.readOnly ? 'r' : 'r+');
      const before = fstatSync(descriptor, { bigint: true }); if (!before.isFile()) throw invalid();
      const uri = pathToFileURL(path); uri.searchParams.set('mode', options.readOnly ? 'ro' : 'rw');
      const nativeResource = resolveSqliteNativeResource();
      opened = new DatabaseSync(uri.href, { readOnly: options.readOnly, timeout: options.busyTimeoutMs, allowExtension: true, enableForeignKeyConstraints: !rebuild, enableDoubleQuotedStringLiterals: false, defensive: true });
      try { opened.loadExtension(nativeResource, 'sqlite3_dbarkrawprobe_init'); } finally { opened.enableLoadExtension(false); }
      const after = statSync(path, { bigint: true }); if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) throw invalid();
      opened.enableLoadExtension(false); opened.enableDefensive(true);
      // SQLite必须先读取完整schema记录，随后才能对DDL作有界BLOB分块；公开值仍受nativeRows/rawFrames的1MiB门约束。
      opened.limits.length = Math.min(opened.limits.length, limits.recordBytes);
      opened.limits.sqlLength = Math.min(opened.limits.sqlLength, limits.sqlBytes);
      // private候选额外ordinal及window复制的隐藏投影留原生余量，公开结果列仍由statement保持1024门槛。
      const nativeColumnLimit = rebuild ? limits.columns * 2 + 2 : limits.columns;
      opened.limits.column = Math.min(opened.limits.column, nativeColumnLimit);
      opened.limits.variableNumber = Math.min(opened.limits.variableNumber, limits.columns);
      if (!integer(opened.limits.length, 1, limits.recordBytes) || !integer(opened.limits.sqlLength, 1, limits.sqlBytes) || !integer(opened.limits.column, 1, nativeColumnLimit)) throw invalid();
      // 唯一私有模式在安装通用authorizer之前设置固定值；不向普通execute开放任何PRAGMA setter。
      opened.exec(rebuild ? 'PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON' : 'PRAGMA foreign_keys=ON');
      const foreignKeys = opened.prepare('PRAGMA foreign_keys').get(); if (!foreignKeys || Object.values(foreignKeys)[0] !== (rebuild ? 0 : 1)) throw invalid();
      if (rebuild && Object.values(opened.prepare('PRAGMA legacy_alter_table').get() ?? {})[0] !== 1) throw invalid();
      // 只核原生实际开启状态，不添加关闭CHECK的setter或继承其他连接的假定。
      if (Object.values(opened.prepare('PRAGMA ignore_check_constraints').get() ?? {})[0] !== 0) throw invalid();
      // 强制读取真实主库头；只读取sqlite_version常量不能替代文件格式验证。
      const schema = opened.prepare('PRAGMA main.schema_version').get(); if (!schema || typeof Object.values(schema)[0] !== 'number') throw invalid();
      const versionRow = opened.prepare('SELECT sqlite_version() AS version').get();
      if (!versionRow || typeof versionRow.version !== 'string' || versionRow.version.length > 100) throw invalid();
      let copySourceIdentity;
      if (options.sourcePath) {
        if (!unicode(options.sourcePath) || !isAbsolute(options.sourcePath)) throw invalid();
        const sourcePath = realpathSync.native(options.sourcePath);
        sourceDescriptor = openSync(sourcePath, 'r');
        const sourceBefore = fstatSync(sourceDescriptor, { bigint: true });
        if (!sourceBefore.isFile() || sourceBefore.dev === before.dev && sourceBefore.ino === before.ino)
          throw new DriverFailure('SQLITE_COPY_SAME_FILE', '来源和目标指向同一 SQLite 文件，请选择本文件复制');
        // 只在独立任务启动时运行固定 ATTACH，URI 和磁盘路径均来自已授权的 Main 配置。
        const sourceUri = pathToFileURL(sourcePath); sourceUri.searchParams.set('mode', 'ro');
        try { opened.prepare('ATTACH ? AS ' + sqliteCopySourceSchema).run(sourceUri.href); }
        catch { throw new DriverFailure('SQLITE_COPY_SOURCE_OPEN', 'SQLite 复制来源无法只读打开，请核对文件、锁状态和两端数据库编码'); }
        const location = opened.location(sqliteCopySourceSchema);
        const sourceAfter = statSync(sourcePath, { bigint: true });
        if (!location || realpathSync.native(location) !== sourcePath || !sourceAfter.isFile() || sourceBefore.dev !== sourceAfter.dev || sourceBefore.ino !== sourceAfter.ino) throw invalid();
        copySourceIdentity = { path: sourcePath, device: sourceBefore.dev.toString(), inode: sourceBefore.ino.toString() };
      }
      {
        const encoding = Object.values(opened.prepare('PRAGMA encoding').get() ?? {})[0];
        const label = encoding === 'UTF-8' ? 'utf-8' : encoding === 'UTF-16le' ? 'utf-16le' : encoding === 'UTF-16be' ? 'utf-16be' : undefined;
        if (!label) throw invalid();
        // ignoreBOM=true保留真实U+FEFF，不能把字段开头BOM当文件标记剥离；fatal禁止静默替换坏字节。
        const decoder = new TextDecoder(label, { fatal: true, ignoreBOM: true });
        opened.function(sqliteExportTextFunction, { deterministic: true, directOnly: true, useBigIntArguments: true }, (text, bytes) => {
          try {
            // 内部record预算不授权复制或导出超量单格；原库编码与UTF8输出表示均保留原1MiB门。
            if (typeof text !== 'string' || !(bytes instanceof Uint8Array) || bytes.byteLength > limits.valueBytes || Buffer.byteLength(text, 'utf8') > limits.valueBytes || decoder.decode(bytes) !== text) throw Error('文本原字节、单值预算与原文不一致');
            return text;
          } catch {
            const failure = new DriverFailure('SQLITE_TEXT_ENCODING_UNREPRESENTABLE', 'SQLite源TEXT包含无效编码或无法无损表示的文本，本次操作已停止');
            if (this.active) this.active.fault = failure;
            throw failure;
          }
        });
      }
      // 读写连接也须在原生prepare之前拦截副作用PRAGMA；多句参数检查和消费者ACK都发生得更晚。
      // 执行阶段仍拒绝任何 ATTACH/DETACH。私有来源即使存在，也只授权读取。
      opened.setAuthorizer((action, first, second, database, source) => {
        const nativeControl = second?.toLowerCase() === sqliteNativeFunction;
        // 内部只编译固定的SELECT函数壳；函数内用户SQL的prepare必须重新经过原权限判断。
        if (this.preparingNativeControl) return action === constants.SQLITE_SELECT || action === constants.SQLITE_FUNCTION && nativeControl ? constants.SQLITE_OK : constants.SQLITE_DENY;
        if (action === constants.SQLITE_FUNCTION && nativeControl) return constants.SQLITE_DENY;
        if (action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH) return constants.SQLITE_DENY;
        if (action === constants.SQLITE_PRAGMA) {
          const restoring = this.restoringRebuildFlags && rebuild && source === null && (first === 'foreign_keys' && second === 'ON' || first === 'legacy_alter_table' && second === 'OFF');
          return restoring || readablePragma(first, second) ? constants.SQLITE_OK : constants.SQLITE_DENY;
        }
        if (database === sqliteCopySourceSchema && action !== constants.SQLITE_READ) return constants.SQLITE_DENY;
        if (options.readOnly && ![constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE, constants.SQLITE_TRANSACTION, constants.SQLITE_SAVEPOINT].includes(action)) return constants.SQLITE_DENY;
        if (this.guardedCreate) return this.authorizeCreate(action, first, second, database, source);
        return constants.SQLITE_OK;
      });
      this.nativeInvoke = createSqliteNativeInvoke(opened, value => { this.preparingNativeControl = value; });
      this.db = opened; this.readOnly = options.readOnly; this.rebuildWriter = rebuild; opened = undefined;
      this.port.send({ kind: 'opened', id, version: versionRow.version, transaction: this.transaction(), readOnly: options.readOnly, identity: { path, device: before.dev.toString(), inode: before.ino.toString() }, ...(options.mode ? { mode: options.mode } : {}), ...(copySourceIdentity ? { copySourceIdentity } : {}) });
    } catch (error) {
      try { opened?.close(); } catch {}
      this.failure(id, error instanceof DriverFailure ? error : new DriverFailure('SQLITE_OPEN_FAILED', 'SQLite文件打开失败或当前运行时不支持所需原生能力'));
    } finally { for (const file of [descriptor, sourceDescriptor]) if (file !== undefined) { try { closeSync(file); } catch { this.port.exit(1); } } }
  }

  /** 正常关闭前恢复保护必须位于事务外；恢复失败不发送closed，更不冒充COMMIT/ROLLBACK。 */
  private restoreRebuildFlags(): void {
    if (!this.db || this.transaction()) throw new DriverFailure('SQLITE_REBUILD_TRANSACTION_ACTIVE', 'SQLite重建事务尚未明确收束');
    this.restoringRebuildFlags = true;
    try {
      this.db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON');
      if (Object.values(this.db.prepare('PRAGMA legacy_alter_table').get() ?? {})[0] !== 0 || Object.values(this.db.prepare('PRAGMA foreign_keys').get() ?? {})[0] !== 1 || Object.values(this.db.prepare('PRAGMA ignore_check_constraints').get() ?? {})[0] !== 0) throw invalid();
    } finally { this.restoringRebuildFlags = false; }
  }

  /** CREATE的原生action才证明准确对象与ON关系；不从SQL正文正则推断触发器归属。 */
  private authorizeCreate(action: number, first: string | null, second: string | null, database: string | null, source: string | null): number {
    const pending = this.guardedCreate!;
    const deny = () => { pending.owner.fault ??= new DriverFailure('SQLITE_CREATE_GUARD_DENIED', 'SQLite原生对象创建目标、类型或所属关系不符合本次内部能力，尚未执行CREATE'); return constants.SQLITE_DENY; };
    if (this.active !== pending.owner) return deny();
    const expected = pending.guard.kind === 'view' ? constants.SQLITE_CREATE_VIEW : constants.SQLITE_CREATE_TRIGGER;
    if (action === expected) {
      const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
      if (database !== 'main' || source !== null || first !== pending.guard.name || pending.guard.kind === 'trigger' && (second === null || !pending.guard.allowedRelations.some(name => fold(name) === fold(second)))) return deny();
      pending.matched = true; return constants.SQLITE_OK;
    }
    if ([constants.SQLITE_INSERT, constants.SQLITE_UPDATE, constants.SQLITE_DELETE].includes(action)) {
      // CREATE必须写sqlite_schema；此许可不能用于业务DML，且step前仍要求观察到准确CREATE。
      return database === 'main' && source === null && ['sqlite_master', 'sqlite_schema'].includes(first ?? '') ? constants.SQLITE_OK : deny();
    }
    if ([constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE].includes(action)) return constants.SQLITE_OK;
    return deny();
  }

  /** 每个帧先登记原序号再发送，ACK或取消只唤醒本帧；唤醒后重新核验取消状态。 */
  private async sendFrame(active: Execution, body: { kind: 'statement'; index: number; sql: string; columns: SqliteColumn[]; title?: string } | { kind: 'batch'; index: number; rows: SqliteValue[][] } | { kind: 'rebuildProgress'; comparedRows: string; columnGroups: number }): Promise<void> {
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

  /** 只在私有writer真实事务内比较，无任意SQL、用户值或累计结果预算旁路。 */
  private async rebuildCompare(active: Execution, request: Extract<SqliteWorkerRequest, { kind: 'rebuildCompare' }>): Promise<void> {
    try {
      if (!this.rebuildWriter || this.readOnly) throw new DriverFailure('SQLITE_REBUILD_COMPARE_MODE', 'SQLite完整重建比较只允许独立重建writer');
      if (!this.transaction()) throw new DriverFailure('SQLITE_REBUILD_COMPARE_TRANSACTION', 'SQLite重建比较要求原writer处于明确事务');
      if (Reflect.ownKeys(request).length !== 3 || !['kind', 'id', 'input'].every(key => { const descriptor = Object.getOwnPropertyDescriptor(request, key); return !!descriptor && descriptor.enumerable && 'value' in descriptor; })) throw new DriverFailure('SQLITE_REBUILD_COMPARE_INPUT', 'SQLite重建比较请求格式无效');
      const input = copySqliteRebuildComparisonInput(Object.getOwnPropertyDescriptor(request, 'input')!.value), columnGroups = Math.ceil(input.columns.length / 256);
      this.check(active);
      const result = copySqliteRebuildComparisonResult(await compareSqliteRebuildTables(this.db!, input, { check: () => this.check(active), yield: () => this.yield(active), progress: async comparedRows => { await this.sendFrame(active, { kind: 'rebuildProgress', comparedRows, columnGroups }); await this.yield(active); } }));
      this.check(active); if (!this.transaction() || result.columnGroups !== columnGroups) throw new DriverFailure('SQLITE_REBUILD_COMPARE_RESULT', 'SQLite完整比较分组或原事务状态无效');
      this.port.send({ kind: 'completed', id: active.id, result: { statements: [], transaction: true, comparison: result } });
    } catch (error) {
      if (active.fault) this.failure(active.id, active.fault);
      else if (active.cancelled && !this.closing) this.port.send({ kind: 'cancelled', id: active.id, transaction: this.transaction(), completedStatements: 0 });
      else if (!this.closing) this.failure(active.id, error instanceof DriverFailure ? error : new DriverFailure(error instanceof SqliteRebuildComparisonError ? error.code : 'SQLITE_REBUILD_COMPARE_FAILED', 'SQLite完整重建比较未通过，未发送提交；原事务仍须明确收束'));
    } finally { active.waiting = undefined; if (this.active === active) this.active = undefined; }
  }

  /** 在任何用户step前完成参数和单语句约束；脚本每条仅消费原生确认的准确前缀。 */
  private async execute(active: Execution, request: Extract<SqliteWorkerRequest, { kind: 'execute' | 'streamRead' }>): Promise<void> {
    try {
      const { sql, options } = request;
      const stream = request.kind === 'streamRead';
      if (stream && !this.readOnly) throw new DriverFailure('SQLITE_STREAM_REQUIRES_READONLY', 'SQLite完整流读取只允许物理只读连接');
      if (typeof sql !== 'string' || !unicode(sql) || Buffer.byteLength(sql) > limits.sqlBytes || !object(options) || !integer(options.batchRows, 1, limits.batchRows)
        || !stream && (!integer(options.maxRows, 1, limits.rows) || !integer(options.maxBytes, 1, limits.resultBytes))) throw invalid();
      if (stream && Object.hasOwn(request, 'namedParameters') || request.namedParameters !== undefined && request.parameters !== undefined) throw invalidNamedParameters();
      const named = request.namedParameters === undefined ? undefined : namedParameters(sql, request.namedParameters);
      if (request.parameters !== undefined && (!Array.isArray(request.parameters) || request.parameters.length > limits.columns)) throw invalid();
      const parameters = request.parameters?.map(parameter);
      if (parameters && parameters.reduce<number>((bytes, value) => bytes + (typeof value === 'string' ? Buffer.byteLength(value) : value instanceof Uint8Array ? value.byteLength : 16), 0) > limits.resultBytes) throw invalid();
      const descriptor = Object.getOwnPropertyDescriptor(request, 'createGuard');
      if (stream && ('createGuard' in request)) throw new DriverFailure('SQLITE_CREATE_GUARD_INVALID', 'SQLite完整流读取不接受对象创建内部能力');
      if (descriptor && !('value' in descriptor) || !descriptor && 'createGuard' in request) throw new DriverFailure('SQLITE_CREATE_GUARD_INVALID', 'SQLite对象创建内部能力无效');
      if (descriptor?.value !== undefined) {
        if (stream || named !== undefined || !Array.isArray(request.parameters) || request.parameters.length !== 0 || Reflect.ownKeys(request.parameters).length !== 1) throw new DriverFailure('SQLITE_CREATE_GUARD_INVALID', 'SQLite对象创建必须独占显式空参数和单条语句');
        let guard: SqliteCreateGuard; try { guard = copySqliteCreateGuard(descriptor.value); } catch { throw new DriverFailure('SQLITE_CREATE_GUARD_INVALID', 'SQLite对象创建内部能力格式或预算无效'); }
        this.guardedCreate = { owner: active, guard, matched: false };
      }
      // 原生准备仍跳过注释。另记最近分隔符，避免空语句前的注释串到下一条结果。
      let heading = 0;
      const afterDelimiter = (next: number) => { heading = next; };
      let offset = skipTrivia(sql, 0, afterDelimiter);
      if (stream && (!Array.isArray(request.parameters) || !/^SELECT\b/i.test(sql.slice(offset)))) throw new DriverFailure('SQLITE_STREAM_REQUIRES_SELECT', 'SQLite完整流读取只接受单条SELECT');
      if (parameters && offset === sql.length) throw invalid();
      while (offset < sql.length) {
        this.check(active); if (active.results.length >= limits.statements) throw invalid();
        const remaining = sql.slice(offset), statement = SqliteRawStatement.prepare(this.nativeInvoke!, remaining), prefix = statement.sourceSQL;
        try {
          if (typeof prefix !== 'string' || !prefix.length || !remaining.startsWith(prefix)) throw invalid();
          const title = stream ? undefined : queryResultTitle(sql.slice(heading, Math.min(offset + prefix.length, heading + queryResultTitlePrefixLimit + 1)), true);
          heading = offset + prefix.length;
          offset = skipTrivia(sql, heading, afterDelimiter);
          if (parameters && offset !== sql.length) throw new DriverFailure('SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', '带参数的SQLite执行只能包含一条完整语句，尚未执行任何语句');
          if (this.guardedCreate && !this.guardedCreate.matched) throw new DriverFailure('SQLITE_CREATE_GUARD_DENIED', 'SQLite没有观察到本次准确CREATE原生授权，尚未执行任何语句');
          if (this.guardedCreate && statement.columns().length !== 0) throw new DriverFailure('SQLITE_CREATE_GUARD_DENIED', 'SQLite对象创建不能使用EXPLAIN或带结果列的其它语句');
          if (!statement.hasStatement) continue;
          const result = await this.statement(active, statement, prefix, named ?? parameters ?? [], stream ? { maxRows: 1, maxBytes: 1, batchRows: options.batchRows } : options as SqliteExecutionOptions, stream, title);
          active.results.push(result); this.port.send({ kind: 'statementEnd', id: active.id, result });
        } finally { statement.finish(); }
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
        this.failure(active.id, error instanceof DriverFailure ? error : error instanceof SqliteRawValueError ? new DriverFailure(error.code === 'SQLITE_RAW_VALUE_INVALID' ? 'SQLITE_VALUE_INVALID' : error.code, error.message) : new DriverFailure(nativeCode, 'SQLite语句执行失败，已停止后续语句；未自动回滚或重放'), active.results.length);
      }
    } finally { if (this.guardedCreate?.owner === active) this.guardedCreate = undefined; active.waiting = undefined; if (this.active === active) this.active = undefined; }
  }

  /** 结果达到预算后仍drain原语句，避免RETURNING写入因提前return而只执行一部分。 */
  private async statement(active: Execution, statement: SqliteRawStatement, sql: string, parameters: SQLInputValue[] | Record<string, SQLInputValue>, options: SqliteExecutionOptions, stream = false, title?: string): Promise<SqliteStatementResult> {
    statement.bind(parameters);
    const columns = statement.columns(); if (columns.length > limits.columns) throw invalid();
    const before = this.changes(), index = active.results.length;
    await this.sendFrame(active, { kind: 'statement', index, sql, columns, ...(columns.length && title ? { title } : {}) });
    this.check(active);
    let rows = 0, truncated = false, retaining = true, batch: SqliteValue[][] = [], batchBytes = 0, row: SqliteValue[] | undefined, rowBytes = 2;
    const flush = async () => {
      if (!batch.length) return; const output = batch; batch = []; batchBytes = 0; rows += output.length;
      await this.sendFrame(active, { kind: 'batch', index, rows: output }); await this.yield(active);
    };
    await consumeSqliteRawFrames(statement, { rows: Math.min(200, options.batchRows), check: () => this.check(active), onFrame: async frame => {
      this.check(active);
      for (const event of frame.events) {
        if (event.kind === 'row') {
          if (event.columns !== columns.length) throw invalid();
          if (!stream && (!retaining || rows + batch.length >= options.maxRows || active.bytes >= options.maxBytes)) { retaining = false; truncated = true; }
          row = retaining ? [] : undefined; rowBytes = 2;
        } else if (event.kind === 'value' && row) {
          const next = rowBytes + Buffer.byteLength(JSON.stringify(event.value)) + (row.length ? 1 : 0);
          if (stream && next + 1 > limits.valueBytes) throw new DriverFailure('SQLITE_STREAM_FRAME_LIMIT', 'SQLite完整流读取单帧或累计计数超过安全预算');
          if (!stream && active.bytes + next + 1 > options.maxBytes) { row = undefined; retaining = false; truncated = true; }
          else { row.push(event.value); rowBytes = next; }
        } else if (event.kind === 'rowEnd' && row) {
          if (row.length !== columns.length) throw invalid(); const bytes = rowBytes + 1;
          if (!Number.isSafeInteger(active.bytes + bytes) || !Number.isSafeInteger(rows + batch.length + 1)) throw invalid();
          if (batch.length && batchBytes + bytes > limits.valueBytes) await flush();
          batch.push(row); row = undefined; batchBytes += bytes; active.bytes += bytes;
          if (batch.length >= options.batchRows || batchBytes >= limits.valueBytes) await flush();
        }
      }
    } });
    await flush(); this.check(active);
    statement.finish();
    const changed = this.changes() - before; if (changed < 0n) throw invalid();
    return { index, rows, truncated, changes: changed.toString(), transaction: this.transaction() };
  }
}
