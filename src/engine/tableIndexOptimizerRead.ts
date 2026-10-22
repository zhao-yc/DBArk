import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { TableIndexPatchTarget } from '../shared/tableIndexTasks';
import { indexOptimizerMessages as text } from '../shared/tableIndexOptimizer';
import { structureTaskQuery, readStructureDefinition, assertStructureDefinitionUnchanged, type StructureTaskContext } from './structureDefinition';
import type { IndexStructureRead } from './tableIndexRead';
import { crossCheckIndexStatistics, deriveStatisticsCapabilities } from './tableIndexMetadata';
import { readTableDefaultEncodingAlter } from './tableDefaultEncodingPrivileges';
import { indexOptimizerVersionSupported, optimizerIndexDefinitions, type OptimizerIndexDefinition } from './tableIndexOptimizerSql';

export interface OptimizerNativeIndex { name: string; id: string; type: number; fields: number; }
export interface TableIndexOptimizerFacts {
  physical: { tableId: string; nativeName: string; clusteredIndexName: string; dialect: 'mysql' | 'mariadb'; version: string; os: string; lowerNames: 0; identity: string };
  nativeIndexes: OptimizerNativeIndex[]; indexes: OptimizerIndexDefinition[]; digest: string; bytes: number;
}
export type TableIndexOptimizerReadResult = { kind: 'ready'; value: TableIndexOptimizerFacts } | { kind: 'unavailable'; reason: string };
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 私有目录逐项读取自有原始标量，数量及累计字节先受限，不执行getter或迭代器。 */
function directory(value: unknown, keys: readonly string[], maximum: number): Record<string, string | number | null>[] {
  if (types.isProxy(value) || !Array.isArray(value)) throw Error('索引优化器目录不是有界行集');
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) throw Error('索引优化器目录数量无效');
  const result: Record<string, string | number | null>[] = []; let bytes = 0;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), row: unknown = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !row || typeof row !== 'object' || types.isProxy(row) || Reflect.ownKeys(row).length !== keys.length) throw Error('索引优化器目录行字段无效');
    const copy: Record<string, string | number | null> = Object.create(null);
    for (const key of keys) {
      const item = Object.getOwnPropertyDescriptor(row, key), field: unknown = item?.value;
      if (!item?.enumerable || !Object.hasOwn(item, 'value') || !(field === null || typeof field === 'string' || typeof field === 'number' && Number.isSafeInteger(field))) throw Error('索引优化器目录不是原始标量');
      bytes += Buffer.byteLength(key) + (typeof field === 'string' ? Buffer.byteLength(field) : 24) + 8;
      if (bytes > 4 * 1024 * 1024) throw Error('索引优化器目录超过4MiB');
      copy[key] = field as string | number | null;
    }
    result.push(copy);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw Error('索引优化器转义目录超过4MiB');
  return result;
}
/** 表/索引编号始终保留十进制字符串，不经Number损失原生身份。 */
function nativeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || value.length === 20 && value > '18446744073709551615') throw Error('索引优化器原生编号无效');
  return value;
}
function smallInteger(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})$/.test(value))) throw Error('索引优化器目录整数无效');
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 0 || number > 65535) throw Error('索引优化器目录整数越界'); return number;
}
/** 独立附加用途失败不改变旧索引能力；取消、断线仍必须沿原任务终态抛出。 */
function active(context: StructureTaskContext): void { context.checkCancelled(); if (context.managed.signal?.aborted || context.managed.broken) throw Error('索引优化器目录读取已取消或连接断开'); }

