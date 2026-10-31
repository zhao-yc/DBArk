import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { qisLifetime, type QisContext } from './queryInsertIntegration';
import { closeEmptyDefaultStream } from './tableCreateEmptyDefault';

export const tableValueOptionsGate = 'DBARK_TABLE_VALUE_OPTIONS_TEST';
const versions = { '13357': ['mysql', '5.7.44'], '13380': ['mysql', '8.0.46'], '13384': ['mysql', '8.4.11'], '13310': ['mariadb', '10.11.19'], '13311': ['mariadb', '11.4.13'], '13484': ['mysql', '8.4.11'] } as const;
type Environment = Record<string, string | undefined>;

/** 本用途双门显式绑定六实例身份，不读取凭据文件、不把其它专项开关自动升级为授权。 */
export function bindTableValueOptionsTarget(read: () => Environment, id: string) {
  const raw = read(), port = raw.DBARK_TEST_PORT;
  if (!port || !Object.hasOwn(versions, port)) throw Error('不同值实库验收没有准确隔离端口');
  const [dialect, version] = versions[port as keyof typeof versions];
  const keys = ['DBARK_INTEGRATION_ENABLED', tableValueOptionsGate, 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID', 'DBARK_TEST_EXPECTED_SERVER_PORT', ...(dialect === 'mysql' ? ['DBARK_TEST_EXPECTED_SERVER_UUID'] : []), ...(port === '13484' ? ['DBARK_TEST_CA'] : [])];
  if (keys.some(key => !Object.hasOwn(raw, key) || typeof raw[key] !== 'string') || raw.DBARK_INTEGRATION_ENABLED !== '1' || raw[tableValueOptionsGate] !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(raw.DBARK_TEST_HOST!) || !raw.DBARK_TEST_USER || !raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME || !/^\d{1,10}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_ID!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_ID) > 4294967295 || !/^[1-9]\d{0,4}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_PORT!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_PORT) > 65535 || raw.DBARK_TEST_TLS !== (port === '13484' ? '1' : '0') || port === '13484' && !raw.DBARK_TEST_CA!.trim() || dialect === 'mysql' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)) throw Error('不同值实库验收目标、身份或严格TLS未显式准备');
  const forbidden = ['DBARK_TEST_SSH', 'DBARK_TEST_CERT', 'DBARK_TEST_KEY', 'DBARK_TEST_DATABASE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'DBARK_DATABASE_DROP_TEST', 'DBARK_DATABASE_DEFAULT_ENCODING_TEST', 'DBARK_TABLE_STATISTICS_TEST'];
  if (forbidden.some(key => Object.hasOwn(raw, key) && raw[key] !== undefined && raw[key] !== '' && !(key === 'DBARK_TEST_SSH' && raw[key] === '0'))) throw Error('不同值实库验收有旁路、非本例数据库或其它专项开关');
  const all = [...new Set([...keys, ...forbidden])], fixed = all.map(key => [key, Object.hasOwn(raw, key), raw[key]] as const); let retained = false;
  const assertCurrent = () => { const current = read(); if (retained || fixed.some(([key, own, value]) => Object.hasOwn(current, key) !== own || current[key] !== value)) { retained = true; throw Error('不同值实库验收配置漂移，保留原现场'); } };
  const profile: ConnectionProfile = Object.freeze({ id, name: '服务器不同值隔离验收', group: '', color: '#123456', dialect, host: raw.DBARK_TEST_HOST!, port: Number(port), user: raw.DBARK_TEST_USER!, password: raw.DBARK_TEST_PASSWORD!, ...(port === '13484' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: raw.DBARK_TEST_CA! } } : {}) });
  return { profile, dialect, version, hostname: raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME!, serverId: raw.DBARK_TEST_EXPECTED_SERVER_ID!, serverPort: raw.DBARK_TEST_EXPECTED_SERVER_PORT!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID, assertCurrent };
}
export type TableValueOptionsBinding = ReturnType<typeof bindTableValueOptionsTarget>;
/** 原Vitest起点和120秒sticky owner；任何失败保留，不续期、不自动重试。 */
export function tableValueOptionsLifetime(context: QisContext, binding: TableValueOptionsBinding, retain: () => void) { return qisLifetime(context, binding, retain); }
export type TableValueOptionsLifetime = ReturnType<typeof tableValueOptionsLifetime>;
/** 仅双门测试体显式载入原连接与真实Engine。 */
export async function loadTableValueOptionsModules() { const connection = await import('../../src/engine/connection'); const engine = await import('../../src/engine/index'); return { connection, engine }; }
/** 创建资源前核实际Linux服务器、版本、server_id、大小写及MySQL UUID。 */
export function assertTableValueOptionsIdentity(rows: unknown, binding: TableValueOptionsBinding, status: ManagedConnection['status'], uuidRows?: unknown): void {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('不同值实库实际身份响应不完整');
  const row = rows[0] as Record<string, unknown>;
  if (row.hostname !== binding.hostname || String(row.serverId) !== binding.serverId || String(row.port) !== binding.serverPort || !['linux', 'debian-linux-gnu'].includes(String(row.os).toLowerCase()) || ![0, '0'].includes(row.lowerNames as number) || status.dialect !== binding.dialect || status.version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0] !== binding.version) throw Error('不同值实库实际hostname、版本、系统、大小写或server_id不符');
  if (binding.dialect === 'mysql' && (!Array.isArray(uuidRows) || uuidRows.length !== 1 || uuidRows[0]?.uuid !== binding.uuid)) throw Error('不同值实库实际MySQL UUID不符');
}

