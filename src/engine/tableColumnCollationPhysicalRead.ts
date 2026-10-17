import { types } from 'node:util';
import { structureTaskQuery, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import { parseTableColumnDefinition } from './tableColumnDefinition';
import type { TableColumnPatchTarget, TableDefinitionContext } from '../shared/tableColumnPatches';

type PhysicalStage = 'input' | 'server' | 'table' | 'partition' | 'identity';
export type ColumnCollationPhysicalUnavailableReason =
  | 'unsupported-version' | 'unsupported-target' | 'unsupported-mapping' | 'catalog-permission'
  | 'missing-table' | 'ambiguous-table' | 'unsupported-engine' | 'partitioned-table'
  | 'missing-table-id' | 'ambiguous-table-id' | 'invalid-catalog' | 'catalog-budget';

/** 仅代表本轮实际观测；不提供DDL授权、算法结论或执行后ID必须不变的承诺。 */
export type ColumnCollationPhysicalResult = Readonly<{
  status: 'observed'; tableId: string; target: Readonly<TableColumnPatchTarget>; serverIdentity: string;
  mapping: Readonly<{
    dialect: 'mysql'; version: '8.4.11'; compileOs: 'linux' | 'debian-linux-gnu'; compileOsReported: string;
    lowerCaseTableNames: 0; tableType: 'BASE TABLE'; engine: 'InnoDB';
    partitionName: null; catalog: 'information_schema.INNODB_TABLES'; nativeName: string;
  }>;
  bytes: number;
}> | Readonly<{
  status: 'unavailable'; reason: ColumnCollationPhysicalUnavailableReason; stage: PhysicalStage; bytes: number;
}>;

const queryBytes = 64 * 1024;
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 内部目录失败具有固定原因；真实驱动错误不转换成此类型。 */
class PhysicalUnavailable extends Error {
  constructor(readonly reason: ColumnCollationPhysicalUnavailableReason) { super(reason); }
}

/** 拒绝Proxy和访问器，反射时不执行输入的getter或toJSON。 */
function record(value: unknown): object {
  if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error('物理身份只接受普通数据对象');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('物理身份不接受自定义原型');
  return value;
}

/** 只读取自有数据字段，类型声明不能替代运行时输入校验。 */
function data(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(value), key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('物理身份字段缺失或不是数据属性');
  return descriptor.value;
}

/** 在任何await之前固定目标，禁止调用方额外传入tableId或能力布尔。 */
function copyTarget(value: TableColumnPatchTarget): TableColumnPatchTarget {
  const keys = Reflect.ownKeys(record(value));
  if (keys.length !== 3 || !['connectionId', 'database', 'table'].every(key => keys.includes(key))) throw new Error('物理身份目标字段不准确');
  const connectionId = data(value, 'connectionId'), database = data(value, 'database'), table = data(value, 'table');
  if (typeof connectionId !== 'string' || !connectionId || connectionId.length > 256 || typeof database !== 'string' || typeof table !== 'string') throw new Error('物理身份目标类型无效');
  return { connectionId, database, table };
}

/** 读取器不另建会话；沿用共用查询的命令收尾，再检查取消和物理连接终态。 */
function active(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? new Error('物理身份读取已取消');
  if (context.managed.broken) throw new Error('物理身份结构连接已断开');
}

/** 仅明确权限ERR可关闭能力；fatal、取消、断线及未知错误原样上抛。 */
function permissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return false;
  const errno = Object.getOwnPropertyDescriptor(error, 'errno'), fatal = Object.getOwnPropertyDescriptor(error, 'fatal');
  if (fatal && (!Object.hasOwn(fatal, 'value') || fatal.value !== false && fatal.value !== undefined)) return false;
  return !!errno && Object.hasOwn(errno, 'value') && [1142, 1143, 1227].includes(errno.value);
}

/** 最多两行，每个结果只保留固定字段及标量；先计UTF-8预算，不序列化原始对象。 */
function boundedRows(value: unknown, keys: readonly string[]): { rows: Record<string, string | number | null>[]; bytes: number } {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new PhysicalUnavailable('invalid-catalog');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length > 2 || Reflect.ownKeys(value).length !== length + 1) throw new PhysicalUnavailable('invalid-catalog');
  const rows: Record<string, string | number | null>[] = [];
  let bytes = 2;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new PhysicalUnavailable('invalid-catalog');
    let row: object;
    try { row = record(descriptor.value); } catch { throw new PhysicalUnavailable('invalid-catalog'); }
    if (Reflect.ownKeys(row).length !== keys.length) throw new PhysicalUnavailable('invalid-catalog');
    const copy: Record<string, string | number | null> = {};
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(row, key);
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new PhysicalUnavailable('invalid-catalog');
      const item: unknown = field.value;
      if (item !== null && typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item))) throw new PhysicalUnavailable('invalid-catalog');
      bytes += Buffer.byteLength(key) + (typeof item === 'string' ? Buffer.byteLength(item) : 24) + 8;
      if (bytes > queryBytes) throw new PhysicalUnavailable('catalog-budget');
      copy[key] = item as string | number | null;
    }
    // 转义后的JSON也计入预算，避免大量控制字符绕过64 KiB限制。
    rows.push(copy);
  }
  bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(rows)));
  if (bytes > queryBytes) throw new PhysicalUnavailable('catalog-budget');
  return { rows, bytes };
}

