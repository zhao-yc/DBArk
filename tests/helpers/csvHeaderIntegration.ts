import { isDeepStrictEqual } from 'node:util';
import type { DataRow } from '../../src/shared/contracts';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

export const csvHeaderIntegrationGate = 'DBARK_CSV_HEADER_TEST';
export type CsvHeaderEncoding = 'utf8' | 'utf16le' | 'gb18030';
export type CsvHeaderDelimiter = ',' | ';' | '\t';

/** 独立双门沿六实例身份及严格TLS；只导出准备函数，不读取文件凭据或自行建连。 */
export function bindCsvHeaderTarget(read: () => Record<string, string | undefined>, id: string) {
  let retained = false;
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (retained || env[csvHeaderIntegrationGate] !== '1' || ['DBARK_TABLE_VALUE_OPTIONS_TEST', 'DBARK_FILTERED_SELECT_TEST', 'DBARK_TABLE_FILTERED_EXPORT_TEST', 'DBARK_RESULT_INSERT_TEST', 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED'].some(key => Boolean(env[key]))) {
      retained = true; throw Error('无标题CSV需要独立双门，混用用途或配置漂移永久停链');
    }
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env[csvHeaderIntegrationGate] };
  }, id);
}

function identifier(value: string) { return '`' + value.replaceAll('`', '``') + '`'; }
/** 手工CSV协议编码，仅用于独立合成输入；不调用产品csvCell或导出器自证解析结果。 */
function field(value: string | null, delimiter: CsvHeaderDelimiter): string {
  const raw = value === null ? '\\N' : value.startsWith('\\') ? '\\' + value : value;
  return !raw.length || raw.includes(delimiter) || /["\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw;
}
function line(values: (string | null)[], delimiter: CsvHeaderDelimiter) { return values.map(value => field(value, delimiter)).join(delimiter); }

export interface CsvHeaderCase {
  name: string; table: string; encoding: CsvHeaderEncoding; delimiter: CsvHeaderDelimiter; csvHasHeader?: boolean;
  text: string; mapping: Record<string, string>; preview: { columns: string[]; rows: DataRow[] }; expected: DataRow[];
  parameters: (string | null | Buffer)[][];
}
const targets = ['unsigned_value', 'amount', 'text_value', 'null_value', 'literal_value', 'payload', 'tail_value'];
const positional = targets.map((_, index) => `第${index + 1}列`), headers = ['big', 'amount', 'text', 'nullable', 'literal', 'bytes', 'tail'];

/** 所有预期为原始精确文本，重复首值、空首值和真实同名目标分别有独立case。 */
export function csvHeaderCases(): CsvHeaderCase[] {
  const cases: CsvHeaderCase[] = [];
  for (const encoding of ['utf8', 'utf16le', 'gb18030'] as const) for (const delimiter of [',', ';', '\t'] as const) {
    const values = [
      ['18446744073709551615', '123456789012345678.123456789012', `中文${delimiter}双"引号"\r\n跨行`, null, '\\N', 'base64:AAH/', ''],
      ['18446744073709551614', '-123456789012345678.123456789011', '尾部中文', '', '\\leading', 'base64:', '末列中文'],
    ];
    const rows = values.map(row => Object.fromEntries(positional.map((name, index) => [name, row[index]]))) as DataRow[];
    cases.push({ name: encoding + '-' + (delimiter === ',' ? 'comma' : delimiter === ';' ? 'semicolon' : 'tab'), table: 'data_' + encoding + '_' + (delimiter === ',' ? 'comma' : delimiter === ';' ? 'semicolon' : 'tab'), encoding, delimiter, csvHasHeader: false,
      text: values.map(row => line(row, delimiter)).join('\r\n') + '\r\n', mapping: Object.fromEntries(positional.map((name, index) => [name, targets[index]])), preview: { columns: [...positional], rows },
      expected: values.map((row, index) => ({ id: index + 1, ...Object.fromEntries(targets.map((name, column) => [name, name === 'payload' ? { type: 'binary', base64: column === 5 && index === 0 ? 'AAH/' : '' } : row[column]])) })) as DataRow[],
      parameters: values.map((row, index) => row.map((value, column) => column === 5 ? Buffer.from(index === 0 ? [0, 1, 255] : []) : value)),
    });
  }
  const base = cases[0], namedRows = base.preview.rows.map(row => Object.fromEntries(headers.map((name, index) => [name, row[positional[index]]])));
  cases.push({ ...base, name: 'default-header', table: 'default_header', csvHasHeader: undefined, text: headers.join(',') + '\r\n' + base.text, mapping: Object.fromEntries(headers.map((name, index) => [name, targets[index]])), preview: { columns: [...headers], rows: namedRows } });
  for (const [name, first] of [['repeat-first', ['重复', '重复', '']], ['empty-first', ['', '', '']]] as const) {
    const values: (string | null)[][] = [[...first], ['中文', '', null]], columns = ['第1列', '第2列', '第3列'];
    cases.push({ name, table: name.replace('-', '_'), encoding: 'utf8', delimiter: ',', csvHasHeader: false, text: values.map(row => line(row, ',')).join('\r\n') + '\r\n', mapping: { 第1列: 'mapped_first', 第2列: '第1列', 第3列: 'empty_value' },
      preview: { columns, rows: values.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]]))) }, expected: values.map((row, index) => ({ id: index + 1, mapped_first: row[0], 第1列: row[1], empty_value: row[2] })), parameters: values });
  }
  cases.push({ name: 'blank-first', table: 'blank_first', encoding: 'utf8', delimiter: ',', csvHasHeader: false, text: '\n', mapping: { 第1列: 'value' }, preview: { columns: ['第1列'], rows: [{ 第1列: '' }] }, expected: [{ id: 1, value: '' }], parameters: [['']] });
  return cases;
}

