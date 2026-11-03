import { describe, expect, it } from 'vitest';
import { relationshipLiveCommands, relationshipLiveEnvironment } from '../e2e/relationship-diagram-live-gate';

const environment = () => ({ DBARK_ER_LIVE_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: 'isolated', DBARK_TEST_PASSWORD: '仅RAM合成密码', DBARK_ER_SOURCE_DATABASE: 'dbark_ergraph_a1b2c3d4e5f6_a', DBARK_ER_TARGET_DATABASE: 'dbark_ergraph_a1b2c3d4e5f6_b', DBARK_ER_OWNER: 'a'.repeat(32), DBARK_ER_SERVER_UUID: '11111111-2222-3333-4444-555555555555' });
describe('ER实库读取仅允许Root预置隔离资源', () => {
  it('原工作区只允许空恢复／握手，绝不开放系统对象解析、提交或导航', () => {
    expect(relationshipLiveCommands.filter(command => command.startsWith('workbench.'))).toEqual(['workbench.get', 'workbench.protocolReady', 'workbench.protocolTake']);
    for (const command of ['workbench.save', 'workbench.resolve', 'workbench.protocolResolve', 'workbench.protocolCommit', 'workbench.protocolFinish']) expect(relationshipLiveCommands).not.toContain(command);
  });
  it.each(['win32', 'darwin'])('%s只复制准确环境，不读文件或创建资源', platform => {
    const original = environment(), result = relationshipLiveEnvironment(original, ['--workers=1', '--retries', '0', '--trace=off'], platform); original.DBARK_ER_OWNER = 'changed'; expect(result.owner).toBe('a'.repeat(32)); expect(result.port).toBe(13384); expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([
    ['DBARK_ER_LIVE_NATIVE', '0'], ['DBARK_INTEGRATION_ENABLED', '0'], ['DBARK_TEST_HOST', 'production.invalid'], ['DBARK_TEST_PORT', '3306'], ['DBARK_TEST_PASSWORD', ''],
    ['DBARK_ER_SOURCE_DATABASE', 'normal_database'], ['DBARK_ER_TARGET_DATABASE', 'dbark_ergraph_999999999999_b'], ['DBARK_ER_OWNER', 'a'], ['DBARK_ER_SERVER_UUID', 'unknown'], ['DBARK_TEST_DATABASE', 'other'],
    ['DBARK_USER_DATA', 'user-profile'], ['NODE_PATH', 'injection'], ['SSH_AUTH_SOCK', 'agent'], ['DBARK_SSH_KEY', 'key'], ['PWDEBUG', '1'],
  ])('%s不符在启动前拒绝且错误不泄漏环境值', (key, value) => {
    const env = { ...environment(), [key]: value }; expect(() => relationshipLiveEnvironment(env, [], 'win32')).toThrow('实库门'); try { relationshipLiveEnvironment(env, [], 'win32'); } catch (reason) { if (env.DBARK_TEST_PASSWORD) expect(String(reason)).not.toContain(env.DBARK_TEST_PASSWORD); expect(String(reason)).not.toContain('user-profile'); }
  });
  it.each([['--retries=1'], ['--workers', '2'], ['--repeat-each=2'], ['--timeout', '1000'], ['--trace=on'], ['--config=x'], ['-c', 'x'], ['-cother.js'], ['--project=x']].map(args => ({ args })))('原配置覆盖$args在启动前拒绝', ({ args }) => { expect(() => relationshipLiveEnvironment(environment(), args, 'win32')).toThrow(); });
  it('未知平台和空字段不落到默认目标', () => { expect(() => relationshipLiveEnvironment(environment(), [], 'linux')).toThrow(); expect(() => relationshipLiveEnvironment({}, [], 'win32')).toThrow(); });
  it('非数组命令参数不按字符遍历并落到默认许可', () => { expect(() => relationshipLiveEnvironment(environment(), '--workers=2' as unknown as string[], 'win32')).toThrow(); });
});
