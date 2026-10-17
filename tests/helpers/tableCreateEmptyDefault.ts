type Environment = Record<string, string | undefined>;
export const emptyDefaultKeys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_EXECUTABLE_PATH', 'DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI'] as const;

/** 只绑定本轮显式RAM配置，不读取文件、不提供默认账号，变化后不允许恢复旧授权。 */
export function bindEmptyDefaultTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const key of emptyDefaultKeys) if (!Object.hasOwn(raw, key) || !Object.hasOwn(helper, key) || typeof raw[key] !== 'string' || raw[key] !== helper[key]) throw Error('空串验收缺少本轮显式一致配置');
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!) || !/\.exe$/i.test(raw.DBARK_EXECUTABLE_PATH!) || raw.DBARK_INTEGRATION_ENABLED !== '1' || raw.DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI !== '1' || Object.hasOwn(raw, 'DBARK_DEV_URL') || Object.hasOwn(raw, 'ELECTRON_RUN_AS_NODE')) throw Error('空串验收准确Windows安装/MySQL目标未准备');
  const fixed = Object.freeze(Object.fromEntries(emptyDefaultKeys.map(key => [key, raw[key]])));
  const target = Object.freeze({ host: fixed.DBARK_TEST_HOST!, port: 13384, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, uuid: fixed.DBARK_TEST_EXPECTED_SERVER_UUID! });
  let changed = false;
  return { target, assertCurrent() {
    if (changed) throw Error('空串验收本轮配置已变化，保留现场');
    const current = readRaw();
    if (emptyDefaultKeys.some(key => !Object.hasOwn(current, key) || !Object.hasOwn(helper, key) || current[key] !== fixed[key] || helper[key] !== fixed[key]) || Object.hasOwn(current, 'DBARK_DEV_URL') || Object.hasOwn(current, 'ELECTRON_RUN_AS_NODE')) { changed = true; throw Error('空串验收本轮配置已变化，保留现场'); }
  } };
}

export const emptyDefaultFactSql = 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,@@SESSION.sql_mode AS mode,@@SESSION.autocommit AS autocommit,@@innodb_strict_mode AS innodbStrict,@@sql_quote_show_create AS quoteShowCreate,@@SESSION.sql_generate_invisible_primary_key AS gipk';
/** 普通InnoDB设计所需事实全部来自只读观察；不SET模式或把端口当准确版本。 */
export function assertEmptyDefaultFacts(value: unknown, uuid: string): string {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') throw Error('空串验收事实形状未知');
  const row = value[0] as Record<string, unknown>;
  if (['version', 'os', 'names', 'uuid', 'mode', 'autocommit', 'innodbStrict', 'quoteShowCreate', 'gipk'].some(key => !Object.hasOwn(row, key))) throw Error('空串验收事实不完整');
  const supported = ['ONLY_FULL_GROUP_BY', 'STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES', 'NO_ZERO_IN_DATE', 'NO_ZERO_DATE', 'ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION', 'NO_BACKSLASH_ESCAPES'];
  if (typeof row.version !== 'string' || !/^8\.4\.11(?:[-+][^\s]+)?$/.test(row.version) || /mariadb/i.test(row.version) || typeof row.os !== 'string' || !['linux', 'debian-linux-gnu'].includes(row.os.toLowerCase()) || ![0, '0'].includes(row.names as number) || row.uuid !== uuid || typeof row.mode !== 'string' || row.mode !== '' && row.mode.split(',').some(mode => !supported.includes(mode)) || ![1, '1'].includes(row.autocommit as number) || ![1, '1'].includes(row.innodbStrict as number) || ![1, '1'].includes(row.quoteShowCreate as number) || ![0, '0'].includes(row.gipk as number)) throw Error('空串验收版本、UUID或普通建表能力未知');
  return JSON.stringify(['version', 'os', 'names', 'uuid', 'mode', 'autocommit', 'innodbStrict', 'quoteShowCreate', 'gipk'].map(key => row[key]));
}

export interface EmptyDefaultOwner { assertCurrent(allowClosed: boolean): void; retain(): void; now(): number; }
/** 本地sticky锁先于共享通知；所有异步前后及原时限之后均拒绝继续，包括迟到ACK。 */
export function emptyDefaultGuard(owner: EmptyDefaultOwner, deadline: number) {
  let retained = false, active = true, pending = 0;
  const stop = () => { if (retained) return; retained = true; try { owner.retain(); } catch { /* 本地锁仍有效，不覆盖首因。 */ } };
  const check = (allowClosed = false) => {
    try { if (retained || !active || !Number.isFinite(deadline) || owner.now() >= deadline) throw Error('空串验收已停链或原时限已过'); owner.assertCurrent(allowClosed); }
    catch (reason) { stop(); throw reason; }
  };
  return {
    stop, check,
    get state() { return { retained, active, pending }; },
    async run<T>(action: () => Promise<T>, allowClosed = false): Promise<T> {
      check(allowClosed); pending++;
      try { const result = await action(); check(allowClosed); return result; }
      catch (reason) { stop(); throw reason; }
      finally { pending--; }
    },
    finish() { check(true); if (pending) { stop(); throw Error('空串验收仍有未结束观察'); } active = false; },
    afterEach() { try { if (retained || active || pending) throw Error('空串验收主体或收尾尚未确认结束'); owner.assertCurrent(true); } catch (reason) { stop(); throw reason; } },
  };
}
export type EmptyDefaultGuard = ReturnType<typeof emptyDefaultGuard>;

