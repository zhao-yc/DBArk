import { isDeepStrictEqual } from 'node:util';
import type { DataRow, FilterGroup, FilterMode, FilterRule, SortRule } from '../../src/shared/contracts';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

export const tableFilteredSelectGate = 'DBARK_FILTERED_SELECT_TEST';
export const filteredSelectTable = 'subject?`表';
export const filteredSelectColumns = ['id', 'ci', 'bin', 'big_value', 'amount', 'odd?`列', 'rank_value'];
export const filteredSelectModes = ['', 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES'];

/** 独立双门仅映射已核六实例身份验证，不读取默认配置、文件凭据或其它专项授权。 */
export function bindTableFilteredSelectTarget(read: () => Record<string, string | undefined>, id: string) {
  let retained = false;
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (retained || env[tableFilteredSelectGate] !== '1' || env.DBARK_TABLE_VALUE_OPTIONS_TEST || env.DBARK_TABLE_FILTERED_EXPORT_TEST) { retained = true; throw Error('筛选SELECT需要独立双门，不能混用其它专项；漂移永久停链'); }
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env[tableFilteredSelectGate] };
  }, id);
}

/** 合成对象的名称独立引用；值仅使用十六进制，不依赖待验产品生成器。 */
function identifier(name: string) { return '`' + name.replaceAll('`', '``') + '`'; }
function literal(value: string) { return "_utf8mb4 X'" + Buffer.from(value, 'utf8').toString('hex') + "'"; }

/** 精确静态fixture，无业务数据；UINT64邻值、PAD SPACE及Unicode必须由真实服务器比较。 */
export function planTableFilteredSelectFixture(database: string, marker: string) {
  if (!/^dbark_filteredselect_[a-f0-9]{32}$/.test(database) || !/^dbark-filtered-select:[a-f0-9]{32}$/.test(marker)) throw Error('筛选SELECT隔离资源身份无效');
  const db = identifier(database), table = db + '.' + identifier(filteredSelectTable);
  const labels = ['Alpha', 'alpha', 'Alpha ', '', null, "引号'双引号\"反斜线\\NUL\0中文😀", '%_\\', '尾部中文', 'NULL', 'Alpha', 'alpha', 'Alpha'];
  const rows = labels.map((text, index) => ({ id: index + 1, ci: text, bin: text, big_value: index === 0 ? '18446744073709551615' : index === 1 ? '18446744073709551614' : index === 2 ? '9007199254740993' : String(index), amount: index === 0 ? '9007199254740993.123456789012' : index === 1 ? '9007199254740993.123456789011' : index === 2 ? '-9007199254740993.123456789012' : index + '.000000000000', 'odd?`列': text, rank_value: index % 2 }));
  const creates = [
    `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    `CREATE TABLE ${db}.\`__owner\` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`,
    `CREATE TABLE ${table} (id INT NOT NULL PRIMARY KEY,ci VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,bin VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,big_value BIGINT UNSIGNED NOT NULL,amount DECIMAL(30,12) NOT NULL,\`odd?\`\`列\` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,rank_value INT NOT NULL) ENGINE=InnoDB COMMENT='${marker}:subject'`,
  ];
  const seeds = [`INSERT INTO ${db}.\`__owner\` VALUES ('${marker}')`, `INSERT INTO ${table} VALUES ` + rows.map(row => '(' + [row.id, row.ci === null ? 'NULL' : literal(row.ci), row.bin === null ? 'NULL' : literal(row.bin), row.big_value, row.amount, row['odd?`列'] === null ? 'NULL' : literal(row['odd?`列']!), row.rank_value].join(',') + ')').join(',')];
  return { database, marker, table, creates, seeds, rows, objects: ['__owner', filteredSelectTable], drop: 'DROP DATABASE ' + db };
}

