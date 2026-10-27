import { createHash } from 'node:crypto';
import type { FieldPacket } from 'mysql2';
import { assertRoutineInvocationMetadata, parseRoutineCreateSignature, parseRoutineInvocationMetadata, parseRoutineInvocationTarget, routineInvocationLimits, type RoutineInvocationMetadata, type RoutineInvocationTarget, type RoutineInvocationParameter } from '../shared/routineInvocation';
import { routineInvocationZh as text } from '../shared/routineInvocation.zh-CN';
import { qualified } from './sql';
import type { StructureTaskContext } from './structureDefinition';

export interface RoutineInvocationInput extends RoutineInvocationTarget { taskId: string; }
export type RoutineInvocationReader = (sql: string, values: readonly Buffer[]) => Promise<unknown>;
const { definitionBytes, metadataBytes, parameters: parameterLimit } = routineInvocationLimits;
type Row = Record<string, string | number | null>;
const routineKeys = ['databaseName', 'name', 'kind', 'sqlMode', 'created', 'altered', 'definer', 'securityType'];
const parameterKeys = ['databaseName', 'name', 'kind', 'ordinal', 'mode', 'parameterName', 'type', 'characterSet', 'collation'];
const sessionKeys = ['sqlMode', 'quoteShowCreate'];

/** 数组、行和字段只读取自有数据描述符；畸形替身或访问器不能在预算检查时运行。 */
function records(value: unknown, maximum: number, keys: readonly string[]): Row[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.invalid);
  const output: Row[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !('value' in entry) || !entry.enumerable || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) throw Error(text.invalid);
    const row = entry.value as object, names = Reflect.ownKeys(row);
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) throw Error(text.invalid);
    const copy: Row = Object.create(null) as Row;
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(row, key);
      if (!field || !('value' in field) || !field.enumerable || !(field.value === null || typeof field.value === 'string' || typeof field.value === 'number' && Number.isSafeInteger(field.value))) throw Error(text.invalid);
      copy[key] = field.value as Row[string];
    }
    output.push(copy);
  }
  return output;
}

/** 目录序号允许驱动精确十进制字符串，不接受符号、指数、空白、负零或非安全整数。 */
function ordinal(value: Row[string]): number {
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,2})$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > parameterLimit) throw Error(text.invalid);
  return value;
}

/** 等待原回调或连接终态，取消ACK不提前释放命令占用；此处始终只发送SELECT/SHOW。 */
function driverRead(context: StructureTaskContext, sql: string, values: readonly Buffer[]): Promise<unknown> {
  const managed = context.managed;
  if (managed.broken || managed.signal?.aborted) return Promise.reject(Error(text.cancelled));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, rows?: unknown): void => {
      if (settled) return;
      settled = true; managed.connection.removeListener('error', failed); managed.connection.removeListener('end', ended); managed.signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(rows);
    };
    const failed = (error: Error): void => finish(error);
    const ended = (): void => finish(Error(text.cancelled));
    const aborted = (): void => finish(Error(text.cancelled));
    managed.connection.once('error', failed); managed.connection.once('end', ended); managed.signal?.addEventListener('abort', aborted, { once: true });
    try {
      const done = (error: Error | null, rows: unknown, _fields: FieldPacket[]): void => finish(error, rows);
      // Buffer值由mysql2固定转为X'hex'，名字中的反斜线/引号在NBE模式下也不改变SQL结构；不引入prepare阶段。
      if (values.length) managed.connection.query(sql, [...values], done); else managed.connection.query(sql, done);
    } catch (error) { finish(error); }
  });
}

/** 不信任information_schema的默认排序规则：SQL按字节筛选后仍逐行核原目标和种类。 */
function targetRow(row: Row, target: RoutineInvocationTarget): void {
  if (row.databaseName !== target.database || row.name !== target.name || row.kind !== target.kind.toUpperCase()) throw Error(text.invalid);
}

