import { isIP } from 'node:net';
import { win32 } from 'node:path';

/** 仅固化已经注册的准确组合；此表不替代Root的套件哈希、路径、身份和平台核验。 */
export const databaseBackupNativeProfile = Object.freeze({
  id: 'mysql-8.4.11-win32-x64', family: 'mysql', version: '8.4.11',
  policy: 'mysql-8.4.11-controlled-tcp-v1',
} as const);

/** 私有运行端输入，不是IPC合同；renderer不能构造路径、凭据、附加flags或SQL。 */
export interface DatabaseBackupNativeInput {
  tool: { id: string; family: 'mysql' | 'mariadb'; version: string; directory: string };
  target: {
    host: string; port: number; user: string; password: string; database: string;
    transport: 'tcp'; tls: 'disabled'; ssh: false; authPlugin: 'caching_sha2_password';
  };
  defaultsFile: { token: string; path: string };
}
export interface DatabaseBackupNativeDumpInput extends DatabaseBackupNativeInput {
  /** 这是Root选择的策略，不是本模块取得/证明了锁；Root必须覆盖整个dump生命周期。 */
  lockStrategy: 'root-held-global-read-lock';
}
export interface DatabaseBackupNativeRestoreInput extends DatabaseBackupNativeInput {
  /** 首片不做跨库重映射，归档预检确认的源库名必须与目标库名精确相同。 */
  sourceDatabase: string;
}

