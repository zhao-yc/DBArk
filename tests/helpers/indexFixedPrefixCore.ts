/** 本辅助仅服务三个已有表前缀核心case；没有环境、文件、驱动或桌面模块读取。 */
export const fixedPrefixCases = [
  ['units', 'CHAR字符与BINARY字节前缀单次替换并保持原列旁键数据及表尾'],
  ['budget', '复合前缀3073字节在DDL发送前拒绝而3072字节单次执行并完整后核'],
  ['duplicate', '唯一CHAR与BINARY前缀真实1062保持原DDL数据且旧令牌不可重用'],
] as const;
export type FixedPrefixCase = typeof fixedPrefixCases[number][0];
type Environment = Record<string, string | undefined>;
const versions = { '13357': ['mysql', '5.7.44'], '13380': ['mysql', '8.0.46'], '13384': ['mysql', '8.4.11'], '13310': ['mariadb', '10.11.19'], '13311': ['mariadb', '11.4.13'], '13484': ['mysql', '8.4.11'] } as const;

/** 认证必须是自有显式字符串；TLS仅13484开放，Maria指纹和MySQL UUID分别绑定。 */
export function bindFixedPrefixTarget(readRaw: () => Environment) {
  const raw = readRaw(), port = raw.DBARK_TEST_PORT;
  if (!port || !Object.hasOwn(versions, port)) throw Error('前缀核心验收准确端口未准备');
  const [dialect, version] = versions[port as keyof typeof versions];
  const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_INDEX_FIXED_PREFIX_CORE', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', ...(dialect === 'mysql' ? ['DBARK_TEST_EXPECTED_SERVER_UUID'] : ['DBARK_TEST_EXPECTED_SERVER_HOSTNAME', 'DBARK_TEST_EXPECTED_SERVER_ID', 'DBARK_TEST_EXPECTED_SERVER_PORT']), ...(port === '13484' ? ['DBARK_TEST_CA'] : [])];
  for (const key of keys) if (!Object.hasOwn(raw, key) || typeof raw[key] !== 'string') throw Error('前缀核心验收缺少显式配置');
  if (raw.DBARK_INTEGRATION_ENABLED !== '1' || raw.DBARK_INDEX_FIXED_PREFIX_CORE !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(raw.DBARK_TEST_HOST!) || raw.DBARK_TEST_TLS !== (port === '13484' ? '1' : '0') || !raw.DBARK_TEST_USER || raw.DBARK_TEST_SSH === '1' || port === '13484' && !raw.DBARK_TEST_CA!.trim()) throw Error('前缀核心验收目标或TLS合同不符');
  if (dialect === 'mysql' ? !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!) : !raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME || !/^[1-9]\d{0,9}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_ID!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_ID) > 4294967295 || !/^[1-9]\d{0,4}$/.test(raw.DBARK_TEST_EXPECTED_SERVER_PORT!) || Number(raw.DBARK_TEST_EXPECTED_SERVER_PORT) > 65535) throw Error('前缀核心验收准确身份未绑定');
  const fixed = Object.freeze(Object.fromEntries(keys.map(key => [key, raw[key]!]))), ssh = raw.DBARK_TEST_SSH;
  let changed = false;
  return { target: Object.freeze({ dialect, version, host: fixed.DBARK_TEST_HOST, port: Number(port), user: fixed.DBARK_TEST_USER, password: fixed.DBARK_TEST_PASSWORD, tls: port === '13484', ca: fixed.DBARK_TEST_CA, uuid: fixed.DBARK_TEST_EXPECTED_SERVER_UUID, hostname: fixed.DBARK_TEST_EXPECTED_SERVER_HOSTNAME, serverId: fixed.DBARK_TEST_EXPECTED_SERVER_ID, serverPort: fixed.DBARK_TEST_EXPECTED_SERVER_PORT }), assertCurrent() {
    const current = readRaw();
    if (changed || keys.some(key => !Object.hasOwn(current, key) || current[key] !== fixed[key]) || current.DBARK_TEST_SSH !== ssh) { changed = true; throw Error('前缀核心验收配置已变化，禁止继续'); }
  } };
}
export type FixedPrefixTarget = ReturnType<typeof bindFixedPrefixTarget>['target'];

