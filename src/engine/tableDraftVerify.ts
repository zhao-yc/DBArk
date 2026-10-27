import type { FieldPacket } from 'mysql2';
import type { RowChange, TableInfo } from '../shared/contracts';
import { parseTableDraftPayload, tableDraftLimits } from '../shared/tableDraft';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableInfo, type MetadataQuery } from './metadata';
import { buildChanges, identifier, inlineParameters, qualified, serializeCell } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

export interface TableDraftVerifyInput {
  connectionId: string; database: string; table: string; taskId: string;
  metadataKey: string; changes: RowChange[];
}

const rollbackSql = 'ROLLBACK AND NO CHAIN NO RELEASE';
const messages = {
  invalid: '草稿恢复请求或服务器回包无效',
  metadata: '表结构或可靠定位键已变化，未恢复草稿',
  conflict: '保存草稿的原始行已变化或不存在，未恢复任何草稿',
  duplicate: '草稿中的多个操作指向同一原始行，未恢复任何草稿',
  warning: '草稿核验遇到服务器告警，未恢复草稿',
  budget: '草稿核验超过有界读取预算',
} as const;

/** 诊断计数独立于max_error_count；严格读取原单行单列自有数据字段，不执行访问器。 */
function assertNoWarnings(value: unknown): void {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 1 || Reflect.ownKeys(value).length !== 2) throw Error(messages.invalid);
  const entry = Object.getOwnPropertyDescriptor(value, '0');
  if (!entry || !('value' in entry) || !entry.enumerable) throw Error(messages.invalid);
  const row: unknown = entry.value;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Reflect.ownKeys(row).length !== 1) throw Error(messages.invalid);
  const cell = Object.getOwnPropertyDescriptor(row, '@@session.warning_count');
  if (!cell || !('value' in cell) || !cell.enumerable) throw Error(messages.invalid);
  const count: unknown = cell.value;
  if (Object.is(count, 0) || count === '0') return;
  if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0 || typeof count === 'string' && /^[1-9]\d{0,19}$/.test(count)) throw Error(messages.warning);
  throw Error(messages.invalid);
}

/** 每条真实语句结束后立即核对原诊断，目录读取与控制语句的告警也不能丢失。 */
async function checkedQuery<T>(context: StructureTaskContext, sql: string, submitted?: () => void): Promise<{ rows: T; fields: FieldPacket[] }> {
  if (Buffer.byteLength(sql) > tableDraftLimits.bytes * 2) throw Error(messages.budget);
  const result = await structureTaskQuery<T>(context, sql, submitted);
  // SHOW COUNT与SHOW WARNINGS均为诊断语句，不用后继普通SELECT覆盖原命令的警告状态。
  assertNoWarnings((await structureTaskQuery<unknown>(context, 'SHOW COUNT(*) WARNINGS')).rows);
  const warnings = (await structureTaskQuery<unknown>(context, 'SHOW WARNINGS LIMIT 1')).rows;
  if (!Array.isArray(warnings) || warnings.length !== 0) throw Error(messages.warning);
  const header = result.rows as { warningStatus?: unknown } | undefined;
  if (!Array.isArray(header) && header && header.warningStatus !== undefined && header.warningStatus !== 0) throw Error(messages.warning);
  context.checkCancelled();
  return result;
}

/** 同一只读会话复用真实目录解析；固定LIMIT和累计字节同时限制元数据结果。 */
async function readMetadata(context: StructureTaskContext, input: TableDraftVerifyInput): Promise<TableInfo> {
  let bytes = 0;
  const query: MetadataQuery = async <T>(sql: string, parameters: (string | number | boolean | null | Buffer)[] = []) => {
    const bounded = /^SELECT\b/i.test(sql) && !/\bLIMIT\s+\d+\s*$/i.test(sql) ? sql + ' LIMIT 1025' : sql;
    const result = await checkedQuery<T>(context, inlineParameters(bounded, parameters.map(serializeCell)));
    if (!Array.isArray(result.rows) || result.rows.length > 1024) throw Error(messages.budget);
    bytes += Buffer.byteLength(JSON.stringify(result.rows));
    if (bytes > tableDraftLimits.bytes) throw Error(messages.budget);
    return result;
  };
  const mode = (await query<{ sqlMode: string }[]>('SELECT @@SESSION.sql_mode AS sqlMode')).rows;
  if (mode.length !== 1 || typeof mode[0].sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(mode[0].sqlMode)) throw Error(messages.invalid);
  context.managed.sqlMode = mode[0].sqlMode;
  const info = await tableInfo(context.managed, input.database, input.table, query);
  if (info.database !== input.database || info.name !== input.table || info.objectKind !== 'table'
    || info.engine.toUpperCase() !== 'INNODB' || !info.editableKey.length
    || new Set(info.columns.map(column => column.name)).size !== info.columns.length
    || new Set(info.editableKey).size !== info.editableKey.length
    || info.editableKey.some(name => !info.columns.some(column => column.name === name && !column.nullable))) throw Error(messages.metadata);
  if (tableCopyMetadataKey(info) !== input.metadataKey) throw Error(messages.metadata);
  return info;
}

