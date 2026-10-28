import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { tableCreateDraftSchema, tableCreateHasGenerated, type TableCreateDraft } from '../shared/tableCreate';
import { assertTableCreateGenerated, tableCreateGeneratedReferenceColumns, tableCreateGeneratedMessages as text, tableCreateNumericType } from '../shared/tableCreateGenerated';
import { definitionOmittingSqlModes, readColumnOnUpdate, readControlledTimestampDefault, sameColumnOnUpdate, type TableColumnDefinition, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { compileResolvedGeneratedColumnExpression, readGeneratedColumnDefinition, sameGeneratedColumnExpression } from './tableGeneratedColumn';
import { sameStructureFragment, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { qualified } from './sql';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableDefaultEncodingDefinition } from './tableDefaultEncodingSql';
import { effectiveTableCreateColumnEncoding } from '../shared/tableCreateColumnEncoding';
import { tableCreateColumnDefaultMatches } from './tableCreateColumnDefaults';
import { tableCreateCheckHasJson, tableCreateCheckJsonMatches, type TableCreateChecksProof } from './tableCreateChecks';

export interface TableCreateGeneratedFacts {
  dialect: 'mysql' | 'mariadb'; serverVersion: string; os: string; lowerNames: 0; sqlMode: string; quoteShowCreate: 1;
  characterSetConnection: string; collationConnection: string; engineSupport: 'YES' | 'DEFAULT'; serverIdentity: string; digest: string;
}
export interface TableCreateGeneratedPlan {
  factsDigest: string; dialect: 'mysql' | 'mariadb'; serverVersion: string;
  columns: { ordinal: number; name: string; storage: 'VIRTUAL' | 'STORED'; sql: string; fingerprint: string; referencedColumns: string[] }[];
}
const factsKeys = ['dialect', 'serverVersion', 'os', 'lowerNames', 'sqlMode', 'quoteShowCreate', 'characterSetConnection', 'collationConnection', 'engineSupport', 'serverIdentity', 'digest'] as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 原回调终态之后仍检查取消/断线，不能把取消误转为普通能力只读。 */
function active(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? Error(text.facts);
  if (context.managed.broken) throw Error(text.facts);
}

/** 只读取固定标量自有字段，按实际UTF8及JSON转义字节计预算，拒绝代理/访问器/稀疏目录。 */
export function boundedCreateColumnRows(value: unknown, keys: readonly string[], maximum: number, budget: number): Record<string, string | number | null>[] {
  if (types.isProxy(value) || !Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.verify);
  const result: Record<string, string | number | null>[] = []; let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !Object.hasOwn(item, 'value') || !item.value || typeof item.value !== 'object' || types.isProxy(item.value) || Reflect.ownKeys(item.value).length !== keys.length) throw Error(text.verify);
    const row: Record<string, string | number | null> = {};
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item.value, key), scalar: unknown = field?.value;
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || scalar !== null && typeof scalar !== 'string' && !(typeof scalar === 'number' && Number.isSafeInteger(scalar))) throw Error(text.verify);
      bytes += Buffer.byteLength(key) + (typeof scalar === 'string' ? Buffer.byteLength(scalar) : 24) + 8;
      if (bytes > budget) throw Error(text.budget); row[key] = scalar as string | number | null;
    }
    result.push(row);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > budget) throw Error(text.budget);
  return result;
}

/** 准确补丁允许发行后缀，不允许邻近版本、空白或MySQL/Maria方言互换。 */
function supported(dialect: 'mysql' | 'mariadb', version: string): boolean {
  const match = /^(?:5\.5\.5-)?(\d+\.\d+\.\d+)(?:[-+][^\s]+)?$/.exec(version);
  return !!match && (dialect === 'mysql' ? !/maria/i.test(version) && ['5.7.44', '8.0.46', '8.4.11'].includes(match[1]) : ['10.11.19', '11.4.13'].includes(match[1]));
}

