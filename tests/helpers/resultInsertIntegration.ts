import type { DataRow, ResultExportData } from '../../src/shared/contracts';
import { isDeepStrictEqual } from 'node:util';
import { bindTableValueOptionsTarget } from './tableValueOptionsIntegration';

export const resultInsertIntegrationGate = 'DBARK_RESULT_INSERT_TEST';

/** 本专项独立双门复用六实例准确身份，配置漂移永久停链，不加载默认配置或凭据文件。 */
export function bindResultInsertTarget(read: () => Record<string, string | undefined>, id: string) {
  let retained = false;
  return bindTableValueOptionsTarget(() => {
    const env = read();
    if (retained || env[resultInsertIntegrationGate] !== '1' || env.DBARK_TABLE_VALUE_OPTIONS_TEST || env.DBARK_FILTERED_SELECT_TEST || env.DBARK_TABLE_FILTERED_EXPORT_TEST || env.DBARK_QUERY_INSERT_INTEGRATION_ENABLED) {
      retained = true; throw Error('结果直接插入需要独立双门，不能混用其它用途；漂移永久停链');
    }
    return { ...env, DBARK_TABLE_VALUE_OPTIONS_TEST: env[resultInsertIntegrationGate] };
  }, id);
}

/** 本例标识符与合成值独立编码，不调用待验产品SQL编译器生产期望。 */
function identifier(value: string) { return '`' + value.replaceAll('`', '``') + '`'; }
function text(value: string) { return "_utf8mb4 X'" + Buffer.from(value, 'utf8').toString('hex') + "'"; }

/** 合成RAM源含重名展示列但唯一内部键；映射故意不同于目标列顺序，源SQL从未提供给产品。 */
export function resultInsertPrecisionData(): { data: ResultExportData; mapping: { source: string; target: string }[]; expectedRows: DataRow[] } {
  const special = "中文😀'反斜线\\NUL\0";
  const data: ResultExportData = {
    columns: [{ key: 'source_id', name: '标识' }, { key: 'source_unsigned', name: '重复显示名' }, { key: 'source_decimal', name: '重复显示名' }, { key: 'source_blob', name: '字节' }, { key: 'source_text', name: '文本' }, { key: 'source_day', name: '日期' }, { key: 'source_at', name: '日期时间' }, { key: 'source_stamp', name: '时间戳文字' }],
    rows: [
      { source_id: '0', source_unsigned: '18446744073709551615', source_decimal: '9007199254740993.123456789012', source_blob: { type: 'binary', base64: 'AP8nClw=' }, source_text: null, source_day: '2026-10-24', source_at: '2026-10-24 01:02:03.123456', source_stamp: '2026-10-24 01:02:03.123456' },
      { source_id: '5', source_unsigned: '18446744073709551614', source_decimal: '-9007199254740993.123456789011', source_blob: { type: 'binary', base64: '' }, source_text: special, source_day: '2000-01-01', source_at: '2000-01-01 00:00:00.000001', source_stamp: '2000-01-01 00:00:00.000001' },
      { source_id: '8', source_unsigned: '0', source_decimal: '0.000000000000', source_blob: { type: 'binary', base64: '' }, source_text: '', source_day: '2026-10-24', source_at: '2026-10-24 01:02:03.000000', source_stamp: '2026-10-24 01:02:03.000000' },
    ], truncated: true,
  };
  const mapping = [{ source: 'source_decimal', target: 'amount' }, { source: 'source_id', target: 'id' }, { source: 'source_blob', target: 'payload' }, { source: 'source_unsigned', target: 'unsigned_value' }, { source: 'source_text', target: 'note' }, { source: 'source_day', target: 'day_value' }, { source: 'source_at', target: 'at_value' }, { source: 'source_stamp', target: 'stamp_value' }];
  const expectedRows: DataRow[] = [
    { id: '0', unsigned_value: '18446744073709551615', amount: '9007199254740993.123456789012', payload: { type: 'binary', base64: 'AP8nClw=' }, note: null, day_value: '2026-10-24', at_value: '2026-10-24 01:02:03.123456', stamp_value: '2026-10-24 01:02:03.123456', omitted: '默认值', computed: '9007199254740994.123456789012' },
    { id: '5', unsigned_value: '18446744073709551614', amount: '-9007199254740993.123456789011', payload: { type: 'binary', base64: '' }, note: special, day_value: '2000-01-01', at_value: '2000-01-01 00:00:00.000001', stamp_value: '2000-01-01 00:00:00.000001', omitted: '默认值', computed: '-9007199254740992.123456789011' },
    { id: '8', unsigned_value: '0', amount: '0.000000000000', payload: { type: 'binary', base64: '' }, note: '', day_value: '2026-10-24', at_value: '2026-10-24 01:02:03.000000', stamp_value: '2026-10-24 01:02:03.000000', omitted: '默认值', computed: '1.000000000000' },
  ];
  return { data, mapping, expectedRows };
}

