import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseBackupNativeDumpOptions as dump, databaseBackupNativeRestoreOptions as restore, type DatabaseBackupNativeDumpInput, type DatabaseBackupNativeRestoreInput } from '../../src/engine/databaseBackupNativeOptions';

/** 全部是假路径与合成凭据；不读取认证文件、探测版本、spawn或连接数据库。 */
function input(): DatabaseBackupNativeDumpInput {
  return { tool: { id: 'mysql-8.4.11-win32-x64', family: 'mysql', version: '8.4.11', directory: 'D:\\受控路径占位' }, target: { host: '127.0.0.1', port: 13384, user: 'fixture-user', password: 'SYNTHETIC-only-4-Secret', database: '业务库#带空格 名称', transport: 'tcp', tls: 'disabled', ssh: false, authPlugin: 'caching_sha2_password' }, defaultsFile: { token: 'fixture-options-token', path: 'D:\\Private Temp\\fixture#4.cnf' }, lockStrategy: 'root-held-global-read-lock' };
}
function valid(): DatabaseBackupNativeDumpInput { const value = input(); value.tool.directory = 'D:\\Verified Tools\\mysql-8.4.11'; return value; }
function restoreInput(): DatabaseBackupNativeRestoreInput { const { lockStrategy: _, ...value } = valid(); return { ...value, sourceDatabase: value.target.database }; }
/** 按官方my_default.cc语义建立小参考读取器：只接受本片固定三行配置，验证无段落/指令注入。 */
function parseClient(text: string): Record<string, string> {
  const lines = text.split('\n'); expect(lines[0]).toBe('[client]'); expect(lines).toHaveLength(4); expect(lines[3]).toBe('');
  const result: Record<string, string> = {};
  for (const line of lines.slice(1, 3)) {
    const equals = line.indexOf('='), key = line.slice(0, equals), value = line.slice(equals + 1);
    expect(['user', 'password']).toContain(key); expect(value.startsWith('"') && value.endsWith('"')).toBe(true);
    let decoded = '';
    for (let at = 1; at < value.length - 1; at++) {
      const char = value[at];
      if (char !== '\\') { expect(char).not.toBe('"'); decoded += char; continue; }
      const escaped = value[++at];
      switch (escaped) {
        case 'n': decoded += '\n'; break; case 'r': decoded += '\r'; break; case 't': decoded += '\t'; break;
        case 'b': decoded += '\b'; break; case 's': decoded += ' '; break;
        case '\\': case '"': case "'": decoded += escaped; break;
        default: throw Error('参考读取器遇到未证实转义');
      }
    }
    result[key] = decoded;
  }
  return result;
}