/** 计划只消费真实读取并带完整摘要的能力；调用者不能仅凭宽版本或草稿补证。 */
export function assertTableCreateGeneratedFacts(facts: TableCreateGeneratedFacts): void {
  const row = boundedCreateColumnRows([facts], factsKeys, 1, 64 * 1024)[0];
  if (!['mysql', 'mariadb'].includes(row.dialect as string) || typeof row.serverVersion !== 'string' || !supported(row.dialect as TableCreateGeneratedFacts['dialect'], row.serverVersion) || typeof row.os !== 'string' || !['linux', 'debian-linux-gnu'].includes(row.os.toLowerCase()) || row.lowerNames !== 0 || row.quoteShowCreate !== 1 || typeof row.sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(row.sqlMode) || row.sqlMode.split(',').some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode.toUpperCase())) || typeof row.characterSetConnection !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(row.characterSetConnection) || typeof row.collationConnection !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(row.collationConnection) || !['YES', 'DEFAULT'].includes(row.engineSupport as string) || typeof row.serverIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(row.serverIdentity) || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)) throw Error(text.facts);
  const { digest: _digest, ...content } = row;
  if (hash(content) !== row.digest) throw Error(text.facts);
}

/** 只查实际会话、服务器身份与引擎支持，不读取不存在的新表、不SET模式或制造TABLE_ID。 */
export async function readTableCreateGeneratedFacts(context: StructureTaskContext): Promise<TableCreateGeneratedFacts> {
  active(context);
  const query = async (sql: string, keys: readonly string[]) => { const result = await structureTaskQuery<unknown>(context, sql); active(context); return boundedCreateColumnRows(result.rows, keys, 2, 64 * 1024); };
  const rows = await query('SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@sql_mode AS sqlMode,@@sql_quote_show_create AS quoteShowCreate,@@hostname AS hostname,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS currentUser,@@character_set_connection AS charset,@@collation_connection AS collation', ['version', 'os', 'lowerNames', 'sqlMode', 'quoteShowCreate', 'hostname', 'port', 'serverId', 'currentUser', 'charset', 'collation']);
  const row = rows[0], { dialect, version } = context.managed.status;
  if (rows.length !== 1 || !row || row.version !== version || !supported(dialect, version) || ![0, '0'].includes(row.lowerNames as number) || ![1, '1'].includes(row.quoteShowCreate as number) || ['os', 'sqlMode', 'hostname', 'currentUser', 'charset', 'collation'].some(key => typeof row[key] !== 'string') || !row.hostname || !row.currentUser || !/^[1-9]\d{0,4}$/.test(String(row.port)) || Number(row.port) > 65535 || !/^(?:0|[1-9]\d{0,9})$/.test(String(row.serverId)) || Number(row.serverId) > 4294967295) throw Error(text.facts);
  let uuid: string | null = null;
  if (dialect === 'mysql') {
    const values = await query('SELECT @@server_uuid AS uuid', ['uuid']);
    if (values.length !== 1 || typeof values[0].uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(values[0].uuid)) throw Error(text.facts);
    uuid = values[0].uuid;
  }
  const engines = await query("SELECT ENGINE AS engine,SUPPORT AS support FROM information_schema.ENGINES WHERE ENGINE='InnoDB' LIMIT 2", ['engine', 'support']);
  if (engines.length !== 1 || engines[0].engine !== 'InnoDB' || !['YES', 'DEFAULT'].includes(engines[0].support as string)) throw Error(text.facts);
  const content = { dialect, serverVersion: version, os: row.os as string, lowerNames: 0 as const, sqlMode: row.sqlMode as string, quoteShowCreate: 1 as const, characterSetConnection: row.charset as string, collationConnection: row.collation as string, engineSupport: engines[0].support as 'YES' | 'DEFAULT', serverIdentity: hash([row.hostname, String(row.port), String(row.serverId), row.currentUser, uuid, dialect, version]) };
  const facts = { ...content, digest: hash(content) }; assertTableCreateGeneratedFacts(facts); active(context); return facts;
}

