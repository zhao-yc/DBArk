import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import type { EventEmitter } from 'node:events';
import type { ColumnInfo, ResultExportData, TableInfo } from '../shared/contracts';
import { resultInsertApplyInputSchema, resultInsertConfirmation, resultInsertLimits as limits, resultInsertPreviewInputSchema, resultInsertReleaseInputSchema, resultInsertText as text, type ResultInsertApplyInput, type ResultInsertApplyOutput, type ResultInsertMapping, type ResultInsertPreviewInput, type ResultInsertPreviewOutput, type ResultInsertProgress, type ResultInsertReleaseInput, type ResultInsertTarget } from '../shared/resultInsert';
import { readControlledTimestampDefault, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { readIncomingReferenceTable, incomingReferenceSourceDigest } from './incomingReferences';
import { validateLosslessImport } from './losslessImport';
import { deserializeCell, identifier, inlineParameters, qualified, typedCellPlaceholder } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

export interface ResultInsertHost {
  run<T>(target: ResultInsertTarget, taskId: string, action: (context: StructureTaskContext) => Promise<T>, progress: ResultInsertProgress, execution: boolean): Promise<T>;
}
interface TargetRead { source: TableInfo; definitionDigest: string; serverIdentity: string; context: TableDefinitionContext; }
interface Preview {
  token: string; target: ResultInsertTarget; revision: number; generation: number; expires: number; bytes: number;
  data: ResultExportData; mapping: ResultInsertMapping[]; timeZone: string; read?: TargetRead; applying: boolean; pending: boolean; revoked: boolean; timer?: ReturnType<typeof setTimeout>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string) => `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'`;
/** 每个阶段单独记录发送与ACK事实；Promise拒绝不能改写已收到的提交成功。 */
export function resultInsertProgress(totalRows: number): ResultInsertProgress {
  return { phase: 'preparing', rows: 0, totalRows, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: false, outcome: 'not-sent' };
}
function version(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw Error(text.stale); return value; }
/** 逐行计量原文，不构造第二份完整结果JSON；额外预留元数据和完整SQL样本空间。 */
function reservedBytes(data: ResultExportData, mapping: ResultInsertMapping[]): number {
  let bytes = 64 + Buffer.byteLength(JSON.stringify(data.columns)) + Buffer.byteLength(JSON.stringify(mapping));
  for (const row of data.rows) bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
  return bytes + 2 * limits.definitionBytes + limits.previewSqlBytes + 4096;
}
/** 预览拥有独立冻结副本，合法__proto__内部键作为普通自有字段保留。 */
function freezeData(data: ResultExportData): ResultExportData {
  const rows = data.rows.map(row => Object.freeze(Object.fromEntries(data.columns.map(column => {
    const value = row[column.key]; return [column.key, value && typeof value === 'object' ? Object.freeze({ type: 'binary' as const, base64: value.base64 }) : value];
  }))));
  return Object.freeze({ columns: Object.freeze(data.columns.map(column => Object.freeze({ ...column }))), rows: Object.freeze(rows), truncated: data.truncated }) as unknown as ResultExportData;
}
/** 身份只比较服务器/授权主体，物理会话编号另核；不能把新会话编号纳跨会话摘要。 */
async function serverIdentity(context: StructureTaskContext): Promise<string> {
  const managed = context.managed, uuid = managed.status.dialect === 'mysql' ? '@@server_uuid' : 'NULL';
  const records = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT @@version AS version,@@hostname AS hostname,CAST(@@port AS CHAR) AS port,CAST(@@server_id AS CHAR) AS serverId,CURRENT_USER() AS currentUser,CAST(CONNECTION_ID() AS CHAR) AS connectionId,CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate,@@character_set_connection AS charset,@@collation_connection AS collation,${uuid} AS uuid`)).rows;
  const keys = ['version', 'hostname', 'port', 'serverId', 'currentUser', 'connectionId', 'quoteShowCreate', 'charset', 'collation', 'uuid'];
  if (!Array.isArray(records) || records.length !== 1 || !records[0] || Reflect.ownKeys(records[0]).length !== keys.length) throw Error(text.changed);
  const row = records[0], decimal = (value: unknown) => typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value);
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(row, key); if (!field || !field.enumerable || !('value' in field)) throw Error(text.changed); }
  if (row.version !== managed.status.version || typeof row.hostname !== 'string' || !row.hostname || typeof row.currentUser !== 'string' || !row.currentUser || !decimal(row.port) || BigInt(row.port as string) < 1n || BigInt(row.port as string) > 65535n || !decimal(row.serverId) || !decimal(row.connectionId) || BigInt(row.connectionId as string) !== BigInt(managed.connection.threadId) || row.quoteShowCreate !== '1' || row.charset !== 'utf8mb4' || typeof row.collation !== 'string' || !/^utf8mb4_/i.test(row.collation) || (managed.status.dialect === 'mysql' ? typeof row.uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.uuid) : row.uuid !== null)) throw Error(text.changed);
  return hash([managed.status.dialect, ...keys.filter(key => key !== 'connectionId').map(key => [key, row[key]])]);
}
/** 只有显式直接TRIGGER授权可证明目录完整；角色、部分撤销或未知语法不猜测为空。 */
export function resultInsertTriggerVisibility(grants: readonly string[], target: ResultInsertTarget, mode: TableDefinitionContext): boolean {
  let proven = false;
  for (const grant of grants) {
    const tokens = tableDefinitionTokens(grant, mode), word = (index: number) => tokens[index]?.kind === 'word' ? tokens[index].value.toUpperCase() : '';
    if (word(0) === 'REVOKE' || tokens.some(token => token.kind === 'executable')) return false;
    const on = tokens.findIndex((_, index) => word(index) === 'ON');
    if (word(0) !== 'GRANT' || on < 2 || tokens[on + 2]?.value !== '.' || word(on + 4) !== 'TO') continue;
    const database = tokens[on + 1], table = tokens[on + 3];
    if (!database || !table || !['word', 'identifier', 'symbol'].includes(database.kind) || !['word', 'identifier', 'symbol'].includes(table.kind)) continue;
    const scope = database.value === '*' && table.value === '*' || database.value === target.database && (table.value === '*' || table.value === target.table);
    if (!scope) continue;
    const privileges = grant.slice(tokens[1].start, tokens[on].start).toUpperCase().split(',').map(value => value.trim());
    if (privileges.some(value => ['ALL', 'ALL PRIVILEGES', 'TRIGGER'].includes(value))) proven = true;
  }
  return proven;
}
/** 完整目标和事务副作用目录同一会话读取，定义摘要只忽略解析确认的表尾自增计数。 */
async function readTarget(context: StructureTaskContext, target: ResultInsertTarget): Promise<TargetRead> {
  const before = await serverIdentity(context), source = await readIncomingReferenceTable(context, target);
  if (source.objectKind !== 'table' || source.engine.toUpperCase() !== 'INNODB' || !source.columns.length || source.columns.length > 4096 || new Set(source.columns.map(column => column.name)).size !== source.columns.length || Buffer.byteLength(source.ddl) > limits.definitionBytes || Buffer.byteLength(JSON.stringify(source)) > limits.definitionBytes || typeof context.managed.sqlMode !== 'string') throw Error(text.unsupported);
  const modes = context.managed.sqlMode.split(','), definitionContext: TableDefinitionContext = { dialect: context.managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } };
  const grants = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(grants) || grants.length > 256 || Buffer.byteLength(JSON.stringify(grants)) > 512 * 1024 || !resultInsertTriggerVisibility(grants.map(row => { const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') throw Error(text.triggers); return values[0]; }), target, definitionContext)) throw Error(text.triggers);
  const triggers = (await structureTaskQuery<unknown[]>(context, `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(${literal(target.table)} AS BINARY) LIMIT 1`)).rows;
  if (!Array.isArray(triggers) || triggers.length) throw Error(text.triggers);
  const parsed = parseTableColumnDefinition(source.ddl, definitionContext);
  if (parsed.table !== target.table || parsed.database !== undefined && parsed.database !== target.database || parsed.columns.length !== source.columns.length || parsed.columns.some((column, index) => column.name !== source.columns[index].name)) throw Error(text.changed);
  // 默认表达式、生成式和CHECK可能触及存储函数/序列。仅放行明确无外部副作用的片段。
  for (const column of parsed.columns) {
    if (column.default.kind === 'opaque' || column.default.kind === 'expression' && !readControlledTimestampDefault(column.default.sql)) throw Error(text.triggers);
    for (const attribute of column.attributes) {
      if (attribute.kind === 'opaque' || attribute.kind === 'column-format' || attribute.kind === 'storage') throw Error(text.unsupported);
      if (attribute.kind === 'generated') {
        const tokens = tableDefinitionTokens(attribute.raw, definitionContext), allowed = new Set(source.columns.map(item => item.name));
        if (tokens.some((token, index) => token.kind === 'executable' || token.kind === 'string' || token.kind === 'word' && !['GENERATED', 'ALWAYS', 'AS', 'VIRTUAL', 'STORED', 'PERSISTENT'].includes(token.value.toUpperCase()) && !allowed.has(token.value) || ['word', 'identifier'].includes(token.kind) && tokens[index + 1]?.value === '(' && token.value.toUpperCase() !== 'AS')) throw Error(text.triggers);
      }
      if (attribute.kind === 'check' && !/^CHECK\s*\(\s*json_valid\s*\(\s*(?:`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\)$/i.test(attribute.raw.trim())) throw Error(text.triggers);
    }
  }
  if (parsed.items.some(item => item.kind === 'constraint' && tableDefinitionTokens(item.raw, definitionContext).some(token => token.kind === 'word' && token.value.toUpperCase() === 'CHECK'))) throw Error(text.triggers);
  const definitionDigest = incomingReferenceSourceDigest(source, definitionContext), after = await serverIdentity(context);
  if (before !== after) throw Error(text.changed);
  return { source, definitionDigest, serverIdentity: before, context: definitionContext };
}
/** 所有映射和全部行必须先过类型守卫；未知空间/插件类型不能落入无检查分支。 */
export function validateResultInsertRows(source: TableInfo, data: ResultExportData, mapping: ResultInsertMapping[], dialect: 'mysql' | 'mariadb', definitionContext: TableDefinitionContext): ColumnInfo[] {
  const keys = new Set(data.columns.map(column => column.key)), targets = new Set<string>(), parsed = parseTableColumnDefinition(source.ddl, definitionContext);
  if (parsed.columns.length !== source.columns.length || parsed.columns.some((column, index) => column.name !== source.columns[index].name)) throw Error(text.changed);
  const columns = mapping.map(item => {
    const column = source.columns.find(column => column.name === item.target);
    if (!keys.has(item.source) || !column || column.generated || targets.has(item.target)) throw Error(text.mapping);
    targets.add(item.target);
    if (!/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|BOOL|BOOLEAN|DECIMAL|NUMERIC|FIXED|FLOAT|DOUBLE|REAL|BIT|DATE|YEAR|TIME|DATETIME|TIMESTAMP|CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|JSON|ENUM|SET)\b/i.test(column.type)) throw Error(text.unsupported);
    return column;
  });
  for (const column of source.columns) if (!targets.has(column.name) && !column.generated && !column.nullable && !/\bauto_increment\b/i.test(column.extra) && ['none', 'null'].includes(parsed.columnsByName.get(column.name)!.default.kind)) throw Error(text.required);
  for (const row of data.rows) for (const [index, column] of columns.entries()) {
    const value = row[mapping[index].source]; validateLosslessImport(column, value, dialect); typedCellPlaceholder(column, value);
    const jsonAlias = dialect === 'mariadb' && parsed.columnsByName.get(column.name)!.attributes.some(attribute => attribute.kind === 'check' && /\bjson_valid\s*\(/i.test(attribute.raw));
    if ((/^JSON\b/i.test(column.type) || jsonAlias) && value !== null) {
      if (typeof value !== 'string') throw Error('JSON目标要求完整JSON原文');
      // 仅校验语法；解析结果从不传递或重序列化，JSON大整数仍按原文字节写入并由服务器复核。
      try { JSON.parse(value); } catch { throw Error('JSON目标要求有效JSON文本，未发送插入'); }
    }
  }
  return columns;
}
/** 每行一个真实预处理命令；样本也沿相同typed孔位，不把客户端SQL当执行输入。 */
export function resultInsertStatement(target: ResultInsertTarget, columns: ColumnInfo[], mapping: ResultInsertMapping[], row: ResultExportData['rows'][number]): { sql: string; values: (string | number | boolean | null | Buffer)[] } {
  const cells = mapping.map(item => row[item.source]);
  return { sql: `INSERT INTO ${qualified(target.database, target.table)} (${columns.map(column => identifier(column.name)).join(', ')}) VALUES (${columns.map((column, index) => typedCellPlaceholder(column, cells[index])).join(', ')})`, values: cells.map(deserializeCell) };
}
/** 生命周期沿原结构命令回调/断线/取消终态；COMMIT ACK在任何报告或后续检查之前入账。 */
function command(context: StructureTaskContext, sql: string, values: (string | number | boolean | null | Buffer)[] | undefined, submitted?: () => void, acknowledged?: (header: ResultSetHeader) => void, rollingBack = false): Promise<ResultSetHeader> {
  if (!rollingBack) context.checkCancelled(); const managed = context.managed;
  if (managed.broken || managed.signal?.aborted) return Promise.reject(Error(text.unknown));
  return new Promise((resolve, reject) => {
    const finished = context.commandStarted(); let settled = false, callbackSeen = false, terminal = false, physical = false;
    let failure: unknown, result: ResultSetHeader | undefined, query: EventEmitter | undefined;
    const stream = (managed.connection as unknown as { stream?: EventEmitter }).stream;
    const cleanup = () => {
      managed.connection.removeListener('error', connectionError); managed.connection.removeListener('end', closed); stream?.removeListener('close', closed);
      managed.signal?.removeEventListener('abort', aborted); query?.removeListener('end', ended); query?.removeListener('error', queryError); finished();
    };
    const finish = () => {
      if (settled || !physical && !(callbackSeen && terminal)) return;
      settled = true; try { cleanup(); } catch (error) { failure ??= error; }
      if (failure || !result) reject(failure ?? Error(text.unknown)); else resolve(result);
    };
    // 取消仅撤销使用权，不能把ACK或AbortSignal冒充原Query/Execute的真正终态。
    const aborted = () => { failure ??= Error(text.unknown); finish(); };
    const closed = () => { failure ??= Error(text.unknown); physical = true; finish(); };
    const connectionError = (error: Error) => { failure ??= error; physical = true; finish(); };
    const queryError = (error: Error) => { failure ??= error; terminal = true; callbackSeen = true; finish(); };
    const ended = () => { terminal = true; finish(); };
    managed.connection.once('error', connectionError); managed.connection.once('end', closed); stream?.once('close', closed); managed.signal?.addEventListener('abort', aborted, { once: true });
    const done = (error: Error | null, rows: unknown) => {
      if (settled || callbackSeen) return; callbackSeen = true;
      if (error) failure ??= error;
      else { result = rows as ResultSetHeader; try { acknowledged?.(result); } catch (reason) { failure ??= reason; } }
      finish();
    };
    try {
      submitted?.(); query = (values ? managed.connection.execute(sql, values, done) : managed.connection.query(sql, done)) as unknown as EventEmitter;
      if (!query || typeof query.once !== 'function') throw Error(text.unknown);
      query.once('end', ended); query.once('error', queryError);
    } catch (error) { failure ??= error; callbackSeen = true; terminal = true; finish(); }
  });
}
function header(value: ResultSetHeader, inTransaction: boolean, affected: number): void {
  if (!value || value.affectedRows !== affected || value.warningStatus !== 0 || !Number.isSafeInteger(value.serverStatus) || Boolean(value.serverStatus & 1) !== inTransaction) throw Error(text.warnings);
}
function transaction(context: StructureTaskContext): void {
  if (context.managed.broken || context.managed.signal?.aborted || context.managed.transactionStateKnown !== true || !Number.isSafeInteger(context.managed.serverStatus) || !(context.managed.serverStatus! & 1)) throw Error(text.transaction);
}
/** 独立会话增加严格写值模式与显式时区，读回实际值，绝不修改父查询会话。 */
async function configure(context: StructureTaskContext, timeZone: string): Promise<void> {
  const before = (await structureTaskQuery<{ sqlMode: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode')).rows;
  if (!Array.isArray(before) || before.length !== 1 || typeof before[0].sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(before[0].sqlMode)) throw Error(text.transaction);
  const modes = [...new Set([...before[0].sqlMode.split(',').filter(Boolean), 'STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO'])].sort();
  header(await command(context, `SET SESSION sql_mode = '${modes.join(',')}'`, undefined), false, 0);
  header(await command(context, `SET SESSION time_zone = '${timeZone}'`, undefined), false, 0);
  const actual = (await structureTaskQuery<{ sqlMode: string; timeZone: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone')).rows;
  if (!Array.isArray(actual) || actual.length !== 1 || typeof actual[0].sqlMode !== 'string' || actual[0].timeZone !== timeZone || JSON.stringify(actual[0].sqlMode.split(',').filter(Boolean).sort()) !== JSON.stringify(modes)) throw Error(text.transaction);
  context.managed.sqlMode = actual[0].sqlMode;
}

/** 缓存含在途预留；token只用一次，连接断开或过期后不能从旧回调复活。 */
export class ResultInsertTasks {
  private readonly entries = new Map<string, Preview>(); private readonly generations = new Map<string, number>();
  constructor(private readonly host: ResultInsertHost, private readonly now = () => Date.now()) {}
  /** 到期回收只撤销本token；在途预留不能被计时器提前释放。 */
  private forget(entry: Preview): void { if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined; if (this.entries.get(entry.token) === entry) this.entries.delete(entry.token); }
  private time(): number { const value = this.now(); if (!Number.isFinite(value)) throw Error(text.stale); return value; }
  private expire(entry: Preview): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (this.entries.get(entry.token) !== entry || entry.pending || entry.applying) return;
      try { if (entry.expires <= this.time()) this.forget(entry); else this.expire(entry); } catch { this.forget(entry); }
    }, Math.max(1, entry.expires - this.time()));
    entry.timer.unref();
  }
  private prune(): void { for (const entry of this.entries.values()) if (!entry.applying && !entry.pending && entry.expires <= this.time()) this.forget(entry); }
  private current(entry: Preview): void {
    if (entry.revoked || this.entries.get(entry.token) !== entry || !entry.applying && entry.expires <= this.time() || entry.generation !== (this.generations.get(entry.target.connectionId) ?? 0)) throw Error(text.stale);
  }
  /** 全部行校验和真实元数据前后核验完成且资源已关闭后才发布预览。 */
  async preview(raw: ResultInsertPreviewInput, revision: number): Promise<ResultInsertPreviewOutput> {
    const input = resultInsertPreviewInputSchema.parse(raw); version(revision); this.prune();
    const bytes = reservedBytes(input.data, input.mapping);
    if (this.entries.size >= limits.previews || bytes + [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0) > limits.retainedBytes) throw Error(text.budget);
    const token = randomUUID(), target = { connectionId: input.connectionId, database: input.database, table: input.table };
    const entry: Preview = { token, target, revision, generation: this.generations.get(input.connectionId) ?? 0, expires: this.time() + limits.lifetimeMs, bytes, data: freezeData(input.data), mapping: input.mapping.map(item => Object.freeze({ ...item })), timeZone: input.timeZone, applying: false, pending: true, revoked: false };
    this.entries.set(token, entry); const state = resultInsertProgress(entry.data.rows.length);
    try {
      const result = await this.host.run(target, input.taskId, async context => {
        this.current(entry); state.phase = 'validating'; context.report(); const read = await readTarget(context, target);
        const columns = validateResultInsertRows(read.source, entry.data, entry.mapping, read.context.dialect, read.context); this.current(entry);
        const sample: string[] = []; let shownRows = 0, sampleBytes = 0;
        for (const row of entry.data.rows.slice(0, limits.shownRows)) {
          const statement = resultInsertStatement(target, columns, entry.mapping, row), text = inlineParameters(statement.sql, entry.mapping.map(item => row[item.source])) + ';';
          const size = Buffer.byteLength(text) + 1; if (size > limits.previewSqlBytes - sampleBytes) break;
          sample.push(text); sampleBytes += size; shownRows++;
        }
        if (!shownRows) throw Error(text.budget);
        const after = await readTarget(context, target); if (read.definitionDigest !== after.definitionDigest || read.serverIdentity !== after.serverIdentity) throw Error(text.changed);
        this.current(entry); entry.read = read;
        // 初始按最大元数据和样本预留；原任务收尾前不缩减在途额度。
        state.phase = 'releasing'; context.report();
        return { previewToken: token, target: { ...target }, rows: entry.data.rows.length, mapping: entry.mapping.map(item => ({ ...item })), shownRows, sql: sample.join('\n'), expiresAt: new Date(entry.expires).toISOString(), definitionDigest: read.definitionDigest, sourceTruncated: entry.data.truncated, timeZone: entry.timeZone, warnings: ['仅插入明确已返回的冻结行，不重新执行源SQL；截断结果不包含未返回的数据。', '整批只执行INSERT，不更新或覆盖目标原行；失败或提交结果未知时不会自动重放。', 'TIMESTAMP按所选数值时区解释，不推测来源时区；自动生成列和未映射默认列由服务器计算。', 'JSON原文不在客户端重序列化，由服务器验证并规范化；不承诺任意JSON数值或重复成员的存储表示无损。'] };
      }, state, false);
      this.current(entry); entry.pending = false;
      entry.bytes = bytes - 2 * limits.definitionBytes - limits.previewSqlBytes + Buffer.byteLength(JSON.stringify(entry.read)) + Buffer.byteLength(result.sql);
      this.expire(entry);
      state.phase = 'finished'; return result;
    } catch (error) { this.forget(entry); throw error; }
  }
  /** 首await前消费token；保留在途容量直到原host严格收尾，不允许重放原授权。 */
  async apply(raw: ResultInsertApplyInput, revision: number): Promise<ResultInsertApplyOutput> {
    const input = resultInsertApplyInputSchema.parse(raw), entry = this.entries.get(input.previewToken);
    if (!entry || entry.applying) throw Error(text.stale); entry.applying = true; if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined;
    const state = resultInsertProgress(entry.data.rows.length); let committed: ResultInsertApplyOutput | undefined;
    try {
      this.current(entry);
      if (entry.pending || entry.expires <= this.time() || !entry.read || entry.revision !== version(revision) || input.connectionId !== entry.target.connectionId || input.confirmation !== resultInsertConfirmation(entry.target)) throw Error(text.stale);
      // 应用会新读一份完整目标元数据；首await前为该在途副本预留额度。
      if ([...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0) + limits.definitionBytes > limits.retainedBytes) throw Error(text.budget);
      entry.bytes += limits.definitionBytes;
      const result = await this.host.run(entry.target, input.taskId, async context => {
        this.current(entry); await configure(context, entry.timeZone); this.current(entry);
        let begun = false;
        try {
          header(await command(context, 'START TRANSACTION', undefined), true, 0); begun = true;
          await structureTaskQuery(context, `SELECT 1 FROM ${qualified(entry.target.database, entry.target.table)} LIMIT 0`); transaction(context);
          const read = await readTarget(context, entry.target); transaction(context);
          if (read.definitionDigest !== entry.read!.definitionDigest || read.serverIdentity !== entry.read!.serverIdentity) throw Error(text.changed);
          state.phase = 'validating'; context.report(); const columns = validateResultInsertRows(read.source, entry.data, entry.mapping, read.context.dialect, read.context);
          this.current(entry); transaction(context); state.transactionProtected = true;
          for (const row of entry.data.rows) {
            this.current(entry); transaction(context); context.checkCancelled(); state.phase = 'inserting';
            const statement = resultInsertStatement(entry.target, columns, entry.mapping, row);
            const inserted = await command(context, statement.sql, statement.values, () => { state.dmlMayHaveBeenSent = true; state.outcome = 'unknown'; context.report(); });
            header(inserted, true, 1); transaction(context); state.rows++; context.report();
          }
          this.current(entry); transaction(context); context.checkCancelled(); state.phase = 'committing';
          await command(context, 'COMMIT', undefined, () => { state.commitMayHaveBeenSent = true; context.report(); }, acknowledged => {
            if (!acknowledged || acknowledged.affectedRows !== 0 || !Number.isSafeInteger(acknowledged.serverStatus) || acknowledged.serverStatus & 1) throw Error(text.unknown);
            state.commitAcknowledged = true; state.outcome = 'committed';
            committed = { target: { ...entry.target }, rows: state.rows, outcome: 'committed', commitAcknowledged: true };
            // 已收到明确COMMIT OK时，晚警告或收尾异常不能反称未提交。
            header(acknowledged, false, 0);
          });
          state.phase = 'releasing'; context.report(); return committed!;
        } catch (error) {
          if (state.commitAcknowledged && committed) { state.phase = 'releasing'; try { context.report(); } catch { /* 晚报告失败不改变COMMIT ACK。 */ } return committed; }
          if (begun && !state.commitMayHaveBeenSent && !context.managed.broken && !context.managed.signal?.aborted) {
            state.phase = 'rolling-back'; try { context.report(); } catch { /* 清理必须继续，不因进度通知失败跳过ROLLBACK。 */ }
            try { header(await command(context, 'ROLLBACK', undefined, undefined, undefined, true), false, 0); state.rollbackAcknowledged = true; state.outcome = state.dmlMayHaveBeenSent ? 'rolled-back' : 'not-sent'; } catch { if (state.dmlMayHaveBeenSent) state.outcome = 'unknown'; }
            try { context.report(); } catch { /* 已核回滚ACK同样优先于晚报告异常。 */ }
          }
          state.phase = 'releasing'; context.report(); throw error;
        }
      }, state, true);
      state.phase = 'finished'; return result;
    } catch (error) { if (state.commitAcknowledged && committed) return committed; throw error; }
    finally { this.forget(entry); }
  }
  /** 释放不能取消正在应用的原事务；执行取消交给原task及host收尾。 */
  release(raw: ResultInsertReleaseInput): void { const input = resultInsertReleaseInputSchema.parse(raw), entry = this.entries.get(input.previewToken); if (!entry) return; if (entry.target.connectionId !== input.connectionId || entry.applying) throw Error(text.stale); entry.revoked = true; if (!entry.pending) this.forget(entry); }
  /** 修改/断开连接当场撤销所有尚未应用的预览，原在途动作下一边界也会失效。 */
  releaseConnection(id: string): void { this.generations.set(id, (this.generations.get(id) ?? 0) + 1); for (const entry of this.entries.values()) if (entry.target.connectionId === id) { entry.revoked = true; if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined; if (!entry.applying && !entry.pending) this.forget(entry); } }
  /** 退出撤销现有能力；取消退出后仍可建立新预览，真正退出守卫和资源等待归host负责。 */
  close(): void { for (const entry of this.entries.values()) { entry.revoked = true; if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined; if (!entry.applying && !entry.pending) this.forget(entry); } }
}
