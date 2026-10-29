export const tableFilteredUpdateUiKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_FILTERED_UPDATE_UI_OWNER', 'DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST', 'DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256', 'DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT'] as const;
export const tableFilteredUpdateMultiUiKeys = [...tableFilteredUpdateUiKeys.filter(key => key !== 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST'), 'DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST'] as const;

/** 列表模式早于全部环境读取；未开双门不加载桌面、凭据或数据库驱动。 */
export function tableFilteredUpdateUiActive(env: NodeJS.ProcessEnv, args: readonly string[], gate = 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST'): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env[gate] === '1';
}

/** 仅在RAM核对Root预置身份，不探测磁盘或数据库，不自行创建资源。 */
function assertCommonUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string, gate: string): void {
  if (platform !== 'win32' || !tableFilteredUpdateUiActive(env, args, gate)) throw Error('全部筛选行填充专项须Windows及两个显式开关');
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || env.DBARK_TEST_TLS !== '0' || !env.DBARK_TEST_USER || typeof env.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_filteredupdateui_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE ?? '') || !/^dbark-table-filtered-update-ui:[a-f0-9]{32}$/.test(env.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('全部筛选行填充原200/13384、UUID或随机资源身份无效');
  const absolute = (value: string | undefined) => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
  if (!absolute(env.DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST) || !absolute(env.DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT) || !/^[a-f0-9]{64}$/.test(env.DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256 ?? '')) throw Error('全部筛选行填充缺少原来源清单及独占输出目录');
  for (const key of Object.keys(env)) if (/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('全部筛选行填充拒绝环境大小写别名');
  for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(env, key)) throw Error('全部筛选行填充拒绝替代运行环境或目标');
  if (args.some(value => /^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value))) throw Error('全部筛选行填充拒绝替代配置或交互运行');
  for (const [index, value] of args.entries()) if (value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('全部筛选行填充拒绝CLI开启trace');
}

/** 单字段与多字段专项独立开启，禁止混用同一配置并发执行。 */
export function assertTableFilteredUpdateUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  assertCommonUiEnvironment(env, args, platform, 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST');
  if (env.DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST === '1') throw Error('单字段专项不得同时开启多字段门');
}
/** 多字段只读RAM来源，不借旧门为新增数据库动作分配权限。 */
export function assertTableFilteredUpdateMultiUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void {
  assertCommonUiEnvironment(env, args, platform, 'DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST');
  if (env.DBARK_TABLE_FILTERED_UPDATE_UI_TEST === '1') throw Error('多字段专项不得同时开启单字段门');
}

/** 相关键存在性和argv发生漂移即永久停链；改回原值不能复活旧资源。 */
function bindUiEnvironment<const Keys extends readonly string[]>(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }, keys: Keys, validate: typeof assertTableFilteredUpdateUiEnvironment) {
  const signature = () => { const current = read(); validate(current.env, current.args, current.platform); return JSON.stringify([current.platform, current.args, Object.keys(current.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, current.env[key]])]); };
  const original = signature(), values = Object.freeze(Object.fromEntries(keys.map(key => [key, read().env[key]!])) as Record<Keys[number], string>); let retained = false;
  return { values, assertCurrent() { if (retained) throw Error('全部筛选行填充原环境失效，保留现场'); try { if (signature() !== original) throw Error('全部筛选行填充原环境或argv漂移'); } catch (error) { retained = true; throw error; } } };
}
/** 旧入口保持准确单字段值集合及原环境失效规则。 */
export function bindTableFilteredUpdateUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) { return { mode: 'single' as const, ...bindUiEnvironment(read, tableFilteredUpdateUiKeys, assertTableFilteredUpdateUiEnvironment) }; }
/** 新入口只绑定多字段门，不能复活旧环境或并行消费同一源。 */
export function bindTableFilteredUpdateMultiUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) { return { mode: 'multi' as const, ...bindUiEnvironment(read, tableFilteredUpdateMultiUiKeys, assertTableFilteredUpdateMultiUiEnvironment) }; }

/** Windows原句柄是shell启动器，真实主进程必须以其为父进程。 */
export function assertTableFilteredUpdateUiProcess(actual: { pid: number; parent: number; platform: string }, launcher: number | undefined, platform: string): void {
  if (!Number.isSafeInteger(launcher) || launcher! <= 0 || !Number.isSafeInteger(actual.pid) || actual.pid <= 0 || actual.platform !== platform || (platform === 'win32' ? actual.parent !== launcher || actual.pid === launcher : actual.pid !== launcher)) throw Error('全部筛选行填充原启动器与实际主进程关系未知');
}