export interface FilteredSelectCase {
  name: string; filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup;
  values: string[]; where(value: (index: number) => string): string;
  columns: string[]; limit: number; sort: SortRule[];
  /** 仅给不受排序规则差异影响的用例声明实际命中行，防止两条路径同时空结果而假通过。 */
  expectedIds?: number[];
}

/** 手工列举谓词及参数顺序，预期SQL不调用产品筛选编译器，也不扫描SQL替换问号。 */
export function tableFilteredSelectCases(): FilteredSelectCase[] {
  const wrap = (...clauses: string[]) => '(' + clauses.map(clause => '(' + clause + ')').join(' AND ') + ')';
  const uint = (value: string) => 'CAST(CAST(' + value + ' AS DECIMAL(20,0)) AS UNSIGNED)';
  const decimal = (value: string) => 'CAST(' + value + ' AS DECIMAL(65,12))';
  const defaults = { columns: ['amount', 'odd?`列', 'big_value', 'id', 'bin', 'ci'], limit: 3, sort: [{ column: 'ci', direction: 'ASC' }, { column: 'rank_value', direction: 'DESC' }] as SortRule[] };
  const cases: Omit<FilteredSelectCase, keyof typeof defaults>[] = [
    { name: '无筛选第一页及两级排序补主键', filters: [], values: [], where: () => '' },
    { name: 'UINT64最大原文', filters: [{ column: 'big_value', operator: '=', value: '18446744073709551615' }], values: ['18446744073709551615'], where: p => wrap('`big_value` = ' + uint(p(0))), expectedIds: [1] },
    { name: 'UINT64相邻IN精度', filters: [{ column: 'big_value', operator: 'IN', values: ['18446744073709551614', '18446744073709551615'] }], values: ['18446744073709551614', '18446744073709551615'], where: p => wrap('`big_value` IN (' + uint(p(0)) + ', ' + uint(p(1)) + ')'), expectedIds: [1, 2] },
    { name: 'DECIMAL相邻BETWEEN精度', filters: [{ column: 'amount', operator: 'BETWEEN', values: ['9007199254740993.123456789011', '9007199254740993.123456789012'] }], values: ['9007199254740993.123456789011', '9007199254740993.123456789012'], where: p => wrap('`amount` BETWEEN ' + decimal(p(0)) + ' AND ' + decimal(p(1))), expectedIds: [1, 2] },
    ...(['ci', 'bin'] as const).flatMap(column => ['Alpha', 'Alpha ', ''].map(value => ({ name: column + '比较' + JSON.stringify(value), filters: [{ column, operator: '=' as const, value }], values: [value], where: (p: (index: number) => string) => wrap(identifier(column) + ' = ' + p(0)) }))),
    { name: 'NULL与文本NULL区别', filters: [{ column: 'ci', operator: 'IS NULL' }], values: [], where: () => wrap('`ci` IS NULL'), expectedIds: [5] },
    { name: '停用叶及嵌套组DFS参数顺序', filters: [{ column: 'ci', operator: 'IS NULL' }, { column: 'big_value', operator: '<', value: '0', enabled: false }, { column: 'bin', operator: 'IN', values: ['', 'NULL'] }], filterMode: 'any', filterGroup: { mode: 'any', children: [{ mode: 'all', children: [0, 1] }, 2] }, values: ['', 'NULL'], where: p => '(((`ci` IS NULL)) OR (`bin` IN (' + p(0) + ', ' + p(1) + ')))' },
    { name: '引号反斜线NULUnicode及问号反引号标识符', filters: [{ column: 'odd?`列', operator: '=', value: "引号'双引号\"反斜线\\NUL\0中文😀" }], values: ["引号'双引号\"反斜线\\NUL\0中文😀"], where: p => wrap('`odd?``列` = ' + p(0)), expectedIds: [6] },
    { name: 'LIKE保留百分号下划线', filters: [{ column: 'bin', operator: 'LIKE', value: '%_%' }], values: ['%_%'], where: p => wrap('`bin` LIKE ' + p(0)) },
    { name: 'LIKE反斜线服务器模式语义', filters: [{ column: 'bin', operator: 'LIKE', value: '%\\%' }], values: ['%\\%'], where: p => wrap('`bin` LIKE ' + p(0)) },
    { name: 'any平铺及ISNOTNULL', filters: [{ column: 'ci', operator: '=', value: '' }, { column: 'bin', operator: 'IS NOT NULL' }], filterMode: 'any', values: [''], where: p => '((`ci` = ' + p(0) + ') OR (`bin` IS NOT NULL))' },
  ];
  return cases.map(item => ({ ...defaults, ...item }));
}