afterEach(() => { vi.unstubAllEnvs(); });
describe('B01原生参数与选项文本纯生成', () => {
  it('固定已注册组合与原生可执行路径，defaults-file/login顺序在普通参数之前', () => {
    const value = valid(), result = dump(value);
    expect(result).toMatchObject({ policy: 'mysql-8.4.11-controlled-tcp-v1', toolId: value.tool.id, defaultsFileToken: value.defaultsFile.token, launch: { executable: 'D:\\Verified Tools\\mysql-8.4.11\\bin\\mysqldump.exe', shell: false, windowsVerbatimArguments: false, env: {}, stdin: 'closed', stdout: 'dump-bytes' } });
    expect(result.launch.argv.slice(0, 5)).toEqual([`--defaults-file=${value.defaultsFile.path}`, '--no-login-paths', '--protocol=TCP', '--host=127.0.0.1', '--port=13384']);
    expect(result.launch.argv).toContain('--plugin-dir=D:\\Verified Tools\\mysql-8.4.11\\lib\\plugin');
    expect(result.launch.argv.some(arg => arg.startsWith('--defaults-extra-file') || arg === '--no-defaults')).toBe(false);
  });
  it('dump明确对象/GTID/统计策略且最后一个选项关闭表锁，不暗中单事务或再次拿锁', () => {
    const value = valid(), argv = dump(value).launch.argv;
    for (const arg of ['--opt', '--quick', '--hex-blob', '--routines', '--events', '--triggers', '--set-gtid-purged=OFF', '--column-statistics=0', '--databases', '--quote-names']) expect(argv).toContain(arg);
    expect(argv.slice(-3)).toEqual(['--skip-lock-tables', '--', value.target.database]);
    expect(argv.indexOf('--opt')).toBeLessThan(argv.indexOf('--skip-lock-tables'));
    for (const forbidden of ['--single-transaction', '--lock-all-tables', '--lock-tables', '--all-databases', '--force', '--tab', '--result-file']) expect(argv.some(arg => arg === forbidden || arg.startsWith(forbidden + '='))).toBe(false);
  });
  it('restore独立使用二进制非交互stdin、不重连、不本地读文件，不增加SQL入口', () => {
    const value = restoreInput(), result = restore(value), argv = result.launch.argv;
    expect(result.launch).toMatchObject({ executable: 'D:\\Verified Tools\\mysql-8.4.11\\bin\\mysql.exe', stdin: 'archive-dump-bytes', stdout: 'bounded-diagnostics', shell: false, env: {} });
    for (const arg of ['--batch', '--binary-mode', '--skip-reconnect', '--local-infile=0', '--skip-auto-rehash', '--skip-system-command', '--commands=OFF', `--database=${value.target.database}`]) expect(argv).toContain(arg);
    expect(argv.some(arg => /^--(?:execute|init-command|force|source|databases|single-transaction|quick)(?:=|$)/u.test(arg))).toBe(false);
    expect(argv).not.toContain('--skip-lock-tables');
    // 8.4.11 mysql.cc只在USE_POPEN（非Windows）编译pager选项；本片不能套用Unix开关。
    expect(argv).not.toContain('--skip-pager');
  });
  it('引号、反斜线、#、空格、CR/LF/tab/backspace及Unicode凭据无损且不能注入配置', () => {
    const value = valid(); value.target.user = '  用户#\'"\\尾 '; value.target.password = '  #"\'\\n\\s\b\t\r\n!include x\n[mysql]\ninit-command=注入被转义 😀  ';
    const text = dump(value).clientOptions.takeText();
    expect(parseClient(text)).toEqual({ user: value.target.user, password: value.target.password });
    expect(text.split('\n')).toHaveLength(4); expect(text).not.toContain('\r'); expect(text).not.toContain('\t');
    expect(text).toContain('\\r\\n!include\\sx\\n[mysql]\\ninit-command=');
    expect(text).toContain('\\\\n\\\\s');
  });
  it('空密码显式编码，不依赖继承的MYSQL_PWD或插件/配置环境', () => {
    vi.stubEnv('MYSQL_PWD', 'SYNTHETIC-parent-secret'); vi.stubEnv('MYSQL_TEST_LOGIN_FILE', 'D:\\untrusted.cnf'); vi.stubEnv('LIBMYSQL_PLUGINS', 'arbitrary');
    const value = valid(); value.target.password = ''; const result = dump(value);
    expect(parseClient(result.clientOptions.takeText()).password).toBe(''); expect(result.launch.env).toEqual({});
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-parent-secret');
  });
  it('敏感文本仅显式取出一次，JSON/inspect/错误均不泄漏合成密码', () => {
    const value = valid(), result = dump(value), secret = value.target.password;
    for (const text of [JSON.stringify(result), inspect(result), inspect(result, { customInspect: false, showHidden: true }), String(result.clientOptions), JSON.stringify(result.launch)]) expect(text).not.toContain(secret);
    expect(result.launch.argv.every(arg => !/^(?:--password|--password[123]|-p)/u.test(arg))).toBe(true);
    expect(parseClient(result.clientOptions.takeText()).password).toBe(secret);
    expect(() => result.clientOptions.takeText()).toThrow('已阻断');
    const hostile = new Proxy({}, { getPrototypeOf() { throw Error(secret); } });
    try { dump(hostile as DatabaseBackupNativeDumpInput); throw Error('应当拒绝'); } catch (error) { expect(String(error)).toContain('已阻断'); expect(String(error)).not.toContain(secret); }
  });
  it.each(['\0', '\x01', '\x0b', '\x0c', '\x1a', '\x1f', '\x7f', '\ud800', '\udfff'])('不可无损/未支持控制值 %j 明确阻断，不截断', bad => {
    for (const field of ['user', 'password'] as const) { const value = valid(); value.target[field] = 'prefix' + bad + 'suffix'; expect(() => dump(value)).toThrow('已阻断'); }
  });
  it('拒绝Maria待核扩展、版本近似和未注册id，不盲用MySQL登录路径开关', () => {
    for (const patch of [{ family: 'mariadb', version: '11.4.13', id: 'mariadb-11.4.13-win32-x64' }, { version: '8.4.12' }, { version: '8.4.11-debug' }, { id: 'mysql-8.4.11-darwin-arm64' }, { family: ['mysql'] }]) {
      const value = valid(); Object.assign(value.tool, patch); expect(() => dump(value)).toThrow('已阻断');
    }
  });
  it('未证TLS/SSH/socket/认证插件/DNS组合与端口均阻断，不能静默降级', () => {
    for (const patch of [{ tls: 'required' }, { tls: true }, { ssh: true }, { transport: 'socket' }, { authPlugin: 'mysql_native_password' }, { host: 'localhost' }, { host: '127.0.0.1 --password=x' }, { host: 'fe80::1%3' }, { port: 0 }, { port: 65536 }, { port: 3306.5 }, { port: NaN }, { port: '3306' }]) {
      const value = valid(); Object.assign(value.target, patch); expect(() => dump(value)).toThrow('已阻断');
    }
    const ipv6 = valid(); ipv6.target.host = '::1'; expect(dump(ipv6).launch.argv).toContain('--host=::1');
  });
  it('路径只接受规范受控本地路径，不归一化、读文件或接受隐式插件替换', () => {
    const paths = ['relative.cnf', 'C:relative.cnf', '\\\\server\\share\\x.cnf', '\\\\?\\D:\\x.cnf', 'D:\\x\\..\\y.cnf', 'D:/x.cnf', 'D:\\x:stream', 'D:\\NUL.cnf', 'D:\\x.\\a.cnf', 'D:\\x\\bad".cnf', 'D:\\x\\a\n.cnf', 'D:\\中文\\x.cnf', 'D:\\' + 'a'.repeat(240)];
    for (const path of paths) { const value = valid(); value.defaultsFile.path = path; expect(() => dump(value)).toThrow('已阻断'); }
    const inside = valid(); inside.defaultsFile.path = inside.tool.directory + '\\bin\\mysql.exe'; expect(() => dump(inside)).toThrow('已阻断');
    expect(() => dump(input())).toThrow('已阻断');
  });
  it('数据库为单一值且不跨库映射；系统库/控制/选项注入/超长标识拒绝', () => {
    for (const database of ['--all-databases', '-x', 'MYSQL', 'information_schema', 'performance_schema', 'sys', 'ndbinfo', 'a\0b', 'a\nb', 'x/y', 'x\\y', 'x.y', 'a'.repeat(65), 'trail ']) {
      const value = valid(); value.target.database = database; expect(() => dump(value)).toThrow('已阻断');
    }
    const value = restoreInput(); value.sourceDatabase = '另一个库'; expect(() => restore(value)).toThrow('已阻断');
    const quoted = valid(); quoted.target.database = '库`名"#;$(test)'; expect(dump(quoted).launch.argv.at(-1)).toBe(quoted.target.database);
  });
  it('多余flags、env、SQL、GETTER和错误锁策略不进入生成器', () => {
    for (const extra of [{ flags: ['--force'] }, { env: { MYSQL_PWD: 'synthetic' } }, { sql: 'DROP DATABASE fixture' }]) expect(() => dump({ ...valid(), ...extra })).toThrow('已阻断');
    const value = valid(); Object.assign(value.target, { initCommand: 'SELECT 1' }); expect(() => dump(value)).toThrow('已阻断');
    const getter = vi.fn(() => 'SYNTHETIC-not-read'), accessor = valid(); Object.defineProperty(accessor.target, 'password', { get: getter, enumerable: true });
    expect(() => dump(accessor)).toThrow('已阻断'); expect(getter).not.toHaveBeenCalled();
    const lock = valid(); Object.assign(lock, { lockStrategy: 'single-transaction' }); expect(() => dump(lock)).toThrow('已阻断');
    expect(Object.isFrozen(dump(valid()).launch.argv)).toBe(true); expect(Object.isFrozen(dump(valid()).launch.env)).toBe(true);
  });
});
