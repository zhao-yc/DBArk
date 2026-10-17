import { describe, expect, it } from 'vitest';
import { tableCopyStructureTarget, type TableCopyStructureTargetKey } from '../helpers/tableCopyStructureTarget';

/** 合成UUID与显式环境，仅测试纯目标合同，不读取真实环境或凭据。 */
function config(port = '13380') { return { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: port, DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: 'synthetic-password', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-2222-3333-4444-555555555555' }; }
describe('8.0未来正式例目标仅由Root显式绑定', () => {
  it.each([['mysql80', '13380', '8.0.46'], ['mysql84', '13384', '8.4.11']] as const)('%s独立绑定准确端口及版本', (key, port, version) => {
    const raw = config(port), result = tableCopyStructureTarget(key, raw, raw); expect(result.port).toBe(Number(port)); expect(Object.isFrozen(result)).toBe(true); expect(result.versionPattern.test(version)).toBe(true); expect(result.versionPattern.test(key === 'mysql80' ? '8.4.11' : '8.0.46')).toBe(false);
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'] as const)('缺少显式%s不能沿helper默认值触碰服务器', name => {
    const helper = config(), raw: Record<string, string | undefined> = { ...helper }; delete raw[name]; expect(() => tableCopyStructureTarget('mysql80', raw, helper)).toThrow();
  });
  it.each([{ DBARK_TEST_PORT: '13384' }, { DBARK_TEST_HOST: 'localhost' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_TLS: 'true' }, { DBARK_TEST_TLS: '' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_EXPECTED_SERVER_UUID: 'unknown' }])('不符合限定条件%s拒绝', patch => {
    const raw = { ...config(), ...patch }; expect(() => tableCopyStructureTarget('mysql80', raw, raw)).toThrow();
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'] as const)('原始与helper的%s不一致拒绝', name => {
    const raw = config(), helper = { ...raw, [name]: 'different' }; expect(() => tableCopyStructureTarget('mysql80', raw, helper)).toThrow('不一致');
  });
  it.each(['unknown', '__proto__', 'constructor'])('未知版本键%s不得命中原型', key => expect(() => tableCopyStructureTarget(key as TableCopyStructureTargetKey, config(), config())).toThrow('未准备'));
  it('未指定TLS且helper也未指定时才允许明确的明文入口', () => {
    const raw: Record<string, string | undefined> = config(); delete raw.DBARK_TEST_TLS; expect(tableCopyStructureTarget('mysql80', raw, raw).port).toBe(13380); expect(() => tableCopyStructureTarget('mysql80', raw, config())).toThrow('不一致');
  });
  it.each([['mysql80', '13380'], ['mysql84', '13384']] as const)('%s账号及密码逐字显式绑定，允许空密码', (key, port) => {
    for (const password of ['', 'synthetic-password']) { const raw = { ...config(port), DBARK_TEST_PASSWORD: password }; expect(tableCopyStructureTarget(key, raw, { ...raw }).port).toBe(Number(port)); }
  });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'] as const)('raw原型继承的%s不能冒充显式提供', name => {
    const helper = config(), raw = Object.assign(Object.create({ [name]: helper[name] }), helper); delete raw[name]; expect(() => tableCopyStructureTarget('mysql80', raw, helper)).toThrow();
  });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'] as const)('helper原型继承的%s不能补足实际配置', name => {
    const raw = config(), helper = Object.assign(Object.create({ [name]: raw[name] }), raw); delete helper[name]; expect(() => tableCopyStructureTarget('mysql80', raw, helper)).toThrow();
  });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'] as const)('raw的%s非字符串或显式undefined均拒绝，不用helper回填', name => {
    for (const value of [undefined, null, 0, {}]) { const raw = { ...config(), [name]: value } as unknown as Record<string, string | undefined>; expect(() => tableCopyStructureTarget('mysql80', raw, config())).toThrow(); }
  });
  it('空账号即使helper有已有账号也拒绝，不修剪或重写合法账号', () => {
    expect(() => tableCopyStructureTarget('mysql80', { ...config(), DBARK_TEST_USER: '' }, config())).toThrow(); const raw = { ...config(), DBARK_TEST_USER: ' synthetic ' }; expect(tableCopyStructureTarget('mysql80', raw, { ...raw }).port).toBe(13380);
  });
  it('凭据错误仅返回通用分类，错误不包含任一账号或密码值', () => {
    const raw = { ...config(), DBARK_TEST_USER: 'raw-user-canary', DBARK_TEST_PASSWORD: 'raw-password-canary' }, helper = { ...raw, DBARK_TEST_USER: 'helper-user-canary', DBARK_TEST_PASSWORD: 'helper-password-canary' }; let message = '';
    try { tableCopyStructureTarget('mysql80', raw, helper); } catch (reason) { message = (reason as Error).message; }
    expect(message).toContain('不一致'); for (const value of [raw.DBARK_TEST_USER, raw.DBARK_TEST_PASSWORD, helper.DBARK_TEST_USER, helper.DBARK_TEST_PASSWORD]) expect(message).not.toContain(value);
  });
});
