import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { assertTableCreateChecks, tableCreateChecksMessages as text } from '../shared/tableCreateChecks';
import type { TableCreateDraft } from '../shared/tableCreate';
import { definitionOmittingSqlModes, type TableColumnDefinitionDocument, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { tableCheckLimits } from '../shared/tableChecks';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { assertTableCheckExpression, readTableCheckDefinition, tableCheckVersionCapabilities, type ParsedTableCheck } from './tableCheckDefinition';
import { identifier, SqlScriptScanner } from './sql';
import { sameStructureFragment, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableCreateColumnDefaultMatches } from './tableCreateColumnDefaults';

export interface TableCreateCheckFacts {
  dialect: 'mysql' | 'mariadb'; serverVersion: string; sqlMode: string; allowsNotEnforced: boolean; digest: string;
}
type Row = Record<string, string | number | null>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
const condition = (database: string, table: string, prefix = '') => `CAST(${prefix}TABLE_SCHEMA AS BINARY)=CAST(${literal(database)} AS BINARY) AND CAST(${prefix}TABLE_NAME AS BINARY)=CAST(${literal(table)} AS BINARY)`;
const lexical = (facts: TableCreateCheckFacts): TableDefinitionContext => ({ dialect: facts.dialect, mode: { ansiQuotes: facts.sqlMode.split(',').includes('ANSI_QUOTES'), noBackslashEscapes: facts.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES') } });

/** 所有目录先验证普通自有标量、数量及累计字节，未知/稀疏/访问器不会变成零约束。 */
function rows(value: unknown, keys: readonly string[], maximum: number, budget: number = tableCheckLimits.metadataBytes): Row[] {
  if (types.isProxy(value) || !Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.verify);
  let used = 0; const output: Row[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)), item: unknown = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !item || typeof item !== 'object' || types.isProxy(item) || Reflect.ownKeys(item).length !== keys.length) throw Error(text.verify);
    const copy: Row = Object.create(null) as Row;
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item, key), scalar: unknown = field?.value;
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || scalar !== null && typeof scalar !== 'string' && !(typeof scalar === 'number' && Number.isSafeInteger(scalar))) throw Error(text.verify);
      used += Buffer.byteLength(key) + (typeof scalar === 'string' ? Buffer.byteLength(scalar) * 6 : 32) + 8;
      if (used > budget) throw Error(text.verify); copy[key] = scalar as string | number | null;
    }
    output.push(copy);
  }
  return output;
}

/** 仅显式请求CHECK事实时调整新建专用会话；不触及任何查询标签或全局开关。 */
export async function readTableCreateCheckFacts(context: StructureTaskContext): Promise<TableCreateCheckFacts> {
  const select = async (sql: string, keys: readonly string[]) => rows((await structureTaskQuery<unknown>(context, sql)).rows, keys, 1, 65536);
  const actual = await select('SELECT VERSION() AS version,@@SESSION.sql_mode AS sqlMode', ['version', 'sqlMode']);
  const row = actual[0], { dialect, version } = context.managed.status;
  if (actual.length !== 1 || row.version !== version || typeof row.sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(row.sqlMode) || row.sqlMode.split(',').some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode.toUpperCase()))) throw Error(text.unavailable);
  const capability = tableCheckVersionCapabilities(dialect, version); if (!capability.writable) throw Error(text.unsupported);
  await structureTaskQuery(context, 'SET SESSION foreign_key_checks=1,unique_checks=1');
  if (dialect === 'mariadb') await structureTaskQuery(context, 'SET SESSION check_constraint_checks=ON');
  const flags = await select(`SELECT @@SESSION.foreign_key_checks AS fk,@@SESSION.unique_checks AS uq,${dialect === 'mariadb' ? '@@SESSION.check_constraint_checks' : '1'} AS checks,@@SESSION.sql_mode AS sqlMode`, ['fk', 'uq', 'checks', 'sqlMode']);
  if (flags.length !== 1 || flags[0].sqlMode !== row.sqlMode || !['fk', 'uq', 'checks'].every(key => [1, '1', 'ON'].includes(flags[0][key] as string | number))) throw Error(text.unavailable);
  const content = { dialect, serverVersion: version, sqlMode: row.sqlMode, allowsNotEnforced: capability.allowsNotEnforced };
  context.checkCancelled(); return { ...content, digest: hash(content) };
}

/** 每个独立预览/执行会话重新保持开关并逐字核事实；不能把5.7的忽略语法作为降级。 */
export async function recheckTableCreateChecks(context: StructureTaskContext, expected: TableCreateCheckFacts): Promise<void> {
  if ((await readTableCreateCheckFacts(context)).digest !== expected.digest) throw Error(text.stale);
}