/** 任务只是退出前必要证据；未知/取消/失败不能授权DROP，也不重放CREATE。 */
export function assertEmptyDefaultTasks(value: unknown, applied: boolean) {
  if (!Array.isArray(value) || value.some(task => !task || typeof task.kind !== 'string' || typeof task.status !== 'string')) throw Error('空串验收任务形状未知');
  const applies = value.filter(task => task.kind === 'schema.tableCreate.apply');
  if (applies.length !== (applied ? 1 : 0) || applies.some(task => task.status !== 'completed') || value.some(task => task.kind.startsWith('schema.') && (!['completed', 'failed', 'cancelled'].includes(task.status) || task.kind.endsWith('.apply') && task.kind !== 'schema.tableCreate.apply'))) throw Error('空串验收DDL或任务终态未知');
}

/** 严格关闭必须确认同一原生流；Promise end和另一条流的close均不能替代它。 */
export async function closeEmptyDefaultStream<T extends { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown }; end?: unknown; destroy?: unknown }>(native: T | undefined, strictClose: (value: T) => Promise<void>) {
  const stream = native?.stream;
  if (!native || !stream || [native.end, native.destroy, stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('空串验收原生连接或底层流未知');
  await strictClose(native);
  if (native.stream !== stream || stream.closed !== true) throw Error('空串验收同一底层流close未确认');
}

/** 只有明确成功、同一owner正常退出及精确资源复核后才能清库；任一步未知停止后续动作。 */
export async function finishEmptyDefaultCase(guard: EmptyDefaultGuard, ports: { tasks(): Promise<unknown>; exit(): Promise<void>; assertClosed(): void; verifyOwned(): Promise<void>; drop(): Promise<void>; absent(): Promise<void>; close(): Promise<void> }) {
  await guard.run(async () => { assertEmptyDefaultTasks(await ports.tasks(), true); });
  await guard.run(ports.exit, true);
  await guard.run(async () => { ports.assertClosed(); await ports.verifyOwned(); }, true);
  await guard.run(ports.drop, true);
  await guard.run(ports.absent, true);
  await guard.run(ports.close, true);
  guard.finish();
}

/** 独立目录断言保留SQL NULL、文字NULL、空串和未设的区别，不用产品归一化器自证。 */
export function assertEmptyDefaultColumns(value: unknown) {
  const expected = [
    ['id', 'int', 'NO', null, ''], ['empty_text', 'varchar(64)', 'NO', '', ''],
    ['literal_null', 'varchar(64)', 'YES', 'NULL', ''], ['sql_null', 'varchar(64)', 'YES', null, ''],
    ['note', 'varchar(64)', 'YES', '普通默认', ''], ['unset_text', 'varchar(64)', 'NO', null, ''],
  ];
  if (!Array.isArray(value) || value.length !== expected.length || value.some((row, index) => !row || ['COLUMN_NAME', 'COLUMN_TYPE', 'IS_NULLABLE', 'COLUMN_DEFAULT', 'EXTRA'].some((key, column) => !Object.hasOwn(row, key) || row[key] !== expected[index][column]) || row.GENERATION_EXPRESSION !== '')) throw Error('空串验收独立COLUMNS定义不符');
}

/** 从真实只读预览/SHOW原文逐行核默认；未设NOT NULL列不能含DEFAULT。 */
export function assertEmptyDefaultDdl(sql: string, empty: boolean) {
  const normalized = sql.replace(/\s+/g, ' ');
  const line = (name: string) => normalized.match(new RegExp('`' + name + '` [^,]+'))?.[0] ?? '';
  if (!/^CREATE TABLE\s/.test(normalized) || !/ENGINE\s*=\s*InnoDB/i.test(normalized) || !/DEFAULT (?:CHARSET|CHARACTER SET)\s*=\s*utf8mb4/i.test(normalized) || !/PRIMARY KEY\s*\(\s*`id`\s*\)/i.test(normalized) || !/`id` int NOT NULL$/i.test(line('id')) || !/`unset_text` varchar\(64\) NOT NULL$/i.test(line('unset_text'))) throw Error('空串验收普通表结构或未设默认不符');
  const emptyLine = line('empty_text');
  if (!(empty ? /`empty_text` varchar\(64\) NOT NULL DEFAULT ''$/i : /`empty_text` varchar\(64\) NOT NULL$/i).test(emptyLine) || !/DEFAULT 'NULL'$/i.test(line('literal_null')) || !/DEFAULT NULL$/i.test(line('sql_null')) || !/DEFAULT '普通默认'$/i.test(line('note'))) throw Error('空串验收默认值语义不符');
}
