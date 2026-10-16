import { isAbsolute } from 'node:path';
import { c02Failure, c02Names, cleanupC02, type C02Ownership } from './c02-mtls-policy';

/** 只收录本片源码固定文案；不得从driver消息、SQL或外部属性自动登记。固定编号追加维护。 */
const d02FixedText: Readonly<Record<string, string>> = {
  D02_FIXED_001: "完整复制源真实验收尚未显式启用",
  D02_FIXED_002: "只允许ROOT核对的server-200及13384或13484",
  D02_FIXED_003: "本片不允许SSH转发或替换目标",
  D02_FIXED_004: "必须显式提供本轮实际MySQL实例UUID",
  D02_FIXED_005: "必须由ROOT显式注入本轮既有观察账号和密码",
  D02_FIXED_006: "严格TLS必须显式启用并提供原CA绝对路径及已核对SHA256，禁止降级或替换CA",
  D02_FIXED_007: "D02夹具写结果未知，永久保留资源",
  D02_FIXED_008: "D02清理验证或操作失败，禁止所有后续DROP",
  D02_FIXED_009: "D02写结果未知，禁止后续写操作",
  D02_FIXED_010: "D02夹具SQL超时，服务器结果未知且未重放",
  D02_FIXED_011: "D02账号权限不再是精确subject SELECT，保留现场",
  D02_FIXED_012: "D02账号存在额外权限，保留现场",
  D02_FIXED_013: "D02账号存在角色授权，保留现场",
  D02_FIXED_014: "D02待核线程编号无效",
  D02_FIXED_015: "D02真实线程尚未归还，保留账号和库",
  D02_FIXED_016: "D02真实CREATE确认状态仍未知，禁止任何DROP",
  D02_FIXED_017: "D02已删除账号再次出现，保留现场",
  D02_FIXED_018: "D02账号归属已变化，拒绝删除",
  D02_FIXED_019: "D02subject缺失、存在未知表或归属已变化，拒绝删除",
  D02_FIXED_020: "D02库中存在非本轮对象，拒绝删除",
  D02_FIXED_021: "D02无观察连接，保留对象",
  D02_FIXED_022: "D02存在无法核对编号的连接，保留现场",
  D02_FIXED_023: "D02真实连接缺少严格TLS证据",
  D02_FIXED_024: "D02临时账号仍有线程，保留对象",
  D02_FIXED_025: "D02本轮页没有可验证的行来源",
  D02_FIXED_026: "D02待释放来源不完整",
  D02_PREFLIGHT_CA_FILE: "D02原CA不是普通文件",
  D02_PREFLIGHT_CA_HASH: "D02原CA摘要不匹配，未创建连接或对象",
  D02_PREFLIGHT_TLS_IDENTITY: "D02观察连接的原CA认证或目标IP身份不匹配，未创建对象",
  D02_PREFLIGHT_TLS_CIPHER: "D02观察连接没有实际TLS会话cipher，未创建对象",
  D02_PREFLIGHT_IDENTITY: "D02实例UUID或已批准的MySQL8.4/Linux条件不符，未创建对象",
  D02_PREFLIGHT_PROCESS: "D02既有观察账号缺少直接PROCESS权限；不自动扩权",
  D02_PREFLIGHT_MDL: "D02服务器未提供真实MDL观察条件；不自动修改全局设置",
  D02_PREFLIGHT_OBSERVER: "D02观察连接不能看见自身线程，拒绝零线程假证据",
  D02_FIXED_027: "D02随机库已存在，拒绝接管",
  D02_FIXED_028: "D02随机账号已存在，拒绝接管",
  D02_FIXED_029: "D02管理员旧来源只用于同轮限权归属负例",
  D02_FIXED_030: "D02管理员旧来源未真实签发",
  D02_FIXED_031: "D02只读来源意外发送任务事件",
  D02_FIXED_032: "D02账号删除后仍存在",
  D02_FIXED_033: "D02数据库删除后仍存在",
  D02_FIXED_034: "D02读取没有按预期完整拒绝，不能认定安全通过",
  D02_FIXED_035: "D02真实页未签发完整来源",
  D02_FIXED_036: "D02页与租约结构身份不一致",
  D02_FIXED_037: "D02独立事实或真实缺列条件不成立",
  D02_FIXED_038: "D02完整标量/NULL精度与独立观察事实不同",
  D02_FIXED_039: "D02完整投影与独立列目录或已加载值不符",
  D02_FIXED_040: "D02完整二进制与独立字节事实不同",
  D02_FIXED_041: "D02没有真实读取时点",
  D02_FIXED_042: "D02并发UPDATE没有独立确认",
  D02_FIXED_043: "D02观察不到原物理表身份",
  D02_FIXED_044: "D02服务器没有独立证实物理重建",
  D02_FIXED_045: "D02观察连接未证实DDL漂移",
  D02_FIXED_046: "D02公开输入未在建连前拒绝自造键",
  D02_FIXED_047: "D02原可靠键变更未被观察确认",
  D02_FIXED_048: "D02TTL并非原五分钟范围，拒绝缩短或伪造时钟",
  D02_FIXED_049: "D02真实等待期间观察连接已失效",
  D02_FIXED_050: "D02独立服务器时钟未证实真实等待",
  D02_FIXED_051: "D02观察连接没有证实超预算长度",
  D02_FIXED_052: "D02没有观察到目标真实MDL等待，不能把普通取消算作通过",
  D02_FIXED_053: "D02被取消的读取仍返回完整行",
  D02_FIXED_054: "D02取消误伤了原阻塞连接或锁",
  D02_FIXED_055: "D02仅SELECT账号没有明确身份权限降级",
  D02_FIXED_056: "D02拒绝跨账号误用时破坏了原管理员来源",
  D02_STAGE_001: "D02验证或操作无法确认，永久保留现场",
  D02_STAGE_002: "D02夹具写响应未知，保留现场且未重放",
  D02_STAGE_003: "D02锁连接操作失败，未重放",
  D02_STAGE_004: "D02引擎关闭失败",
  D02_STAGE_005: "D02锁连接关闭失败",
  D02_COMPARE_001: "D02只读补取后行值或条数发生变化",
  D02_COMPARE_002: "D02拒绝旧来源时意外改写数据",
  D02_COMPARE_003: "D02重建后的真实DDL与原定义不同",
  D02_COMPARE_004: "D02重建后的真实键值与原行不同",
  D02_COMPARE_005: "D02租约释放或到期拒绝后数据发生变化",
  D02_COMPARE_006: "D02预算拒绝后完整行发生改变或裁短",
  D02_COMPARE_007: "D02限权查看或拒绝旧管理员来源后源数据变化",
  D02_UNCLASSIFIED: "D02检查拒绝（未登记固定原因）",
  D02_CASE_FAILURE: "D02用例失败",
  D02_CASE_CLEANUP_FAILURE: "D02验收或清理失败",
};
const d02MessageCodes = new Map(Object.entries(d02FixedText).map(([code,message]) => [message,code]));
const d02ErrorCodes = new WeakMap<object, readonly string[]>();
const d02Stages = new Map([["D02验证或操作无法确认，永久保留现场","D02_STAGE_001"],["D02夹具写响应未知，保留现场且未重放","D02_STAGE_002"],["D02锁连接操作失败，未重放","D02_STAGE_003"],["D02引擎关闭失败","D02_STAGE_004"],["D02锁连接关闭失败","D02_STAGE_005"]]);