/** 仅已知列名的引用形式可规范化；不把字符串、函数、精确数字或其它标识符猜成等价。 */
function expressionKey(expression: string, context: TableDefinitionContext, columns: readonly string[]): string {
  const names = new Set(columns), tokens = JSON.parse(assertTableCheckExpression(expression, context).key) as [string, string][];
  // 常量、运算符、关键字及无括号系统函数不能因表里恰有同名列而变成列引用。
  const reserved = new Set(('TRUE FALSE NULL UNKNOWN CASE WHEN THEN ELSE END IS NOT AND OR XOR IN BETWEEN LIKE REGEXP RLIKE COLLATE BINARY DIV MOD INTERVAL ESCAPE SOUNDS DISTINCT ALL ANY SOME AS FROM FOR USING CHARACTER SET BOTH LEADING TRAILING ON MATCH AGAINST WITH BOOLEAN MODE NATURAL LANGUAGE EXPANSION DEFAULT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURRENT_ROLE CURRENT_CATALOG CURRENT_SCHEMA LOCALTIME LOCALTIMESTAMP SESSION_USER SYSTEM_USER USER UTC_DATE UTC_TIME UTC_TIMESTAMP').split(' '));
  return JSON.stringify(tokens.map(([kind, value], index) => {
    const before = tokens[index - 1], after = tokens[index + 1];
    const bare = before?.[1] !== '.' && after?.[1] !== '.' && after?.[1] !== '(' && after?.[0] !== 'string';
    if (bare && kind === 'identifier' && names.has(value)) return ['column', value];
    if (bare && kind === 'word' && !reserved.has(value)) { const matches = columns.filter(name => name.toUpperCase() === value); if (matches.length === 1) return ['column', matches[0]]; }
    return [kind, value];
  }));
}

/** 按完整解析器的真实表体边界插入；字符串/注释中的括号和末尾表注释不参与定位。 */
export function buildTableCreateChecks(baseSql: string, design: TableCreateDraft, facts: TableCreateCheckFacts): string {
  assertTableCreateChecks(design);
  const context = lexical(facts), capability = tableCheckVersionCapabilities(facts.dialect, facts.serverVersion);
  if (!capability.writable || capability.allowsNotEnforced !== facts.allowsNotEnforced) throw Error(text.unsupported);
  const document = parseTableColumnDefinition(baseSql, context);
  if (document.database !== design.database || document.table !== design.name || document.columns.length !== design.columns.length || readTableCheckDefinition(document, facts.serverVersion).checks.length || !design.checks?.length) throw Error(text.invalid);
  const namespace = [...design.indexes.filter(index => index.name !== 'PRIMARY').map(index => index.name), ...design.foreignKeys.map(key => key.name)];
  const additions = design.checks.map(check => {
    if (namespace.some(name => name.toLowerCase() === check.name.toLowerCase()) || !check.enforced && !facts.allowsNotEnforced) throw Error(text.unsupported);
    assertTableCheckExpression(check.expression, context);
    return `CONSTRAINT ${identifier(check.name)} CHECK (\n${check.expression}\n)${facts.dialect === 'mysql' ? check.enforced ? ' ENFORCED' : ' NOT ENFORCED' : ''}`;
  });
  const sql = baseSql.slice(0, document.body.end) + ',\n  ' + additions.join(',\n  ') + '\n' + baseSql.slice(document.body.end);
  if (Buffer.byteLength(sql) > 2 * 1024 * 1024 || new SqlScriptScanner(context.mode.noBackslashEscapes, context.mode.ansiQuotes).push(sql, true).length !== 1) throw Error(text.invalid);
  const parsed = parseTableColumnDefinition(sql, context), checks = readTableCheckDefinition(parsed, facts.serverVersion);
  if (checks.coverage !== 'complete' || checks.checks.length !== design.checks.length || checks.checks.some(check => check.location !== 'table')) throw Error(text.invalid);
  return sql;
}

/** proof仅由真实目录交叉后的私有WeakMap签发，不接受renderer布尔标志或伪造LONGTEXT类型。 */
export interface TableCreateChecksProof { readonly document: TableColumnDefinitionDocument; }
const proofs = new WeakMap<TableCreateChecksProof, { source: string; json: Map<string, Row> }>();

/** 后续旧核验器的每一份COLUMNS仍需与同一完整SHOW及已证JSON目录相符。 */
export function tableCreateCheckJsonMatches(proof: TableCreateChecksProof | undefined, document: TableColumnDefinitionDocument, name: string, actual: Record<string, unknown>): boolean {
  const saved = proof && proofs.get(proof), row = saved?.json.get(name);
  if (!proof || proof.document !== document || saved?.source !== document.source || !row) return false;
  const required = ['typeSql', 'nullable', 'defaultValue', 'extra', 'comment'];
  if (required.some(key => !Object.hasOwn(actual, key))) return false;
  return Object.keys(actual).every(key => Object.hasOwn(row, key) && actual[key] === row[key]);
}

