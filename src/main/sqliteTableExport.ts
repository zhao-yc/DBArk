import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { CellValue } from '../shared/contracts';
import { sqliteTableExportSchema, type SqliteTableExportInput } from '../shared/sqliteTableExport';
import type { SqliteTableColumn } from '../shared/sqliteTableBrowse';
import { sqliteExportTextFunction, type SqliteValue } from '../engine/sqlite/protocol';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { AtomicFile, AtomicFileTargetReservation, nativeAtomicFileIO, type AtomicFileIO, type WritableFile } from '../engine/atomicFile';
import { exportExcelFile } from '../engine/excelFiles';
import { EXCEL_LIMITS } from '../shared/excelTransfer';
import { csvExportDelimiter } from '../shared/csvExport';
import { csvCell, csvHeader } from '../engine/files';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import { buildSqliteTableSelect, quoteSqliteIdentifier, readSqliteTableCatalogue, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { readSqliteSchemaExport } from './sqliteSchemaExport';

export const sqliteTableExportLimits = { fileBytes: 10 * 1024 ** 3 } as const;
/** 只有Main同进程可注入原窗口、目标复核及跨入口预留，公共IPC没有这些能力。 */
export interface SqliteTableExportRequest extends SqliteTableExportInput {
  filePath: string; assertCurrent(): void; validateDestination(): Promise<void>;
  retainDestinationUntil(recovered: Promise<void>): void;
}
interface FileRecord {
  path: string; handle?: WritableFile; closed: boolean; removed: boolean;
  closeWork?: Promise<void>; removeWork?: Promise<void>; removeOwned?: () => Promise<void>;
}

/** NUL不能通过依赖目标数据库编码的BLOB转TEXT；平衡连接树保留Unicode且不随NUL数线性增加表达式深度。 */
function sqliteTextLiteral(value: string): string {
  const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  if (!value.includes('\0')) return quote(value);
  const fragments = value.split('\0'), leaves: string[] = [];
  for (let index = 0; index < fragments.length; index++) { if (fragments[index]) leaves.push(quote(fragments[index])); if (index < fragments.length - 1) leaves.push('char(0)'); }
  const balanced = (start: number, end: number): string => { if (end - start === 1) return leaves[start]; const middle = start + Math.floor((end - start) / 2); return '(' + balanced(start, middle) + '||' + balanced(middle, end) + ')'; };
  return balanced(0, leaves.length);
}

/** SQLite字面量不沿用MySQL转义；REAL保持存储类别，文本始终保持跨目标编码的Unicode语义。 */
export function sqliteInsertLiteral(value: SqliteValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return sqliteTextLiteral(value);
  if (value.type === 'binary') return "X'" + Buffer.from(value.base64, 'base64').toString('hex') + "'";
  if (value.type === 'integer') return value.value;
  if (value.value === 'Infinity') return '9e999';
  if (value.value === '-Infinity') return '-9e999';
  return /[.eE]/.test(value.value) ? value.value : value.value + '.0';
}

/** Excel只交接一行，消费者下一次next才确认原行已编码并通过XML背压。 */
class RowChannel implements AsyncIterableIterator<CellValue[]> {
  private pending?: { row: CellValue[]; resolve(): void; reject(reason: unknown): void };
  private taken?: { resolve(): void; reject(reason: unknown): void };
  private wake?: () => void;
  private failure?: { reason: unknown };
  private ended = false;
  [Symbol.asyncIterator](): AsyncIterableIterator<CellValue[]> { return this; }
  async write(row: CellValue[]): Promise<void> {
    if (this.failure) throw this.failure.reason;
    if (this.ended || this.pending || this.taken) throw Error('SQLite Excel行背压状态无效');
    return new Promise<void>((resolve, reject) => { this.pending = { row, resolve, reject }; this.wake?.(); this.wake = undefined; });
  }
  async next(): Promise<IteratorResult<CellValue[]>> {
    this.taken?.resolve(); this.taken = undefined;
    for (;;) {
      if (this.failure) throw this.failure.reason;
      if (this.pending) { const item = this.pending; this.pending = undefined; this.taken = item; return { done: false, value: item.row }; }
      if (this.ended) return { done: true, value: undefined };
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
  end(): void { this.ended = true; this.wake?.(); this.wake = undefined; }
  fail(reason: unknown): void { this.failure ??= { reason }; this.pending?.reject(reason); this.pending = undefined; this.taken?.reject(reason); this.taken = undefined; this.wake?.(); this.wake = undefined; }
  async return(): Promise<IteratorResult<CellValue[]>> { this.fail(Error('SQLite Excel行消费者已停止')); return { done: true, value: undefined }; }
}

/** 即使AtomicFile.dispose永久失败，也保留原handle和精确删除能力供显式收尾恢复。 */
export class SqliteTableExportFile {
  private readonly target: string;
  private reservation?: AtomicFileTargetReservation;
  private reservationWork?: Promise<AtomicFileTargetReservation>;
  private atomic?: AtomicFile;
  private record?: FileRecord;
  private cleanupFailure?: unknown;
  private cleaned = false;
  private rename: 'none' | 'pending' | 'confirmed' | 'unknown' = 'none';
  private finishRecovery!: () => void;
  readonly recovered: Promise<void>;

  constructor(private readonly input: SqliteTableExportRequest, private readonly check: () => void, private readonly commitStart: () => void, private readonly io: AtomicFileIO = nativeAtomicFileIO, private readonly maxBytes = sqliteTableExportLimits.fileBytes) {
    if (!isAbsolute(input.filePath) || input.filePath.includes('\0')) throw Error('Main未提供已授权的SQLite导出目标');
    this.target = resolve(input.filePath); this.recovered = new Promise<void>(resolve => { this.finishRecovery = resolve; });
  }
  get fileCommitted(): boolean { return this.rename === 'confirmed' || this.atomic?.fileCommitted === true; }
  get closed(): boolean { return this.cleaned; }
  get bytesWritten(): number { return this.atomic?.bytesWritten ?? 0; }

  /** close只重试原对象；路径身份漂移后的清理能力始终拒绝，不重新认领目录项。 */
  private closeRecord(record: FileRecord): Promise<void> {
    if (record.closed || !record.handle) return Promise.resolve();
    if (!record.closeWork) {
      const work = record.handle.close().then(() => { record.closed = true; }); record.closeWork = work;
      void work.catch(() => { if (record.closeWork === work) record.closeWork = undefined; });
    }
    return record.closeWork;
  }
  /** 清理只调用原handle签发的精确partial删除能力，绝不按路径强删。 */
  private removeRecord(record: FileRecord): Promise<void> {
    if (record.removed) return Promise.resolve();
    if (!record.closed || !record.removeOwned) return Promise.reject(Error('SQLite导出原暂存关闭或删除归属尚未确认'));
    if (!record.removeWork) {
      const work = record.removeOwned().then(() => { record.removed = true; }); record.removeWork = work;
      void work.catch(() => { if (record.removeWork === work) record.removeWork = undefined; });
    }
    return record.removeWork;
  }
  /** 真实IO逐个包装，不丢失创建/关闭/删除失败时的准确句柄。 */
  private trackedIO(): AtomicFileIO {
    return {
      ...this.io,
      open: async path => {
        if (this.record || dirname(path) !== dirname(this.target) || !basename(path).startsWith(basename(this.target) + '.dbark-') || !path.endsWith('.partial')) throw Error('SQLite导出暂存路径或分配次数无效');
        const record: FileRecord = { path, closed: false, removed: false }; this.record = record;
        const handle = await this.io.open(path); record.handle = handle;
        return {
          write: (bytes, offset, length) => handle.write(bytes, offset, length), sync: () => handle.sync(), close: () => this.closeRecord(record),
          ...(handle.identity ? { identity: () => handle.identity!() } : {}),
          ...(handle.protectOwnership ? { protectOwnership: async () => { record.removeOwned = await handle.protectOwnership!(); return () => this.removeRecord(record); } } : {}),
        };
      },
      rename: async (source, target) => {
        if (source !== this.record?.path || target !== this.target || !this.record.closed || this.rename !== 'none') throw Error('SQLite导出原子替换归属无效');
        this.rename = 'pending';
        try { await this.io.rename(source, target); this.rename = 'confirmed'; }
        catch (reason) { this.rename = 'unknown'; throw reason; }
      },
      remove: async path => { if (path !== this.record?.path) throw Error('SQLite导出不能删除外来文件'); await this.removeRecord(this.record); },
    };
  }
  /** 创建partial之前必须复核源库覆盖保护；预留Promise也属于本文件资源，不在失败时丢失。 */
  async open(): Promise<void> {
    this.check(); await this.input.validateDestination(); this.check();
    this.reservationWork = AtomicFileTargetReservation.reserve(this.target);
    this.reservation = await this.reservationWork; this.check();
    try {
      const bytes = this.input.format === 'xlsx' ? Math.min(this.maxBytes, EXCEL_LIMITS.maxCompressedBytes) : this.maxBytes;
      this.atomic = await AtomicFile.create(this.target, this.input.format === 'xlsx' ? 'utf8' : this.input.encoding, this.check, this.commitStart, this.trackedIO(), bytes, this.reservation, true);
    } catch (reason) { if (reason instanceof AggregateError) this.cleanupFailure = reason; throw reason; }
  }
  /** 文本及二进制都复用原AtomicFile短写与严格编码检查。 */
  write(text: string): Promise<void> { if (!this.atomic) return Promise.reject(Error('SQLite导出原暂存未打开')); return this.atomic.write(text); }
  /** Excel原流写入器只推迟prepare，其ZIP/XML背压及格式预算全部保持。 */
  excelFile(): AtomicFile {
    if (!this.atomic) throw Error('SQLite导出原暂存未打开');
    const atomic = this.atomic;
    return new Proxy(atomic, { get(target, key) { if (key === 'prepare') return async () => {}; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(atomic) : value; } });
  }
  /** 调用者必须先确认原DBdriver正常关闭，再复核目标，才能fsync/close原暂存。 */
  async prepare(): Promise<void> { this.check(); await this.input.validateDestination(); this.check(); if (!this.atomic) throw Error('SQLite导出原暂存未打开'); await this.atomic.prepare(true); this.check(); }
  /** 最后一次目标/文档核验后进入不可取消rename边界；ACK之后不以晚撤权抹掉提交事实。 */
  async commit(): Promise<void> { this.check(); await this.input.validateDestination(); this.check(); if (!this.atomic) throw Error('SQLite导出原暂存未打开'); await this.atomic.commit(); }
  /** 只有准确关闭与删除/已发布均确认，才释放同目标锁并通知Main跨入口预留可释放。 */
  private release(): void {
    if (this.record?.handle && (!this.record.closed || !this.record.removed && !this.fileCommitted)) throw Error('SQLite导出原文件资源仍未确认释放');
    this.reservation?.release(); this.cleaned = true; this.finishRecovery();
  }
  /** 正常收尾只尝试一次AtomicFile清理；失败必须保留资源，不能自动吞错改成功。 */
  async dispose(): Promise<void> {
    if (this.cleaned) return;
    if (this.cleanupFailure) throw this.cleanupFailure;
    if (this.rename === 'pending' || this.rename === 'unknown') throw Error('SQLite导出文件发布结果尚未确认，保留原暂存资源');
    try { await this.atomic?.dispose(); this.release(); }
    catch (reason) { this.cleanupFailure = reason; throw reason; }
  }
  /** 仅显式连接close/forceClose在原任务结束后调用，重试原关闭/删除能力，不重放数据或rename。 */
  async recover(): Promise<void> {
    if (this.cleaned) return;
    if (this.rename === 'pending' || this.rename === 'unknown') throw Error('SQLite导出文件发布结果未知，不能重试替换或释放目标预留');
    if (this.reservationWork && !this.reservation) try { this.reservation = await this.reservationWork; } catch { /* 未取得预留便没有可释放的原目标锁。 */ }
    if (this.record?.handle) { await this.closeRecord(this.record); if (!this.fileCommitted) await this.removeRecord(this.record); }
    this.release();
  }
}

/** 有数据时只用单条无LIMIT SELECT流写；结构及附属对象沿同一只读快照，原data模式保持INSERT-only。 */
export async function prepareSqliteTableExport(driver: SqliteDriverSession, input: SqliteTableExportRequest, file: SqliteTableExportFile, control: SqliteTableBrowseControl & { progress(rows: number): void }): Promise<number> {
  if (!driver.readOnly) throw Error('SQLite完整导出必须使用独立物理只读连接');
  const { filePath: _path, assertCurrent: _owner, validateDestination: _destination, retainDestinationUntil: _retain, ...publicInput } = input;
  const parsed = sqliteTableExportSchema.parse(publicInput); let count = 0, failed = false, failure: unknown;
  const channel = parsed.format === 'xlsx' ? new RowChannel() : undefined; let excel: Promise<{ rows: number; bytes: number }> | undefined;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const source = await readSqliteTableCatalogue(driver, parsed.table, control);
    if (source.schemaKey !== parsed.schemaKey) throw Error('SQLite源表结构已变化，请刷新表浏览后重新导出');
    const structure = parsed.format === 'sql' && (parsed.sqlContent === 'structure' || parsed.sqlContent === 'structure-data'), hasData = !(structure && parsed.sqlContent === 'structure');
    const names = new Map(source.columns.map(column => [column.name, column])), selected: SqliteTableColumn[] = parsed.columns.map(name => { const column = names.get(name); if (!column) throw Error('SQLite导出列已不存在，请刷新表结构'); return column; });
    if (parsed.format === 'sql' && (hasData && source.kind !== 'table' || selected.some(column => column.generated))) throw Error('SQLite INSERT导出不接受视图或显式生成列，请改用CSV/JSON/XLSX或重新选择普通列');
    if (structure && hasData) {
      const writable = source.columns.filter(column => !column.generated);
      if (selected.length !== writable.length || writable.some(column => !parsed.columns.includes(column.name))) throw Error('SQLite结构及数据导出必须恰好选择全部非生成列，允许调整列顺序');
    }
    const schema = structure ? await readSqliteSchemaExport(driver, parsed.table, source, control) : undefined;
    // 只改变投影做原字节校验；WHERE/ORDER BY始终引用原表全限定列，保留原collation与动态类型。
    const plan = hasData ? buildSqliteTableSelect({ connectionId: parsed.connectionId, database: 'main', table: parsed.table, taskId: parsed.taskId, mode: parsed.mode, filters: parsed.filters, sort: parsed.sort, limit: 1, offset: 0 }, source.columns, parsed.columns, true,
      column => 'CASE WHEN typeof(' + column + ")='text' THEN " + sqliteExportTextFunction + '(' + column + ', CAST(' + column + ' AS BLOB)) ELSE ' + column + ' END') : undefined;
    await file.open(); control.check(); const delimiter = csvExportDelimiter(parsed.format, parsed.csvDelimiter);
    if (parsed.format !== 'xlsx' && parsed.encoding === 'utf16le') await file.write('\uFEFF');
    if (parsed.format === 'csv') await file.write(selected.map(column => csvHeader(column.name, delimiter)).join(delimiter) + '\r\n');
    if (parsed.format === 'json') await file.write('[\n');
    if (schema) await file.write(schema.beforeData);
    if (channel) {
      excel = exportExcelFile({ filePath: input.filePath, columns: selected.map(column => ({ name: column.name, type: 'SQLITE' })), rows: channel, deferredAtomicFile: file.excelFile(), checkCancelled: control.check, onCommitStart: () => { throw Error('SQLite Excel不能自行发布文件'); } });
      void excel.catch(reason => { channel.fail(reason); });
    }
    const result = plan ? await driver.streamRead(plan.sql, {
      parameters: plan.parameters, batchRows: 100,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== selected.length || statement.columns.some((column, index) => column.name !== selected[index].name)) throw Error('SQLite导出结果与真实选择列不一致'); },
      onBatch: async batch => {
        control.check(); if (batch.index !== 0) throw Error('SQLite完整导出出现了额外结果集');
        for (const row of batch.rows) {
          control.check(); if (row.length !== selected.length || !Number.isSafeInteger(count + 1)) throw Error('SQLite导出原结果行或计数无效');
          if (channel) await channel.write(row.map(sqliteWorkspaceValue));
          else if (parsed.format === 'sql') await file.write('INSERT INTO "main".' + quoteSqliteIdentifier(parsed.table) + ' (' + selected.map(column => quoteSqliteIdentifier(column.name)).join(', ') + ') VALUES (' + row.map(sqliteInsertLiteral).join(', ') + ');\n');
          else {
            const values = row.map(sqliteWorkspaceValue);
            await file.write(parsed.format === 'csv' ? values.map(value => csvCell(value, delimiter)).join(delimiter) + '\r\n' : (count ? ',\n' : '') + '{' + selected.map((column, index) => JSON.stringify(column.name) + ':' + JSON.stringify(values[index])).join(',') + '}');
          }
          count++; if (count % 100 === 0) control.progress(count);
        }
      },
    }) : undefined;
    if (result && (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== count)) throw Error('SQLite完整导出没有取得完整原生终态，文件未发布');
    channel?.end(); if (excel && (await excel).rows !== count) throw Error('SQLite Excel导出行数与原结果不一致');
    if (parsed.format === 'json') await file.write('\n]\n');
    if (schema) await file.write(schema.afterData);
  } catch (reason) { failed = true; failure = reason; channel?.fail(reason); if (excel) await excel.catch(() => {}); }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) {
    try { await driver.execute('ROLLBACK'); }
    catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite导出失败且读快照回滚未确认', { cause: failure }) : reason; failed = true; }
  } else if (!driver.isClosed && driver.transaction !== false) {
    const reason = Error('SQLite导出读快照状态未知，必须确认原driver退出'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite导出失败且读快照状态未知', { cause: failure }) : reason; failed = true;
  }
  if (failed) throw failure;
  control.check(); return count;
}
