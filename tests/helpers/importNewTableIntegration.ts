import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DataRow } from '../../src/shared/contracts';
import type { TableCreateDraft } from '../../src/shared/tableCreate';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';
import { tableFilteredExportSqlTokens } from './tableFilteredExportSqlAudit';

export const importNewTableGate = 'DBARK_IMPORT_NEW_TABLE_TEST';
/** 列表优先短路；缺少任何独立双门时不读取认证或载入真实Engine。 */
export function importNewTableEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean { return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env[importNewTableGate] === '1'; }
/** 只适配六实例身份，不继承旧fixture权限；nonce由Root预先绑定，漂移后永久停链。 */
export function bindImportNewTableTarget(read: () => Record<string, string | undefined>, id: string) {
  const initial = read(), nonce = initial.DBARK_IMPORT_NEW_TABLE_NONCE; let retained = false;
  const project = () => { const env = read(); if (retained || !importNewTableEnabled(env, []) || !Object.hasOwn(env, 'DBARK_IMPORT_NEW_TABLE_NONCE') || typeof nonce !== 'string' || !/^[a-f0-9]{12}$/.test(nonce) || env.DBARK_IMPORT_NEW_TABLE_NONCE !== nonce || ['DBARK_TABLE_VALUE_OPTIONS_TEST', 'DBARK_FILE_IMPORT_TRANSACTION_TEST', 'DBARK_FILE_IMPORT_CONFLICT_TEST', 'DBARK_TABLE_FILTERED_UPDATE_TEST', 'DBARK_TABLE_FILTERED_UPDATE_MULTI_TEST', 'DBARK_TABLE_FILTERED_EXPORT_TEST', 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED'].some(key => env[key] === '1')) { retained = true; throw Error('新表导入独立双门、随机资源或目标配置已失效，保留现场'); } return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: '1' }; };
  const binding = bindTableValueOptionsTarget(project, id);
  return { ...binding, nonce: nonce!, database: 'dbark_importnew_' + nonce, marker: 'dbark-importnew:' + nonce };
}
export type ImportNewTableBinding = ReturnType<typeof bindImportNewTableTarget>;
export type ImportNewTableCaseName = 'csv_success' | 'json_success' | 'late_invalid' | 'changed_source' | 'changing_source';
export interface ImportNewTableCase {
  name: ImportNewTableCaseName; table: ImportNewTableCaseName; format: 'csv' | 'json'; kind: 'success' | 'late-invalid' | 'changed' | 'changing';
  text: string; bytes: Buffer; source: { sha256: string; bytes: number }; sourceSha256: string; changedText: string; changedBytes: Buffer;
  design: TableCreateDraft; expectedCreateSql: string; insertSql: string; parameters: (string | null | Buffer)[][]; changedParameters: (string | null | Buffer)[][];
  rows: DataRow[]; expectedRows: DataRow[]; readSql: string; hexSql: string; inserts: number; commits: number; rollbacks: number;
}
const identifier = (name: string) => '`' + name.replaceAll('`', '``') + '`';
const literal = (value: string) => "_utf8mb4 X'" + Buffer.from(value, 'utf8').toString('hex') + "'";
const converted = (value: string) => "CONVERT(X'" + Buffer.from(value, 'utf8').toString('hex') + "' USING utf8mb4)";
/** CSV协议独立手写：NULL、空串、反斜线文字和引号内换行必须互相可区分。 */
function csvField(value: string | null): string { const text = value === null ? '\\N' : value.startsWith('\\') ? '\\' + value : value; return !text.length || /[,"\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
/** 数值均用整数/十进制原文造数，嵌套JSON不经JavaScript浮点数解析。 */
function syntheticRows(): DataRow[] {
  return Array.from({ length: 502 }, (_, index) => ({ id: index === 0 ? '18446744073709551615' : index === 1 ? '9223372036854775808' : index === 2 ? '9007199254740993' : String(18446744073709551000n + BigInt(index)), amount: (index % 2 ? '-' : '') + '123456789012345678.' + String(index + 1).padStart(12, '0'), note: index === 0 ? null : index === 1 ? '' : index === 2 ? 'NULL' : index === 3 ? '\\N' : index === 4 ? '同长原文-5' : `第${index + 1}行 中文🚢,"双引号"\r\n跨行\\尾部`, payload: index % 3 === 0 ? null : { type: 'binary' as const, base64: index % 3 === 1 ? '' : 'AAH/gFwn' }, happened: '2026-10-29 01:02:03.' + String(index + 1).padStart(6, '0'), doc: index % 3 === 0 ? null : index % 3 === 1 ? '' : '{"n":18446744073709551615,"d":0.12345678901234567890,"i":' + index + '}' }));
}
/** 仅生成本轮Root已指定的新前缀资源计划；被测五张目标表不在observer创建清单。 */
export function planImportNewTableFixture(database: string, marker: string) {
  const nonce = /^dbark_importnew_([a-f0-9]{12})$/.exec(database)?.[1]; if (!nonce || marker !== 'dbark-importnew:' + nonce) throw Error('新表导入隔离库名与原owner标记不一致');
  const names: ImportNewTableCaseName[] = ['csv_success', 'json_success', 'late_invalid', 'changed_source', 'changing_source'], table = (name: string) => { if (!['__owner', ...names].includes(name)) throw Error('新表导入对象不属于本例计划'); return identifier(database) + '.' + identifier(name); };
  const sourceColumns = ['id', 'amount', 'note', 'payload', 'happened', 'doc'], mapping = Object.fromEntries(sourceColumns.map(name => [name, name]));
  const cases: ImportNewTableCase[] = names.map((name): ImportNewTableCase => {
    const format = name === 'csv_success' || name === 'changing_source' ? 'csv' : 'json', kind = name.endsWith('_success') ? 'success' : name === 'late_invalid' ? 'late-invalid' : name === 'changed_source' ? 'changed' : 'changing', rows = syntheticRows(); if (kind === 'late-invalid') rows[501].amount = (rows[501].amount as string) + '3';
    const encode = (values: DataRow[]) => format === 'csv' ? sourceColumns.join(',') + '\r\n' + values.map(row => sourceColumns.map(column => csvField(column === 'payload' && row[column] !== null ? 'base64:' + (row[column] as { base64: string }).base64 : row[column] as string | null)).join(',')).join('\r\n') + '\r\n' : '[' + values.map(row => '{"id":' + row.id + ',"amount":' + row.amount + ',"note":' + JSON.stringify(row.note) + ',"payload":' + JSON.stringify(row.payload) + ',"happened":' + JSON.stringify(row.happened) + ',"doc":' + (row.doc === null ? 'null' : row.doc === '' ? '""' : row.doc) + '}').join(',\n') + ']';
    const text = encode(rows), bytes = Buffer.from(text, 'utf8'), sourceSha256 = createHash('sha256').update(bytes).digest('hex'), changedRows = rows.map(row => ({ ...row })); changedRows[4].note = '同长改文-5'; const changedText = encode(changedRows), changedBytes = Buffer.from(changedText, 'utf8'); if (bytes.length !== changedBytes.length) throw Error('本例受控改写没有保持原字节长度');
    const column = (name: string, type: string, nullable = false) => ({ name, type, nullable, autoIncrement: false, comment: '' });
    const design: TableCreateDraft = { database, name, engine: 'InnoDB', charset: 'utf8mb4', comment: marker + ':' + name, columns: [column('id', 'BIGINT UNSIGNED'), column('amount', 'DECIMAL(30,12)'), column('note', 'LONGTEXT', true), column('payload', 'BLOB', true), column('happened', 'DATETIME(6)'), column('doc', 'LONGTEXT', true)], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [] };
    const expectedCreateSql = 'CREATE TABLE ' + table(name) + ' (\n  `id` BIGINT UNSIGNED NOT NULL,\n  `amount` DECIMAL(30,12) NOT NULL,\n  `note` LONGTEXT NULL,\n  `payload` BLOB NULL,\n  `happened` DATETIME(6) NOT NULL,\n  `doc` LONGTEXT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=INNODB DEFAULT CHARACTER SET=utf8mb4 COMMENT=\'' + marker + ':' + name + '\'';
    const parameters = (values: DataRow[]) => values.map(row => sourceColumns.map(column => column === 'payload' && row[column] !== null ? Buffer.from((row[column] as { base64: string }).base64, 'base64') : row[column] as string | null));
    const observed = (row: DataRow): DataRow => ({ id: row.id, amount: row.amount, noteHex: row.note === null ? null : Buffer.from(row.note as string).toString('hex').toUpperCase(), payloadHex: row.payload === null ? null : Buffer.from((row.payload as { base64: string }).base64, 'base64').toString('hex').toUpperCase(), happened: row.happened, docHex: row.doc === null ? null : Buffer.from(row.doc as string).toString('hex').toUpperCase() });
    // 投影的id别名是字符串，排序必须指向原BIGINT列，避免按字符串长度不同的数字文本排序。
    return { name, table: name, format, kind, text, bytes, source: { sha256: sourceSha256, bytes: bytes.length }, sourceSha256, changedText, changedBytes, design, expectedCreateSql, insertSql: 'INSERT INTO ' + table(name) + ' (`id`, `amount`, `note`, `payload`, `happened`, `doc`) VALUES (?, ?, ?, ?, ?, ?)', parameters: parameters(kind === 'late-invalid' ? rows.slice(0, 501) : rows), changedParameters: parameters(changedRows), rows, expectedRows: kind === 'success' ? [...rows].sort((a, b) => BigInt(a.id as string) < BigInt(b.id as string) ? -1 : 1).map(observed) : [], readSql: 'SELECT * FROM ' + table(name) + ' ORDER BY `id` ASC', hexSql: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(note) AS noteHex,HEX(payload) AS payloadHex,DATE_FORMAT(happened,\'%Y-%m-%d %H:%i:%s.%f\') AS happened,HEX(doc) AS docHex FROM ' + table(name) + ' ORDER BY ' + table(name) + '.`id` ASC', inserts: kind === 'late-invalid' ? 501 : 502, commits: kind === 'success' ? 1 : 0, rollbacks: kind === 'success' ? 0 : 1 };
  });
  const creates = ['CREATE DATABASE ' + identifier(database) + ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE ' + table('__owner') + " (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='" + marker + ":owner'"], ownerSeed = 'INSERT INTO ' + table('__owner') + " VALUES ('" + marker + "')";
  const observerColumnsSql = 'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', observerIndexesSql = 'SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX';
  return { database, marker, nonce, table, creates, ownerSeed, seeds: [ownerSeed], drop: 'DROP DATABASE ' + identifier(database), objects: ['__owner', ...names].sort(), sourceColumns, mapping, cases, observerColumnsSql, observerIndexesSql };
}
export type ImportNewTableFixture = ReturnType<typeof planImportNewTableFixture>;
const metadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];

/** 精确登记本例SQL、值及scope；规范化只用于已手写的只读/CREATE模板，不放宽DML实体。 */
export function createImportNewTableSqlAudit(plan: ImportNewTableFixture, writes: ReadonlySet<string>, owned: (id: number) => boolean) {
  const sent: { sql: string; values: readonly unknown[]; scope: string }[] = [], rejected: { sql: string; scope: string }[] = [], rules = new Map<string, readonly unknown[][]>();
  const fingerprint = (sql: string, mode = '') => /^(?:SELECT|SHOW|CREATE)\b/i.test(sql) ? tableFilteredExportSqlTokens(/^CREATE TABLE\b/i.test(sql) && sql.endsWith(';') ? sql.slice(0, -1) : sql, mode) : sql;
  const add = (scope: string, sql: string, values: unknown[] = []) => { const key = JSON.stringify([scope, fingerprint(sql)]); rules.set(key, [...rules.get(key) ?? [], values]); };
  const fixture = new Set([...plan.creates, plan.ownerSeed, plan.drop]), db = converted(plan.database);
  for (const item of plan.cases) {
    const target = converted(item.name), condition = 'TABLE_SCHEMA=' + db + ' AND TABLE_NAME=' + target;
    for (const label of [item.name, ...(item.name === 'csv_success' ? ['csv_success_duplicate'] : [])]) {
      for (const command of ['get', 'preview', 'apply']) {
        const scope = 'schema.tableCreate.' + command + ':' + label;
        for (const statement of ['SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS currentUser,@@sql_mode AS sqlMode,@@lower_case_table_names AS lowerNames,@@character_set_connection AS charset,@@collation_connection AS collation', 'SELECT @@server_uuid AS uuid', 'SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=' + db + ' LIMIT 2', 'SELECT @@version AS version,@@explicit_defaults_for_timestamp AS explicitTimestamp,@@innodb_strict_mode AS innodbStrict', "SELECT ENGINE AS engine,SUPPORT AS support FROM information_schema.ENGINES WHERE ENGINE='InnoDB' LIMIT 2", 'SELECT CHARACTER_SET_NAME AS charset FROM information_schema.CHARACTER_SETS ORDER BY BINARY CHARACTER_SET_NAME LIMIT 257']) add(scope, statement);
        if (command !== 'get') add(scope, 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE ' + condition + ' LIMIT 2');
        if (command === 'apply' && label === item.name) {
          add(scope, item.expectedCreateSql); add(scope, 'SHOW CREATE TABLE ' + plan.table(item.name));
          add(scope, 'SELECT t.TABLE_NAME AS name,t.ENGINE AS engine,c.CHARACTER_SET_NAME AS charset,t.TABLE_COLLATION AS collation,t.TABLE_COMMENT AS comment FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME=t.TABLE_COLLATION WHERE t.TABLE_SCHEMA=' + db + ' AND t.TABLE_NAME=' + target + ' LIMIT 2');
          add(scope, 'SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ' + condition + ' ORDER BY ORDINAL_POSITION LIMIT 1001');
          add(scope, 'SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,COLUMN_NAME AS `column`,SEQ_IN_INDEX AS sequence,SUB_PART AS subPart,INDEX_TYPE AS method,COLLATION AS direction,INDEX_COMMENT AS comment FROM information_schema.STATISTICS WHERE ' + condition + ' ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 4097');
        }
      }
    }
    for (const command of ['files.preflight', 'files.import']) {
      const scope = command + ':' + item.name;
      for (const statement of metadata) { if (command === 'files.import') add(scope, statement, [plan.database, item.name]); else { let index = 0; add(scope, statement.replace(/\?/g, () => literal([plan.database, item.name][index++]))); } }
      add(scope, 'SHOW CREATE TABLE ' + plan.table(item.name)); add(scope, 'SELECT @@SESSION.sql_mode AS mode');
      // Maria通用UCA目录能力查询本身是固定只读模板，实际配对另由下方严格词法模板验证。
      add(scope, "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'COLLATION_CHARACTER_SET_APPLICABILITY' LIMIT 64");
      if (command === 'files.import') {
        for (const statement of ['START TRANSACTION', 'SELECT 1 FROM ' + plan.table(item.name) + ' LIMIT 0', 'SHOW WARNINGS LIMIT 32', ...(item.commits ? ['COMMIT'] : ['ROLLBACK'])]) add(scope, statement);
        for (const values of item.parameters) add(scope, item.insertSql, values);
        if (['changed', 'changing'].includes(item.kind)) for (const values of item.changedParameters) add(scope, item.insertSql, values);
      }
    }
    for (const statement of [item.readSql, item.hexSql, 'SHOW CREATE TABLE ' + plan.table(item.name)]) add('observer', statement);
    add('observer', plan.observerColumnsSql, [plan.database, item.name]); add('observer', plan.observerIndexesSql, [plan.database, item.name]);
  }
  for (const statement of ['SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames', 'SELECT @@server_uuid AS uuid', 'SELECT CURRENT_USER() AS currentUser', 'SHOW GRANTS', 'SELECT marker FROM ' + plan.table('__owner'), 'SHOW CREATE TABLE ' + plan.table('__owner')]) add('observer', statement);
  for (const statement of ['SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?']) add('observer', statement, [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) add('observer', 'SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]);
  const knownScope = (scope: string) => /^(?:files\.(?:preflight|import)|schema\.tableCreate\.(?:get|preview|apply)):(csv_success|json_success|late_invalid|changed_source|changing_source)$/.test(scope);
  return { sent, rejected, assert(sql: string, values: readonly unknown[], scope: string, mode = ''): void {
    try {
      if (typeof sql !== 'string' || !sql || typeof scope !== 'string' || typeof mode !== 'string') throw Error();
      if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || Reflect.ownKeys(values).length !== values.length + 1) throw Error();
      for (let index = 0; index < values.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(values, String(index)); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error(); }
      const thread = scope === 'observer' && ['SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', 'SELECT trx_mysql_thread_id AS id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', 'SELECT trx_mysql_thread_id AS id FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?'].includes(sql) && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && values[0] > 0 && owned(values[0]);
      // 本批没有主动取消案例；历史owned线程只可查询，不能据此KILL可能已复用的线程编号。
      const collation = /^SELECT a\.CHARACTER_SET_NAME AS charset, a\.(COLLATION_NAME|FULL_COLLATION_NAME) AS collation FROM information_schema\.COLLATION_CHARACTER_SET_APPLICABILITY a JOIN information_schema\.CHARACTER_SETS s ON s\.CHARACTER_SET_NAME = a\.CHARACTER_SET_NAME WHERE a\.\1 = CONVERT\(X'([a-f0-9]{2,510})' USING utf8mb4\) LIMIT 2$/.exec(sql), allowedCollation = knownScope(scope) && scope.startsWith('files.') && !values.length && collation && /^utf8mb4_[A-Za-z0-9_]{1,240}$/.test(Buffer.from(collation[2], 'hex').toString('utf8'));
      const allowed = scope === 'observer' && fixture.has(sql) && writes.has(sql) && !values.length || rules.get(JSON.stringify([scope, fingerprint(sql, mode)]))?.some(expected => isDeepStrictEqual(expected, values)) || thread || allowedCollation;
      if (!allowed) throw Error(); sent.push({ sql, scope, values: values.map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value) });
    } catch { rejected.push({ sql: typeof sql === 'string' ? sql : '非文字SQL', scope }); throw Error('新表导入拒绝未登记SQL、原参数或目标作用域'); }
  } };
}