/** 只用于SHOW类型判断，实际后读COLUMNS仍须另经tableCreateCheckJsonMatches交叉。 */
export function tableCreateCheckHasJson(proof: TableCreateChecksProof | undefined, document: TableColumnDefinitionDocument, name: string): boolean {
  const saved = proof && proofs.get(proof); return !!proof && proof.document === document && saved?.source === document.source && saved.json.has(name);
}

/** 完整SHOW+TC+CC证明显式CHECK及Maria隐式JSON_VALID后，才从旧核验视图剔除准确范围。 */
export async function verifyTableCreateChecks(context: StructureTaskContext, target: { database: string; table: string }, design: TableCreateDraft, facts: TableCreateCheckFacts, document: TableColumnDefinitionDocument): Promise<TableCreateChecksProof> {
  const expectedContext = lexical(facts);
  if (document.table !== target.table || document.database !== undefined && document.database !== target.database || target.database !== design.database || target.table !== design.name || document.context.dialect !== expectedContext.dialect || document.context.mode.ansiQuotes !== expectedContext.mode.ansiQuotes || document.context.mode.noBackslashEscapes !== expectedContext.mode.noBackslashEscapes) throw Error(text.verify);
  const parsed = readTableCheckDefinition(document, facts.serverVersion); if (parsed.coverage !== 'complete') throw Error(text.verify);
  let remaining = tableCheckLimits.metadataBytes;
  const read = async (sql: string, keys: readonly string[], maximum: number) => { const value = rows((await structureTaskQuery<unknown>(context, sql)).rows, keys, maximum, remaining); remaining -= Buffer.byteLength(JSON.stringify(value)); if (remaining < 0) throw Error(text.verify); return value; };
  const tc = await read(`SELECT CONSTRAINT_SCHEMA AS schemaName,TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,CONSTRAINT_NAME AS name,CONSTRAINT_TYPE AS type,${facts.dialect === 'mysql' ? 'ENFORCED' : 'NULL'} AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE ${condition(target.database, target.table)} ORDER BY CONSTRAINT_NAME,CONSTRAINT_TYPE LIMIT 4097`, ['schemaName', 'databaseName', 'tableName', 'name', 'type', 'enforced'], 4096);
  if (tc.some(row => row.schemaName !== target.database || row.databaseName !== target.database || row.tableName !== target.table || typeof row.name !== 'string' || !row.name || !['CHECK', 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY'].includes(String(row.type)))) throw Error(text.verify);
  const join = facts.dialect === 'mysql' ? ' JOIN information_schema.TABLE_CONSTRAINTS t ON CAST(c.CONSTRAINT_SCHEMA AS BINARY)=CAST(t.CONSTRAINT_SCHEMA AS BINARY) AND CAST(c.CONSTRAINT_NAME AS BINARY)=CAST(t.CONSTRAINT_NAME AS BINARY)' : '';
  const where = facts.dialect === 'mysql' ? condition(target.database, target.table, 't.') + " AND t.CONSTRAINT_TYPE='CHECK'" : `CAST(c.CONSTRAINT_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(c.TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const cc = await read(`SELECT c.CONSTRAINT_SCHEMA AS schemaName,${facts.dialect === 'mysql' ? 't.TABLE_NAME' : 'c.TABLE_NAME'} AS tableName,c.CONSTRAINT_NAME AS name,c.CHECK_CLAUSE AS expression FROM information_schema.CHECK_CONSTRAINTS c${join} WHERE ${where} ORDER BY c.CONSTRAINT_NAME LIMIT ${tableCheckLimits.checks + 1}`, ['schemaName', 'tableName', 'name', 'expression'], tableCheckLimits.checks);
  const checkRows = tc.filter(row => row.type === 'CHECK');
  if (cc.length !== checkRows.length || cc.length !== parsed.checks.length || new Set(cc.map(row => row.name)).size !== cc.length || cc.some(row => row.schemaName !== target.database || row.tableName !== target.table || typeof row.name !== 'string' || !row.name || typeof row.expression !== 'string' || checkRows.filter(check => check.name === row.name).length !== 1)) throw Error(text.verify);
  const names = design.columns.map(column => column.name), used = new Set<ParsedTableCheck>(), explicit = new Set(design.checks!.map(check => check.name)), json = new Map<string, Row>();
  const implicit = new Set<string>();
  for (const row of cc) {
    const expected = design.checks!.find(check => check.name === row.name), key = expressionKey(row.expression as string, document.context, names);
    const matches = parsed.checks.filter(check => !used.has(check) && (check.name !== undefined ? check.name === row.name : check.location === 'column' && check.columnName === row.name) && expressionKey(check.expression, document.context, names) === key);
    if (matches.length !== 1) throw Error(text.verify); const shown = matches[0], catalog = checkRows.find(check => check.name === row.name)!;
    const enforced = facts.dialect === 'mariadb' ? true : catalog.enforced === 'YES' ? true : catalog.enforced === 'NO' ? false : undefined;
    if (enforced === undefined || shown.enforced !== enforced) throw Error(text.verify);
    if (expected) { if (shown.location !== 'table' || expected.enforced !== enforced || expressionKey(expected.expression, document.context, names) !== key) throw Error(text.verify); explicit.delete(expected.name); }
    else {
      const column = design.columns.find(column => column.name === shown.columnName), actual = document.columns.find(column => column.name === shown.columnName);
      if (facts.dialect !== 'mariadb' || !column || !actual || column.type.trim().toUpperCase() !== 'JSON' || actual.type.raw.trim().toUpperCase() !== 'LONGTEXT' || shown.location !== 'column' || shown.name !== undefined || row.name !== column.name || implicit.has(column.name) || !enforced || expressionKey(`JSON_VALID(${identifier(column.name)})`, document.context, names) !== key) throw Error(text.verify);
      implicit.add(column.name);
    }
    used.add(shown);
  }
  if (explicit.size || used.size !== parsed.checks.length || facts.dialect === 'mariadb' && design.columns.some(column => column.type.trim().toUpperCase() === 'JSON' && !implicit.has(column.name))) throw Error(text.verify);
  const projectedColumns = document.columns.map(column => ({ ...column, attributes: column.attributes.filter(attribute => {
    const inside = parsed.checks.some(check => check.location === 'column' && check.columnName === column.name && attribute.range.start >= check.range.start && attribute.range.end <= check.range.end);
    if (inside && attribute.kind !== 'check') throw Error(text.verify); return !inside;
  }) }));
  const columnsByName = new Map(projectedColumns.map(column => [column.name, column]));
  const projected: TableColumnDefinitionDocument = { ...document, columns: projectedColumns, columnsByName, items: document.items.filter(item => item.kind !== 'constraint' || !parsed.checks.some(check => check.location === 'table' && check.range.start === item.range.start && check.range.end === item.range.end)).map(item => item.kind === 'column' ? columnsByName.get(item.name)! : item) };
  if (implicit.size) {
    const keys = ['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'collation', 'comment'];
    const catalog = await read(`SELECT COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal,COLUMN_TYPE AS typeSql,DATA_TYPE AS dataType,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,GENERATION_EXPRESSION AS generationExpression,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${condition(target.database, target.table)} ORDER BY ORDINAL_POSITION LIMIT 1001`, keys, 1000);
    if (catalog.length !== design.columns.length || catalog.some((row, index) => row.name !== design.columns[index].name || Number(row.ordinal) !== index + 1)) throw Error(text.verify);
    for (const name of implicit) {
      const row = catalog.find(row => row.name === name)!, shown = projected.columnsByName.get(name)!, expected = design.columns.find(column => column.name === name)!;
      if (row.dataType !== 'longtext' || typeof row.typeSql !== 'string' || !sameStructureFragment(row.typeSql, shown.type.raw, document.context) || row.charset !== 'utf8mb4' || row.collation !== 'utf8mb4_bin' || !['YES', 'NO'].includes(String(row.nullable)) || (row.nullable === 'YES') !== expected.nullable || shown.nullable !== undefined && shown.nullable !== expected.nullable || row.extra !== '' || row.generationExpression !== '' && row.generationExpression !== null || row.comment !== expected.comment || row.comment !== (shown.comment ?? '') || !tableCreateColumnDefaultMatches(expected, shown, row.defaultValue as string | null, document.context) || shown.attributes.some(attribute => !['charset', 'collation', 'nullable', 'default', 'comment'].includes(attribute.kind))) throw Error(text.verify);
      const encoding = shown.attributes.filter(attribute => attribute.kind === 'charset' || attribute.kind === 'collation');
      if (encoding.some(attribute => { const tokens = tableDefinitionTokens(attribute.raw, document.context); return tokens.at(-1)?.value !== (attribute.kind === 'charset' ? row.charset : row.collation); })) throw Error(text.verify);
      json.set(name, row);
    }
  }
  const proof: TableCreateChecksProof = { document: projected }; proofs.set(proof, { source: document.source, json }); context.checkCancelled(); return proof;
}
