import { expect, it } from 'vitest';
import { win32 } from 'node:path';
import { bindGeneratedColumnUi, generatedColumnUiUuid } from '../helpers/generatedColumnUi';

/** RAM使用显式Windows路径，不读取本机凭据、输出或清单，也不依赖当前平台/cwd。 */
function environment(): NodeJS.ProcessEnv {
  return {
    DBARK_INTEGRATION_ENABLED: '1', DBARK_GENERATED_COLUMN_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic-only', DBARK_TEST_PASSWORD: 'synthetic-not-a-real-password', DBARK_TEST_EXPECTED_SERVER_UUID: generatedColumnUiUuid,
    DBARK_GENERATED_COLUMN_OUTPUT: win32.resolve('D:\\DBArk', '.cache', 'dbark-generated-column-' + 'a'.repeat(32)), DBARK_GENERATED_COLUMN_MANIFEST: win32.resolve('D:\\DBArk', '.cache', 'synthetic-manifest.json'), DBARK_GENERATED_COLUMN_MANIFEST_SHA256: 'b'.repeat(64),
  };
}
function bind(env: NodeJS.ProcessEnv, args: string[] = [], platform = 'win32') { return bindGeneratedColumnUi(() => ({ env, platform, args })); }

it('准确11键固定Windows独占路径；RAM中不加载或探测任何清单、文件与数据库', () => {
  const env = environment(), owner = bind(env); expect(Object.keys(env)).toHaveLength(11); expect(owner.target.port).toBe(13384); expect(owner.target.uuid).toBe(generatedColumnUiUuid); expect(Object.isFrozen(owner.target)).toBe(true); expect(win32.isAbsolute(owner.target.output)).toBe(true); expect(() => owner.assertCurrent()).not.toThrow();
});

it.each(Object.keys(environment()))('缺少必需原配置键%s时拒绝登记', key => { const env = environment(); delete env[key]; expect(() => bind(env)).toThrow(); });

it.each(['dbark_generated_column_ui', 'Dbark_TEST_USER', 'DBARK_DATABASE_DEFAULT_ENCODING_UI', 'DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('额外门或配置别名%s即使为空也拒绝', key => { const env = environment(); env[key] = ''; expect(() => bind(env)).toThrow(); });

it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PASSWORD', 'DBARK_GENERATED_COLUMN_MANIFEST'])('配置getter%s不能用读取认证值冒充固定描述符', key => { const env = environment(); let reads = 0; Object.defineProperty(env, key, { enumerable: true, configurable: true, get() { reads++; return '不得读取'; } }); expect(() => bind(env)).toThrow(); expect(reads).toBe(0); });

it.each([
  ['DBARK_INTEGRATION_ENABLED', '0'], ['DBARK_GENERATED_COLUMN_UI', '0'], ['DBARK_TEST_HOST', 'deve-server.yinzon.com'], ['DBARK_TEST_HOST', '127.0.0.1'], ['DBARK_TEST_PORT', '13380'], ['DBARK_TEST_TLS', '1'], ['DBARK_TEST_USER', ' '], ['DBARK_TEST_EXPECTED_SERVER_UUID', 'another-server'],
  ['DBARK_GENERATED_COLUMN_OUTPUT', 'relative\\dbark-generated-column-' + 'a'.repeat(32)], ['DBARK_GENERATED_COLUMN_OUTPUT', '/tmp/dbark-generated-column-' + 'a'.repeat(32)], ['DBARK_GENERATED_COLUMN_OUTPUT', 'D:\\'], ['DBARK_GENERATED_COLUMN_OUTPUT', 'D:\\DBArk\\dbark-generated-column-short'], ['DBARK_GENERATED_COLUMN_OUTPUT', 'D:\\DBArk\\sub\\..\\dbark-generated-column-' + 'a'.repeat(32)],
  ['DBARK_GENERATED_COLUMN_MANIFEST', 'manifest.json'], ['DBARK_GENERATED_COLUMN_MANIFEST', '/tmp/manifest.json'], ['DBARK_GENERATED_COLUMN_MANIFEST', 'D:\\DBArk\\sub\\..\\manifest.json'], ['DBARK_GENERATED_COLUMN_MANIFEST_SHA256', ''], ['DBARK_GENERATED_COLUMN_MANIFEST_SHA256', 'B'.repeat(64)],
])('原配置%s=%s不能替代准确目标/身份', (key, value) => { const env = environment(); env[key] = value; expect(() => bind(env)).toThrow(); });

it.each(['linux', 'darwin', 'Win32'])('本轮平台%s不能借Windows门运行', platform => { expect(() => bind(environment(), [], platform)).toThrow(); });

it.each([['--config', 'other.ts'], ['-c', 'other.ts'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug'], ['--trace', 'on'], ['--trace=on']])('替换原运行参数%j被拒绝', (...args) => { expect(() => bind(environment(), args)).toThrow(); });

it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PASSWORD', 'DBARK_GENERATED_COLUMN_MANIFEST_SHA256', 'DBARK_GENERATED_COLUMN_OUTPUT'])('已捕获%s改变并恢复后仍永久停链', key => { const env = environment(), owner = bind(env), original = env[key]; env[key] = 'changed'; expect(() => owner.assertCurrent()).toThrow(); env[key] = original; expect(() => owner.assertCurrent()).toThrow(); });

it('原参数/平台或描述符的ABA不得复活；签名不包含无关非认证环境值', () => {
  const env = environment(), args = ['--trace=off']; let platform = 'win32'; const owner = bindGeneratedColumnUi(() => ({ env, platform, args })); env.UNRELATED_SYNTHETIC = '不同'; expect(() => owner.assertCurrent()).not.toThrow(); args.push('--ui'); expect(() => owner.assertCurrent()).toThrow(); args.pop(); expect(() => owner.assertCurrent()).toThrow();
  const next = bindGeneratedColumnUi(() => ({ env, platform, args })); platform = 'linux'; expect(() => next.assertCurrent()).toThrow(); platform = 'win32'; expect(() => next.assertCurrent()).toThrow();
  const descriptorOwner = bind(env), original = env.DBARK_TEST_USER; Object.defineProperty(env, 'DBARK_TEST_USER', { enumerable: true, configurable: true, get: () => original }); expect(() => descriptorOwner.assertCurrent()).toThrow(); Object.defineProperty(env, 'DBARK_TEST_USER', { value: original, enumerable: true, configurable: true, writable: true }); expect(() => descriptorOwner.assertCurrent()).toThrow();
});