/** 四条模板分别代表原prepared、原表页inline、独立预期生成语句；全部固定到本例对象。 */
export function filteredSelectCaseSql(database: string, item: FilteredSelectCase) {
  const target = identifier(database) + '.' + identifier(filteredSelectTable), order = ' ORDER BY `ci` ASC, `rank_value` DESC, `id` ASC';
  const where = (kind: 'prepared' | 'inline' | 'generated') => {
    const expression = item.where(index => kind === 'prepared' ? '?' : literal(item.values[index]));
    return expression ? ' WHERE ' + expression : '';
  };
  return {
    prepared: `SELECT * FROM ${target}${where('prepared')}${order} LIMIT 1001 OFFSET 0`,
    inline: `SELECT * FROM ${target}${where('inline')}${order} LIMIT 1001 OFFSET 0`,
    later: `SELECT * FROM ${target}${where('inline')}${order} LIMIT 4 OFFSET 3`,
    generated: `SELECT ${item.columns.map(identifier).join(', ')} FROM ${target}${where('generated')}${order} LIMIT ${item.limit};`,
  };
}

export interface TableFilteredSelectPreparedLikeDivergence {
  mode: string; caseName: string; preparedIds: number[]; actualPageIds: number[];
  reason: '原prepared LIKE与实际inline表页的既有NO_BACKSLASH_ESCAPES差异';
}

/** 仅在原路径实际不等时，为固定LIKE原值及准确模式声明窄差异预期，不假定跨版本行为。 */
function exactLikeModeExpectation(item: FilteredSelectCase, mode: string): { ids: number[]; admitsDifference: boolean } | undefined {
  if (!filteredSelectModes.includes(mode) || item.name !== 'LIKE反斜线服务器模式语义' || item.filterMode !== undefined || item.filterGroup !== undefined || item.limit !== 3
    || !isDeepStrictEqual(item.filters, [{ column: 'bin', operator: 'LIKE', value: '%\\%' }]) || !isDeepStrictEqual(item.values, ['%\\%'])
    || !isDeepStrictEqual(item.columns, ['amount', 'odd?`列', 'big_value', 'id', 'bin', 'ci'])
    || !isDeepStrictEqual(item.sort, [{ column: 'ci', direction: 'ASC' }, { column: 'rank_value', direction: 'DESC' }])
    || item.where(() => '?') !== '((`bin` LIKE ?))') return undefined;
  const noBackslash = mode === 'NO_BACKSLASH_ESCAPES' || mode === 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES';
  return { ids: noBackslash ? [7, 6] : [], admitsDifference: noBackslash };
}

