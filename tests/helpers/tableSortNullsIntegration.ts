import type { DataRow, SortRule } from '../../src/shared/contracts';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

/** 独立双门只映射已有六实例严格身份绑定；开关漂移永久停链。 */
export function bindTableSortNullsTarget(read: () => Record<string, string | undefined>, id: string) {
  let stale = false;
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (stale || env.DBARK_TABLE_SORT_NULLS_TEST !== '1' || env.DBARK_TABLE_VALUE_OPTIONS_TEST || env.DBARK_TABLE_FILTERED_EXPORT_TEST || env.DBARK_FILTERED_SELECT_TEST) { stale = true; throw Error('NULL排序需要独立双门，不混用其它专项'); }
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env.DBARK_TABLE_SORT_NULLS_TEST };
  }, id);
}
export const sortNullsColumns = ['tenant', 'id', 'row_no', 'label', 'amount', 'big_value'];
export const sortNullsProjection = ['row_no', 'tenant', 'id', 'amount', 'big_value'];
const labels = [null, '', 'A', 'B', 'Z'] as const;
const amounts = [null, '-9007199254740993.123456789012', '-9007199254740993.123456789011', '0.000000000000', '9007199254740993.123456789011', '9007199254740993.123456789012'] as const;
const bigs = [null, '0', '9007199254740992', '9007199254740993', '18446744073709551614', '18446744073709551615'] as const;
const identifier = (name: string) => '`' + name.replaceAll('`', '``') + '`';
const literal = (value: string) => "_utf8mb4 X'" + Buffer.from(value).toString('hex') + "'";

/** 1005条已知原值，复合主键；NULL、空串、邻接精确数各有独立桶，不用产品生成器构造预期。 */
export function planTableSortNullsFixture(database: string, marker: string) {
  if (!/^dbark_sortnulls_[a-f0-9]{32}$/.test(database) || !/^dbark-sort-nulls:[a-f0-9]{32}$/.test(marker)) throw Error('NULL排序隔离身份无效');
  const db = identifier(database), table = db + '.`subject`';
  const rows: DataRow[] = Array.from({ length: 1005 }, (_, n) => ({ tenant: n % 3, id: Math.floor(n / 3) + 1, row_no: n + 1, label: labels[n % labels.length], amount: amounts[Math.floor(n / 5) % amounts.length], big_value: bigs[Math.floor(n / 7) % bigs.length] }));
  const creates = [
    'CREATE DATABASE ' + db + ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    'CREATE TABLE ' + db + '.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT=\'' + marker + ':owner\'',
    'CREATE TABLE ' + table + ' (tenant INT NOT NULL,id INT NOT NULL,row_no INT NOT NULL,label VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,amount DECIMAL(30,12) NULL,big_value BIGINT UNSIGNED NULL,PRIMARY KEY(tenant,id)) ENGINE=InnoDB COMMENT=\'' + marker + ':subject\'',
  ];
  const seeds = ['INSERT INTO ' + db + '.`__owner` VALUES (\'' + marker + '\')'];
  for (let offset = 0; offset < rows.length; offset += 250) seeds.push('INSERT INTO ' + table + ' VALUES ' + rows.slice(offset, offset + 250).map(row => '(' + [row.tenant, row.id, row.row_no, row.label === null ? 'NULL' : literal(String(row.label)), row.amount ?? 'NULL', row.big_value ?? 'NULL'].join(',') + ')').join(','));
  return { database, marker, db, table, rows, creates, seeds, objects: ['__owner', 'subject'], drop: 'DROP DATABASE ' + db };
}
export interface SortNullsCase { name: string; sort: SortRule[]; order: string; }
/** 手工声明SQL表达式，不调用任何产品SQL编译器；缺省用例仍仅输出原列方向。 */
export function tableSortNullsCases(): SortNullsCase[] {
  const cases: SortNullsCase[] = [];
  for (const column of ['label', 'amount', 'big_value']) for (const direction of ['ASC', 'DESC'] as const) for (const nulls of ['FIRST', 'LAST'] as const) cases.push({ name: column + ':' + direction + ':' + nulls, sort: [{ column, direction, nulls }], order: '(' + identifier(column) + ' IS NULL) ' + (nulls === 'FIRST' ? 'DESC' : 'ASC') + ', ' + identifier(column) + ' ' + direction + ', `tenant` ASC, `id` ASC' });
  cases.push({ name: '复合三列', sort: [{ column: 'label', direction: 'DESC', nulls: 'LAST' }, { column: 'amount', direction: 'ASC', nulls: 'FIRST' }, { column: 'big_value', direction: 'DESC', nulls: 'LAST' }], order: '(`label` IS NULL) ASC, `label` DESC, (`amount` IS NULL) DESC, `amount` ASC, (`big_value` IS NULL) ASC, `big_value` DESC, `tenant` ASC, `id` ASC' });
  cases.push({ name: '旧缺省字节', sort: [{ column: 'label', direction: 'ASC' }], order: '`label` ASC, `tenant` ASC, `id` ASC' });
  return cases;
}
/** 精确值排序基线用固定已知等级，绝不Number化DECIMAL/BIGINT，也不使用待验ORDER生成器。 */
export function expectedTableSortNullsRows(rows: readonly DataRow[], item: SortNullsCase): DataRow[] {
  const ranks: Record<string, readonly (string | null)[]> = { label: labels, amount: amounts, big_value: bigs };
  return [...rows].sort((a, b) => {
    for (const rule of item.sort) {
      const left = a[rule.column], right = b[rule.column];
      if (left === right) continue;
      if (left === null || right === null) { const first = rule.nulls === 'FIRST' || rule.nulls === undefined && rule.direction === 'ASC'; return left === null ? first ? -1 : 1 : first ? 1 : -1; }
      const delta = ranks[rule.column].indexOf(left as string) - ranks[rule.column].indexOf(right as string);
      if (delta) return rule.direction === 'ASC' ? delta : -delta;
    }
    return Number(a.tenant) - Number(b.tenant) || Number(a.id) - Number(b.id);
  });
}
const metadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];

