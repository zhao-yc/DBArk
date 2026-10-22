import { createHash } from 'node:crypto';
import type { ForeignKeyInfo, TableInfo } from '../shared/contracts';
import { incomingReferenceLimits as limits, incomingReferenceMessages as text, type IncomingReferenceRelation, type IncomingReferencesInput, type IncomingReferencesOutput, type IncomingReferenceSelection } from '../shared/incomingReferences';
import { canonicalReference } from '../shared/references';
import { definitionOmittingSqlModes, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { tableInfo, type MetadataQuery } from './metadata';
import { inlineParameters, serializeCell } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

type Tuple = { database: string; table: string; foreignKeyName: string };
type Row = Record<string, string | number | null>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
const equal = (field: string, value: string) => `CAST(${field} AS BINARY)=CAST(${literal(value)} AS BINARY)`;
const key = (value: Tuple) => JSON.stringify([value.database, value.table, value.foreignKeyName]);
const validName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64 && !value.includes('\0') && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
/** 目录名以实际UTF8二进制序比较，不使用本机语言排序或数组位置作为身份。 */
export function compareIncomingReferenceTuple(a: Tuple, b: Tuple): number { for (const field of ['database', 'table', 'foreignKeyName'] as const) { const value = Buffer.compare(Buffer.from(a[field]), Buffer.from(b[field])); if (value) return value; } return 0; }
function tuple(value: unknown): Tuple {
  const item = value as Tuple; if (!item || !validName(item.database) || !validName(item.table) || !validName(item.foreignKeyName)) throw Error(text.invalid);
  return { database: item.database, table: item.table, foreignKeyName: item.foreignKeyName };
}
function active(context: StructureTaskContext): void { context.checkCancelled(); if (context.managed.signal?.aborted || context.managed.broken) throw Error('关联读取会话已中断'); }
/** 固定自有标量投影，LIMIT+1同时检测数量和完整字节预算。 */
function rows(value: unknown, fields: readonly string[], maximum: number): Row[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error(text.budget);
  const result = value.map(item => {
    if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== fields.length) throw Error(text.invalid);
    const entries = fields.map(field => { const descriptor = Object.getOwnPropertyDescriptor(item, field), cell: unknown = descriptor?.value;
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || cell !== null && typeof cell !== 'string' && !(typeof cell === 'number' && Number.isSafeInteger(cell))) throw Error(text.invalid);
      return [field, cell] as [string, string | number | null];
    }); return Object.fromEntries(entries);
  });
  if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) throw Error(text.budget); return result;
}
const modeOf = (context: StructureTaskContext): TableDefinitionContext => { if (context.managed.sqlMode === undefined) throw Error(text.invalid); const modes = context.managed.sqlMode.split(','); return { dialect: context.managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } }; };
/** 只忽略解析器确认的表尾自增计数；字段属性、生成式、约束及备注均继续绑定摘要。 */
export function incomingReferenceSourceDigest(info: TableInfo, definitionContext: TableDefinitionContext): string {
  const document = parseTableColumnDefinition(info.ddl, definitionContext), tokens = tableDefinitionTokens(info.ddl, definitionContext), canonical: unknown[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.start >= document.tail.range.start && token.kind === 'word' && token.value.toUpperCase() === 'AUTO_INCREMENT') {
      let next = index + 1; if (tokens[next]?.value === '=') next++;
      if (tokens[next]?.kind === 'number' && /^(?:0|[1-9]\d*)$/.test(tokens[next].value)) { index = next; continue; }
    }
    canonical.push([token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  }
  const { ddl: _ddl, ...structure } = info; return hash([structure, canonical, definitionContext]);
}
/** 游标仅定位已返回的最后实际tuple；父结构变化拒绝，不承诺跨页目录快照。 */
export function encodeIncomingReferenceCursor(sourceDigest: string, last: Tuple): string { return Buffer.from(JSON.stringify({ version: 1, sourceDigest, last: tuple(last) })).toString('base64url'); }
export function decodeIncomingReferenceCursor(value: string | undefined, sourceDigest: string): Tuple | undefined {
  if (value === undefined) return;
  try {
    if (value.length > limits.cursor || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (decoded.version !== 1 || decoded.sourceDigest !== sourceDigest || Object.keys(decoded).length !== 3 || Object.keys(decoded.last).length !== 3 || encodeIncomingReferenceCursor(sourceDigest, decoded.last) !== value) throw Error();
    return tuple(decoded.last);
  } catch { throw Error(text.cursor); }
}

/** 所有元数据语句同一独立会话，注入原commandStarted生命周期并给旧目录读取追加硬LIMIT。 */
export async function readIncomingReferenceTable(context: StructureTaskContext, target: { database: string; table: string }, allowViews = false): Promise<TableInfo> {
  if (!validName(target.database) || !validName(target.table)) throw Error(text.invalid); active(context);
  const modes = rows((await structureTaskQuery(context, 'SELECT @@SESSION.sql_mode AS sqlMode')).rows, ['sqlMode'], 1);
  if (modes.length !== 1 || typeof modes[0].sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(modes[0].sqlMode) || modes[0].sqlMode.split(',').some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode.toUpperCase()))) throw Error(text.invalid);
  context.managed.sqlMode = modes[0].sqlMode;
  const identity = rows((await structureTaskQuery(context, `SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE ${equal('TABLE_SCHEMA', target.database)} AND ${equal('TABLE_NAME', target.table)} LIMIT 2`)).rows, ['databaseName', 'tableName', 'kind'], 2);
  if (identity.length !== 1 || identity[0].databaseName !== target.database || identity[0].tableName !== target.table || identity[0].kind !== 'BASE TABLE' && !(allowViews && identity[0].kind === 'VIEW')) throw Error(text.invalid);
  let total = 0;
  const query: MetadataQuery = async <T>(sql: string, params: (string | number | boolean | null | Buffer)[] = []) => {
    const bounded = /^SELECT\b/i.test(sql) && !/\bLIMIT\s+\d+\s*$/i.test(sql) ? sql + ' LIMIT 4097' : sql;
    const result = await structureTaskQuery<T>(context, inlineParameters(bounded, params.map(serializeCell))); active(context);
    if (!Array.isArray(result.rows) || result.rows.length > limits.rows) throw Error(text.budget);
    total += Buffer.byteLength(JSON.stringify(result.rows)); if (total > limits.bytes) throw Error(text.budget); return result;
  };
  const info = await tableInfo(context.managed, target.database, target.table, query); active(context);
  if (info.objectKind !== (identity[0].kind === 'VIEW' ? 'view' : 'table') || Buffer.byteLength(JSON.stringify(info)) > limits.bytes) throw Error(text.invalid); return info;
}

