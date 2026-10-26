export const tableFilteredDeleteUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_FILTERED_DELETE_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_FILTERED_DELETE_UI_OWNER', 'DBARK_TABLE_FILTERED_DELETE_UI_MANIFEST', 'DBARK_TABLE_FILTERED_DELETE_UI_MANIFEST_SHA256', 'DBARK_TABLE_FILTERED_DELETE_UI_OUTPUT'] as const;

/** 列表模式早于全部环境读取；未开双门不加载桌面、凭据或数据库驱动。 */
export function tableFilteredDeleteUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_FILTERED_DELETE_UI_TEST === '1';
}

/** 仅在RAM核对Root预置身份，不探测磁盘或数据库，不自行创建资源。 */
export function assertTableFilteredDeleteUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  if (platform !== 'win32' || !tableFilteredDeleteUiActive(env, args)) throw Error('全部筛选行删除专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_filtereddeleteui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-table-filtered-delete-ui:[a-f0-9]{32}$/.test(env.DBARK_TABLE_FILTERED_DELETE_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('全部筛选行删除原200/13384、UUID或随机资源身份无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_TABLE_FILTERED_DELETE_UI_MANIFEST) || !absolute(env.DBARK_TABLE_FILTERED_DELETE_UI_OUTPUT) || !/^[a-f0-9]{64}$/.test(env.DBARK_TABLE_FILTERED_DELETE_UI_MANIFEST_SHA256 ?? '')) throw Error('全部筛选行删除缺少原来源清单及独占输出目录');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('全部筛选行删除拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('全部筛选行删除拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('全部筛选行删除拒绝替代配置或交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('全部筛选行删除拒绝CLI开启trace');
}

/** 相关键存在性和argv发生漂移即永久停链；改回原值不能复活旧资源。 */
export function bindTableFilteredDeleteUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const signature = () => { const current = read(); assertTableFilteredDeleteUiEnvironment(current.env, current.args, current.platform); return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]); };
  const original = signature(), values = Object.freeze(Object.fromEntries(tableFilteredDeleteUiKeys.map(key => [key, read().env[key]!])) as Record<typeof tableFilteredDeleteUiKeys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('全部筛选行删除原环境失效，保留现场'); try { if (signature() !== original) throw Error('全部筛选行删除原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}

/** Root独立构造两张81行表；第一张真实删除后不补种，第二张单独验证整批回滚。 */
export function tableFilteredDeleteUiFixture(database: string, marker: string) {
  if (!/^dbark_filtereddeleteui_[a-f0-9]{32}$/.test(database) || !/^dbark-table-filtered-delete-ui:[a-f0-9]{32}$/.test(marker)) throw Error('全部筛选行删除隔离资源身份无效');
  const table = '`' + database + '`.`subject`', conflictTable = '`' + database + '`.`conflict_subject`', id = (index: number) => (9007199254740992n + BigInt(index)).toString(), concurrentValue = 'Root并发修改';
  const rows = Array.from({ length: 81 }, (_, offset) => {
    const index = offset + 1;
    return { id: id(index), label: index <= 61 ? index % 2 ? 'Alpha' : 'Beta' : index % 2 ? null : 'Gamma', amount: index % 5 ? '123456789012345678.' + String(index).padStart(6, '0') : null, payloadHex: '00FF' + index.toString(16).padStart(2, '0').toUpperCase(), note: index % 7 ? '原值-' + index : null, sideNote: '旁列-' + index };
  });
  const hex = (value: string) => Buffer.from(value, 'utf8').toString('hex').toUpperCase(), literal = (value: string | null) => value === null ? 'NULL' : "_utf8mb4 X'" + hex(value).toLowerCase() + "'";
  const observed = (row: typeof rows[number]) => ({ id: row.id, labelHex: row.label === null ? null : hex(row.label), amount: row.amount, payloadHex: row.payloadHex, noteHex: row.note === null ? null : hex(row.note), sideHex: hex(row.sideNote) });
  const expectedInitial = rows.map(observed), expectedAfterDelete = expectedInitial.slice(61), expectedAfterConflict = rows.map((row, offset) => observed(offset === 0 ? { ...row, note: concurrentValue } : row));
  const filters = [
    { column: 'label', operator: '=' as const, value: 'Alpha' }, { column: 'label', operator: '=' as const, value: 'Beta' },
    { column: 'id', operator: '>=' as const, value: '9007199254740993' }, { column: 'amount', operator: '>' as const, value: '999999999999999999.999999', enabled: false },
  ];
  const filterGroup = { mode: 'all' as const, children: [2, 3, { mode: 'any' as const, children: [0, 1] }] }, sort = [{ column: 'label', direction: 'ASC' as const }, { column: 'id', direction: 'DESC' as const }];
  // 31个Alpha先按id降序，再30个Beta降序；冲突在不可见第31行，不调用产品排序器生成期望。
  const expectedFilteredIds = [...Array.from({ length: 31 }, (_, index) => id(61 - 2 * index)), ...Array.from({ length: 30 }, (_, index) => id(60 - 2 * index))];
  const rowSql = (name: string) => 'SELECT CAST(id AS CHAR) AS id,HEX(label) AS labelHex,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(side_note) AS sideHex FROM ' + name + ' ORDER BY ' + name + '.`id` ASC';
  const definition = ' (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,label VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,amount DECIMAL(30,6) NULL,payload VARBINARY(16) NOT NULL,note VARCHAR(128) NULL,side_note VARCHAR(80) NOT NULL) ENGINE=InnoDB';
  const seed = (name: string) => 'INSERT INTO ' + name + ' (id,label,amount,payload,note,side_note) VALUES ' + rows.map(row => '(' + row.id + ',' + literal(row.label) + ',' + (row.amount === null ? 'NULL' : "CAST('" + row.amount + "' AS DECIMAL(30,6))") + ",X'" + row.payloadHex.toLowerCase() + "'," + literal(row.note) + ',' + literal(row.sideNote) + ')').join(',');
  return {
    database, marker, table, conflictTable, columns: ['id', 'label', 'amount', 'payload', 'note', 'side_note'], rows, expectedInitial, expectedAfterDelete, expectedAfterConflict,
    filters, filterMode: 'all' as const, filterGroup, sort, concurrentValue, tables: 2,
    totalRows: 81, matchedRows: 61, untouchedRows: 20, pageSize: 50, originalPage: 2, expectedFilteredIds, expectedSecondPageIds: expectedFilteredIds.slice(50),
    rowSql: rowSql(table), conflictRowSql: rowSql(conflictTable),
    // 此计划只有准确单次CAS；helper没有执行端口，不向Root传递任意SQL。
    conflict: { sql: 'UPDATE ' + conflictTable + ' SET note = ? WHERE id = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) AND CAST(note AS BINARY) = CAST(? AS BINARY)', parameters: [concurrentValue, id(1), rows[0].note], affectedRows: 1, id: id(1) },
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', 'CREATE TABLE ' + table + definition, 'CREATE TABLE ' + conflictTable + definition],
    seeds: ['INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", seed(table), seed(conflictTable)], drop: 'DROP DATABASE `' + database + '`',
  };
}

export const tableFilteredDeleteUiConflictFiles = Object.freeze({ request: 'conflict-request.json', ack: 'conflict-ack.json', requestTemporary: 'conflict-request.json.dbark-test.partial', ackTemporary: 'conflict-ack.json.dbark-root.partial' });
export interface TableFilteredDeleteUiConflictRequest { owner: string; database: string; table: 'conflict_subject'; previewToken: string; }
export interface TableFilteredDeleteUiConflictAck extends TableFilteredDeleteUiConflictRequest { requestSha256: string; affectedRows: 1; controlThreadId: number; }
const tokenPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** 请求只绑定原随机资源及第三个预览令牌，不能把任意SQL交给Root控制连接。 */
export function tableFilteredDeleteUiConflictRequest(database: string, owner: string, previewToken: string): TableFilteredDeleteUiConflictRequest {
  if (!/^dbark_filtereddeleteui_[a-f0-9]{32}$/.test(database) || !/^dbark-table-filtered-delete-ui:[a-f0-9]{32}$/.test(owner) || !tokenPattern.test(previewToken)) throw Error('全部筛选行删除冲突请求身份无效');
  return { owner, database, table: 'conflict_subject', previewToken };
}

/** 回执必须只含准确七个自有数据字段；原SHA及不同控制线程共同绑定唯一授权CAS。 */
export function parseTableFilteredDeleteUiConflictAck(value: unknown, request: TableFilteredDeleteUiConflictRequest, requestSha256: string, observerThread: number): TableFilteredDeleteUiConflictAck {
  tableFilteredDeleteUiConflictRequest(request.database, request.owner, request.previewToken);
  if (!/^[a-f0-9]{64}$/.test(requestSha256) || !Number.isSafeInteger(observerThread) || observerThread < 1 || !value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('全部筛选行删除冲突回执无效');
  const keys = Reflect.ownKeys(value), allowed = ['owner', 'database', 'table', 'previewToken', 'requestSha256', 'affectedRows', 'controlThreadId'];
  if (keys.length !== allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw Error('全部筛选行删除冲突回执字段无效');
  const ack = value as TableFilteredDeleteUiConflictAck;
  if (ack.owner !== request.owner || ack.database !== request.database || ack.table !== 'conflict_subject' || request.table !== 'conflict_subject' || ack.previewToken !== request.previewToken || ack.requestSha256 !== requestSha256 || ack.affectedRows !== 1 || !Number.isSafeInteger(ack.controlThreadId) || ack.controlThreadId < 1 || ack.controlThreadId === observerThread) throw Error('全部筛选行删除冲突回执原资源、摘要或控制线程变化');
  return { owner: ack.owner, database: ack.database, table: 'conflict_subject', previewToken: ack.previewToken, requestSha256: ack.requestSha256, affectedRows: 1, controlThreadId: ack.controlThreadId };
}