/** Root资源计划及独立期望；所有81行和61行范围均用整数/原字节构造，不调用产品SQL或筛选器。 */
export function tableFilteredUpdateUiFixture(database: string, marker: string) {
  if (!/^dbark_filteredupdateui_[a-f0-9]{32}$/.test(database) || !/^dbark-table-filtered-update-ui:[a-f0-9]{32}$/.test(marker)) throw Error('全部筛选行填充隔离资源身份无效');
  const table = '`' + database + '`.`subject`', id = (index: number) => (9007199254740992n + BigInt(index)).toString();
  const fillValue = '跨页整批新值', secondFillValue = '不应落库', concurrentValue = 'Root并发修改';
  const rows = Array.from({ length: 81 }, (_, offset) => {
    const index = offset + 1;
    return { id: id(index), label: index <= 61 ? index % 2 ? 'Alpha' : 'Beta' : index % 2 ? null : 'Gamma', amount: index % 5 ? '123456789012345678.' + String(index).padStart(6, '0') : null, payloadHex: '00FF' + index.toString(16).padStart(2, '0').toUpperCase(), note: index % 7 ? '原值-' + index : null, sideNote: '旁列-' + index };
  });
  const hex = (value: string) => Buffer.from(value, 'utf8').toString('hex').toUpperCase();
  const literal = (value: string | null) => value === null ? 'NULL' : "_utf8mb4 X'" + hex(value).toLowerCase() + "'";
  const observed = (row: typeof rows[number]) => ({ id: row.id, labelHex: row.label === null ? null : hex(row.label), amount: row.amount, payloadHex: row.payloadHex, noteHex: row.note === null ? null : hex(row.note), sideHex: hex(row.sideNote) });
  const expectedInitial = rows.map(observed);
  const afterRows = rows.map((row, offset) => offset < 61 ? { ...row, note: fillValue } : row), expectedAfterFill = afterRows.map(observed);
  // 并发只改变首个匹配行目标值；第二轮整批失败后，其它60行仍是第一次已确认提交的值。
  const expectedAfterConflict = afterRows.map((row, offset) => observed(offset === 0 ? { ...row, note: concurrentValue } : row));
  const filters = [
    { column: 'label', operator: '=' as const, value: 'Alpha' }, { column: 'label', operator: '=' as const, value: 'Beta' },
    { column: 'id', operator: '>=' as const, value: '9007199254740993' }, { column: 'amount', operator: '>' as const, value: '999999999999999999.999999', enabled: false },
  ];
  const filterGroup = { mode: 'all' as const, children: [2, 3, { mode: 'any' as const, children: [0, 1] }] }, sort = [{ column: 'label', direction: 'ASC' as const }, { column: 'id', direction: 'DESC' as const }];
  // 31个Alpha先按id降序，再30个Beta降序；手写数学顺序，不调用产品排序实现。
  const expectedFilteredIds = [...Array.from({ length: 31 }, (_, index) => id(61 - 2 * index)), ...Array.from({ length: 30 }, (_, index) => id(60 - 2 * index))];
  return {
    database, marker, table, columns: ['id', 'label', 'amount', 'payload', 'note', 'side_note'], rows, expectedInitial, expectedAfterFill, expectedAfterConflict,
    filters, filterMode: 'all' as const, filterGroup, sort, field: 'note', fillValue, secondFillValue, concurrentValue,
    totalRows: 81, matchedRows: 61, untouchedRows: 20, pageSize: 50, originalPage: 2, expectedFilteredIds, expectedSecondPageIds: expectedFilteredIds.slice(50),
    rowSql: 'SELECT CAST(id AS CHAR) AS id,HEX(label) AS labelHex,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(side_note) AS sideHex FROM ' + table + ' ORDER BY ' + table + '.`id` ASC',
    // 这条SQL仅为待Root明确授权的独立冲突动作；helper本身不提供执行端口，也不发SQL。
    conflict: { sql: 'UPDATE ' + table + ' SET note = ? WHERE id = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) AND BINARY note = BINARY ?', parameters: [concurrentValue, id(1), fillValue], affectedRows: 1, id: id(1) },
    creates: ['CREATE DATABASE `' + database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'CREATE TABLE `' + database + '`.`__owner` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB', 'CREATE TABLE ' + table + ' (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,label VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,amount DECIMAL(30,6) NULL,payload VARBINARY(16) NOT NULL,note VARCHAR(128) NULL,side_note VARCHAR(80) NOT NULL) ENGINE=InnoDB'],
    seeds: ['INSERT INTO `' + database + "`.`__owner` VALUES ('" + marker + "')", 'INSERT INTO ' + table + ' (id,label,amount,payload,note,side_note) VALUES ' + rows.map(row => '(' + row.id + ',' + literal(row.label) + ',' + (row.amount === null ? 'NULL' : "CAST('" + row.amount + "' AS DECIMAL(30,6))") + ",X'" + row.payloadHex.toLowerCase() + "'," + literal(row.note) + ',' + literal(row.sideNote) + ')').join(',')],
    drop: 'DROP DATABASE `' + database + '`',
  };
}