/** 首列目录按实际child三元组做二进制keyset，51st只作为续页标记，不截断整个可见目录。 */
export function incomingReferenceCandidatesSql(parent: { database: string; table: string }, after?: Tuple): string {
  const fields = ['k.TABLE_SCHEMA', 'k.TABLE_NAME', 'k.CONSTRAINT_NAME'], values = after && [after.database, after.table, after.foreignKeyName];
  const continuation = values ? ' AND (' + fields.map((field, index) => '(' + [...fields.slice(0, index).map((previous, earlier) => equal(previous, values[earlier])), `CAST(${field} AS BINARY)>CAST(${literal(values[index])} AS BINARY)`].join(' AND ') + ')').join(' OR ') + ')' : '';
  return `SELECT k.TABLE_SCHEMA AS databaseName,k.TABLE_NAME AS tableName,k.CONSTRAINT_NAME AS foreignKeyName FROM information_schema.KEY_COLUMN_USAGE k WHERE k.ORDINAL_POSITION=1 AND ${equal('k.REFERENCED_TABLE_SCHEMA', parent.database)} AND ${equal('k.REFERENCED_TABLE_NAME', parent.table)}${continuation} ORDER BY BINARY k.TABLE_SCHEMA,BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME LIMIT 51`;
}
const selectedWhere = (selected: Tuple[], prefix: string, schemaField: string) => selected.map(item => '(' + [equal(prefix + schemaField, item.database), equal(prefix + 'TABLE_NAME', item.table), equal(prefix + 'CONSTRAINT_NAME', item.foreignKeyName)].join(' AND ') + ')').join(' OR ');
export function incomingReferencePartsSql(selected: Tuple[]): string {
  if (!selected.length || selected.length > limits.relations) throw Error(text.invalid);
  return `SELECT k.TABLE_SCHEMA AS databaseName,k.TABLE_NAME AS tableName,k.CONSTRAINT_NAME AS foreignKeyName,k.CONSTRAINT_SCHEMA AS constraintSchema,k.COLUMN_NAME AS columnName,k.ORDINAL_POSITION AS ordinal,k.POSITION_IN_UNIQUE_CONSTRAINT AS parentPosition,k.REFERENCED_TABLE_SCHEMA AS parentDatabase,k.REFERENCED_TABLE_NAME AS parentTable,k.REFERENCED_COLUMN_NAME AS parentColumn FROM information_schema.KEY_COLUMN_USAGE k WHERE ${selectedWhere(selected, 'k.', 'TABLE_SCHEMA')} ORDER BY BINARY k.TABLE_SCHEMA,BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION LIMIT 4097`;
}
export function incomingReferenceRulesSql(selected: Tuple[]): string {
  if (!selected.length || selected.length > limits.relations) throw Error(text.invalid);
  return `SELECT r.CONSTRAINT_SCHEMA AS databaseName,r.TABLE_NAME AS tableName,r.CONSTRAINT_NAME AS foreignKeyName,r.UNIQUE_CONSTRAINT_SCHEMA AS parentDatabase,r.REFERENCED_TABLE_NAME AS parentTable,r.UNIQUE_CONSTRAINT_NAME AS uniqueName,r.MATCH_OPTION AS matchOption,r.UPDATE_RULE AS onUpdate,r.DELETE_RULE AS onDelete FROM information_schema.REFERENTIAL_CONSTRAINTS r WHERE ${selectedWhere(selected, 'r.', 'CONSTRAINT_SCHEMA')} ORDER BY BINARY r.CONSTRAINT_SCHEMA,BINARY r.TABLE_NAME,BINARY r.CONSTRAINT_NAME LIMIT 51`;
}
/** 两套真实目录必须一一对应，复合列完整有序，缺规则或未知动作不能被当成不存在。 */
export function assembleIncomingReferenceRelations(source: TableInfo, sourceDigest: string, selected: Tuple[], partsValue: unknown, rulesValue: unknown): IncomingReferenceRelation[] {
  const parts = rows(partsValue, ['databaseName', 'tableName', 'foreignKeyName', 'constraintSchema', 'columnName', 'ordinal', 'parentPosition', 'parentDatabase', 'parentTable', 'parentColumn'], limits.rows);
  const rules = rows(rulesValue, ['databaseName', 'tableName', 'foreignKeyName', 'parentDatabase', 'parentTable', 'uniqueName', 'matchOption', 'onUpdate', 'onDelete'], limits.relations);
  if (Buffer.byteLength(JSON.stringify([source, parts, rules])) > limits.bytes || new Set(selected.map(key)).size !== selected.length) throw Error(text.budget);
  const selectedKeys = new Set(selected.map(key)), grouped = new Map<string, Row[]>(), ruleMap = new Map<string, Row>();
  const rowTuple = (row: Row) => tuple({ database: row.databaseName, table: row.tableName, foreignKeyName: row.foreignKeyName });
  for (const row of parts) { const identity = key(rowTuple(row)); if (!selectedKeys.has(identity)) throw Error(text.invalid); const list = grouped.get(identity) ?? []; list.push(row); grouped.set(identity, list); }
  for (const row of rules) { const identity = key(rowTuple(row)); if (!selectedKeys.has(identity) || ruleMap.has(identity)) throw Error(text.invalid); ruleMap.set(identity, row); }
  return selected.map(item => {
    const values = grouped.get(key(item)), rule = ruleMap.get(key(item));
    if (!values?.length || values.length > limits.parts || !rule || rule.parentDatabase !== source.database || rule.parentTable !== source.name || !validName(rule.uniqueName) || !['NONE', 'SIMPLE'].includes(String(rule.matchOption)) || !['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].includes(String(rule.onUpdate)) || !['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].includes(String(rule.onDelete))) throw Error(text.invalid);
    const positions = new Set<number>(), childColumns = new Set<string>(), parentColumns = new Set<string>();
    for (const [index, row] of values.entries()) {
      if (row.constraintSchema !== item.database || row.parentDatabase !== source.database || row.parentTable !== source.name || !validName(row.columnName) || !validName(row.parentColumn) || !/^[1-9]\d*$/.test(String(row.ordinal)) || Number(row.ordinal) !== index + 1 || !/^[1-9]\d*$/.test(String(row.parentPosition)) || Number(row.parentPosition) > limits.parts || positions.has(Number(row.parentPosition)) || childColumns.has(row.columnName) || parentColumns.has(row.parentColumn) || !source.columns.some(column => column.name === row.parentColumn)) throw Error(text.invalid);
      positions.add(Number(row.parentPosition)); childColumns.add(row.columnName); parentColumns.add(row.parentColumn);
    }
    const foreignKey: ForeignKeyInfo = { name: item.foreignKeyName, columns: values.map(row => row.columnName as string), referencedDatabase: source.database, referencedTable: source.name, referencedColumns: values.map(row => row.parentColumn as string), onUpdate: rule.onUpdate as string, onDelete: rule.onDelete as string };
    return { database: item.database, table: item.table, foreignKey, digest: hash([sourceDigest, item.database, item.table, foreignKey]) };
  });
}
/** 关系读取不隐式遍历子表数据，权限范围永远是visible-only。 */
export async function readIncomingRelations(context: StructureTaskContext, source: TableInfo, sourceDigest: string, selected: Tuple[]): Promise<IncomingReferenceRelation[]> {
  if (!selected.length) return [];
  const parts = (await structureTaskQuery(context, incomingReferencePartsSql(selected))).rows; active(context);
  const rules = (await structureTaskQuery(context, incomingReferenceRulesSql(selected))).rows; active(context);
  return assembleIncomingReferenceRelations(source, sourceDigest, selected, parts, rules);
}
/** 每页重核父结构并返回全部可见目录的续页游标；不把权限过滤结果声称为全局清单。 */
export async function readIncomingReferences(context: StructureTaskContext, input: IncomingReferencesInput): Promise<IncomingReferencesOutput> {
  const source = await readIncomingReferenceTable(context, input), sourceDigest = incomingReferenceSourceDigest(source, modeOf(context)), after = decodeIncomingReferenceCursor(input.cursor, sourceDigest);
  const candidates = rows((await structureTaskQuery(context, incomingReferenceCandidatesSql(input, after))).rows, ['databaseName', 'tableName', 'foreignKeyName'], limits.relations + 1);
  active(context); const selected = candidates.map(row => tuple({ database: row.databaseName, table: row.tableName, foreignKeyName: row.foreignKeyName }));
  for (let index = 0; index < selected.length; index++) { const previous = index ? selected[index - 1] : after; if (previous && compareIncomingReferenceTuple(previous, selected[index]) >= 0) throw Error(text.invalid); }
  const page = selected.slice(0, limits.relations), relations = await readIncomingRelations(context, source, sourceDigest, page);
  if (incomingReferenceSourceDigest(await readIncomingReferenceTable(context, input), modeOf(context)) !== sourceDigest) throw Error(text.stale);
  const output: IncomingReferencesOutput = { source, sourceDigest, relations, ...(selected.length > page.length ? { nextCursor: encodeIncomingReferenceCursor(sourceDigest, page.at(-1)!) } : {}), scope: 'visible-only' };
  if (Buffer.byteLength(JSON.stringify(output)) > limits.bytes) throw Error(text.budget); return output;
}
/** 真实child目录必须与关系的两套目录完全一致，不能借任意目标或伪映射进入数据读取。 */
export async function resolveIncomingReference(context: StructureTaskContext, parent: { database: string; table: string }, selection: IncomingReferenceSelection) {
  const source = await readIncomingReferenceTable(context, parent), sourceDigest = incomingReferenceSourceDigest(source, modeOf(context));
  const relation = (await readIncomingRelations(context, source, sourceDigest, [tuple(selection)]))[0];
  if (relation.digest !== selection.digest) throw Error(text.stale);
  const target = await readIncomingReferenceTable(context, selection), matches = target.foreignKeys.filter(foreignKey => foreignKey.name === selection.foreignKeyName);
  if (matches.length !== 1 || JSON.stringify(canonicalReference(target, matches[0], source)) !== JSON.stringify(relation.foreignKey)) throw Error(text.stale);
  return { source, sourceDigest, relation, target, targetDigest: incomingReferenceSourceDigest(target, modeOf(context)) };
}
/** 读完数据后只比较原观察定义，不宣称跨目录/数据原子快照或自动追踪父行变化。 */
export async function recheckIncomingReference(context: StructureTaskContext, parent: { database: string; table: string }, selection: IncomingReferenceSelection, original: Awaited<ReturnType<typeof resolveIncomingReference>>): Promise<void> {
  const current = await resolveIncomingReference(context, parent, selection);
  if (current.sourceDigest !== original.sourceDigest || current.targetDigest !== original.targetDigest) throw Error(text.stale);
}
