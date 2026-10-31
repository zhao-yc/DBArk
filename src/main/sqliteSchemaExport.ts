import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteValue } from '../engine/sqlite/protocol';
import { type SqliteTableBrowseControl, type SqliteTableCatalogue } from './sqliteTableBrowse';

export const sqliteSchemaExportLimits = { objects: 1000, definitionBytes: 2 * 1024 * 1024, tokens: 300000 } as const;
interface Token { kind: 'word' | 'quoted' | 'string' | 'symbol'; value: string; }
export interface SqliteSchemaExport { beforeData: string; afterData: string; }

/** 原目录文字必须经过原生TEXT字节校验；定义中的NUL不能作为可回放SQL发布。 */
function text(column: string): string { return 'CASE WHEN typeof(' + column + ")='text' THEN " + sqliteExportTextFunction + '(' + column + ',CAST(' + column + ' AS BLOB)) ELSE ' + column + ' END'; }
function string(value: SqliteValue | undefined): string { if (typeof value !== 'string' || value.includes('\0')) throw Error('SQLite结构目录文字无效或含NUL，原文件未发布'); return value; }
const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const word = (token: Token | undefined, value: string) => token?.kind === 'word' && token.value.toUpperCase() === value;

/** 仅作DDL边界/归属确认与AUTOINCREMENT词法识别；引用名、字符串和注释从不充当关键字。 */
function tokens(sql: string): { parts: Token[]; lineCommentAtEnd: boolean } {
  if (Buffer.byteLength(sql) > sqliteSchemaExportLimits.definitionBytes || sql.includes('\0')) throw Error('SQLite结构定义超过预算或包含NUL');
  const output: Token[] = []; let lineCommentAtEnd = false;
  for (let index = 0; index < sql.length;) {
    const start = index, character = sql[index];
    if (/[ \t\r\n\v\f]/.test(character)) { index++; continue; }
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index + 2); lineCommentAtEnd = end < 0; index = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', index)) { const end = sql.indexOf('*/', index + 2); if (end < 0) throw Error('SQLite结构定义注释未闭合'); index = end + 2; continue; }
    if (["'", '"', '`', '['].includes(character)) {
      const end = character === '[' ? ']' : character; let value = '', closed = false; index++;
      while (index < sql.length) { if (sql[index] === end) { if (end !== ']' && sql[index + 1] === end) { value += end; index += 2; } else { index++; closed = true; break; } } else value += sql[index++]; }
      if (!closed) throw Error('SQLite结构定义引用未闭合'); output.push({ kind: character === "'" ? 'string' : 'quoted', value });
    } else if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
      index++; while (index < sql.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(sql[index])) index++; output.push({ kind: 'word', value: sql.slice(start, index) });
    } else { output.push({ kind: 'symbol', value: character }); index++; }
    if (output.length > sqliteSchemaExportLimits.tokens) throw Error('SQLite结构定义词法目录超过预算');
  }
  return { parts: output, lineCommentAtEnd };
}

/** 只认main中的准确名称；SQLite允许引用名和旧式单引号对象名，按其真实解码值核对。 */
function name(parts: Token[], index: number): { value: string; next: number } {
  const identifier = (token: Token | undefined) => token && ['word', 'quoted', 'string'].includes(token.kind) ? token.value : undefined;
  let value = identifier(parts[index]); if (value === undefined) throw Error('SQLite结构对象归属无法确认'); index++;
  if (parts[index]?.value === '.' && parts[index].kind === 'symbol') { if (fold(value) !== 'main') throw Error('SQLite结构对象不能属于其它数据库'); value = identifier(parts[++index]); if (value === undefined) throw Error('SQLite结构对象名称无效'); index++; }
  return { value, next: index };
}