/** 用真实第二批唯一冲突证明前500已提交、当前批回滚；不依赖解析器chunk预读时序。 */
export function csvHeaderBadBatch() {
  const records = [...Array.from({ length: 501 }, (_, index) => [String(index + 1), '批次' + (index + 1)]), ['1', '第二批重复键']];
  return { table: 'bad_batch', text: records.map(row => line(row, ',')).join('\n') + '\n', mapping: { 第1列: 'id', 第2列: 'label' },
    preview: { columns: ['第1列', '第2列'], rows: records.slice(0, 20).map(row => ({ 第1列: row[0], 第2列: row[1] })) },
    parameters: records, expected: records.slice(0, 500).map((row, index) => ({ id: index + 1, label: row[1] })) };
}

/** 坏列数仅声明首批零提交及回滚，不假定文件流在报错前交付了几条记录。 */
export function csvHeaderBadColumns() {
  return { table: 'bad_columns', text: '1,第一条\n2,第二条\n3\n', mapping: { 第1列: 'id', 第2列: 'label' }, parameters: [['1', '第一条'], ['2', '第二条']] };
}

/** 仅生成随机隔离库、owner及本例固定目标，不发网络或写入文件。 */
export function planCsvHeaderFixture(database: string, marker: string) {
  if (!/^dbark_csvheader_[a-f0-9]{32}$/.test(database) || !/^dbark-csv-header:[a-f0-9]{32}$/.test(marker)) throw Error('无标题CSV隔离资源身份无效');
  const table = (name: string) => identifier(database) + '.' + identifier(name), cases = csvHeaderCases(), bad = csvHeaderBadBatch(), badColumns = csvHeaderBadColumns();
  const creates = [`CREATE DATABASE ${identifier(database)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`, `CREATE TABLE ${table('__owner')} (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`];
  for (const item of cases) {
    const fields = item.table === 'repeat_first' || item.table === 'empty_first' ? 'mapped_first VARCHAR(32) NULL,`第1列` VARCHAR(32) NULL,empty_value TEXT NULL' : item.table === 'blank_first' ? 'value VARCHAR(32) NULL' : 'unsigned_value BIGINT UNSIGNED NOT NULL,amount DECIMAL(30,12) NOT NULL,text_value TEXT NULL,null_value TEXT NULL,literal_value TEXT NULL,payload BLOB NOT NULL,tail_value TEXT NULL';
    creates.push(`CREATE TABLE ${table(item.table)} (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,${fields}) ENGINE=InnoDB COMMENT='${marker}:${item.table}'`);
  }
  creates.push(`CREATE TABLE ${table(bad.table)} (id INT NOT NULL PRIMARY KEY,label TEXT NOT NULL) ENGINE=InnoDB COMMENT='${marker}:bad_batch'`);
  creates.push(`CREATE TABLE ${table(badColumns.table)} (id INT NOT NULL PRIMARY KEY,label TEXT NOT NULL) ENGINE=InnoDB COMMENT='${marker}:bad_columns'`);
  return { database, marker, table, cases, bad, badColumns, creates, seeds: [`INSERT INTO ${table('__owner')} VALUES ('${marker}')`], objects: ['__owner', ...cases.map(item => item.table), bad.table, badColumns.table].sort(), drop: 'DROP DATABASE ' + identifier(database) };
}

const metadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];

/** 精确目录、INSERT原值与本例事务语句白名单，不按SQL前缀放行。 */
export function createCsvHeaderSqlAudit(plan: ReturnType<typeof planCsvHeaderFixture>, writes: ReadonlySet<string>, owned: (id: number) => boolean) {
  const sent: { sql: string; scope: string; values: readonly unknown[] }[] = [], rejected: { sql: string; scope: string }[] = [], rules: { sql: string; scope: string; values: readonly unknown[] }[] = [];
  const fixture = new Set([...plan.creates, ...plan.seeds, plan.drop]), add = (sql: string, scope: string, values: readonly unknown[] = []) => rules.push({ sql, scope, values });
  for (const item of [...plan.cases, { name: 'bad-batch', table: plan.bad.table, mapping: plan.bad.mapping, parameters: plan.bad.parameters }, { name: 'bad-columns', table: plan.badColumns.table, mapping: plan.badColumns.mapping, parameters: plan.badColumns.parameters }]) {
    const scope = 'files.import:' + item.name, columns = Object.values(item.mapping);
    for (const statement of metadata) add(statement, scope, [plan.database, item.table]); add('SHOW CREATE TABLE ' + plan.table(item.table), scope); add('SELECT @@SESSION.sql_mode AS mode', scope);
    for (const statement of ['START TRANSACTION', ...(item.name === 'bad-columns' ? [] : ['COMMIT']), 'ROLLBACK', 'SHOW WARNINGS LIMIT 32']) add(statement, scope);
    const insert = `INSERT INTO ${plan.table(item.table)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    for (const values of item.parameters) add(insert, scope, values);
    add('SELECT * FROM ' + plan.table(item.table) + ' ORDER BY `id` ASC', 'observer'); add('SHOW CREATE TABLE ' + plan.table(item.table), 'observer');
  }
  for (const statement of ['SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames', 'SELECT @@server_uuid AS uuid', 'SELECT marker FROM ' + plan.table('__owner')]) add(statement, 'observer');
  add('SHOW CREATE TABLE ' + plan.table('__owner'), 'observer');
  add('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', 'observer', [plan.database]);
  add('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', 'observer', [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) add('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', 'observer', [plan.database]);
  add('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', 'observer', [plan.database]);
  return { sent, rejected, assert(sql: string, values: readonly unknown[], scope: string): void {
    if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) throw Error('CSV专项参数必须为稠密原数组');
    for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('CSV专项参数不能是访问器或空洞');
    const allowed = scope === 'observer' && fixture.has(sql) && writes.has(sql) && !values.length || rules.some(rule => rule.sql === sql && rule.scope === scope && isDeepStrictEqual(rule.values, values)) || scope === 'observer' && sql === 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?' && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && owned(values[0]);
    if (!allowed) { rejected.push({ sql, scope }); throw Error('CSV专项拒绝未登记SQL、参数、任务或目标'); }
    sent.push({ sql, scope, values: values.map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value) });
  } };
}