/** D02自有错误不进入公共C02消息信任范围；仅私有登记的固定分类可由本片恢复。 */
export class D02FixtureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    const code = d02MessageCodes.get(message) ?? 'D02_UNCLASSIFIED';
    super(d02FixedText[code], options); d02ErrorCodes.set(this, [code]);
  }
}

export interface D02CopyConfig {
  host: '192.168.31.200'; port: 13384 | 13484; serverUuid: string;
  user: string; password: string; tls: boolean; caPath?: string; caSha256?: string;
}
export type D02Ownership = C02Ownership;

/** 默认只读两个开关；未同时开启时不读取其他配置、文件或加载数据库模块。 */
export function d02CopyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_D02_COPY_SOURCE_ENABLED === '1';
}

/** 只接受ROOT本轮显式注入值；不读取.env、SSH或既有ROOT凭据，不推测实例UUID。 */
export function d02CopyConfig(env: NodeJS.ProcessEnv): D02CopyConfig {
  if (!d02CopyEnabled(env)) throw new D02FixtureError('完整复制源真实验收尚未显式启用');
  const port = env.DBARK_TEST_PORT;
  if (env.DBARK_TEST_HOST !== '192.168.31.200' || !['13384', '13484'].includes(port ?? '') || env.DBARK_D02_COPY_ROOT_CONFIRM !== `server-200/192.168.31.200:${port}/d02-copy-source`) throw new D02FixtureError('只允许ROOT核对的server-200及13384或13484');
  if (env.DBARK_TEST_SSH === '1') throw new D02FixtureError('本片不允许SSH转发或替换目标');
  const serverUuid = env.DBARK_D02_COPY_SERVER_UUID ?? '';
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid)) throw new D02FixtureError('必须显式提供本轮实际MySQL实例UUID');
  if (!env.DBARK_TEST_USER || !env.DBARK_TEST_PASSWORD) throw new D02FixtureError('必须由ROOT显式注入本轮既有观察账号和密码');
  const tls = port === '13484' || env.DBARK_TEST_TLS === '1';
  const caPath = env.DBARK_TEST_CA, caSha256 = env.DBARK_D02_COPY_CA_SHA256;
  if (tls && (env.DBARK_TEST_TLS !== '1' || !caPath || !isAbsolute(caPath) || /[\r\n\0]/.test(caPath) || !/^[a-f0-9]{64}$/i.test(caSha256 ?? ''))) throw new D02FixtureError('严格TLS必须显式启用并提供原CA绝对路径及已核对SHA256，禁止降级或替换CA');
  return { host: '192.168.31.200', port: Number(port) as 13384 | 13484, serverUuid: serverUuid.toLowerCase(), user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, tls, ...(tls ? { caPath, caSha256: caSha256!.toLowerCase() } : {}) };
}