/** schema可能被外部writable_schema改坏；不能把额外SQL尾部或不属于目标的DDL当作可信原文发布。 */
function definition(sql: string, kind: 'table' | 'view' | 'index' | 'trigger', expectedName: string, table: string): boolean {
  const { parts } = tokens(sql); let index = 0;
  if (!word(parts[index++], 'CREATE')) throw Error('SQLite结构定义不是可确认的CREATE');
  if (kind === 'index' && word(parts[index], 'UNIQUE')) index++;
  if (!word(parts[index++], kind.toUpperCase())) throw Error('SQLite结构定义类型与实际目录不一致');
  // 不发布静默忽略既有对象的脚本，也不改写原CREATE原文来隐藏这种语义。
  if (word(parts[index], 'IF')) throw Error('SQLite结构原文含IF NOT EXISTS，无法提供严格创建脚本');
  const object = name(parts, index); index = object.next; if (fold(object.value) !== fold(expectedName)) throw Error('SQLite结构定义对象名与实际目录不一致');
  if (kind === 'index' || kind === 'trigger') {
    if (kind === 'trigger') while (index < parts.length && !word(parts[index], 'ON') && !word(parts[index], 'BEGIN')) index++;
    if (!word(parts[index++], 'ON')) throw Error('SQLite附属结构目标无法确认');
    const target = name(parts, index); index = target.next; if (fold(target.value) !== fold(table)) throw Error('SQLite附属结构不属于目标对象');
  }
  if (kind === 'trigger') {
    while (index < parts.length && !word(parts[index], 'BEGIN')) index++;
    if (index === parts.length) throw Error('SQLite触发器正文无法确认'); let end = -1; index++;
    // SQLite允许BEGIN/END回退成普通标识符；只有前一语句分号后的END才可能结束trigger。
    // CASE END及AS end都不在该边界，不能按裸关键字计数或拒绝合法字段名。
    for (; index < parts.length; index++) if (word(parts[index], 'END') && parts[index - 1]?.kind === 'symbol' && parts[index - 1].value === ';') { end = index; break; }
    if (end < 0 || parts[end - 1]?.value !== ';' || parts.slice(end + 1).some((part, position) => part.kind !== 'symbol' || part.value !== ';' || position > 0)) throw Error('SQLite触发器存在无法确认的SQL尾部');
  } else if (parts.some((part, position) => part.kind === 'symbol' && part.value === ';' && position !== parts.length - 1)) throw Error('SQLite结构定义存在额外SQL语句');
  return kind === 'table' && parts.some(part => word(part, 'AUTOINCREMENT'));
}

/** 元数据同样不允许截断；不会把有界目录不足当成完整结构。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: SqliteTableBrowseControl): Promise<SqliteValue[][]> {
  control.check(); const result: SqliteValue[][] = [];
  const execution = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 8 * 1024 * 1024, onBatch: batch => { control.check(); result.push(...batch.rows); } });
  control.check(); if (execution.statements.length !== 1 || execution.statements[0].truncated || execution.statements[0].rows !== result.length) throw Error('SQLite结构目录超过预算，不能发布不完整脚本'); return result;
}
/** 普通定义紧接分号，避免额外换行进入重放后的sqlite_schema。
 * 唯一必要转换：原文以尚未换行的--注释结束时补一个换行，避免吞掉分隔及后续SQL；
 * 原定义仍完整保留，但该情形回放目录可能多出这一个换行，不承诺目录字节完全相等。
 */