/** opt-in读取真实物理角色和全量STATISTICS；完整SHOW与目录任一矛盾都不给该用途可写资格。 */
export async function readTableIndexOptimizerFacts(context: StructureTaskContext, target: TableIndexPatchTarget, read: IndexStructureRead): Promise<TableIndexOptimizerReadResult> {
  if (!indexOptimizerVersionSupported(read.context.dialect, read.serverVersion)) return { kind: 'unavailable', reason: text.unsupported };
  try {
    if (!read.options || context.managed.status.version !== read.serverVersion || context.managed.status.dialect !== read.context.dialect) throw Error(text.unavailable);
    const query = async (sql: string, keys: readonly string[], maximum: number) => { const result = await structureTaskQuery<unknown>(context, sql); active(context); return directory(result.rows, keys, maximum); };
    const server = await query('SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2', ['version', 'os', 'lowerNames'], 2);
    if (server.length !== 1 || server[0].version !== read.serverVersion || ![0, '0'].includes(server[0].lowerNames as number) || typeof server[0].os !== 'string' || !(server[0].os.toLowerCase() === 'linux' || read.context.dialect === 'mariadb' && server[0].os === 'debian-linux-gnu')) throw Error('索引优化器真实版本或名称映射未证明');
    const where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
    const tables = await query(`SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE ${where} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine'], 2);
    if (tables.length !== 1 || tables[0].databaseName !== target.database || tables[0].tableName !== target.table || tables[0].kind !== 'BASE TABLE' || tables[0].engine !== 'InnoDB') throw Error('索引优化器目标不是唯一InnoDB基本表');
    const tableCatalog = read.context.dialect === 'mysql' ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES', indexCatalog = read.context.dialect === 'mysql' ? 'INNODB_INDEXES' : 'INNODB_SYS_INDEXES', nativeName = target.database + '/' + target.table;
    const physical = async () => {
      const rows = await query(`SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${tableCatalog} WHERE CAST(NAME AS BINARY)=CAST(${literal(nativeName)} AS BINARY) LIMIT 2`, ['id', 'name'], 2);
      if (rows.length !== 1 || rows[0].name !== nativeName) throw Error('索引优化器原生表名称不能唯一映射');
      return nativeId(rows[0].id);
    };
    const tableId = await physical();
    const nativeSql = `SELECT NAME AS name, CAST(INDEX_ID AS CHAR) AS id, CAST(TYPE AS CHAR) AS type, CAST(N_FIELDS AS CHAR) AS fields FROM information_schema.${indexCatalog} WHERE TABLE_ID = ${tableId} ORDER BY INDEX_ID LIMIT 258`;
    const nativeRows = await query(nativeSql, ['name', 'id', 'type', 'fields'], 257);
    if (!nativeRows.length) throw Error('索引优化器原生索引角色为空');
    const nativeIndexes: OptimizerNativeIndex[] = nativeRows.map(row => { if (typeof row.name !== 'string' || !row.name || row.name.includes('\0')) throw Error('原生索引名称无效'); return { name: row.name, id: nativeId(row.id), type: smallInteger(row.type), fields: smallInteger(row.fields) }; });
    if (new Set(nativeIndexes.map(index => index.id)).size !== nativeIndexes.length || new Set(nativeIndexes.map(index => index.name)).size !== nativeIndexes.length) throw Error('原生索引身份或名称重复');
    const clustered = nativeIndexes.filter(index => (index.type & 1) === 1);
    if (clustered.length !== 1) throw Error('实际聚簇索引角色不能唯一证明');
    const headers = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'STATISTICS' ORDER BY ORDINAL_POSITION LIMIT 65", ['COLUMN_NAME'], 64);
    const capabilities = deriveStatisticsCapabilities(headers.map(row => { if (typeof row.COLUMN_NAME !== 'string') throw Error('STATISTICS能力字段无效'); return row.COLUMN_NAME; }));
    if (read.context.dialect === 'mysql' ? !capabilities.visibility || !capabilities.expression || capabilities.ignored : !capabilities.ignored || capabilities.visibility) throw Error('索引优化器原生目录能力与方言不一致');
    const selected = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', ...(capabilities.expression ? ['EXPRESSION'] : []), ...(capabilities.visibility ? ['IS_VISIBLE'] : []), ...(capabilities.ignored ? ['IGNORED'] : [])];
    const rows = await query(`SELECT ${selected.join(', ')} FROM information_schema.STATISTICS WHERE ${where} ORDER BY INDEX_NAME, SEQ_IN_INDEX LIMIT 8193`, selected, 8192);
    const grouped = new Map<string, Record<string, string | number | null>[]>();
    for (const row of rows) { if (typeof row.INDEX_NAME !== 'string') throw Error('索引优化器目录缺名称'); const list = grouped.get(row.INDEX_NAME) ?? []; list.push(row); grouped.set(row.INDEX_NAME, list); }
    if (grouped.size !== read.model.indexes.size || [...read.model.indexes.values()].some(index => !grouped.has(index.parsed.name))) throw Error('索引优化器完整目录未与SHOW互相覆盖');
    const definitions = optimizerIndexDefinitions(read), indexes: OptimizerIndexDefinition[] = [];
    for (const [ref, definition] of definitions) {
      const raw = read.model.indexes.get(ref)!.parsed, records = grouped.get(definition.name)!;
      // 专用plain片段独立证明key parts；原模型中的opaque和旧操作权限保持不变。
      const plain = { ...raw, rawSql: definition.rawWithoutVisibility, opaqueReasons: [], parts: raw.parts, comment: definition.definition.comment, method: definition.definition.method };
      const checked = crossCheckIndexStatistics(plain, records, capabilities);
      const allowedReasons = new Set(['STATISTICS 不证明索引是否由服务器生成，需另有可信证据', ...(read.context.dialect === 'mariadb' ? ['目录未独立证明索引可见性'] : [])]);
      if (checked.reasons.some(reason => !allowedReasons.has(reason)) || capabilities.expression && records.some(row => row.EXPRESSION !== null)) continue;
      const states = records.map(row => read.context.dialect === 'mysql' ? row.IS_VISIBLE === 'YES' : row.IGNORED === 'NO');
      if (states.some(state => state !== definition.visible) || checked.visible !== 'unknown' && checked.visible !== definition.visible || read.model.indexes.get(ref)!.visible !== definition.visible) throw Error('索引优化器SHOW与STATISTICS状态不一致');
      const actual = nativeIndexes.filter(index => index.name === definition.name);
      if (actual.length !== 1 || ![0, 1, 2, 3].includes(actual[0].type) || ((actual[0].type & 2) === 2) !== (definition.definition.kind !== 'ordinary') || actual[0].fields < definition.definition.keyParts.length) throw Error('索引优化器普通/唯一角色与原生目录矛盾');
      indexes.push(definition);
    }
    if (!await readTableDefaultEncodingAlter(context, target, read.context)) throw Error('索引优化器直接ALTER权限未证明');
    const final = await readStructureDefinition(context, target, false); assertStructureDefinitionUnchanged({ ...read, originalMode: read.normalizedMode }, final);
    if (JSON.stringify(read.columnExtras) !== JSON.stringify(final.columnExtras) || tableId !== await physical() || JSON.stringify(nativeRows) !== JSON.stringify(await query(nativeSql, ['name', 'id', 'type', 'fields'], 257))) throw Error('索引优化器准备期间实际表或索引实体变化');
    const evidence = [tableId, nativeName, clustered[0].name, nativeIndexes, rows, indexes, read.catalogDigest, read.dependencyDigest], bytes = Buffer.byteLength(JSON.stringify(evidence)) + 8192;
    if (bytes > 8 * 1024 * 1024) throw Error('索引优化器完整事实超过8MiB');
    active(context); return { kind: 'ready', value: { physical: { tableId, nativeName, clusteredIndexName: clustered[0].name, dialect: read.context.dialect, version: read.serverVersion, os: server[0].os, lowerNames: 0, identity: read.identity }, nativeIndexes, indexes, digest: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'), bytes } };
  } catch { active(context); return { kind: 'unavailable', reason: text.unavailable }; }
}
/** 原生实体与所有真实目录必须同时保持，不以同名或相同SHOW代替身份。 */
export function assertTableIndexOptimizerUnchanged(before: TableIndexOptimizerFacts, after: TableIndexOptimizerFacts): void {
  if (before.digest !== after.digest || JSON.stringify(before.physical) !== JSON.stringify(after.physical)) throw Error(text.changed);
}