/** 沿用已授权cp_十二位后缀及精确subject表；不允许外部传入库名或账号。 */
export function d02CopyNames(suffix: string, limited: boolean) {
  const names = c02Names(suffix);
  return { ...names, database: limited ? names.database : `dbark_e2e_d02_${suffix}` };
}

/** 一切断言只输出固定说明，不让Vitest把真实行、凭据或驱动sql对象展开。 */
export function d02Fact(condition: unknown, message: string): asserts condition { if (!condition) throw new D02FixtureError(message); }

/** 只读取自有数据属性并保留私有登记分类，外部伪造message/code/诊断属性均无授权。 */
function d02Codes(reason: unknown): string[] {
  const codes = new Set<string>(), seen = new Set<object>();
  function visit(value: unknown, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value) || seen.size >= 64) return; seen.add(value);
    for (const code of d02ErrorCodes.get(value) ?? []) if (Object.hasOwn(d02FixedText, code)) codes.add(code);
    try {
      const cause = Object.getOwnPropertyDescriptor(value, 'cause'); if (cause && 'value' in cause) visit(cause.value, depth + 1);
      const errors = Object.getOwnPropertyDescriptor(value, 'errors');
      if (errors && 'value' in errors && Array.isArray(errors.value)) for (let i = 0; i < Math.min(errors.value.length, 16); i++) { const item = Object.getOwnPropertyDescriptor(errors.value, String(i)); if (item && 'value' in item) visit(item.value, depth + 1); }
    } catch { /* 未知子节点不能抹掉父节点已有的私有固定分类。 */ }
  }
  visit(reason); return [...codes].slice(0, 12);
}

