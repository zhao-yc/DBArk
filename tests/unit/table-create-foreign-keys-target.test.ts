import { describe, expect, it } from 'vitest';
import { tableCreateForeignKeysTarget, bindTableCreateForeignKeysTarget } from '../helpers/tableCreateForeignKeysTarget';
/** 全部为合成配置，测试不读取真实环境或凭据。 */
function config(): Record<string, string | undefined> { return { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic-user', DBARK_TEST_PASSWORD: 'synthetic-password', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-2222-3333-4444-555555555555' }; }
describe('复合FK正式目标必须显式绑定', () => {
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_TLS'])('本轮固定%s，helper变化再还原也不能复活', name => {
    const raw = config(), helper = { ...raw }, binding = bindTableCreateForeignKeysTarget(() => raw, helper), original = helper[name]; binding.assertCurrent(); helper[name] = 'changed'; expect(() => binding.assertCurrent()).toThrow('本轮身份'); helper[name] = original; expect(() => binding.assertCurrent()).toThrow('本轮身份');
  });
  it('raw和helper同时换成另一账号不能重绑定，替换raw对象也必须逐字相同', () => {
    let raw = config(); const helper = { ...raw }, binding = bindTableCreateForeignKeysTarget(() => raw, helper); raw = { ...raw }; binding.assertCurrent(); raw.DBARK_TEST_USER = helper.DBARK_TEST_USER = 'other-account'; expect(() => binding.assertCurrent()).toThrow('本轮身份'); expect(binding.target.user).toBe('synthetic-user');
  });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'])('实时raw的%s改为原型回填不能通过旧授权', name => {
    let raw = config(); const binding = bindTableCreateForeignKeysTarget(() => raw, { ...raw }); raw = Object.assign(Object.create({ [name]: raw[name] }), raw); delete raw[name]; expect(() => binding.assertCurrent()).toThrow('本轮身份');
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('缺失%s不能由helper回填', name => { const raw = config(); delete raw[name]; expect(() => tableCreateForeignKeysTarget(raw, config())).toThrow(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_TLS'])('helper的%s不同不能代替原配置', name => { const helper = { ...config(), [name]: 'different' }; expect(() => tableCreateForeignKeysTarget(config(), helper)).toThrow(); });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'])('原型上的%s不能冒充本轮原始值', name => { const raw = Object.assign(Object.create({ [name]: config()[name] }), config()); delete raw[name]; expect(() => tableCreateForeignKeysTarget(raw, config())).toThrow(); });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'])('helper原型上的%s不能补足配置', name => { const raw = config(), helper = Object.assign(Object.create({ [name]: raw[name] }), raw); delete helper[name]; expect(() => tableCreateForeignKeysTarget(raw, helper)).toThrow(); });
  it('账号非字符串不能冒充显式非空账号', () => { for (const value of [undefined, null, 7, {}]) { const raw = { ...config(), DBARK_TEST_USER: value } as unknown as Record<string, string | undefined>; expect(() => tableCreateForeignKeysTarget(raw, config())).toThrow(); } });
  it.each([{ DBARK_TEST_PORT: '13380' }, { DBARK_TEST_HOST: 'localhost' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_TLS: 'false' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_EXPECTED_SERVER_UUID: 'unknown' }])('错误目标准备条件%s拒绝', patch => { const raw = { ...config(), ...patch }; expect(() => tableCreateForeignKeysTarget(raw, raw)).toThrow(); });
  it('显式空密码可用，未提供或非字符串不等于空密码', () => {
    const raw = { ...config(), DBARK_TEST_PASSWORD: '' }; expect(tableCreateForeignKeysTarget(raw, { ...raw }).password).toBe(''); expect(Object.isFrozen(tableCreateForeignKeysTarget(raw, raw))).toBe(true);
    for (const value of [undefined, null, 0, {}]) { const invalid = { ...config(), DBARK_TEST_PASSWORD: value } as Record<string, string | undefined>; expect(() => tableCreateForeignKeysTarget(invalid, config())).toThrow(); }
  });
  it('通用错误不包含原始或helper的账号密码', () => { const raw = config(), helper = { ...raw, DBARK_TEST_USER: 'helper-canary-user', DBARK_TEST_PASSWORD: 'helper-canary-password' }; let message = ''; try { tableCreateForeignKeysTarget(raw, helper); } catch (reason) { message = (reason as Error).message; } expect(message).toContain('不一致'); for (const value of [raw.DBARK_TEST_USER!, raw.DBARK_TEST_PASSWORD!, helper.DBARK_TEST_USER, helper.DBARK_TEST_PASSWORD]) expect(message).not.toContain(value); });
});
