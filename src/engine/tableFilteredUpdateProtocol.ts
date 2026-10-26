import { createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import type { EventEmitter } from 'node:events';
import type { TableInfo } from '../shared/contracts';
import { tableFilteredUpdateLimits as limits, tableFilteredUpdateText as text, type TableFilteredUpdateTarget as ResultInsertTarget } from '../shared/tableFilteredUpdate';
import { readControlledTimestampDefault, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { readIncomingReferenceTable, incomingReferenceSourceDigest } from './incomingReferences';
import { qualified } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
interface TargetRead { source: TableInfo; definitionDigest: string; serverIdentity: string; context: TableDefinitionContext; }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string) => `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'`;
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
    const wildcard = (token: typeof database) => token.kind === 'symbol' && token.value === '*';
    const scope = wildcard(database) && wildcard(table) || ['word', 'identifier'].includes(database.kind) && database.value === target.database && (wildcard(table) || ['word', 'identifier'].includes(table.kind) && table.value === target.table);
    if (!scope) continue;
    const privileges = grant.slice(tokens[1].start, tokens[on].start).toUpperCase().split(',').map(value => value.trim());
    if (privileges.some(value => ['ALL', 'ALL PRIVILEGES', 'TRIGGER'].includes(value))) proven = true;
  }
  return proven;
}
/** 完整目标和事务副作用目录同一会话读取，定义摘要只忽略解析确认的表尾自增计数。 */
export async function readTarget(context: StructureTaskContext, target: ResultInsertTarget): Promise<TargetRead> {
  const before = await serverIdentity(context), source = await readIncomingReferenceTable(context, target, true);
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
/** 生命周期沿原结构命令回调/断线/取消终态；COMMIT ACK在任何报告或后续检查之前入账。 */
export function command(context: StructureTaskContext, sql: string, values: (string | number | boolean | null | Buffer)[] | undefined, submitted?: () => void, acknowledged?: (header: ResultSetHeader) => void, rollingBack = false): Promise<ResultSetHeader> {
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
export function header(value: ResultSetHeader, inTransaction: boolean, affected: number): void {
  if (!value || value.affectedRows !== affected || value.warningStatus !== 0 || !Number.isSafeInteger(value.serverStatus) || Boolean(value.serverStatus & 1) !== inTransaction) throw Error(text.warnings);
}
export function transaction(context: StructureTaskContext): void {
  if (context.managed.broken || context.managed.signal?.aborted || context.managed.transactionStateKnown !== true || !Number.isSafeInteger(context.managed.serverStatus) || !(context.managed.serverStatus! & 1)) throw Error(text.transaction);
}
/** 独立会话增加严格写值模式与显式时区，读回实际值，绝不修改父查询会话。 */
export async function configure(context: StructureTaskContext, timeZone: string): Promise<void> {
  const before = (await structureTaskQuery<{ sqlMode: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode')).rows;
  if (!Array.isArray(before) || before.length !== 1 || typeof before[0].sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(before[0].sqlMode)) throw Error(text.transaction);
  const modes = [...new Set([...before[0].sqlMode.split(',').filter(Boolean), 'STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO'])].sort();
  header(await command(context, `SET SESSION sql_mode = '${modes.join(',')}'`, undefined), false, 0);
  header(await command(context, `SET SESSION time_zone = '${timeZone}'`, undefined), false, 0);
  const actual = (await structureTaskQuery<{ sqlMode: string; timeZone: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone')).rows;
  if (!Array.isArray(actual) || actual.length !== 1 || typeof actual[0].sqlMode !== 'string' || actual[0].timeZone !== timeZone || JSON.stringify(actual[0].sqlMode.split(',').filter(Boolean).sort()) !== JSON.stringify(modes)) throw Error(text.transaction);
  context.managed.sqlMode = actual[0].sqlMode;
}