/** 四列原值独立组合；NULL、定点金额、原字节及文本不经产品转换器生成期望。 */
export function tableFilteredUpdateMultiUiFixture(database: string, marker: string) {
  const base = tableFilteredUpdateUiFixture(database, marker), side = "整组中文🚢\n'\\", amount = '987654321098765432.123456', payload = Buffer.from([0, 255, 128, 39, 92]);
  const assignments = [{ column: 'note', value: null }, { column: 'amount', value: amount }, { column: 'payload', value: { type: 'binary' as const, base64: payload.toString('base64') } }, { column: 'side_note', value: side }];
  const secondAssignments = [{ column: 'note', value: '不应落库' }, { column: 'amount', value: null }, { column: 'payload', value: { type: 'binary' as const, base64: '' } }, { column: 'side_note', value: '另一组不应落库' }];
  const sideHex = Buffer.from(side).toString('hex').toUpperCase(), expectedAfterFill = base.expectedInitial.map((row, index) => index < 61 ? { ...row, noteHex: null, amount, payloadHex: payload.toString('hex').toUpperCase(), sideHex } : row);
  const expectedAfterConflict = expectedAfterFill.map((row, index) => index === 0 ? { ...row, sideHex: Buffer.from(base.concurrentValue).toString('hex').toUpperCase() } : row);
  return { ...base, assignments, secondAssignments, fillColumns: assignments.map(item => item.column), expectedAfterFill, expectedAfterConflict,
    conflict: { ...base.conflict, sql: 'UPDATE ' + base.table + ' SET side_note = ? WHERE id = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) AND BINARY side_note = BINARY ?', parameters: [base.concurrentValue, base.conflict.id, side] },
  };
}

export const tableFilteredUpdateUiConflictFiles = Object.freeze({ request: 'conflict-request.json', ack: 'conflict-ack.json', requestTemporary: 'conflict-request.json.dbark-test.partial', ackTemporary: 'conflict-ack.json.dbark-root.partial' });
export interface TableFilteredUpdateUiConflictRequest { owner: string; database: string; previewToken: string; }
export interface TableFilteredUpdateUiConflictAck extends TableFilteredUpdateUiConflictRequest { requestSha256: string; affectedRows: 1; controlThreadId: number; }
const tokenPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** 请求只绑定原随机资源及第三个预览令牌，不能把任意SQL交给Root控制连接。 */
export function tableFilteredUpdateUiConflictRequest(database: string, owner: string, previewToken: string): TableFilteredUpdateUiConflictRequest {
  if (!/^dbark_filteredupdateui_[a-f0-9]{32}$/.test(database) || !/^dbark-table-filtered-update-ui:[a-f0-9]{32}$/.test(owner) || !tokenPattern.test(previewToken)) throw Error('全部筛选行填充冲突请求身份无效');
  return { owner, database, previewToken };
}

/** 回执必须只含准确六个自有数据字段；原SHA及不同控制线程共同绑定唯一授权CAS。 */
export function parseTableFilteredUpdateUiConflictAck(value: unknown, request: TableFilteredUpdateUiConflictRequest, requestSha256: string, observerThread: number): TableFilteredUpdateUiConflictAck {
  tableFilteredUpdateUiConflictRequest(request.database, request.owner, request.previewToken);
  if (!/^[a-f0-9]{64}$/.test(requestSha256) || !Number.isSafeInteger(observerThread) || observerThread < 1 || !value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('全部筛选行填充冲突回执无效');
  const keys = Reflect.ownKeys(value), allowed = ['owner', 'database', 'previewToken', 'requestSha256', 'affectedRows', 'controlThreadId'];
  if (keys.length !== allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw Error('全部筛选行填充冲突回执字段无效');
  const ack = value as TableFilteredUpdateUiConflictAck;
  if (ack.owner !== request.owner || ack.database !== request.database || ack.previewToken !== request.previewToken || ack.requestSha256 !== requestSha256 || ack.affectedRows !== 1 || !Number.isSafeInteger(ack.controlThreadId) || ack.controlThreadId < 1 || ack.controlThreadId === observerThread) throw Error('全部筛选行填充冲突回执原资源、摘要或控制线程变化');
  return { owner: ack.owner, database: ack.database, previewToken: ack.previewToken, requestSha256: ack.requestSha256, affectedRows: 1, controlThreadId: ack.controlThreadId };
}