/** 字段白名单与完整旧值要求先于任何记录读取；不把缺字段当NULL或DEFAULT。 */
function assertChanges(info: TableInfo, changes: RowChange[]): void {
  const names = new Set(info.columns.map(column => column.name));
  for (const change of changes) {
    if (change.kind !== 'delete' && Object.keys(change.values).some(name => !names.has(name))) throw Error(messages.invalid);
    if (change.kind !== 'insert') {
      if (Object.keys(change.before).length !== names.size || Object.keys(change.before).some(name => !names.has(name))
        || [...names].some(name => !Object.hasOwn(change.before, name))) throw Error(messages.invalid);
    }
  }
  // 只生成原有SQL并验证写入范围；此处从不发送这些INSERT/UPDATE/DELETE。
  buildChanges(info, changes);
}

/** 旧值谓词直接复用最终提交生成器；固定转换DELETE模板，不接收界面SQL。 */
export function tableDraftMatchSql(info: TableInfo, before: Extract<RowChange, { kind: 'delete' }>['before']): string {
  const statement = buildChanges(info, [{ kind: 'delete', before }], { binaryText: 'cast' }).statements[0];
  const prefix = `DELETE FROM ${qualified(info.database, info.name)} WHERE `;
  if (!statement || !statement.sql.startsWith(prefix)) throw Error(messages.invalid);
  // 返回真实键的二进制十六进制表示，避免不同文字量形式绕过同一服务器行的重复检查。
  const projection = info.editableKey.map((name, index) => `HEX(CAST(${identifier(name)} AS BINARY)) AS ${identifier('k' + index)}`).join(',');
  return inlineParameters(`SELECT ${projection} FROM ${qualified(info.database, info.name)} WHERE ${statement.sql.slice(prefix.length)} LIMIT 2`, statement.params);
}

/** 原回包只接受恰一行固定自有字段，服务器NULL/多行或未知投影均不能冒充核验成功。 */
function matchedKey(value: unknown, width: number): string {
  if (!Array.isArray(value) || value.length !== 1) throw Error(messages.conflict);
  const row = value[0];
  if (!row || typeof row !== 'object' || Reflect.ownKeys(row).length !== width) throw Error(messages.invalid);
  const parts: string[] = [];
  for (let index = 0; index < width; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(row, 'k' + index), cell: unknown = descriptor?.value;
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || typeof cell !== 'string' || !/^(?:[0-9A-F]{2})*$/.test(cell)) throw Error(messages.invalid);
    if (cell.length > tableDraftLimits.bytes * 2) throw Error(messages.budget);
    parts.push(cell);
  }
  if (Buffer.byteLength(JSON.stringify(parts)) > tableDraftLimits.bytes) throw Error(messages.budget);
  return JSON.stringify(parts);
}

/** 恢复仅核验，不执行数据写入；保留保存时before，最终提交仍重新执行完整旧值保护。 */
export async function verifyTableDraft(context: StructureTaskContext, input: TableDraftVerifyInput): Promise<{ verifiedChanges: number }> {
  const payload = parseTableDraftPayload({ target: { connectionId: input.connectionId, database: input.database, table: input.table }, metadataKey: input.metadataKey, changes: input.changes });
  const request = { ...input, ...payload.target, metadataKey: payload.metadataKey, changes: payload.changes };
  let transactionSubmitted = false, failure: unknown;
  let output: { verifiedChanges: number } | undefined;
  try {
    await checkedQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await checkedQuery(context, 'SET SESSION lock_wait_timeout = 15');
    await checkedQuery(context, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', () => { transactionSubmitted = true; });
    // 包括纯新增草稿也真实打开原表，持有事务MDL后再读目录，不能只凭同名表的缓存目录恢复。
    const lock = (await checkedQuery<unknown>(context, `SELECT 1 FROM ${qualified(request.database, request.table)} LIMIT 0`)).rows;
    if (!Array.isArray(lock) || lock.length !== 0) throw Error(messages.invalid);
    const info = await readMetadata(context, request);
    assertChanges(info, request.changes);
    const originals = new Set<string>();
    for (const change of request.changes) {
      context.checkCancelled();
      if (change.kind === 'insert') continue;
      const result = await checkedQuery<unknown>(context, tableDraftMatchSql(info, change.before));
      const key = matchedKey(result.rows, info.editableKey.length);
      if (originals.has(key)) throw Error(messages.duplicate);
      originals.add(key); context.report();
    }
    await readMetadata(context, request);
    output = { verifiedChanges: request.changes.length };
  } catch (error) { failure = error; }
  // 失败也只在原连接结束事务；取消/断线的物理回收由独立任务框架负责，不另建连接或重放。
  if (transactionSubmitted && !context.managed.broken && !context.managed.signal?.aborted) {
    try { await checkedQuery(context, rollbackSql); }
    catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], '草稿核验失败，原只读事务收尾也未确认'); }
  }
  if (failure !== undefined) throw failure;
  context.checkCancelled();
  if (!output) throw Error(messages.invalid);
  return output;
}
