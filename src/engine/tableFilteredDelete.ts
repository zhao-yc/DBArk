import { createHash, randomUUID } from 'node:crypto';
import type { CellValue, ColumnInfo, DataRow, TableInfo } from '../shared/contracts';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { buildTableReadOrder } from '../shared/tableReadSql';
import { tableFilteredDeleteApplyInputSchema, tableFilteredDeleteScopeIdentity, tableFilteredDeleteConfirmation, tableFilteredDeleteLimits as limits, tableFilteredDeletePreviewInputSchema, tableFilteredDeleteReleaseInputSchema, tableFilteredDeleteText as text, tableFilteredDeleteVersionSupported, type TableFilteredDeleteApplyInput, type TableFilteredDeleteApplyOutput, type TableFilteredDeletePreviewInput, type TableFilteredDeletePreviewOutput, type TableFilteredDeleteProgress, type TableFilteredDeleteReleaseInput, type TableFilteredDeleteTarget } from '../shared/tableFilteredDelete';
import { parseTableColumnDefinition } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { consumeQueryFrames } from './queryStreamProtocol';
import { buildChanges, buildTableFilterSql, deserializeCell, identifier, inlineParameters, qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { command, configure, header, transaction } from './tableFilteredUpdateProtocol';
import { configureTableFilteredDeleteForeignKeys, readTableFilteredDeleteTarget as readTarget, tableFilteredDeleteFailure } from './tableFilteredDeleteProtocol';
import { TableFilteredUpdateSpool as TableFilteredDeleteSpool, type TableFilteredUpdateSnapshotRow as TableFilteredDeleteSnapshotRow } from './tableFilteredUpdateSpool';

export interface TableFilteredDeleteHost {
  run<T>(target: TableFilteredDeleteTarget, taskId: string, action: (context: StructureTaskContext) => Promise<T>, progress: TableFilteredDeleteProgress, execution: boolean, finalize: (succeeded: boolean) => Promise<void>): Promise<T>;
  stop(taskId: string): Promise<void>;
}
interface TimeZone { timeZone: string; systemTimeZone: string; utcOffset: string; }
type TargetRead = Awaited<ReturnType<typeof readTarget>>;
interface Entry {
  token: string; target: TableFilteredDeleteTarget; revision: number; generation: number; scopeDigest: string;
  pending: boolean; applying: boolean; revoked: boolean; expires: number; reservedBytes: number; spool?: TableFilteredDeleteSpool; read?: TargetRead; zone?: TimeZone;
  timer?: ReturnType<typeof setTimeout>; cleanup?: Promise<void>; cleanupError?: unknown; done: Promise<void>; finish(): void;
}
const types = new Set(['TINY', 'SHORT', 'LONG', 'INT24', 'YEAR', 'DECIMAL', 'NEWDECIMAL', 'LONGLONG', 'FLOAT', 'DOUBLE', 'NULL', 'DATE', 'NEWDATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'DATETIME2', 'TIMESTAMP2', 'TIME2', 'VARCHAR', 'VAR_STRING', 'STRING', 'ENUM', 'SET', 'JSON', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'BIT']);
/** transactionProtected是历史证明；COMMIT或ROLLBACK后仍保留其证据。 */
export function tableFilteredDeleteProgress(totalRows = 0): TableFilteredDeleteProgress { return { phase: 'preparing', rows: 0, totalRows, snapshotBytes: 0, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent' }; }
function revision(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw Error(text.stale); return value; }
/** 保留原筛选会话时区；SYSTEM额外核实际系统区及当前偏移，不用UTC替换已应用条件。 */
export async function tableFilteredDeleteTimeZone(context: StructureTaskContext): Promise<TimeZone> {
  const rows = (await structureTaskQuery<TimeZone[]>(context, 'SELECT @@SESSION.time_zone AS timeZone,@@system_time_zone AS systemTimeZone,CAST(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) AS CHAR) AS utcOffset')).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Reflect.ownKeys(rows[0]).length !== 3) throw Error(text.changed);
  const row = rows[0];
  if (typeof row.timeZone !== 'string' || !/^[A-Za-z0-9_+/:.\-]{1,100}$/.test(row.timeZone) || typeof row.systemTimeZone !== 'string' || !row.systemTimeZone || row.systemTimeZone.length > 100 || typeof row.utcOffset !== 'string' || !/^-?\d{1,6}$/.test(row.utcOffset) || Math.abs(Number(row.utcOffset)) > 86400) throw Error(text.changed);
  return { timeZone: row.timeZone, systemTimeZone: row.systemTimeZone, utcOffset: row.utcOffset };
}
/** 元数据可靠键来自原完整目录，且本地再核唯一性、列存在、非空和无重复。 */
export function validateTableFilteredDeleteTarget(read: TargetRead): void {
  const source = read.source, keys = source.editableKey;
  if (!source.columns.length || source.columns.length > limits.columns || !keys.length || new Set(keys).size !== keys.length || keys.some(key => !source.columns.some(column => column.name === key && !column.nullable)) || !source.indexes.some(index => index.unique && JSON.stringify(index.columns) === JSON.stringify(keys))) throw Error(text.unsupported);
  const parsed = parseTableColumnDefinition(source.ddl, read.context), indexes = readTableIndexDefinition(parsed).indexes;
  // 定位键必须在完整原DDL中可证明为整列唯一索引，前缀／表达式唯一性不能代替可靠行身份。
  if (!indexes.some(index => ['primary', 'unique'].includes(index.kind) && !index.opaqueReasons.length && index.parts.length === keys.length && index.parts.every((part, position) => part.columnName === keys[position] && part.prefixLength === undefined && part.expressionSql === undefined && !part.opaqueReasons.length))) throw Error(text.unsupported);
}
function timestamps(source: TableInfo): ColumnInfo[] { return source.columns.filter(column => /^TIMESTAMP\b/i.test(column.type)); }
/** 共享表页WHERE与ORDER BY；TIMESTAMP附加绝对时间只供内部快照，不改变原筛选语义。 */
export function planTableFilteredDelete(source: TableInfo, input: TableFilteredDeletePreviewInput): { sql: string; timestampColumns: ColumnInfo[] } {
  if (tableCopyMetadataKey(source) !== input.metadataKey) throw Error(text.changed);
  const columns = timestamps(source); if (source.columns.length + columns.length > limits.columns) throw Error(text.unsupported);
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup), order = buildTableReadOrder(source, input.sort);
  const projection = [...source.columns.map(column => identifier(column.name)), ...columns.map((column, index) => `CAST(UNIX_TIMESTAMP(${identifier(column.name)}) AS CHAR) AS ${identifier('__dbark_epoch_' + index)}`)];
  const sql = inlineParameters(`SELECT ${projection.join(', ')} FROM ${qualified(source.database, source.name)}${filter.where ? ' WHERE ' + filter.where : ''}${order ? ' ORDER BY ' + order : ''}`, filter.params);
  if (Buffer.byteLength(sql) > limits.definitionBytes) throw Error(text.budget); return { sql, timestampColumns: columns };
}
/** 所有旧列参与原buildChanges定位；同墙钟的TIMESTAMP还必须匹配原epoch，防DST误删除。 */
export function tableFilteredDeleteStatement(source: TableInfo, row: TableFilteredDeleteSnapshotRow): { sql: string; params: CellValue[] } {
  const temporal = timestamps(source);
  if (row.values.length !== source.columns.length || row.timestampEpochs.length !== temporal.length) throw Error(text.spool);
  const before: DataRow = Object.fromEntries(source.columns.map((item, index) => [item.name, row.values[index]]));
  const statement = buildChanges(source, [{ kind: 'delete', before }]).statements[0];
  if (!statement) throw Error(text.invalid);
  const guards = temporal.map((item, index) => {
    const epoch = row.timestampEpochs[index], original = before[item.name];
    if (epoch === null ? original !== null : typeof epoch !== 'string' || !/^-?\d+(?:\.\d{1,6})?$/.test(epoch) || original === null) throw Error(text.timestamp);
    return `UNIX_TIMESTAMP(${identifier(item.name)}) <=> CAST(? AS DECIMAL(20,6))`;
  });
  return { sql: statement.sql + (guards.length ? ' AND ' + guards.join(' AND ') : ''), params: [...statement.params, ...row.timestampEpochs] };
}

/** 一次性预览保存磁盘快照；在途预留直到真实数据库和文件收尾完成才释放。 */
export class TableFilteredDeleteTasks {
  private readonly entries = new Map<string, Entry>(); private readonly generations = new Map<string, number>();
  constructor(private readonly host: TableFilteredDeleteHost, private readonly now = () => Date.now()) {}
  private time(): number { const value = this.now(); if (!Number.isFinite(value)) throw Error(text.stale); return value; }
  private current(entry: Entry): void { if (entry.revoked || this.entries.get(entry.token) !== entry || entry.generation !== (this.generations.get(entry.target.connectionId) ?? 0) || !entry.pending && !entry.applying && entry.expires <= this.time()) throw Error(text.stale); }
  private retainedBytes(): number { return [...this.entries.values()].reduce((sum, entry) => sum + entry.reservedBytes, 0); }
  private clearTimer(entry: Entry): void { if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined; }
  private cleanup(entry: Entry): Promise<void> {
    if (entry.cleanup) return entry.cleanup;
    this.clearTimer(entry); entry.revoked = true;
    entry.cleanup = (async () => { try { await entry.spool?.dispose(); entry.cleanupError = undefined; this.entries.delete(entry.token); } catch (error) { entry.cleanupError = error; throw error; } finally { entry.cleanup = undefined; } })();
    return entry.cleanup;
  }
  private expire(entry: Entry): void {
    this.clearTimer(entry); entry.timer = setTimeout(() => { entry.timer = undefined; if (entry.pending || entry.applying) return; try { if (entry.expires > this.time()) { this.expire(entry); return; } } catch { entry.revoked = true; } void this.cleanup(entry).catch(() => { /* 保留失败账本与原spool，退出/显式释放时重新报告。 */ }); }, Math.max(1, entry.expires - this.time())); entry.timer.unref();
  }
  async preview(raw: TableFilteredDeletePreviewInput, connectionRevision: number): Promise<TableFilteredDeletePreviewOutput> {
    const input = tableFilteredDeletePreviewInputSchema.parse(raw); revision(connectionRevision);
    for (const old of this.entries.values()) if (!old.pending && !old.applying && old.expires <= this.time()) await this.cleanup(old);
    if (this.entries.size >= limits.previews) throw Error(text.budget);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const entry: Entry = { token: randomUUID(), target: { connectionId: input.connectionId, database: input.database, table: input.table }, revision: connectionRevision, generation: this.generations.get(input.connectionId) ?? 0, scopeDigest: createHash('sha256').update(tableFilteredDeleteScopeIdentity(input)).digest('hex'), expires: Infinity, reservedBytes: 0, pending: true, applying: false, revoked: false, done, finish };
    this.entries.set(entry.token, entry); const state = tableFilteredDeleteProgress();
    try {
      const result = await this.host.run(entry.target, input.taskId, async context => {
        const check = () => { context.checkCancelled(); this.current(entry); }; check();
        // 连接握手的实际版本决定能力；拒绝发生在配置、事务、快照及任何写命令之前。
        if (!tableFilteredDeleteVersionSupported(context.managed.status.dialect, context.managed.status.version)) throw Error(text.version);
        await configureTableFilteredDeleteForeignKeys(context);
        await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await structureTaskQuery(context, 'START TRANSACTION READ ONLY');
        await structureTaskQuery(context, `SELECT 1 FROM ${qualified(input.database, input.table)} LIMIT 0`); transaction(context);
        const zone = await tableFilteredDeleteTimeZone(context), read = await readTarget(context, entry.target); transaction(context);
        validateTableFilteredDeleteTarget(read); const plan = planTableFilteredDelete(read.source, input);
        entry.spool = await TableFilteredDeleteSpool.create(check); state.phase = 'snapshotting'; context.report();
        let starts = 0, ends = 0, warningCount: number | undefined, sampleBytes = 0, shownRows = 0, sampleFull = false; const sample: string[] = [];
        await consumeQueryFrames(context.managed, plan.sql, 'binary', { statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, checkCancelled: check, commandStarted: context.commandStarted, stop: () => this.host.stop(input.taskId), consume: async frame => {
          check();
          if (frame.kind === 'rows-start') {
            if (++starts !== 1 || frame.resultOrdinal !== 1 || frame.rowResultOrdinal !== 1 || frame.columns.length !== read.source.columns.length + plan.timestampColumns.length || frame.columns.some((column, index) => column.position !== index + 1 || !types.has(column.type) || column.name !== (read.source.columns[index]?.name ?? '__dbark_epoch_' + (index - read.source.columns.length)))) throw Error(text.invalid);
          } else if (frame.kind === 'row') {
            if (starts !== 1 || ends || frame.resultOrdinal !== 1 || frame.values.length !== read.source.columns.length + plan.timestampColumns.length) throw Error(text.invalid);
            const row: TableFilteredDeleteSnapshotRow = { values: frame.values.slice(0, read.source.columns.length), timestampEpochs: frame.values.slice(read.source.columns.length) as (string | null)[] };
            const statement = tableFilteredDeleteStatement(read.source, row);
            await entry.spool!.append(row, check, additional => { if (this.retainedBytes() + additional > limits.spoolBytes) throw Error(text.budget); entry.reservedBytes += additional; });
            // 先用参数原文大小作保守上界，整条样本超限就省略，绝不切断值或谓词。
            const estimate = Buffer.byteLength(statement.sql) + statement.params.reduce<number>((sum, value) => sum + (typeof value === 'string' ? Buffer.byteLength(value) * 2 + 32 : value && typeof value === 'object' ? value.base64.length * 2 + 32 : 64), 0);
            if (!sampleFull && entry.spool!.rows <= limits.shownRows) { if (estimate > limits.previewSqlBytes - sampleBytes) sampleFull = true; else { const sql = inlineParameters(statement.sql, statement.params) + ';'; const size = Buffer.byteLength(sql) + 1; if (size <= limits.previewSqlBytes - sampleBytes) { sample.push(sql); sampleBytes += size; shownRows++; } else sampleFull = true; } }
            state.rows = state.totalRows = entry.spool!.rows; state.snapshotBytes = entry.spool!.bytes; if (state.rows % 100 === 0) context.report();
          } else if (frame.kind === 'rows-end') { if (++ends !== 1 || starts !== 1 || frame.resultOrdinal !== 1) throw Error(text.invalid); warningCount = frame.warningCount; }
          else throw Error(text.invalid);
        } });
        const warnings = (await structureTaskQuery<unknown[]>(context, 'SHOW WARNINGS LIMIT 21')).rows;
        if (!Array.isArray(warnings) || warnings.length || warningCount !== 0 || starts !== 1 || ends !== 1) throw Error(text.warnings);
        const after = await readTarget(context, entry.target), afterZone = await tableFilteredDeleteTimeZone(context);
        if (tableCopyMetadataKey(after.source) !== input.metadataKey || read.definitionDigest !== after.definitionDigest || read.serverIdentity !== after.serverIdentity || JSON.stringify(zone) !== JSON.stringify(afterZone)) throw Error(text.changed);
        await structureTaskQuery(context, 'ROLLBACK AND NO CHAIN NO RELEASE'); check();
        await entry.spool.seal(check); check(); entry.read = read; entry.zone = zone; state.phase = 'releasing'; context.report();
        return { previewToken: entry.token, target: { ...entry.target }, operation: 'delete' as const, rows: entry.spool.rows, shownRows, sql: sample.join('\n'), sampleOmitted: shownRows < entry.spool.rows, expiresAt: '', definitionDigest: read.definitionDigest, scopeDigest: entry.scopeDigest, timeZone: zone.timeZone, warnings: [`源会话time_zone=${zone.timeZone}；system_time_zone=${zone.systemTimeZone}；当前UTC偏移${zone.utcOffset}秒，原筛选保持该时区语义。`, '删除范围是完整冻结快照；预览后新增匹配行不会删除。', '已拒绝目标触发器、外键级联和不完整的依赖目录；RESTRICT冲突仍会导致整批回滚。', '确认后以独立单事务删除；提交后不能通过撤销恢复。', ...(shownRows < entry.spool.rows ? [text.omitted] : [])] };
      }, state, false, async succeeded => { if (!succeeded) { entry.pending = false; await this.cleanup(entry); } });
      this.current(entry); entry.pending = false; entry.expires = this.time() + limits.lifetimeMs; this.expire(entry); state.phase = 'finished';
      return { ...result, expiresAt: new Date(entry.expires).toISOString() };
    } catch (error) { entry.pending = false; try { if (entry.cleanupError) throw entry.cleanupError; if (this.entries.has(entry.token)) await this.cleanup(entry); } catch (cleanup) { throw new AggregateError([error, cleanup], text.spool); } throw tableFilteredDeleteFailure(error); }
    finally { entry.finish(); }
  }
  /** 首await前消费令牌，完整预扫文件与全部旧行后才发第一条逐行DELETE。 */
  async apply(raw: TableFilteredDeleteApplyInput, connectionRevision: number): Promise<TableFilteredDeleteApplyOutput> {
    const input = tableFilteredDeleteApplyInputSchema.parse(raw), entry = this.entries.get(input.previewToken);
    if (!entry || entry.pending || entry.applying) throw Error(text.stale); entry.applying = true; this.clearTimer(entry);
    let finish!: () => void; entry.done = new Promise<void>(resolve => { finish = resolve; }); entry.finish = finish;
    const state = tableFilteredDeleteProgress(entry.spool?.rows ?? 0); state.snapshotBytes = entry.spool?.bytes ?? 0;
    let committed: TableFilteredDeleteApplyOutput | undefined, failure: unknown;
    try {
      this.current(entry);
      if (!entry.spool || !entry.read || !entry.zone || !entry.spool.rows || entry.expires <= this.time() || entry.revision !== revision(connectionRevision) || input.connectionId !== entry.target.connectionId || input.confirmation !== tableFilteredDeleteConfirmation({ target: entry.target, rows: entry.spool.rows })) throw Error(text.stale);
      const result = await this.host.run(entry.target, input.taskId, async context => {
        const check = () => { context.checkCancelled(); this.current(entry); }; check();
        // 预览与执行是独立物理连接，不能仅相信预览时的版本或渲染进程传来的状态。
        if (!tableFilteredDeleteVersionSupported(context.managed.status.dialect, context.managed.status.version)) throw Error(text.version);
        await configure(context, entry.zone!.timeZone); await configureTableFilteredDeleteForeignKeys(context); check();
        if (JSON.stringify(await tableFilteredDeleteTimeZone(context)) !== JSON.stringify(entry.zone)) throw Error(text.changed);
        let begun = false;
        try {
          header(await command(context, 'START TRANSACTION', undefined), true, 0); begun = true;
          // 常量零行DELETE只在明确确认后的事务内发送，用于获取目标写MDL；不触发任何行级操作，不计删除行数。
          state.transactionProtected = true;
          const locked = await command(context, `DELETE FROM ${qualified(entry.target.database, entry.target.table)} WHERE 0`, undefined, () => { state.dmlMayHaveBeenSent = true; state.outcome = 'unknown'; context.report(); });
          if (!locked || !Number.isSafeInteger(locked.serverStatus) || !(locked.serverStatus & 1)) { state.transactionProtected = false; throw Error(text.transaction); }
          header(locked, true, 0); transaction(context);
          const read = await readTarget(context, entry.target); transaction(context);
          if (read.definitionDigest !== entry.read!.definitionDigest || read.serverIdentity !== entry.read!.serverIdentity) throw Error(text.changed);
          validateTableFilteredDeleteTarget(read); state.transactionProtected = true; state.phase = 'validating'; context.report();
          for await (const row of entry.spool!.read(check)) { tableFilteredDeleteStatement(read.source, row); transaction(context); }
          check(); state.phase = 'deleting'; context.report();
          for await (const row of entry.spool!.read(check)) {
            check(); transaction(context); const statement = tableFilteredDeleteStatement(read.source, row);
            const updated = await command(context, statement.sql, statement.params.map(deserializeCell), () => { const first = !state.dmlMayHaveBeenSent; state.dmlMayHaveBeenSent = true; state.outcome = 'unknown'; if (first) context.report(); });
            // 若成功包明确离开原事务，后续ROLLBACK OK不能反证此前写入已回滚。
            if (!updated || !Number.isSafeInteger(updated.serverStatus) || !(updated.serverStatus & 1)) { state.transactionProtected = false; throw Error(text.transaction); }
            header(updated, true, 1); transaction(context); state.rows++; if (state.rows % 100 === 0 || state.rows === state.totalRows) context.report();
          }
          check(); transaction(context); if (state.rows !== state.totalRows || JSON.stringify(await tableFilteredDeleteTimeZone(context)) !== JSON.stringify(entry.zone)) throw Error(text.changed);
          const after = await readTarget(context, entry.target); if (after.definitionDigest !== read.definitionDigest || after.serverIdentity !== read.serverIdentity) throw Error(text.changed);
          check(); transaction(context); state.phase = 'committing';
          await command(context, 'COMMIT', undefined, () => { state.commitMayHaveBeenSent = true; context.report(); }, acknowledged => {
            if (!acknowledged || acknowledged.affectedRows !== 0 || !Number.isSafeInteger(acknowledged.serverStatus) || acknowledged.serverStatus & 1) throw Error(text.unknown);
            state.commitAcknowledged = true; state.outcome = 'committed'; committed = { operation: 'delete', target: { ...entry.target }, rows: state.rows, outcome: 'committed', commitAcknowledged: true }; header(acknowledged, false, 0);
          });
          state.phase = 'releasing'; context.report(); return committed!;
        } catch (error) {
          if (state.commitAcknowledged && committed) return committed;
          if (begun && !state.commitMayHaveBeenSent && !context.managed.broken && !context.managed.signal?.aborted) {
            state.phase = 'rolling-back'; try { context.report(); } catch { /* 原回滚不能被显示错误跳过。 */ }
            try { header(await command(context, 'ROLLBACK', undefined, undefined, undefined, true), false, 0); state.rollbackAcknowledged = true; state.outcome = state.dmlMayHaveBeenSent ? state.transactionProtected ? 'rolled-back' : 'unknown' : 'not-sent'; } catch { if (state.dmlMayHaveBeenSent) state.outcome = 'unknown'; }
            try { context.report(); } catch { /* 已确认回滚事实保持。 */ }
          }
          if (state.commitMayHaveBeenSent || state.dmlMayHaveBeenSent && (!state.rollbackAcknowledged || !state.transactionProtected)) throw Error(text.unknown);
          throw error;
        }
      }, state, true, async () => { await this.cleanup(entry); });
      state.phase = 'finished'; return result;
    } catch (error) { failure = error; if (state.commitAcknowledged && committed) return committed; throw tableFilteredDeleteFailure(error); }
    finally {
      entry.applying = false;
      try { if (entry.cleanupError) throw entry.cleanupError; if (this.entries.has(entry.token)) await this.cleanup(entry); } catch (cleanup) { if (!state.commitAcknowledged) throw failure ? new AggregateError([failure, cleanup], text.spool) : cleanup; /* COMMIT ACK优先；失败spool仍在账本，退出时继续报告。 */ }
      finally { entry.finish(); }
    }
  }
  /** release不借新任务取消写入；正在执行时由原task取消和严格收尾负责。 */
  async release(raw: TableFilteredDeleteReleaseInput): Promise<void> {
    const input = tableFilteredDeleteReleaseInputSchema.parse(raw), entry = this.entries.get(input.previewToken); if (!entry) return;
    if (entry.target.connectionId !== input.connectionId || entry.applying) throw Error(text.stale); entry.revoked = true; this.clearTimer(entry);
    if (entry.pending) await entry.done; else await this.cleanup(entry);
    if (entry.cleanupError) throw entry.cleanupError;
  }
  /** 同步撤销原能力，再等待在途任务和本例文件清理；不以观察超时冒充已停止。 */
  async releaseConnection(id?: string): Promise<void> {
    if (id !== undefined) this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const entries = [...this.entries.values()].filter(entry => id === undefined || entry.target.connectionId === id);
    for (const entry of entries) { entry.revoked = true; this.clearTimer(entry); }
    const results = await Promise.allSettled(entries.map(async entry => { if (entry.pending || entry.applying) await entry.done; if (this.entries.has(entry.token)) await this.cleanup(entry); }));
    const errors = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected').map(value => value.reason); if (errors.length) throw new AggregateError(errors, text.spool);
  }
  close(): Promise<void> { return this.releaseConnection(); }
}