/** 每case固定30秒单调期限；afterEach先锁本地状态，迟到结果不能启动新动作。 */
export function fixedPrefixOwner(id: string, now: () => number, timeout: number, elapsed = 0) {
  const deadline = now() + 30000 - elapsed;
  let retained = timeout !== 30000 || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 30000, active = true, pending = 0, binding: (() => void) | undefined;
  const stop = () => { retained = true; };
  const check = () => { try { if (retained || !active || now() >= deadline) throw Error('前缀核心验收已停链或原30秒时限已过'); binding?.(); } catch (reason) { stop(); throw reason; } };
  return {
    id, stop, check, bind(value: () => void) { check(); if (binding) { stop(); throw Error('前缀case不能重绑身份'); } binding = value; check(); },
    get state() { return { retained, active, pending }; },
    async run<T>(action: () => Promise<T>): Promise<T> { check(); pending++; try { const result = await action(); check(); return result; } catch (reason) { stop(); throw reason; } finally { pending--; } },
    finish() { check(); if (pending) { stop(); throw Error('前缀case还有未结束观察'); } active = false; },
    afterEach() { if (retained || active || pending) { stop(); throw Error('前缀case或资源收尾未终态，保留现场'); } },
  };
}
export type FixedPrefixOwner = ReturnType<typeof fixedPrefixOwner>;

interface NativeStream { closed?: boolean; once(event: string, callback: () => void): unknown; }
interface NativeConnection { threadId?: number; stream?: NativeStream; query: (...args: unknown[]) => unknown; }
interface Managed { connection: unknown; profile: { id: string }; close(options?: { strict?: boolean }): Promise<void>; }
export interface PrefixConnectionFact {
  ownerId: string; taskId: string; profileId: string; native: NativeConnection; stream: NativeStream; threadId: number;
  managed: Managed; pending: number; closeCalls: number; strict: boolean; closeReturned: boolean; closeFailed: boolean; sawClose: boolean;
  closeEvent: Promise<void>;
  alters: number; alterErrors: { errno?: unknown; code?: unknown; sqlState?: unknown }[];
}

/** 真透传旁观：原Query对象、回调this/参数、原生连接及close结果原样传递，不造回包。 */
export function watchPrefixConnection<T extends Managed>(managed: T, owner: FixedPrefixOwner, taskId: string, profileId: string, qualifiedTarget: string): PrefixConnectionFact {
  // 捕获句柄本身不发I/O：迟到connect也须留下原native归属；后续查询仍由sticky门拒绝。
  const native = managed.connection as NativeConnection, stream = native.stream;
  if (managed.profile.id !== profileId || !stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId! < 1 || typeof native.query !== 'function') throw Error('前缀case原生连接归属或底层流未知');
  let closed!: () => void; const closeEvent = new Promise<void>(resolve => { closed = resolve; });
  const fact: PrefixConnectionFact = { ownerId: owner.id, taskId, profileId, native, stream, threadId: native.threadId!, managed, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, sawClose: false, closeEvent, alters: 0, alterErrors: [] };
  stream.once('close', () => { fact.sawClose = true; closed(); });
  const query = native.query, close = managed.close.bind(managed);
  native.query = function (...args: unknown[]) {
    owner.check();
    if (native.stream !== stream || managed.connection !== native || native.threadId !== fact.threadId || managed.profile.id !== profileId) { owner.stop(); throw Error('前缀case查询句柄已变化'); }
    if (typeof args[0] !== 'string') { owner.stop(); throw Error('前缀case真实查询文本形状未知'); }
    const sql = args[0], alter = /^ALTER\s+TABLE\s/i.test(sql);
    if (alter) { if (!sql.startsWith('ALTER TABLE ' + qualifiedTarget + ' ')) { owner.stop(); throw Error('前缀case拒绝其它目标的ALTER'); } fact.alters++; }
    const callback = args.at(-1);
    if (typeof callback !== 'function') { owner.stop(); throw Error('前缀真实结构查询缺少原回调'); }
    fact.pending++;
    let ended = false;
    const end = () => { if (!ended) { ended = true; fact.pending--; } };
    args[args.length - 1] = function (this: unknown, ...result: unknown[]) {
      if (alter && result[0] && typeof result[0] === 'object') { const error = result[0] as Record<string, unknown>; fact.alterErrors.push({ errno: error.errno, code: error.code, sqlState: error.sqlState }); }
      try { return callback.apply(this, result); } finally { end(); }
    };
    try { return query.apply(native, args); } catch (reason) { end(); throw reason; }
  };
  managed.close = async options => {
    fact.closeCalls++; fact.strict = options?.strict === true;
    try { await close(options); fact.closeReturned = true; }
    catch (reason) { fact.closeFailed = true; throw reason; }
  };
  return fact;
}

