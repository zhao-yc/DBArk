import { describe, expect, it } from 'vitest';
import { assertMariaCreateFacts, bindTableCreateMariaTarget, mariaCreateKeys } from '../helpers/tableCreateMariaTarget';

describe.each(['10.11.19', '11.4.13'] as const)('%s的Maria事实反例（仅RAM）', version => {
  const raw = () => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: version === '10.11.19' ? '13310' : '13311', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: '合成Maria', DBARK_TEST_EXPECTED_SERVER_ID: '27' });
  const target = () => bindTableCreateMariaTarget(version, raw, raw()).target;
  const facts = () => ({ version: version + '-MariaDB-ubu2404', os: 'Linux', names: 0, hostname: '合成Maria', port: Number(raw().DBARK_TEST_PORT), serverId: 27, mode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', autocommit: 1, innodbStrict: 1, quoteShowCreate: 1 });
  it('真实Maria发行后缀及兼容前缀可读，结果只是RAM指纹', () => { expect(assertMariaCreateFacts([facts()], target())).toBeTypeOf('string'); expect(assertMariaCreateFacts([{ ...facts(), version: '5.5.5-' + facts().version }], target())).toBeTypeOf('string'); });
  it.each([{ version: '8.4.11' }, { version: '10.11.19' }, { version: '11.4.12-MariaDB' }, { version: '10.11.19-MariaDB suffix' }, { mode: 'FORGED' }, { mode: 'ORACLE' }, { mode: 'ANSI' }, { mode: '' }, { mode: 'STRICT_TRANS_TABLES,,NO_ENGINE_SUBSTITUTION' }, { autocommit: 0 }, { innodbStrict: undefined }, { quoteShowCreate: 0 }, { names: null }, { serverId: '027' }, { hostname: '其他实例' }, { port: 3306 }])('事实%s不完整或非准确目标时拒绝', patch => { expect(() => assertMariaCreateFacts([{ ...facts(), ...patch }], target())).toThrow(); });
  it.each(['version', 'hostname', 'serverId', 'mode'])('继承的%s不能作为事实', key => { const row: Record<string, unknown> = facts(); const value = row[key]; delete row[key]; Object.setPrototypeOf(row, { [key]: value }); expect(() => assertMariaCreateFacts([row], target())).toThrow(); });
  it.each([[], [1], [null], [{}, {}], null])('未知结果形状%s拒绝', rows => { expect(() => assertMariaCreateFacts(rows, target())).toThrow(); });
  it.each(mariaCreateKeys)('原始%s缺失不能从helper或原型回填', key => { const values = raw(); const current: Record<string, string | undefined> = { ...values }; delete current[key]; Object.setPrototypeOf(current, { [key]: values[key] }); expect(() => bindTableCreateMariaTarget(version, () => current, values)).toThrow(); });
  it('空密码合法但注册后双份ABA永久失效，恢复不能放开', () => { const a = raw(), b = { ...a }, binding = bindTableCreateMariaTarget(version, () => a, b); expect(binding.target.password).toBe(''); a.DBARK_TEST_PASSWORD = b.DBARK_TEST_PASSWORD = '变化'; expect(() => binding.assertCurrent()).toThrow(); a.DBARK_TEST_PASSWORD = b.DBARK_TEST_PASSWORD = ''; expect(() => binding.assertCurrent()).toThrow(); });
});