/** 仅允许固定阶段或严格随机资源标识；外部自由文案不能作为可信阶段输出。 */
function d02Stage(stage: string): { text: string; code?: string } {
  if (stage === '固定阶段失败') return { text: stage };
  if (d02Stages.has(stage)) return { text: stage, code: d02Stages.get(stage) };
  if (/^D02验收失败；本轮数据库(?:dbark_e2e_d02_|dbark_colperm_)[a-f0-9]{12}；临时用户(?:cp_[a-f0-9]{12}|未创建)$/.test(stage)) return { text: stage, code: 'D02_CASE_FAILURE' };
  if (/^D02验收或清理失败；保留现场核对入口(?:dbark_e2e_d02_|dbark_colperm_)[a-f0-9]{12}\/(?:cp_[a-f0-9]{12}|无临时用户)；真实CREATE状态：用户(?:absent|unknown|confirmed)、库(?:absent|unknown|confirmed)；DROP成功响应：用户(?:true|false)、库(?:true|false)；确认删除：用户(?:true|false)、库(?:true|false)$/.test(stage)) return { text: stage, code: 'D02_CASE_CLEANUP_FAILURE' };
  return { text: 'D02阶段未登记，外部文案已脱敏' };
}

/** 不改公共C02规则；本片只恢复私有固定分类，公共脱敏产生的普通Error不再丢失该分类。 */
export function d02Failure(stage: string, reason: unknown): Error {
  const safe = d02Stage(typeof stage === 'string' ? stage : ''); let codes: string[] = [];
  try { codes = d02Codes(reason); } catch { /* 未知Proxy或属性描述器失败不能输出原异常。 */ }
  if (safe.code && !codes.includes(safe.code)) codes.push(safe.code);
  let sanitized: Error;
  try { sanitized = c02Failure(safe.text, reason); } catch { sanitized = c02Failure(safe.text, new Error('未知异常属性不可读取')); }
  // D02包装也使用普通Error，不借公共C02可信类传播可变message；分类只从私有登记恢复。
  const result = new Error(safe.text, { cause: sanitized.cause });
  // 清除外部伪造的D02保留命名空间；只处理已脱敏的新树，不修改原始错误。
  const seen = new Set<object>();
  function clean(value: unknown) { if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value); const code = Object.getOwnPropertyDescriptor(value, 'code'); if (code && 'value' in code && typeof code.value === 'string' && code.value.startsWith('D02_')) Reflect.deleteProperty(value, 'code'); const cause = Object.getOwnPropertyDescriptor(value, 'cause'); if (cause && 'value' in cause) clean(cause.value); const errors = Object.getOwnPropertyDescriptor(value, 'errors'); if (errors && 'value' in errors && Array.isArray(errors.value)) errors.value.forEach(clean); }
  clean(result);
  const fixed = codes.slice(0, 12); d02ErrorCodes.set(result, fixed);
  if (fixed.length) { result.message += '；D02固定分类：' + fixed.map(code => '[' + code + '] ' + d02FixedText[code]).join('；'); Object.assign(result, { code: fixed[0] }); }
  return result;
}

/** 单表归属令牌必须保持，空库只允许由已确认CREATE且没有未知后续写操作的状态调用。 */
export function d02OwnsTables(rows: { name: unknown; comment: unknown }[], owner: string): boolean {
  return /^[a-f0-9]{32}$/.test(owner) && rows.length <= 1 && rows.every(row => row.name === 'subject' && row.comment === `dbark-d02-owner:${owner}`);
}

/** 复用已审过的清理顺序；CREATE/授权/其它夹具写响应未知均保留资源，不重放写操作。 */
export async function cleanupD02Copy(actions: Parameters<typeof cleanupC02>[0], uncertainWrite: boolean, failure?: unknown): Promise<void> {
  // CREATE状态保持原事实；验证/操作失败是独立、不可复活的删除授权标记。
  let first: unknown = failure ?? (uncertainWrite ? new D02FixtureError('D02夹具写结果未知，永久保留资源') : undefined);
  let blocked = uncertainWrite || failure !== undefined;
  const attempt = async (action: () => Promise<void>) => { try { await action(); } catch (error) { blocked = true; first ??= error; throw error; } };
  const drop = async (action: () => Promise<void>) => { if (blocked) throw new D02FixtureError('D02清理验证或操作失败，禁止所有后续DROP', { cause: first }); await attempt(action); };
  await cleanupC02({ ...actions,
    closeConnections: () => attempt(actions.closeConnections), verifyThreadsGone: () => attempt(actions.verifyThreadsGone),
    dropUser: () => drop(actions.dropUser), dropDatabase: () => drop(actions.dropDatabase),
  }, first);
}