/** 敏感文本只允许显式取出一次；常规JSON/inspect不会把密码写进日志。 */
export class DatabaseBackupNativeClientOptions {
  #text: string | undefined;
  constructor(text: string) { this.#text = text; }
  /** Root取得文本后只以UTF-8无BOM写入私有defaults文件，不进入IPC、任务事件或日志。 */
  takeText(): string {
    if (this.#text === undefined) throw invalid();
    const value = this.#text; this.#text = undefined; return value;
  }
  toJSON(): string { return '[敏感客户端选项已隐藏]'; }
  toString(): string { return this.toJSON(); }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return this.toJSON(); }
}
export interface DatabaseBackupNativeOptions {
  readonly policy: typeof databaseBackupNativeProfile.policy;
  readonly toolId: typeof databaseBackupNativeProfile.id;
  readonly defaultsFileToken: string;
  readonly launch: {
    readonly executable: string; readonly argv: readonly string[]; readonly shell: false;
    readonly windowsVerbatimArguments: false; readonly env: Readonly<Record<string, string>>;
    readonly stdin: 'closed' | 'archive-dump-bytes'; readonly stdout: 'dump-bytes' | 'bounded-diagnostics';
  };
  readonly clientOptions: DatabaseBackupNativeClientOptions;
}

/** 所有错误固定文案，不拼接凭据、输入对象、驱动错误或序列化后的选项。 */
function invalid(): Error { return new Error('原生备份参数、凭据表示或受控路径未经支持，已阻断'); }
/** 精确字段且只读取自有数据属性，拒绝隐藏flags、环境、SQL、getter和toJSON。 */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const properties = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(properties);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in properties[key]))) throw invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { if (!Object.hasOwn(properties, key)) throw invalid(); result[key] = properties[key].value; }
  return result;
}
/** 验证UTF-8可无损表示；除已知转义控制符外，其余C0/DEL（含NUL、Ctrl-Z）明确拒绝。 */
function credential(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > 4096 || /[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/u.test(value) || Buffer.from(value, 'utf8').toString('utf8') !== value) throw invalid();
  return value;
}
/** 采用8.4.11 my_default.cc的转义；总是双引号包裹，空格显式转义，#不会成为注释。 */
function optionValue(value: string): string {
  const escapes: Record<string, string> = { '\\': '\\\\', '"': '\\"', "'": "\\'", '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r', ' ': '\\s' };
  return '"' + value.replace(/[\\"'\b\t\n\r ]/gu, char => escapes[char]) + '"';
}
/** 当前只支持规范ASCII本地盘路径，不归一化后悄悄换绑，不接UNC/设备/ADS/相对路径。 */
function controlledPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z]:\\/u.test(value) || /[^\x20-\x7e]/u.test(value) || value !== win32.normalize(value)) throw invalid();
  const components = value.slice(3).split('\\');
  if (!components.length || components.some(part => !part || /[<>:"/|?*]/u.test(part) || /[ .]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw invalid();
  return value;
}
/** 数据库按原字符串保留为一个argv值；禁止系统库、控制字符和含糊/不可编码标识。 */
function database(value: unknown): string {
  const name = credential(value, false);
  if ([...name].length > 64 || /[\x00-\x1f\x7f/\\.]/u.test(name) || name.startsWith('-') || name.endsWith(' ') || ['mysql', 'information_schema', 'performance_schema', 'sys', 'ndbinfo'].includes(name.toLowerCase())) throw invalid();
  return name;
}

/** 仅生成受控文本和argv；任何真实工具/路径/ACL/文件令牌、服务器身份及锁证明均由Root完成。 */
function build(input: DatabaseBackupNativeInput, operation: 'dump' | 'restore'): DatabaseBackupNativeOptions {
  const root = exact(input, ['tool', 'target', 'defaultsFile', operation === 'dump' ? 'lockStrategy' : 'sourceDatabase']);
  const tool = exact(root.tool, ['id', 'family', 'version', 'directory']);
  if (tool.id !== databaseBackupNativeProfile.id || tool.family !== databaseBackupNativeProfile.family || tool.version !== databaseBackupNativeProfile.version) throw invalid();
  const directory = controlledPath(tool.directory), defaults = exact(root.defaultsFile, ['token', 'path']), defaultsPath = controlledPath(defaults.path);
  if (typeof defaults.token !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(defaults.token)) throw invalid();
  // Root应将私有临时凭据文件放在套件外，不能借此覆盖受哈希保护的程序或插件文件。
  const relative = win32.relative(directory, defaultsPath);
  if (!relative || (!relative.startsWith('..\\') && !win32.isAbsolute(relative))) throw invalid();
  const target = exact(root.target, ['host', 'port', 'user', 'password', 'database', 'transport', 'tls', 'ssh', 'authPlugin']);
  if (target.transport !== 'tcp' || target.tls !== 'disabled' || target.ssh !== false || target.authPlugin !== 'caching_sha2_password') throw invalid();
  if (typeof target.host !== 'string' || target.host.includes('%') || !isIP(target.host) || typeof target.port !== 'number' || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) throw invalid();
  const db = database(target.database), user = credential(target.user, false), password = credential(target.password, true);
  if (operation === 'dump' ? root.lockStrategy !== 'root-held-global-read-lock' : database(root.sourceDatabase) !== db) throw invalid();
  const common = [
    `--defaults-file=${defaultsPath}`, '--no-login-paths', '--protocol=TCP', `--host=${target.host}`, `--port=${target.port}`,
    '--default-character-set=utf8mb4', '--ssl-mode=DISABLED', '--default-auth=caching_sha2_password',
    `--plugin-dir=${win32.join(directory, 'lib', 'plugin')}`,
  ];
  const args = operation === 'dump' ? [
    '--opt', '--quick', '--hex-blob', '--routines', '--events', '--triggers', '--quote-names',
    '--set-gtid-purged=OFF', '--column-statistics=0', '--databases', '--skip-lock-tables', '--', db,
  ] : [
    '--batch', '--binary-mode', '--skip-reconnect', '--skip-auto-rehash', '--local-infile=0',
    '--skip-system-command', '--commands=OFF', `--database=${db}`,
  ];
  const clientOptions = new DatabaseBackupNativeClientOptions(`[client]\nuser=${optionValue(user)}\npassword=${optionValue(password)}\n`);
  return Object.freeze({
    policy: databaseBackupNativeProfile.policy, toolId: databaseBackupNativeProfile.id, defaultsFileToken: defaults.token,
    launch: Object.freeze({ executable: win32.join(directory, 'bin', operation === 'dump' ? 'mysqldump.exe' : 'mysql.exe'), argv: Object.freeze([...common, ...args]), shell: false as const, windowsVerbatimArguments: false as const, env: Object.freeze({}), stdin: operation === 'dump' ? 'closed' as const : 'archive-dump-bytes' as const, stdout: operation === 'dump' ? 'dump-bytes' as const : 'bounded-diagnostics' as const }),
    clientOptions,
  });
}
/** 调用前Root必须已经获得全局读锁并在进程退出、stdout结束前持续持有；本方法不执行锁SQL。 */
export function databaseBackupNativeDumpOptions(input: DatabaseBackupNativeDumpInput): DatabaseBackupNativeOptions {
  try { return build(input, 'dump'); } catch { throw invalid(); }
}
/** 只生成从stdin恢复同名库的固定参数；完整归档/来源/跨库依赖/目标冲突须由恢复预检另证。 */
export function databaseBackupNativeRestoreOptions(input: DatabaseBackupNativeRestoreInput): DatabaseBackupNativeOptions {
  try { return build(input, 'restore'); } catch { throw invalid(); }
}
