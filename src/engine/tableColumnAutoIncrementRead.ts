import { types } from 'node:util';
import { columnOnUpdateVersionSupported, readControlledTimestampDefault, type TableColumnPatchTarget, type TableColumnDefinition } from '../shared/tableColumnPatches';
import type { TableAutoIncrementPolicy } from '../shared/tableAutoIncrement';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readIndexStructure, indexReferenceNames, type IndexStructureRead, type IndexReferenceNames } from './tableIndexRead';
import { readTableAutoIncrementPolicy } from './tableAutoIncrementCapabilities';
import { readTableDefaultEncodingAlter } from './tableDefaultEncodingPrivileges';
import { mariaDefault } from './sql';
import { structureTaskQuery, readStructureDefinition, assertStructureDefinitionUnchanged, structureDocumentOf, sameStructureFragment, type StructureTaskContext, type StructureDefinitionRead } from './structureDefinition';

export interface TableColumnAutoIncrementCatalogColumn {
  name: string; ordinal: number; typeSql: string; dataType: string; nullable: string; defaultValue: string | null;
  extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string;
}
export interface TableColumnAutoIncrementPhysical {
  tableId: string; serverIdentity: string; dialect: 'mysql' | 'mariadb'; version: string; os: string; lowerNames: 0; catalog: string; nativeName: string;
}
export interface TableColumnAutoIncrementFacts {
  physical: TableColumnAutoIncrementPhysical; columns: TableColumnAutoIncrementCatalogColumn[];
  indexes: IndexStructureRead; policy: TableAutoIncrementPolicy; bytes: number;
}
export type TableColumnAutoIncrementReadResult = { kind: 'ready'; value: TableColumnAutoIncrementFacts } | { kind: 'unavailable'; reason: string };
const maximumBytes = 8 * 1024 * 1024;
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 所有附加目录回调后核取消；未知关闭或断线不能降级成普通可继续状态。 */
function active(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? Error('列自增目录已取消');
  if (context.managed.broken) throw Error('列自增目录连接已断开');
}
/** 固定标量列、原始行数及UTF8预算先核，不执行目录getter/toJSON或自定义数组迭代器。 */
function rows(value: unknown, keys: readonly string[], maximum: number): Record<string, string | number | null>[] {
  if (types.isProxy(value) || !Array.isArray(value)) throw Error('列自增目录形状无效');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) throw Error('列自增目录数量无效');
  const output: Record<string, string | number | null>[] = []; let bytes = 2;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), item: unknown = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !item || typeof item !== 'object' || types.isProxy(item) || Reflect.ownKeys(item).length !== keys.length) throw Error('列自增目录行字段无效');
    const copy: Record<string, string | number | null> = Object.create(null);
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item, key), scalar: unknown = field?.value;
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || scalar !== null && typeof scalar !== 'string' && !(typeof scalar === 'number' && Number.isSafeInteger(scalar))) throw Error('列自增目录字段不是原始标量');
      bytes += Buffer.byteLength(key) + (typeof scalar === 'string' ? Buffer.byteLength(scalar) : 24) + 8;
      if (bytes > maximumBytes) throw Error('列自增目录超过8MiB');
      copy[key] = scalar as string | number | null;
    }
    output.push(copy);
  }
  if (Buffer.byteLength(JSON.stringify(output)) > maximumBytes) throw Error('列自增目录转义后超过8MiB');
  return output;
}
/** 保留精确原生ID，不用DDL摘要代替同名表身份；未证明名称映射时明确禁用。 */
async function physical(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<TableColumnAutoIncrementPhysical> {
  if (!columnOnUpdateVersionSupported(base.context.dialect, base.serverVersion) || context.managed.status.version !== base.serverVersion || context.managed.status.dialect !== base.context.dialect) throw Error('列自增属性尚未开放当前精确版本');
  const query = async (sql: string, keys: readonly string[]) => { const result = await structureTaskQuery<unknown>(context, sql); active(context); return rows(result.rows, keys, 2); };
  const server = await query('SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2', ['version', 'os', 'lowerNames']);
  if (server.length !== 1 || server[0].version !== base.serverVersion || typeof server[0].os !== 'string' || !['linux', 'debian-linux-gnu'].includes(server[0].os.toLowerCase()) || ![0, '0'].includes(server[0].lowerNames as number)) throw Error('列自增服务器版本或名称映射不能证明');
  const where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const tables = await query(`SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE ${where} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine']);
  if (tables.length !== 1 || tables[0].databaseName !== target.database || tables[0].tableName !== target.table || tables[0].kind !== 'BASE TABLE' || tables[0].engine !== 'InnoDB') throw Error('列自增真实InnoDB基本表不能唯一证明');
  const nativeName = target.database + '/' + target.table, catalog = base.context.dialect === 'mysql' && /^8\./.test(base.serverVersion) ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES';
  const ids = await query(`SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${catalog} WHERE CAST(NAME AS BINARY)=CAST(${literal(nativeName)} AS BINARY) LIMIT 2`, ['id', 'name']);
  const id = ids[0]?.id;
  if (ids.length !== 1 || ids[0].name !== nativeName || typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id) || id.length === 20 && id > '18446744073709551615') throw Error('列自增原生表编号或名称映射不能唯一证明');
  return { tableId: id, serverIdentity: base.identity, dialect: base.context.dialect, version: base.serverVersion, os: server[0].os, lowerNames: 0, catalog, nativeName };
}
/** 只去掉完整最外层括号，不把字符串、注释或运算次序改写为推测等价。 */
function expressionTokens(value: string, base: StructureDefinitionRead): string {
  let tokens = tableDefinitionTokens(value, base.context);
  if (tokens.some(token => token.kind === 'executable')) throw Error('列自增目录含未知可执行表达式');
  while (tokens[0]?.kind === 'symbol' && tokens[0].value === '(' && tokens.at(-1)?.kind === 'symbol' && tokens.at(-1)?.value === ')') {
    let depth = 0, enclosed = true;
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index].kind === 'symbol' && tokens[index].value === '(') depth++;
      if (tokens[index].kind === 'symbol' && tokens[index].value === ')') depth--;
      if (depth === 0 && index < tokens.length - 1) { enclosed = false; break; }
    }
    if (!enclosed) break; tokens = tokens.slice(1, -1);
  }
  return JSON.stringify(tokens.map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
}
/** 每份完整COLUMNS就地核默认值，不能让后读目录掩盖与同份SHOW的矛盾。 */
function defaultMatches(column: TableColumnDefinition, value: string | null, base: StructureDefinitionRead): boolean {
  const actual = base.context.dialect === 'mariadb' ? mariaDefault(value, base.context.mode.noBackslashEscapes) : value, expected = column.default;
  if (expected.kind === 'none' || expected.kind === 'null') return actual === null;
  if (expected.kind === 'opaque') return false;
  if (expected.kind === 'literal') {
    if (expected.introducer !== undefined || expected.valueType === 'binary') return false;
    return actual === (expected.valueType === 'boolean' ? expected.value === 'true' ? '1' : '0' : expected.value);
  }
  if (actual === null) return false;
  const time = readControlledTimestampDefault(expected.sql), observed = readControlledTimestampDefault(actual);
  return time && observed ? time.precision === observed.precision : expressionTokens(expected.sql, base) === expressionTokens(actual, base);
}
/** 全部字段的类型、默认、编码、EXTRA、生成属性与同份SHOW及原目录逐项相证。 */
async function columns(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<TableColumnAutoIncrementCatalogColumn[]> {
  const where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const result = await structureTaskQuery<unknown>(context, `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal, COLUMN_TYPE AS typeSql, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION LIMIT 4097`); active(context);
  const raw = rows(result.rows, ['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'collation', 'comment'], 4096), document = structureDocumentOf(base);
  if (raw.length !== document.columns.length) throw Error('列自增目录未覆盖完整字段');
  const extras = new Map(base.columnExtras ?? []);
  return raw.map((item, index) => {
    const column = document.columns[index], encoding = base.encodings[index];
    if (item.name !== column.name || !(item.ordinal === index + 1 || item.ordinal === String(index + 1)) || typeof item.typeSql !== 'string' || !sameStructureFragment(item.typeSql, column.type.raw, base.context) || typeof item.dataType !== 'string' || !['YES', 'NO'].includes(item.nullable as string) || (item.nullable === 'YES') !== column.nullable || typeof item.extra !== 'string' || typeof item.comment !== 'string' || item.comment !== (column.comment ?? '') || item.defaultValue !== null && typeof item.defaultValue !== 'string' || item.generationExpression !== null && typeof item.generationExpression !== 'string') throw Error('列自增完整目录与SHOW属性不一致');
    const family = /^[A-Za-z]+/.exec(column.type.raw.trim())?.[0].toUpperCase(), aliases: Record<string, string> = { INTEGER: 'INT', NUMERIC: 'DECIMAL' };
    if (!family || (aliases[family] ?? family) !== item.dataType.toUpperCase() || !encoding || encoding.name !== item.name || encoding.charset !== item.charset || encoding.collation !== item.collation || extras.get(column.name) !== item.extra) throw Error('列自增实际类型、编码或EXTRA发生矛盾');
    const generated = column.attributes.find(attribute => attribute.kind === 'generated'), expression = item.generationExpression ?? '';
    if (generated) {
      const parsed = /^(?:GENERATED\s+(?:ALWAYS\s+)?)?AS\s*\(([\s\S]*)\)\s*(VIRTUAL|STORED|PERSISTENT)?$/i.exec(generated.raw.trim()), extra = /^(VIRTUAL|STORED|PERSISTENT)\s+GENERATED$/i.exec(item.extra.trim());
      const storage = (value: string) => value.toUpperCase() === 'PERSISTENT' ? 'STORED' : value.toUpperCase();
      if (!parsed || !extra || typeof expression !== 'string' || !expression || storage(parsed[2] ?? 'VIRTUAL') !== storage(extra[1]) || expressionTokens(parsed[1], base) !== expressionTokens(expression, base) || !(item.defaultValue === null || base.context.dialect === 'mariadb' && item.defaultValue === 'NULL')) throw Error('列自增旁生成列目录不一致');
    } else {
      if (!defaultMatches(column, item.defaultValue as string | null, base) || expression !== '') throw Error('列自增普通默认值或生成目录不一致');
      const markers = item.extra.match(/\bDEFAULT_GENERATED\b/ig) ?? [], extra = item.extra.replace(/\bDEFAULT_GENERATED\b/ig, '').trim();
      if (markers.length && (markers.length !== 1 || base.context.dialect !== 'mysql' || column.default.kind !== 'expression')) throw Error('列自增DEFAULT_GENERATED属性不能证明');
      const expected = [column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', column.attributes.find(attribute => attribute.kind === 'on-update')?.raw ?? '', column.attributes.find(attribute => attribute.kind === 'visibility')?.raw ?? ''].filter(Boolean).join(' ');
      if (!sameStructureFragment(extra, expected, base.context)) throw Error('列自增目录包含未知或矛盾EXTRA');
    }
    return { ...item, ordinal: index + 1, generationExpression: expression } as TableColumnAutoIncrementCatalogColumn;
  });
}
/** 附加真实事实使用原索引/入向目录读取器，不伪造权限、列或索引模型。 */
export async function readTableColumnAutoIncrementFacts(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead, refs?: IndexReferenceNames): Promise<TableColumnAutoIncrementReadResult> {
  try {
    const before = await physical(context, target, base), indexes = await readIndexStructure(context, target, refs);
    assertStructureDefinitionUnchanged({ ...base, originalMode: base.normalizedMode }, indexes);
    if (JSON.stringify(base.columnExtras) !== JSON.stringify(indexes.columnExtras)) throw Error('列自增EXTRA在准备期间变化');
    const catalog = await columns(context, target, base), policy = await readTableAutoIncrementPolicy(context);
    if (!await readTableDefaultEncodingAlter(context, target, base.context)) throw Error('无法证明列自增直接ALTER权限');
    const final = await readStructureDefinition(context, target, false);
    assertStructureDefinitionUnchanged({ ...base, originalMode: base.normalizedMode }, final);
    const after = await physical(context, target, final);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(base.columnExtras) !== JSON.stringify(final.columnExtras)) throw Error('列自增物理身份或目录在准备期间变化');
    const bytes = indexes.bytes + Buffer.byteLength(JSON.stringify([before, catalog, policy])) + 8192;
    if (bytes > maximumBytes) throw Error('列自增完整证据超过8MiB');
    active(context); return { kind: 'ready', value: { physical: before, columns: catalog, indexes, policy, bytes } };
  } catch (error) { active(context); return { kind: 'unavailable', reason: '列自增所需完整目录、原生身份、权限或运行策略未能证明；请重新读取或核对权限，普通属性仍可使用' }; }
}
/** 前核必须保留原实体ID及全部目录/依赖/策略，不接受另一个同名表或客户端事实。 */
export function assertTableColumnAutoIncrementUnchanged(before: TableColumnAutoIncrementFacts, after: TableColumnAutoIncrementFacts): void {
  if (JSON.stringify([before.physical, before.columns, before.policy, before.indexes.catalogDigest, before.indexes.dependencyDigest, before.indexes.options, [...indexReferenceNames(before.indexes).columns], [...indexReferenceNames(before.indexes).indexes]]) !== JSON.stringify([after.physical, after.columns, after.policy, after.indexes.catalogDigest, after.indexes.dependencyDigest, after.indexes.options, [...indexReferenceNames(after.indexes).columns], [...indexReferenceNames(after.indexes).indexes]])) throw Error('列自增实体、目录、关联依赖或运行策略已变化；未发送DDL');
}