interface NativeStream { closed?: boolean; once(name: string, callback: () => void): unknown; }
interface NativeCommand { once(name: string, callback: (...args: unknown[]) => void): unknown; }
interface Native { threadId: number; stream: NativeStream; query(...args: unknown[]): unknown; execute(...args: unknown[]): unknown; }
export interface TableValueOptionsConnectionFact { managed: ManagedConnection; native: Native; stream: NativeStream; id: number; scope: string; pending: number; closeCalls: number; strict: boolean; closeReturned: boolean; closeFailed: boolean; closed: Promise<void>; sawClose: boolean; commands: { sql: string; method: 'query' | 'execute'; streamed: boolean; callbackReturned: boolean; terminal: boolean }[]; }

/** 原命令、回调与数据流透传；产品只允许SELECT/SHOW和固定只读事务，不注入SQL或伪造终态。 */
export function watchTableValueOptionsConnection(managed: ManagedConnection, scope: string, owner: TableValueOptionsLifetime, fixtureWrites: ReadonlySet<string>, allowStop?: (threadId: number, scope: string) => boolean): TableValueOptionsConnectionFact {
  const native = managed.connection as unknown as Native, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('不同值实库原物理连接身份未知');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: TableValueOptionsConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, commands: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check(); if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id) { owner.stop(); throw Error('不同值实库原物理连接漂移'); }
      const input = args[0], sql: unknown = typeof input === 'string' ? input : input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'sql')?.value : undefined;
      if (typeof sql !== 'string' || !sql) { owner.stop(); throw Error('不同值实库原SQL形状未知'); }
      const controls = ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SET SESSION max_sort_length = 262144', 'SET SESSION sort_buffer_size = 8388608', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE'];
      // 预算停止只允许本scope已经登记且尚未终结的原分组线程，不能泛化成任意KILL授权。
      const kill = /^KILL QUERY ([1-9]\d*)$/.exec(sql), stopping = scope !== 'observer' && kill && Number.isSafeInteger(Number(kill[1])) && allowStop?.(Number(kill[1]), scope) === true;
      if (!/^(?:SELECT|SHOW)\b/i.test(sql) && !(scope !== 'observer' && controls.includes(sql)) && !stopping && !(scope === 'observer' && fixtureWrites.has(sql))) { owner.stop(); throw Error('不同值产品发送了写入或未登记事务控制'); }
      const callback = args.at(-1), streamed = typeof callback !== 'function', command = { sql, method, streamed, callbackReturned: streamed, terminal: false }; fact.commands.push(command); fact.pending++;
      let settled = false; const finish = () => { if (!settled && command.callbackReturned && command.terminal) { settled = true; fact.pending--; } };
      if (!streamed) args[args.length - 1] = function (this: unknown, ...values: unknown[]) { try { return (callback as (...values: unknown[]) => unknown).apply(this, values); } finally { command.callbackReturned = true; finish(); } };
      try {
        const originalCommand = original.apply(native, args);
        if (!originalCommand || typeof (originalCommand as NativeCommand).once !== 'function') { owner.stop(); throw Error('不同值原命令无可观察end终态'); }
        (originalCommand as NativeCommand).once('end', () => { command.terminal = true; finish(); }); return originalCommand;
      } catch (error) { owner.stop(); throw error; }
    };
  }
  const close = managed.close.bind(managed);
  managed.close = async options => { fact.closeCalls++; fact.strict = options?.strict === true; try { await close(options); fact.closeReturned = true; } catch (reason) { fact.closeFailed = true; throw reason; } };
  return fact;
}
/** 原callback、原Query end、严格close返回与原stream close缺一不可；ERR不等于end。 */
export function assertTableValueOptionsReleased(facts: readonly TableValueOptionsConnectionFact[], strict: boolean): void {
  if (facts.some(fact => fact.managed.connection !== fact.native as unknown || fact.native.stream !== fact.stream || fact.native.threadId !== fact.id || fact.pending !== 0 || fact.closeCalls !== 1 || strict && !fact.strict || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true || fact.commands.some(command => !command.callbackReturned || !command.terminal))) throw Error('不同值原任务、原命令或原流尚未确认真实释放，保留现场');
}
/** 观察连接也必须等待原底层流关闭；失败保留，不借新连接继续清理。 */
export async function closeTableValueOptionsObserver(observer: ManagedConnection) { await closeEmptyDefaultStream(observer.connection, () => observer.close({ strict: true })); }