/** 新表引用仅来自独立待建声明；实际方言的DECIMAL尺度必须在编译前核对。 */
function plannedColumns(design: TableCreateDraft, dialect: 'mysql' | 'mariadb'): TableCreateGeneratedPlan['columns'] {
  assertTableCreateGenerated(design);
  if (!tableCreateHasGenerated(design) || design.engine.toUpperCase() !== 'INNODB') throw Error(text.target);
  const maxScale = dialect === 'mysql' ? 30 : 38;
  return design.columns.flatMap((column, ordinal) => {
    if (!column.generated) return [];
    const type = tableCreateNumericType(column.type)!;
    if (type.kind === 'decimal' && type.scale > maxScale) throw Error(text.attributes);
    const references = new Map(tableCreateGeneratedReferenceColumns(design, ordinal).map(reference => [reference.name, reference]));
    const compiled = compileResolvedGeneratedColumnExpression(column.generated.expression, name => {
      const reference = references.get(name);
      return reference && !(reference.type.kind === 'decimal' && reference.type.scale > maxScale) ? reference.name : undefined;
    });
    return [{ ordinal, name: column.name, storage: column.generated.storage, ...compiled }];
  });
}

/** 普通列EXTRA也必须由SHOW逐项证明；仅允许独立前置默认标记及真实自增/自动时间，不洗掉未知属性。 */
export function ordinaryCreateColumnExtraMatches(column: TableColumnDefinition, extra: string, dialect: 'mysql' | 'mariadb', characterEncodingProven: boolean): boolean {
  if (extra.length > 512 || column.attributes.some(attribute => !['nullable', 'default', 'comment', 'auto-increment', 'on-update', ...(characterEncodingProven ? ['charset', 'collation'] : [])].includes(attribute.kind))) return false;
  const increments = column.attributes.filter(attribute => attribute.kind === 'auto-increment'), updates = column.attributes.filter(attribute => attribute.kind === 'on-update');
  if (increments.length > 1 || updates.length > 1 || increments.length && updates.length) return false;
  let rest = extra.trim();
  const marker = /^DEFAULT_GENERATED(?:\s+|$)/i.exec(rest);
  if (marker) {
    if (dialect !== 'mysql' || column.default.kind !== 'expression' || !readControlledTimestampDefault(column.default.sql)) return false;
    rest = rest.slice(marker[0].length);
  }
  if (increments.length) return /^auto_increment$/i.test(rest);
  if (!updates.length) return rest === '';
  const expression = /^on\s+update\s+(.+)$/i.exec(rest)?.[1], observed = expression && readControlledTimestampDefault(expression), expected = readColumnOnUpdate(column);
  return !!observed && !!expected && sameColumnOnUpdate(expected, { kind: 'expression', expression: 'current-timestamp', precision: observed.precision }, column.type.raw);
}

/** 每列的有效配对来自显式请求或表继承，SHOW属性须与真实COLUMNS逐项吻合。 */
export function ordinaryCreateColumnEncodingMatches(column: TableColumnDefinition, row: Record<string, string | number | null>, document: TableColumnDefinitionDocument, encoding: { charset: string; collation: string }): boolean {
  const character = /^(?:CHAR|VARCHAR|ENUM|SET|(?:TINY|MEDIUM|LONG)?TEXT)$/i.test(String(row.dataType));
  const attributes = column.attributes.filter(attribute => attribute.kind === 'charset' || attribute.kind === 'collation');
  // 原生MySQL JSON沿既有JSON新增的固有配对门，不把它当字符继承或给它授予列级编码覆写。
  if (document.context.dialect === 'mysql' && String(row.dataType).toUpperCase() === 'JSON' && column.type.raw.trim().toUpperCase() === 'JSON') return attributes.length === 0 && (row.charset === null && row.collation === null || row.charset === 'utf8mb4' && row.collation === 'utf8mb4_bin');
  if (!character) return attributes.length === 0 && row.charset === null && row.collation === null;
  if (row.charset !== encoding.charset || row.collation !== encoding.collation) return false;
  for (const attribute of attributes) {
    const tokens = tableDefinitionTokens(attribute.raw, document.context); let cursor = 0;
    if (attribute.kind === 'charset') {
      if (tokens[cursor]?.kind !== 'word') return false;
      const word = tokens[cursor++].value.toUpperCase();
      if (word === 'CHARACTER') { if (tokens[cursor]?.kind !== 'word' || tokens[cursor++].value.toUpperCase() !== 'SET') return false; }
      else if (word !== 'CHARSET') return false;
    } else if (tokens[cursor]?.kind !== 'word' || tokens[cursor++].value.toUpperCase() !== 'COLLATE') return false;
    if (tokens[cursor]?.value === '=') cursor++;
    const value = tokens[cursor++];
    if (!value || !['word', 'identifier'].includes(value.kind) || value.value !== encoding[attribute.kind === 'charset' ? 'charset' : 'collation'] || cursor !== tokens.length) return false;
  }
  return true;
}