/** 原prepared仍全字段全序对照；唯一已知差异须精确命中空prepared与独立fixture原页[7,6]。 */
export function assertTableFilteredSelectPreparedComparison(input: { item: FilteredSelectCase; mode: string; preparedRows: readonly DataRow[]; actualPageRows: readonly DataRow[]; fixtureRows: readonly DataRow[] }): TableFilteredSelectPreparedLikeDivergence | undefined {
  // 各版本原路径本就相等时直接记零差异，包括NBE下两边都为空；不得施加跨版本结果假定。
  if (isDeepStrictEqual(input.preparedRows, input.actualPageRows)) return undefined;
  const expectation = exactLikeModeExpectation(input.item, input.mode);
  if (expectation) {
    const rows = expectation.ids.map(id => input.fixtureRows.find(row => row.id === id));
    if (rows.some(row => row === undefined) || !isDeepStrictEqual(input.actualPageRows, rows)) throw Error('固定LIKE模式的实际原页不符合独立fixture全字段及顺序预期');
  }
  if (expectation?.admitsDifference && isDeepStrictEqual(input.preparedRows, [])) {
    return { mode: input.mode, caseName: input.item.name, preparedIds: [], actualPageIds: [7, 6], reason: '原prepared LIKE与实际inline表页的既有NO_BACKSLASH_ESCAPES差异' };
  }
  throw Error('原prepared与实际Engine页存在未登记语义差异，保留原现场；不能归因于新SELECT或泛化忽略');
}

const metadataStatements = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];

/** 精确SQL及准确参数白名单；没有SELECT/SHOW前缀授权，也不接纳产品生成结果动态扩权。 */
export function createTableFilteredSelectAudit(plan: ReturnType<typeof planTableFilteredSelectFixture>, cases: readonly FilteredSelectCase[], writes: ReadonlySet<string>, owned: (id: number) => boolean) {
  const rules: { sql: string; values: readonly unknown[]; scopes: readonly string[] }[] = [], fixture = new Set([...plan.creates, ...plan.seeds, plan.drop]);
  const add = (sql: string, values: readonly unknown[] = [], scopes: readonly string[] = ['observer']) => rules.push({ sql, values, scopes });
  const db = identifier(plan.database);
  for (const mode of filteredSelectModes) add("SET SESSION sql_mode = '" + mode + "'", [], ['observer', 'connections.open', 'metadata.table', 'table.page']);
  add('SELECT @@SESSION.sql_mode AS mode', [], ['observer', 'connections.open', 'metadata.table', 'table.page']);
  add('SELECT @@SESSION.sql_mode AS sqlMode', [], ['observer', 'connections.open', 'metadata.table', 'table.page']);
  add('SELECT @@SESSION.character_set_connection AS charset,@@SESSION.collation_connection AS collation', [], ['observer', 'connections.open', 'metadata.table', 'table.page']);
  add('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'); add('SELECT @@server_uuid AS uuid');
  add('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]);
  add('SHOW CREATE TABLE ' + plan.table, [], ['observer', 'metadata.table', 'table.page']);
  for (const statement of metadataStatements) add(statement, [plan.database, filteredSelectTable], ['metadata.table', 'table.page']);
  add('SELECT * FROM ' + plan.table + ' ORDER BY `id` ASC');
  add('SELECT marker FROM ' + db + '.`__owner`');
  add('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) add('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]);
  add('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [plan.database]);
  for (const item of cases) {
    const statements = filteredSelectCaseSql(plan.database, item);
    add(statements.prepared, item.values); add(statements.inline, [], ['table.page']); if (!item.filters.length) add(statements.later, [], ['table.page']); add(statements.generated);
  }
  return {
    /** 仅原观察连接允许本例预先计划且逐条登记的fixture写入。 */
    assert(sql: string, values: readonly unknown[], scope: string): void {
      if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) throw Error('筛选SELECT参数不是稠密原数组');
      for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('筛选SELECT参数不是稠密原数组');
      if (scope === 'observer' && fixture.has(sql) && writes.has(sql) && values.length === 0) return;
      if (scope === 'observer' && sql === 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?' && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && owned(values[0])) return;
      const purpose = scope === 'observer' ? scope : scope.slice(0, scope.indexOf(':'));
      if (rules.some(rule => rule.sql === sql && rule.scopes.includes(purpose) && rule.values.length === values.length && rule.values.every((value, index) => value === values[index]))) return;
      throw Error('筛选SELECT拒绝未登记SQL、参数或其它目标');
    },
  };
}
