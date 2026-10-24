import { isDeepStrictEqual } from 'node:util';
import type { DataRow } from '../../src/shared/contracts';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

export const fileImportTransactionIntegrationGate = 'DBARK_FILE_IMPORT_TRANSACTION_TEST';
/** 只绑定六个既有隔离实例，独立双门和TLS身份漂移永久停链，不读取凭据文件。 */
export function bindFileImportTransactionTarget(read: () => Record<string, string | undefined>, id: string) {
  let retained = false;
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (retained || env[fileImportTransactionIntegrationGate] !== '1' || ['DBARK_TABLE_VALUE_OPTIONS_TEST', 'DBARK_CSV_HEADER_TEST', 'DBARK_FILTERED_SELECT_TEST', 'DBARK_TABLE_FILTERED_EXPORT_TEST', 'DBARK_RESULT_INSERT_TEST', 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED'].some(key => Boolean(env[key]))) { retained = true; throw Error('文件导入事务需要独立双门，混用用途或配置漂移永久停链'); }
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env[fileImportTransactionIntegrationGate] };
  }, id);
}
const identifier = (value: string) => '`' + value.replaceAll('`', '``') + '`';
type Kind = 'invalid' | 'success' | 'duplicate' | 'batch' | 'cancel';
export interface FileImportTransactionCase {
  name: string; table: string; format: 'csv' | 'json'; kind: Kind; transactionMode?: 'atomic'; text: string;
  parameters: (string | null | Buffer)[][]; expected: DataRow[]; inserts: number; commits: number; starts: number; rollbacks: number;
}
/** 独立手工协议编码，不调用产品导出器、解析器或数值转换器构造预期。 */
function csvField(value: string | null): string { const raw = value === null ? '\\N' : value.startsWith('\\') ? '\\' + value : value; return !raw.length || /[,"\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw; }
function rows() {
  return Array.from({ length: 502 }, (_, index) => {
    const payload = index % 3 === 0 ? null : index % 3 === 1 ? { type: 'binary' as const, base64: '' } : { type: 'binary' as const, base64: 'AAH/gFwn' };
    const row: DataRow = { id: String(18446744073709550000n + BigInt(index)), amount: (index % 2 ? '-' : '') + '123456789012345678.123456789012', note: index === 0 ? null : index === 1 ? '' : index === 2 ? 'NULL' : index === 3 ? '\\N' : `第${index + 1}行 中文😀,"双引号"\r\n跨行\\尾部`, payload };
    return row;
  });
}
/** 每种结局使用独立表和独立源文件，绝不重放、清空或覆盖旧案例。 */
export function planFileImportTransactionFixture(database: string, marker: string) {
  if (!/^dbark_fileimporttx_[a-f0-9]{32}$/u.test(database) || !/^dbark-file-import-transaction:[a-f0-9]{32}$/u.test(marker)) throw Error('文件导入事务隔离资源身份无效');
  const table = (name: string) => identifier(database) + '.' + identifier(name), cases: FileImportTransactionCase[] = [];
  for (const format of ['csv', 'json'] as const) for (const kind of ['invalid', 'success', 'duplicate', 'batch', ...(format === 'csv' ? ['cancel'] as const : [])] as Kind[]) {
    const source = rows(); if (kind === 'invalid' || kind === 'batch') source[501].amount = '123456789012345678.1234567890123'; if (kind === 'duplicate') source[501].id = source[0].id;
    const name = format + '_' + (kind === 'batch' ? 'default_batch' : 'atomic_' + kind);
    const text = format === 'csv' ? 'id,amount,note,payload\r\n' + source.map(row => [row.id as string, row.amount as string, row.note as string | null, row.payload === null ? null : 'base64:' + (row.payload as { base64: string }).base64].map(csvField).join(',')).join('\r\n') + '\r\n'
      : '[' + source.map(row => '{"id":' + row.id + ',"amount":' + row.amount + ',"note":' + JSON.stringify(row.note) + ',"payload":' + JSON.stringify(row.payload) + '}').join(',\n') + ']';
    const inserts = kind === 'cancel' ? 500 : kind === 'invalid' || kind === 'batch' ? 501 : 502;
    cases.push({ name, table: name, format, kind, ...(kind === 'batch' ? {} : { transactionMode: 'atomic' as const }), text, parameters: source.slice(0, inserts).map(row => [row.id as string, row.amount as string, row.note as string | null, row.payload === null ? null : Buffer.from((row.payload as { base64: string }).base64, 'base64')]), expected: kind === 'success' ? rows() : kind === 'batch' ? rows().slice(0, 500) : [], inserts, commits: kind === 'success' || kind === 'batch' ? 1 : 0, starts: kind === 'batch' ? 2 : 1, rollbacks: kind === 'success' ? 0 : 1 });
  }
  const creates = [`CREATE DATABASE ${identifier(database)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`, `CREATE TABLE ${table('__owner')} (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`, ...cases.map(item => `CREATE TABLE ${table(item.table)} (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,note TEXT NULL,payload BLOB NULL) ENGINE=InnoDB COMMENT='${marker}:${item.table}'`)];
  return { database, marker, table, cases, creates, seeds: [`INSERT INTO ${table('__owner')} VALUES ('${marker}')`], objects: ['__owner', ...cases.map(item => item.table)].sort(), drop: 'DROP DATABASE ' + identifier(database) };
}

const metadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];
/** 精确SQL/原值/作用域白名单；任何未登记命令（含KILL）都拒绝，不泛化SELECT或INSERT前缀。 */
export function createFileImportTransactionSqlAudit(plan: ReturnType<typeof planFileImportTransactionFixture>, writes: ReadonlySet<string>, owned: (id: number) => boolean) {
  const sent: { sql: string; values: readonly unknown[]; scope: string }[] = [], rejected: { sql: string; scope: string }[] = [], rules = new Map<string, readonly unknown[][]>();
  const add = (sql: string, scope: string, values: unknown[] = []) => { const key = JSON.stringify([scope, sql]); rules.set(key, [...rules.get(key) ?? [], values]); }, fixture = new Set([...plan.creates, ...plan.seeds, plan.drop]);
  for (const item of plan.cases) {
    const scope = 'files.import:' + item.name; for (const statement of metadata) add(statement, scope, [plan.database, item.table]);
    for (const statement of ['SHOW CREATE TABLE ' + plan.table(item.table), 'SELECT @@SESSION.sql_mode AS mode', 'START TRANSACTION', ...(item.commits ? ['COMMIT'] : []), ...(item.rollbacks ? ['ROLLBACK'] : []), 'SHOW WARNINGS LIMIT 32', ...(item.transactionMode ? ['SELECT 1 FROM ' + plan.table(item.table) + ' LIMIT 0'] : [])]) add(statement, scope);
    for (const values of item.parameters) add(`INSERT INTO ${plan.table(item.table)} (\`id\`, \`amount\`, \`note\`, \`payload\`) VALUES (?, ?, ?, ?)`, scope, values);
  }
  for (const name of plan.objects) { add('SHOW CREATE TABLE ' + plan.table(name), 'observer'); if (name !== '__owner') add('SELECT * FROM ' + plan.table(name) + ' ORDER BY `id` ASC', 'observer'); }
  for (const statement of ['SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames', 'SELECT @@server_uuid AS uuid', 'SELECT marker FROM ' + plan.table('__owner')]) add(statement, 'observer');
  add('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', 'observer', [plan.database]);
  add('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', 'observer', [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) add('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', 'observer', [plan.database]);
  add('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', 'observer', [plan.database]);
  return { sent, rejected, assert(sql: string, values: readonly unknown[], scope: string): void {
    if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) throw Error('文件导入事务原参数必须稠密');
    for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('文件导入事务原参数不能访问器或空洞');
    const allowed = scope === 'observer' && fixture.has(sql) && writes.has(sql) && !values.length || rules.get(JSON.stringify([scope, sql]))?.some(expected => isDeepStrictEqual(expected, values)) || scope === 'observer' && sql === 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?' && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && owned(values[0]);
    if (!allowed) { rejected.push({ sql, scope }); throw Error('文件导入事务拒绝未登记SQL、原参数或目标作用域'); }
    sent.push({ sql, scope, values: values.map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value) });
  } };
}