/** 两轮完整目录和SHOW CREATE在同一独立物理连接重读；只返回可生成草稿的有界签名摘要。 */
export async function readRoutineInvocationMetadata(context: StructureTaskContext, input: RoutineInvocationInput, suppliedReader?: RoutineInvocationReader): Promise<RoutineInvocationMetadata> {
  // 复用正式目标解析器，不信任直接进入Engine的内部调用。
  const target = parseRoutineInvocationTarget({ connectionId: input.connectionId, database: input.database, name: input.name, kind: input.kind });
  if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200) throw Error(text.invalid);
  const reader: RoutineInvocationReader = suppliedReader ?? ((sql, values) => driverRead(context, sql, values));
  let bytes = 0;
  const read = async (sql: string, values: readonly Buffer[], maximum: number, keys: readonly string[]): Promise<Row[]> => {
    context.checkCancelled(); const terminal = context.commandStarted();
    try {
      const rows = records(await reader(sql, values), maximum, keys); context.checkCancelled();
      // 两轮读取各有完整元数据预算；不截断目录或DDL后继续生成调用。
      bytes += Buffer.byteLength(JSON.stringify(rows)); if (bytes > metadataBytes * 2) throw Error(text.budget);
      return rows;
    } finally { terminal(); }
  };
  const values = [Buffer.from(target.database), Buffer.from(target.name)];
  const kind = target.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
  const routineSql = `SELECT ROUTINE_SCHEMA AS databaseName, ROUTINE_NAME AS name, ROUTINE_TYPE AS kind, SQL_MODE AS sqlMode, CAST(CREATED AS CHAR) AS created, CAST(LAST_ALTERED AS CHAR) AS altered, DEFINER AS definer, SECURITY_TYPE AS securityType FROM information_schema.ROUTINES WHERE CAST(ROUTINE_SCHEMA AS BINARY)=? AND CAST(ROUTINE_NAME AS BINARY)=? AND ROUTINE_TYPE='${kind}' LIMIT 2`;
  const parameterRows = parameterLimit + (target.kind === 'function' ? 1 : 0);
  const parametersSql = `SELECT SPECIFIC_SCHEMA AS databaseName, SPECIFIC_NAME AS name, ROUTINE_TYPE AS kind, ORDINAL_POSITION AS ordinal, PARAMETER_MODE AS mode, PARAMETER_NAME AS parameterName, DTD_IDENTIFIER AS type, CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation FROM information_schema.PARAMETERS WHERE CAST(SPECIFIC_SCHEMA AS BINARY)=? AND CAST(SPECIFIC_NAME AS BINARY)=? AND ROUTINE_TYPE='${kind}' ORDER BY ORDINAL_POSITION LIMIT ${parameterRows + 1}`;
  const showSql = `SHOW CREATE ${kind} ${qualified(target.database, target.name)}`;
  const showKeys = [target.kind === 'procedure' ? 'Procedure' : 'Function', 'sql_mode', target.kind === 'procedure' ? 'Create Procedure' : 'Create Function', 'character_set_client', 'collation_connection', 'Database Collation'];
  const sessionSql = 'SELECT @@SESSION.sql_mode AS sqlMode, @@SESSION.sql_quote_show_create AS quoteShowCreate LIMIT 2';
  const session = await read(sessionSql, [], 1, sessionKeys);
  if (session.length !== 1 || typeof session[0].sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(session[0].sqlMode) || ![0, 1, '0', '1'].includes(session[0].quoteShowCreate as number | string)) throw Error(text.invalid);
  if (Buffer.byteLength(session[0].sqlMode) > routineInvocationLimits.sqlModeBytes) throw Error(text.budget);
  const routine = await read(routineSql, values, 1, routineKeys);
  if (routine.length !== 1) throw Error(text.definitionUnavailable);
  targetRow(routine[0], target);
  const parameters = await read(parametersSql, values, parameterRows, parameterKeys);
  const shown = await read(showSql, [], 1, showKeys);
  if (shown.length !== 1) throw Error(text.definitionUnavailable);
  const definition = shown[0][showKeys[2]], storedMode = shown[0].sql_mode;
  if (typeof definition !== 'string' || !definition.trim()) throw Error(text.definitionUnavailable);
  if (Buffer.byteLength(definition) > definitionBytes) throw Error(text.budget);
  if (shown[0][showKeys[0]] !== target.name || typeof storedMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(storedMode) || routine[0].sqlMode !== storedMode || showKeys.slice(3).some(key => typeof shown[0][key] !== 'string' || !shown[0][key])) throw Error(text.invalid);
  if (Buffer.byteLength(storedMode) > routineInvocationLimits.sqlModeBytes) throw Error(text.budget);
  const parsed: RoutineInvocationParameter[] = []; let returnType: string | undefined;
  for (let index = 0; index < parameters.length; index++) {
    const row = parameters[index]; targetRow(row, target);
    const position = ordinal(row.ordinal), expected = target.kind === 'function' ? index : index + 1;
    if (position !== expected || typeof row.type !== 'string' || !row.type.trim() || !(row.characterSet === null || typeof row.characterSet === 'string') || !(row.collation === null || typeof row.collation === 'string')) throw Error(text.invalid);
    if (position === 0) {
      if (row.mode !== null || row.parameterName !== null) throw Error(text.invalid);
      returnType = row.type;
    } else {
      if (!['IN', 'OUT', 'INOUT'].includes(row.mode as string) || typeof row.parameterName !== 'string' || !row.parameterName || parsed.some(parameter => parameter.name === row.parameterName) || target.kind === 'function' && row.mode !== 'IN') throw Error(text.invalid);
      parsed.push({ ordinal: position, name: row.parameterName, mode: row.mode as RoutineInvocationParameter['mode'], type: row.type });
    }
  }
  if (target.kind === 'function' && returnType === undefined) throw Error(text.definitionUnavailable);
  const signature = parseRoutineCreateSignature(definition, storedMode, target);
  const metadata: RoutineInvocationMetadata = { connectionId: target.connectionId, database: target.database, name: target.name, kind: target.kind, parameters: parsed, ...(returnType === undefined ? {} : { returnType }), fingerprint: '0'.repeat(64) };
  assertRoutineInvocationMetadata(metadata, signature, storedMode);
  // 空目录也必须与可读取SHOW CREATE签名核对；权限隐藏的入参绝不能降格成零参数。
  const repeatedRoutine = await read(routineSql, values, 1, routineKeys), repeatedParameters = await read(parametersSql, values, parameterRows, parameterKeys), repeatedShown = await read(showSql, [], 1, showKeys), repeatedSession = await read(sessionSql, [], 1, sessionKeys);
  if (JSON.stringify([routine, parameters, shown, session]) !== JSON.stringify([repeatedRoutine, repeatedParameters, repeatedShown, repeatedSession])) throw Error(text.metadataChanged);
  context.checkCancelled();
  metadata.fingerprint = createHash('sha256').update(JSON.stringify([metadata.connectionId, metadata.database, metadata.name, metadata.kind, context.managed.status.dialect, context.managed.status.version, routine, parameters, shown, session])).digest('hex');
  return parseRoutineInvocationMetadata(metadata);
}