function statement(sql: string): string {
  const { parts, lineCommentAtEnd } = tokens(sql), last = parts.at(-1);
  if (last?.kind === 'symbol' && last.value === ';') return sql + '\n';
  return sql + (lineCommentAtEnd ? '\n;\n' : ';\n');
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** 调用方已BEGIN；CREATE、附属对象、FK与序列都在导出自己的同一真实只读快照中读取。 */
export async function readSqliteSchemaExport(driver: SqliteDriverSession, table: string, catalogue: SqliteTableCatalogue, control: SqliteTableBrowseControl): Promise<SqliteSchemaExport> {
  if (/^sqlite_/i.test(table)) throw Error('SQLite系统表不提供结构导出');
  const type = await rows(driver, "SELECT type FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [table], 2, control);
  if (type.length !== 1 || type[0][0] !== catalogue.kind) throw Error('SQLite虚拟表或影子表不提供结构导出');
  const objects = await rows(driver, 'SELECT ' + ['name', 'type', 'tbl_name', 'sql'].map(text).join(',') + " FROM main.sqlite_schema WHERE (name=? COLLATE BINARY AND type IN ('table','view')) OR (tbl_name=? COLLATE BINARY AND type IN ('index','trigger') AND sql IS NOT NULL) ORDER BY type,name LIMIT ?", [table, table, { type: 'integer', value: String(sqliteSchemaExportLimits.objects + 1) }], sqliteSchemaExportLimits.objects + 1, control);
  if (objects.length > sqliteSchemaExportLimits.objects) throw Error('SQLite结构对象超过1000项预算');
  const indexes: string[] = [], triggers: string[] = []; let create: string | undefined, automatic = false, bytes = 0;
  for (const row of objects) {
    if (row.length !== 4) throw Error('SQLite结构目录列数无效'); const [objectName, kind, owner, sql] = row.map(string);
    bytes += Buffer.byteLength(sql); if (bytes > sqliteSchemaExportLimits.definitionBytes) throw Error('SQLite结构定义总量超过2MiB预算');
    if (owner !== table || !['table', 'view', 'index', 'trigger'].includes(kind)) throw Error('SQLite结构归属与实际目标不一致');
    const auto = definition(sql, kind as 'table' | 'view' | 'index' | 'trigger', objectName, table);
    if (kind === catalogue.kind && objectName === table) { if (create !== undefined || sql !== catalogue.schemaSql) throw Error('SQLite原CREATE与同快照目录不一致'); create = sql; automatic = auto; }
    else if (kind === 'index' && catalogue.kind === 'table') indexes.push(sql);
    else if (kind === 'trigger') triggers.push(sql); else throw Error('SQLite附属结构类型或归属无法确认');
  }
  if (create === undefined) throw Error('SQLite结构缺少准确原CREATE');
  // 读取FK依赖以确认有界完整目录；外部对象名不进入注释，脚本不冒充整库备份。
  const foreignKeys = await rows(driver, 'SELECT ' + ['"table"', '"from"', '"to"'].map(text).join(',') + " FROM pragma_foreign_key_list(?,'main') LIMIT ?", [table, { type: 'integer', value: String(sqliteSchemaExportLimits.objects + 1) }], sqliteSchemaExportLimits.objects + 1, control);
  if (foreignKeys.length > sqliteSchemaExportLimits.objects || Buffer.byteLength(JSON.stringify(foreignKeys)) + bytes > sqliteSchemaExportLimits.definitionBytes) throw Error('SQLite外键依赖目录超过结构预算');
  for (const row of foreignKeys) { string(row[0]); string(row[1]); if (row[2] !== null) string(row[2]); }
  let sequence = '';
  if (automatic) {
    const values = await rows(driver, 'SELECT ' + text('name') + ',seq,typeof(seq) FROM main.sqlite_sequence WHERE name=? COLLATE BINARY LIMIT 2', [table], 2, control);
    if (values.length > 1 || values.some(row => string(row[0]) !== table || row[2] !== 'integer' || !row[1] || typeof row[1] !== 'object' || row[1].type !== 'integer' || BigInt(row[1].value) < 0n || BigInt(row[1].value) > 9223372036854775807n)) throw Error('SQLite自增序列不是可靠非负64位整数');
    sequence = 'DELETE FROM "main"."sqlite_sequence" WHERE "name"=' + literal(table) + ';\n';
    if (values.length) sequence += 'INSERT INTO "main"."sqlite_sequence" ("name","seq") VALUES (' + literal(table) + ',' + (values[0][1] as { value: string }).value + ');\n';
  }
  const explanation = '-- SQLite单对象导出。仅在新的目标中执行；脚本不会自动执行。\n-- 遇错立即停止并ROLLBACK，不得选择遇错继续。\n-- 外键、视图及触发器引用的外部对象需要事先准备；这不是整库备份。\n-- 定义、附属对象及自增高水位来自导出开始时的同一只读快照；不代表原浏览页时刻。\n';
  return { beforeData: explanation + 'BEGIN;\n' + statement(create) + indexes.map(statement).join(''), afterData: sequence + triggers.map(statement).join('') + 'COMMIT;\n' };
}