/** 错误1062可能遮住Engine finally中的close错误，因此独立查每条真实流，不能只看终态。 */
export function assertPrefixReleased(facts: PrefixConnectionFact[], owner: FixedPrefixOwner, taskId: string, strict: boolean) {
  owner.check(); const matches = facts.filter(value => value.taskId === taskId);
  if (matches.length !== 1 || matches.some(value => value.ownerId !== owner.id || value.managed.profile.id !== value.profileId || value.managed.connection !== value.native || value.native.stream !== value.stream || value.native.threadId !== value.threadId || value.pending || value.closeCalls !== 1 || strict && !value.strict || !value.closeReturned || value.closeFailed || !value.sawClose || value.stream.closed !== true)) { owner.stop(); throw Error('前缀case准确任务或同一原生流严格关闭未确认'); }
}

/** 仅真实ERR三字段精确匹配可进入预设1062后核；消息文字与outcome unknown都不是清理许可。 */
export function isPrefixDuplicate(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as Record<string, unknown>).errno === 1062 && (error as Record<string, unknown>).code === 'ER_DUP_ENTRY' && (error as Record<string, unknown>).sqlState === '23000';
}

/** cleanup只接受独立资源门后的准确新库；任何未知在DROP前停链，不取消任务换取清理许可。 */
export async function finishFixedPrefix(owner: FixedPrefixOwner, steps: { resources(): Promise<void>; closeEngine(): Promise<void>; verifyOwned(): Promise<void>; drop(): Promise<void>; absent(): Promise<void>; closeObserver(): Promise<void>; restore(): void }) {
  await owner.run(steps.resources);
  await owner.run(steps.closeEngine);
  await owner.run(steps.verifyOwned);
  await owner.run(steps.drop);
  await owner.run(steps.absent);
  await owner.run(steps.closeObserver);
  steps.restore(); owner.finish();
}

/** Maria已有握手模式IGNORE_SPACE单独受证；未知、空项及省略定义的组合仍拒绝，不SET绕过。 */
export function assertFixedPrefixModes(value: unknown, dialect: 'mysql' | 'mariadb') {
  const common = ['ONLY_FULL_GROUP_BY', 'STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES', 'NO_ZERO_IN_DATE', 'NO_ZERO_DATE', 'ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION', 'NO_AUTO_CREATE_USER', 'NO_BACKSLASH_ESCAPES'];
  if (typeof value !== 'string' || !/^[A-Z0-9_,]*$/.test(value) || value !== '' && value.split(',').some(mode => !common.includes(mode) && !(dialect === 'mariadb' && mode === 'IGNORE_SPACE'))) throw Error('前缀case会话模式未知或可能省略原定义');
}

/** 最大预算请求仍是255/255/255/12；只读预览必须展示产品规范后的整字段SQL。 */
export function assertFixedPrefixBudgetPreview(value: unknown, qualifiedTarget: string) {
  const expected = 'ALTER TABLE ' + qualifiedTarget + " ADD INDEX `budget_key` USING BTREE (`c` ASC, `d` ASC, `e` ASC, `b`(12) ASC) COMMENT '';";
  if (value !== expected) throw Error('前缀case最大预算预览未保持整字段规范和BINARY(12)');
}

/** SQL NULL必须是自有数据字段的实际null；缺字段、undefined、文字null不能冒充整字段。 */
export function assertFixedPrefixBudgetSubParts(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) throw Error('前缀case最大预算目录键部分数量不符');
  for (const [index, name] of ['c', 'd', 'e', 'b'].entries()) {
    const row = value[index];
    if (!row || typeof row !== 'object' || ['Key_name', 'Column_name', 'Seq_in_index'].some(key => !Object.hasOwn(row, key)) || row.Key_name !== 'budget_key' || row.Column_name !== name || ![index + 1, String(index + 1)].includes(row.Seq_in_index)) throw Error('前缀case最大预算目录身份或顺序不符');
    const field = Object.getOwnPropertyDescriptor(row, 'Sub_part');
    if (!field || !Object.hasOwn(field, 'value') || (index < 3 ? field.value !== null : field.value !== 12 && field.value !== '12')) throw Error('前缀case最大预算目录必须为SQL NULL/NULL/NULL及字节12');
  }
}