/** 仅生成本例随机库及固定对象；真实写入须逐条登记，失败保留不盲删。 */
export function planResultInsertFixture(database: string, marker: string) {
  if (!/^dbark_resultinsert_[a-f0-9]{32}$/.test(database) || !/^dbark-result-insert:[a-f0-9]{32}$/.test(marker)) throw Error('结果直接插入隔离资源身份无效');
  const db = identifier(database), table = (name: string) => db + '.' + identifier(name);
  const creates = [
    `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    `CREATE TABLE ${table('__owner')} (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`,
    `CREATE TABLE ${table('precise')} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,unsigned_value BIGINT UNSIGNED NOT NULL,amount DECIMAL(30,12) NOT NULL,payload LONGBLOB NOT NULL,note VARCHAR(128) NULL,day_value DATE NOT NULL,at_value DATETIME(6) NOT NULL,stamp_value TIMESTAMP(6) NULL,omitted VARCHAR(16) NOT NULL DEFAULT '默认值',computed DECIMAL(30,12) GENERATED ALWAYS AS (amount + 1) STORED) ENGINE=InnoDB COMMENT='${marker}:precise'`,
    `CREATE TABLE ${table('nokey')} (value VARCHAR(32) NULL) ENGINE=InnoDB COMMENT='${marker}:nokey'`,
    `CREATE TABLE ${table('conflict')} (id INT NOT NULL PRIMARY KEY,label VARCHAR(32) NOT NULL UNIQUE) ENGINE=InnoDB COMMENT='${marker}:conflict'`,
    `CREATE TABLE ${table('drift')} (id INT NOT NULL PRIMARY KEY,value VARCHAR(32) NULL) ENGINE=InnoDB COMMENT='${marker}:drift'`,
  ];
  const seeds = [`INSERT INTO ${table('__owner')} VALUES ('${marker}')`, `INSERT INTO ${table('conflict')} VALUES (9,'occupied')`];
  return { database, marker, table, creates, seeds, objects: ['__owner', 'conflict', 'drift', 'nokey', 'precise'], drift: `ALTER TABLE ${table('drift')} ADD COLUMN added_by_fixture INT NULL`, drop: 'DROP DATABASE ' + db };
}

const resultInsertMetadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];

/** 手工固定本例全部INSERT模板及原参数；不读取产品preview.sql或编译器来扩充白名单。 */
export function resultInsertExpectedDml(plan: ReturnType<typeof planResultInsertFixture>) {
  const precise = resultInsertPrecisionData(), statement = `INSERT INTO ${plan.table('precise')} (\`amount\`, \`id\`, \`payload\`, \`unsigned_value\`, \`note\`, \`day_value\`, \`at_value\`, \`stamp_value\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  return [
    ...precise.data.rows.map(row => ({ scope: 'result.insertApply:precise', sql: statement, values: [row.source_decimal, row.source_id, Buffer.from((row.source_blob as { base64: string }).base64, 'base64'), row.source_unsigned, row.source_text, row.source_day, row.source_at, row.source_stamp] })),
    { scope: 'result.insertApply:nokey', sql: `INSERT INTO ${plan.table('nokey')} (\`value\`) VALUES (?)`, values: ['无主键也可插入'] },
    { scope: 'result.insertApply:conflict', sql: `INSERT INTO ${plan.table('conflict')} (\`id\`, \`label\`) VALUES (?, ?)`, values: ['1', 'fresh'] },
    { scope: 'result.insertApply:conflict', sql: `INSERT INTO ${plan.table('conflict')} (\`id\`, \`label\`) VALUES (?, ?)`, values: ['2', 'occupied'] },
  ];
}

/** 窄SQL/参数/任务/对象审计；读目录也逐条列出，不使用SELECT、SHOW或INSERT前缀授权。 */
export function createResultInsertSqlAudit(plan: ReturnType<typeof planResultInsertFixture>, writes: ReadonlySet<string>, ownedThread: (id: number) => boolean) {
  const observer: { sql: string; values: readonly unknown[] }[] = [], product: { sql: string; scope: string }[] = [];
  const fixture = new Set([...plan.creates, ...plan.seeds, plan.drift, plan.drop]), dml = resultInsertExpectedDml(plan);
  const sent: { sql: string; values: readonly unknown[]; scope: string }[] = [], rejected: { sql: string; scope: string }[] = []; let sqlMode: string | undefined;
  const addObserver = (sql: string, values: readonly unknown[] = []) => observer.push({ sql, values });
  const addProduct = (sql: string, scopes: readonly string[]) => scopes.forEach(scope => product.push({ sql, scope }));
  const converted = (value: string) => "CONVERT(X'" + Buffer.from(value, 'utf8').toString('hex') + "' USING utf8mb4)";
  const targets: Record<string, string[]> = {
    precise: ['result.insertPreview:precise', 'result.insertPreview:generated', 'result.insertApply:precise'],
    nokey: ['result.insertPreview:nokey', 'result.insertApply:nokey'],
    conflict: ['result.insertPreview:conflict', 'result.insertApply:conflict'],
    drift: ['result.insertPreview:drift', 'result.insertPreview:release', 'result.insertApply:drift'],
  };
  const allScopes = Object.values(targets).flat(), applyScopes = allScopes.filter(scope => scope.startsWith('result.insertApply:'));
  const identity = 'SELECT @@version AS version,@@hostname AS hostname,CAST(@@port AS CHAR) AS port,CAST(@@server_id AS CHAR) AS serverId,CURRENT_USER() AS currentUser,CAST(CONNECTION_ID() AS CHAR) AS connectionId,CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate,@@character_set_connection AS charset,@@collation_connection AS collation,';
  addProduct(identity + '@@server_uuid AS uuid', allScopes); addProduct(identity + 'NULL AS uuid', allScopes);
  addProduct('SHOW GRANTS', allScopes); addProduct('SELECT @@SESSION.sql_mode AS sqlMode', allScopes);
  for (const [table, scopes] of Object.entries(targets)) {
    addProduct('SHOW CREATE TABLE ' + plan.table(table), scopes);
    addProduct(`SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${converted(plan.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${converted(table)} AS BINARY) LIMIT 2`, scopes);
    for (const statement of resultInsertMetadata) { let index = 0; const values = [text(plan.database), text(table)]; addProduct(statement.replace(/\?/g, () => values[index++]) + ' LIMIT 4097', scopes); }
    addProduct(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST(${text(plan.database)} AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST(${text(table)} AS BINARY) LIMIT 1`, scopes);
    addProduct('SELECT 1 FROM ' + plan.table(table) + ' LIMIT 0', scopes.filter(scope => scope.startsWith('result.insertApply:')));
    addObserver('SHOW CREATE TABLE ' + plan.table(table)); addObserver('SELECT * FROM ' + plan.table(table) + ' ORDER BY `' + (table === 'nokey' ? 'value' : 'id') + '` ASC');
  }
  addProduct('SELECT @@SESSION.sql_mode AS mode LIMIT 4097', allScopes);
  for (const statement of ["SET SESSION time_zone = '+00:00'", 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone', 'START TRANSACTION', 'ROLLBACK']) addProduct(statement, applyScopes);
  addProduct('COMMIT', ['result.insertApply:precise', 'result.insertApply:nokey']);
  addObserver('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'); addObserver('SELECT @@server_uuid AS uuid');
  addObserver('SELECT @@SESSION.sql_mode AS sqlMode'); addObserver("SET SESSION time_zone = '+00:00'"); addObserver('SELECT @@SESSION.time_zone AS timeZone');
  addObserver('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]); addObserver('SELECT marker FROM ' + plan.table('__owner'));
  addObserver('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [plan.database]);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) addObserver('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]);
  addObserver('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [plan.database]);
  return {
    sent, rejected,
    /** 只绑定原观察连接实读的模式一次；产品自己的SET/SELECT回包不能反向扩充授权。 */
    bindInitialSqlMode(value: string) {
      if (sqlMode !== undefined || typeof value !== 'string' || !/^[A-Z0-9_,]*$/i.test(value)) throw Error('结果插入原观察模式未唯一绑定');
      sqlMode = [...new Set([...value.split(',').filter(Boolean), 'STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO'])].sort().join(',');
      addProduct("SET SESSION sql_mode = '" + sqlMode + "'", applyScopes);
    },
    assert(statement: string, values: readonly unknown[], scope: string): void {
      if (!Array.isArray(values) || Reflect.ownKeys(values).length !== values.length + 1) throw Error('结果插入SQL参数必须为稠密自有数组');
      for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('结果插入SQL参数不能是访问器或空洞');
      const exactObserver = scope === 'observer' && (fixture.has(statement) && writes.has(statement) && !values.length || observer.some(rule => rule.sql === statement && isDeepStrictEqual(rule.values, values))
        || statement === 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?' && values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && ownedThread(values[0]));
      const exactProduct = !values.length && product.some(rule => rule.scope === scope && rule.sql === statement);
      const exactDml = dml.some(rule => rule.scope === scope && rule.sql === statement && isDeepStrictEqual(rule.values, values));
      if (!exactObserver && !exactProduct && !exactDml) { rejected.push({ sql: statement, scope }); throw Error('结果直接插入发送了未登记SQL、原参数、任务或目标'); }
      sent.push({ sql: statement, scope, values: values.map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value) });
    },
  };
}