/** 每个生成列都是0基请求计划；普通索引/FK由原CREATE规划器继续完整核验。 */
export function planTableCreateGeneratedColumns(input: TableCreateDraft, facts: TableCreateGeneratedFacts): TableCreateGeneratedPlan {
  assertTableCreateGeneratedFacts(facts); const design = tableCreateDraftSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(design)) > 2 * 1024 * 1024) throw Error(text.budget);
  return { factsDigest: facts.digest, dialect: facts.dialect, serverVersion: facts.serverVersion, columns: plannedColumns(design, facts.dialect) };
}

/** CREATE后只用实际SHOW与完整COLUMNS补齐省略NULL，不能据此给未知属性授予editable权限。 */
export async function verifyCreatedGeneratedColumns(context: StructureTaskContext, target: { database: string; table: string }, input: TableCreateDraft, plan: TableCreateGeneratedPlan, document: TableColumnDefinitionDocument, checkProof?: TableCreateChecksProof): Promise<boolean> {
  active(context);
  const design = tableCreateDraftSchema.parse(input), facts = await readTableCreateGeneratedFacts(context);
  if (facts.digest !== plan.factsDigest || facts.dialect !== plan.dialect || facts.serverVersion !== plan.serverVersion || target.database !== design.database || target.table !== design.name || document.context.dialect !== plan.dialect || document.context.mode.noBackslashEscapes !== facts.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES') || document.context.mode.ansiQuotes !== facts.sqlMode.split(',').includes('ANSI_QUOTES') || document.table !== target.table || document.database !== undefined && document.database !== target.database || document.columns.length !== design.columns.length || JSON.stringify(plannedColumns(design, facts.dialect)) !== JSON.stringify(plan.columns)) return false;
  const condition = (prefix = '') => `CAST(${prefix}TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(${prefix}TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`, where = condition();
  const query = async (sql: string, keys: readonly string[], maximum = 1000, budget = 2 * 1024 * 1024) => { const value = await structureTaskQuery<unknown>(context, sql); active(context); return boundedCreateColumnRows(value.rows, keys, maximum, budget); };
  const tables = await query(`SELECT t.TABLE_SCHEMA AS databaseName,t.TABLE_NAME AS tableName,t.TABLE_TYPE AS kind,t.ENGINE AS engine,c.CHARACTER_SET_NAME AS charset,t.TABLE_COLLATION AS collation FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME=t.TABLE_COLLATION WHERE ${condition('t.')} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine', 'charset', 'collation'], 2, 64 * 1024);
  if (tables.length !== 1 || tables[0].databaseName !== target.database || tables[0].tableName !== target.table || tables[0].kind !== 'BASE TABLE' || tables[0].engine !== 'InnoDB') return false;
  const table = tables[0], shown = readTableDefaultEncodingDefinition(document.source, document.context);
  if (shown.reasons.length || shown.charset !== design.charset || typeof table.collation !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(table.collation) || shown.collation !== undefined && shown.collation !== table.collation || design.collation !== undefined && design.collation !== table.collation) return false;
  // Maria通用UCA目录可无一对一字符集；只能由SHOW显式完整配对及TABLES实际collation补证，不能猜名称前缀。
  if (table.charset === null ? plan.dialect !== 'mariadb' || shown.collation !== table.collation : table.charset !== design.charset) return false;
  if (shown.collation === undefined) {
    const defaults = await query(`SELECT CHARACTER_SET_NAME AS name,DEFAULT_COLLATE_NAME AS collation FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME=${literal(design.charset)} LIMIT 2`, ['name', 'collation'], 2, 64 * 1024);
    if (defaults.length !== 1 || defaults[0].name !== design.charset || defaults[0].collation !== table.collation) return false;
  }
  const encoding = { charset: design.charset, collation: table.collation };
  const partitions = await query(`SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where} LIMIT 2`, ['name'], 2, 64 * 1024);
  if (partitions.length !== 1 || partitions[0].name !== null) return false;
  const columns = await query(`SELECT COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal,COLUMN_TYPE AS typeSql,DATA_TYPE AS dataType,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,GENERATION_EXPRESSION AS generationExpression,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION LIMIT 1001`, ['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'collation', 'comment']);
  if (columns.length !== document.columns.length) return false;
  const actualColumns = document.columns.map((column, index) => ({ ...column, nullable: columns[index].nullable === 'YES' })), actual = { ...document, columns: actualColumns, columnsByName: new Map(actualColumns.map(column => [column.name, column])) };
  for (const [index, row] of columns.entries()) {
    const column = document.columns[index], requested = design.columns[index], generated = plan.columns.find(item => item.ordinal === index);
    if (row.name !== column.name || row.name !== requested.name || !/^[1-9]\d*$/.test(String(row.ordinal)) || Number(row.ordinal) !== index + 1 || !['YES', 'NO'].includes(row.nullable as string) || (row.nullable === 'YES') !== requested.nullable || column.nullable !== undefined && (row.nullable === 'YES') !== column.nullable || typeof row.typeSql !== 'string' || !sameStructureFragment(row.typeSql, column.type.raw, document.context) || typeof row.dataType !== 'string' || typeof row.extra !== 'string' || typeof row.comment !== 'string' || row.comment !== requested.comment || row.comment !== (column.comment ?? '') || row.defaultValue !== null && typeof row.defaultValue !== 'string' || row.generationExpression !== null && typeof row.generationExpression !== 'string' || row.charset !== null && typeof row.charset !== 'string' || row.collation !== null && typeof row.collation !== 'string') return false;
    const family = /^[A-Za-z]+/.exec(column.type.raw.trim())?.[0].toUpperCase(), aliases: Record<string, string> = { INTEGER: 'INT', NUMERIC: 'DECIMAL' };
    if (!family || (aliases[family] ?? family) !== row.dataType.toUpperCase()) return false;
    if (!generated) {
      // 仅同份SHOW及TC/CC/COLUMNS签发的Maria JSON证据可证明LONGTEXT；本次完整目录仍须逐项相等。
      if (tableCreateCheckHasJson(checkProof, document, column.name)) { if (!tableCreateCheckJsonMatches(checkProof, document, column.name, row)) return false; continue; }
      const character = /^(?:CHAR|VARCHAR|ENUM|SET|(?:TINY|MEDIUM|LONG)?TEXT)$/i.test(row.dataType);
      if (row.generationExpression !== null && row.generationExpression !== '' || !tableCreateColumnDefaultMatches(requested, column, row.defaultValue as string | null, document.context) || !ordinaryCreateColumnEncodingMatches(column, row, document, effectiveTableCreateColumnEncoding(requested, encoding)) || !ordinaryCreateColumnExtraMatches(column, row.extra, plan.dialect, character)) return false;
      continue;
    }
    const numeric = tableCreateNumericType(column.type.raw), expected = tableCreateNumericType(requested.type), projection = readGeneratedColumnDefinition(actual, column.name);
    const storage = /^(VIRTUAL|STORED|PERSISTENT)\s+GENERATED$/i.exec(row.extra.trim())?.[1].toUpperCase(), sqlNull = row.defaultValue === null || plan.dialect === 'mariadb' && row.defaultValue === 'NULL';
    if (!numeric || JSON.stringify(numeric) !== JSON.stringify(expected) || !projection || projection.storage !== generated.storage || projection.fingerprint !== generated.fingerprint || !storage || (storage === 'PERSISTENT' ? 'STORED' : storage) !== generated.storage || !sqlNull || row.nullable !== 'YES' || row.charset !== null || row.collation !== null || typeof row.generationExpression !== 'string' || !row.generationExpression || column.default.kind !== 'none' || column.attributes.some(attribute => !['generated', 'nullable', 'comment'].includes(attribute.kind)) || !sameGeneratedColumnExpression(actual, generated.sql, row.generationExpression, index) || !sameGeneratedColumnExpression(actual, projection.expression, row.generationExpression, index)) return false;
  }
  const after = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows; active(context);
  return Array.isArray(after) && after.length === 1 && after[0]['Create Table'] === document.source;
}