/** 自有合成数据计划可供源码/GUI验收复用；只返回SQL，不建连、不执行，也不接受业务库名。 */
export function planTableValueOptionsFixture(database: string, marker: string) {
  if (!/^dbark_(?:tablevalues|e2e_tablevalues)_[a-f0-9]{32}$/.test(database) || !/^dbark-table-value-options:[a-f0-9]{32}$/.test(marker)) throw Error('不同值合成资源计划身份无效');
  const db = '`' + database + '`', table = db + '.`subject`', literal = (value: string) => `_utf8mb4 X'${Buffer.from(value).toString('hex')}'`;
  const labels = ['Alpha', 'alpha', null, '', 'NULL', '\n', 'line\nbreak', 'Alpha ', '尾部中文'];
  const creates = [
    `CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    `CREATE TABLE ${db}.\`__owner\` (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB COMMENT='${marker}:owner'`,
    `CREATE TABLE ${table} (id INT NOT NULL PRIMARY KEY,label VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,big_value BIGINT UNSIGNED NULL,amount DECIMAL(30,12) NULL,at_value DATETIME(6) NULL,approx_value FLOAT NULL,double_value DOUBLE NULL,color ENUM('z','a') NULL,tags SET('z','a') NULL,long_value TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL) ENGINE=InnoDB COMMENT='${marker}:subject'`,
    `CREATE TABLE ${db}.\`candidates\` (id INT NOT NULL PRIMARY KEY,label VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL) ENGINE=InnoDB COMMENT='${marker}:candidates'`,
    `CREATE TABLE ${db}.\`large_value\` (id INT NOT NULL PRIMARY KEY,label LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL) ENGINE=InnoDB COMMENT='${marker}:large_value'`,
    `CREATE VIEW ${db}.\`subject_view\` AS SELECT id,label,big_value,amount,at_value,approx_value,double_value,color,tags,long_value FROM ${table}`,
  ];
  const tuples = [
    [1, labels[0], '18446744073709551615', '9007199254740993.123456789012', "'2026-10-23 12:34:56.123456'", '0.1', '9007199254740992', "'z'", "'z'"],
    [2, labels[1], '18446744073709551614', '-9007199254740993.123456789011', "'2026-10-23 12:34:56.123457'", '1e-30', '9007199254740994', "'a'", "'a'"],
    [3, labels[2], 'NULL', 'NULL', 'NULL', '-0.0', '-0.0', 'NULL', 'NULL'],
    [4, labels[3], '0', '0.000000000000', "'2000-01-01 00:00:00.000001'", '0.0', '0.0', "'z'", "'z,a'"],
    [5, labels[4], '1', '1.000000000000', "'2000-01-01 00:00:00.000001'", 'NULL', 'NULL', "'a'", "''"],
    [6, labels[5], '2', '2.000000000000', "'2000-01-01 00:00:00.000001'", '-0.1', '-9007199254740994', "'z'", "'z'"],
    [7, labels[6], '3', '3.000000000000', "'2000-01-01 00:00:00.000001'", '3.402823e38', '1e-300', "'a'", "'a'"],
    [8, labels[7], '4', '4.000000000000', "'2000-01-01 00:00:00.000001'", '-1e-30', '1.7976931348623157e308', "'z'", "'z,a'"],
    [9, labels[8], '5', '5.000000000000', "'2000-01-01 00:00:00.000001'", '1.17549435e-38', '-1e-300', "'a'", "''"],
  ];
  const seeds = [
    `INSERT INTO ${db}.\`__owner\` VALUES ('${marker}')`,
    `INSERT INTO ${table} VALUES ` + tuples.map(([id, label, ...values], index) => `(${id},${label === null ? 'NULL' : literal(String(label))},${values.join(',')},${index < 2 ? `CONCAT(REPEAT('a',1500),'${index ? 'Y' : 'X'}')` : 'NULL'})`).join(','),
    `INSERT INTO ${db}.\`candidates\` VALUES ` + Array.from({ length: 540 }, (_, index) => `(${index},'g_${String(index).padStart(4, '0')}')`).join(','),
    `INSERT INTO ${db}.\`large_value\` VALUES (1,REPEAT('x',262144)),(2,REPEAT('x',262145))`,
  ];
  return { database, marker, creates, seeds, drop: 'DROP DATABASE ' + db, labels, objects: ['__owner', 'candidates', 'large_value', 'subject', 'subject_view'] };
}