/** 四条固定SELECT全部成功才返回真实TABLE_ID；不执行DDL、不重试、不读取外部依赖。 */
export async function readColumnCollationPhysicalFacts(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<ColumnCollationPhysicalResult> {
  active(context);
  const fixed = copyTarget(target), dialect = data(data(base, 'context'), 'dialect'), version = data(base, 'serverVersion');
  let stage: PhysicalStage = 'input', bytes = 0;
  const unavailable = (reason: ColumnCollationPhysicalUnavailableReason): ColumnCollationPhysicalResult => ({ status: 'unavailable', reason, stage, bytes });
  if (context.managed.status.dialect !== 'mysql' || context.managed.status.version !== '8.4.11' || dialect !== 'mysql' || version !== '8.4.11') return unavailable('unsupported-version');
  if (![fixed.database, fixed.table].every(name => /^[A-Za-z0-9_]{1,64}$/.test(name))) return unavailable('unsupported-target');
  const source = data(base, 'source'), serverIdentity = data(base, 'identity'), mode = data(data(base, 'context'), 'mode');
  const ansiQuotes = data(mode, 'ansiQuotes'), noBackslashEscapes = data(mode, 'noBackslashEscapes');
  if (typeof source !== 'string' || Buffer.byteLength(source) > 2 * 1024 * 1024 || typeof serverIdentity !== 'string' || !serverIdentity || serverIdentity.length > 256 || typeof ansiQuotes !== 'boolean' || typeof noBackslashEscapes !== 'boolean') throw new Error('物理身份原定义上下文无效');
  const definitionContext: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes, noBackslashEscapes } };
  const document = parseTableColumnDefinition(source, definitionContext);
  if (document.table !== fixed.table || document.database !== undefined && document.database !== fixed.database) throw new Error('物理身份目标与原定义不一致');
  const db = literal(fixed.database), table = literal(fixed.table), where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${table} AS BINARY)`;
  const query = async (sql: string, keys: readonly string[]): Promise<Record<string, string | number | null>[]> => {
    const result = await structureTaskQuery<unknown>(context, sql);
    active(context);
    const bounded = boundedRows(result.rows, keys); bytes += bounded.bytes;
    return bounded.rows;
  };
  try {
    stage = 'server';
    const server = await query('SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2', ['version', 'os', 'lowerNames']);
    if (server.length !== 1) return unavailable('invalid-catalog');
    if (server[0].version !== '8.4.11') return unavailable('unsupported-version');
    const compileOsReported = server[0].os, compileOs = typeof compileOsReported === 'string' ? compileOsReported.toLowerCase() : undefined;
    if (typeof compileOsReported !== 'string' || compileOs !== 'linux' && compileOs !== 'debian-linux-gnu' || server[0].lowerNames !== 0 && server[0].lowerNames !== '0') return unavailable('unsupported-mapping');
    stage = 'table';
    const tables = await query(`SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE ${where} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine']);
    if (!tables.length) return unavailable('missing-table');
    if (tables.length !== 1) return unavailable('ambiguous-table');
    if (tables[0].databaseName !== fixed.database || tables[0].tableName !== fixed.table) return unavailable('invalid-catalog');
    if (tables[0].kind !== 'BASE TABLE' || tables[0].engine !== 'InnoDB') return unavailable('unsupported-engine');
    stage = 'partition';
    const partitions = await query(`SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where} LIMIT 2`, ['name']);
    if (!partitions.length) return unavailable('invalid-catalog');
    if (partitions.length !== 1 || partitions[0].name !== null) return unavailable('partitioned-table');
    stage = 'identity';
    const nativeName = fixed.database + '/' + fixed.table;
    const identities = await query(`SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.INNODB_TABLES WHERE CAST(NAME AS BINARY)=CAST(${literal(nativeName)} AS BINARY) LIMIT 2`, ['id', 'name']);
    if (!identities.length) return unavailable('missing-table-id');
    if (identities.length !== 1) return unavailable('ambiguous-table-id');
    const id = identities[0].id;
    if (typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id) || id.length === 20 && id > '18446744073709551615' || identities[0].name !== nativeName) return unavailable('invalid-catalog');
    active(context);
    if (context.managed.status.dialect !== 'mysql' || context.managed.status.version !== '8.4.11') return unavailable('unsupported-version');
    const mapping = Object.freeze({ dialect: 'mysql' as const, version: '8.4.11' as const, compileOs, compileOsReported, lowerCaseTableNames: 0 as const, tableType: 'BASE TABLE' as const, engine: 'InnoDB' as const, partitionName: null, catalog: 'information_schema.INNODB_TABLES' as const, nativeName });
    bytes += Buffer.byteLength(JSON.stringify([fixed, serverIdentity, mapping, id]));
    return Object.freeze({ status: 'observed', tableId: id, target: Object.freeze(fixed), serverIdentity, mapping, bytes });
  } catch (error) {
    // 活跃性检查先于权限/目录降级，不能把取消、连接破坏伪装成正常只读结果。
    if (context.managed.broken || context.managed.signal?.aborted) throw error;
    context.checkCancelled();
    if (error instanceof PhysicalUnavailable) return unavailable(error.reason);
    if (permissionError(error)) return unavailable('catalog-permission');
    throw error;
  }
}