/** 仅本例固定目标、预先声明SQL、准确参数与scope；原回调/流观察直接复用已有旁观器。 */
export function createTableSortNullsAudit(plan: ReturnType<typeof planTableSortNullsFixture>, cases: readonly SortNullsCase[], writes: ReadonlySet<string>, owned: (id: number) => boolean) {
  const rules: { sql: string; values: readonly unknown[]; scopes: readonly string[] }[] = [], fixture = new Set([...plan.creates, ...plan.seeds, plan.drop]);
  const add = (sql: string, values: readonly unknown[] = [], scopes: readonly string[] = ['observer']) => rules.push({ sql, values, scopes });
  const product = ['metadata.table', 'table.page', 'table.exportFiltered'];
  add('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'); add('SELECT @@server_uuid AS uuid');
  add('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]);
  add('SHOW CREATE TABLE ' + plan.table, [], ['observer', ...product]);
  for (const statement of metadata) {
    add(statement, [plan.database, 'subject'], ['metadata.table', 'table.page']);
    let at = 0; const values = [literal(plan.database), literal('subject')];
    add(statement.replace(/\?/g, () => values[at++]) + ' LIMIT 4097', [], ['table.exportFiltered']);
  }
  for (const statement of ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE', 'SELECT @@SESSION.sql_mode AS sqlMode', 'SELECT @@SESSION.sql_mode AS mode LIMIT 4097', 'SHOW WARNINGS LIMIT 21']) add(statement, [], ['table.exportFiltered']);
  add('SELECT @@SESSION.sql_mode AS mode', [], ['metadata.table', 'table.page']);
  add('SELECT 1 FROM ' + plan.table + ' LIMIT 0', [], ['table.exportFiltered']);
  const converted = (value: string) => "CONVERT(X'" + Buffer.from(value).toString('hex') + "' USING utf8mb4)";
  add('SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(' + converted(plan.database) + ' AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(' + converted('subject') + ' AS BINARY) LIMIT 2', [], ['table.exportFiltered']);
  add('SELECT * FROM ' + plan.table + ' ORDER BY `tenant` ASC, `id` ASC');
  for (const item of cases) {
    add('SELECT * FROM ' + plan.table + ' ORDER BY ' + item.order);
    for (const offset of [0, 1000]) add('SELECT * FROM ' + plan.table + ' ORDER BY ' + item.order + ' LIMIT 1001 OFFSET ' + offset, [], ['table.page']);
    add('SELECT ' + sortNullsProjection.map(identifier).join(', ') + ' FROM ' + plan.table + ' ORDER BY ' + item.order + ' LIMIT 1005;');
  }
  const composite = cases.find(item => item.name === '复合三列')!;
  add('SELECT ' + sortNullsProjection.map(identifier).join(', ') + ' FROM ' + plan.table + ' ORDER BY ' + composite.order, [], ['table.exportFiltered']);
  add('SELECT marker FROM ' + plan.db + '.`__owner`');
  add('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) add('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]);
  add('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [plan.database]);
  return { assert(sql: string, values: readonly unknown[], scope: string): void {
    if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) throw Error('NULL排序参数不是稠密原数组');
    for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('NULL排序参数不能包含访问器');
    if (scope === 'observer' && fixture.has(sql) && writes.has(sql) && values.length === 0) return;
    if (scope === 'observer' && sql === 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?' && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && values[0] > 0 && owned(values[0])) return;
    const purpose = scope === 'observer' ? scope : scope.slice(0, scope.indexOf(':'));
    if (rules.some(rule => rule.sql === sql && rule.scopes.includes(purpose) && rule.values.length === values.length && rule.values.every((value, index) => value === values[index]))) return;
    throw Error('NULL排序拒绝未登记SQL、参数、目标或scope');
  } };
}
