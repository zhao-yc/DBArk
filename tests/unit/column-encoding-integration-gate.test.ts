import { describe, expect, it } from 'vitest';
import { bindColumnEncodingTarget, columnEncodingIntegrationGate } from '../helpers/columnEncodingIntegration';

/** RAM中的显式目标只检验双门，不载入Engine、文件、网络或真实认证。 */
function config(): Record<string, string | undefined> {
  return {
    DBARK_INTEGRATION_ENABLED: '1', [columnEncodingIntegrationGate]: '1',
    DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0',
    DBARK_TEST_USER: 'ram', DBARK_TEST_PASSWORD: '',
    DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'server-200-ram', DBARK_TEST_EXPECTED_SERVER_ID: '1',
    DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '12345678-1234-1234-1234-123456789abc',
  };
}

describe('列字符集实库独立双门和配置漂移', () => {
  it('只绑定明确目标并保留显式空密码，不补认证', () => {
    const env = config(), binding = bindColumnEncodingTarget(() => env, 'ram');
    expect(binding.profile).toMatchObject({ host: '192.168.31.200', port: 13384, password: '' });
    expect(Object.isFrozen(binding.profile)).toBe(true); binding.assertCurrent();
  });
  it.each(Object.keys(config()))('缺少%s禁止绑定', key => {
    const env = config(); delete env[key]; expect(() => bindColumnEncodingTarget(() => env, 'ram')).toThrow();
  });
  it.each(['DBARK_INTEGRATION_ENABLED', columnEncodingIntegrationGate])('总门和专项门%s均须显式为1', key => {
    for (const value of ['0', '2', '', undefined]) {
      const env = { ...config(), [key]: value }; expect(() => bindColumnEncodingTarget(() => env, 'ram')).toThrow();
    }
  });
  it.each([
    ['13357', 'mysql', '5.7.44'], ['13380', 'mysql', '8.0.46'], ['13384', 'mysql', '8.4.11'],
    ['13310', 'mariadb', '10.11.19'], ['13311', 'mariadb', '11.4.13'], ['13484', 'mysql', '8.4.11'],
  ])('端口%s沿用真实身份合同，不因旧版预拒', (port, dialect, version) => {
    const env = { ...config(), DBARK_TEST_PORT: port, DBARK_TEST_TLS: port === '13484' ? '1' : '0', ...(port === '13484' ? { DBARK_TEST_CA: 'ram-ca.pem' } : {}) };
    const binding = bindColumnEncodingTarget(() => env, 'ram');
    expect(binding.profile.port).toBe(Number(port)); expect(binding.dialect).toBe(dialect); expect(binding.version).toBe(version);
    expect(binding.profile.tls?.rejectUnauthorized).toBe(port === '13484' ? true : undefined);
  });
  it('拒绝跨用途门、任意端口和缺失严格TLS证据', () => {
    for (const value of ['1', '0', undefined]) expect(() => bindColumnEncodingTarget(() => ({ ...config(), DBARK_DATABASE_DEFAULT_ENCODING_TEST: value }), 'ram')).toThrow();
    expect(() => bindColumnEncodingTarget(() => ({ ...config(), DBARK_TEST_PORT: '3306' }), 'ram')).toThrow();
    expect(() => bindColumnEncodingTarget(() => ({ ...config(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1' }), 'ram')).toThrow();
    expect(() => bindColumnEncodingTarget(() => ({ ...config(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '0', DBARK_TEST_CA: 'ram-ca.pem' }), 'ram')).toThrow();
  });
  it.each(['DBARK_TEST_SSH', 'DBARK_TEST_CERT', 'DBARK_TEST_KEY', 'DBARK_TEST_DATABASE', 'NODE_OPTIONS'])('拒绝额外旁路%s', key => {
    expect(() => bindColumnEncodingTarget(() => ({ ...config(), [key]: 'extra' }), 'ram')).toThrow();
  });
  it.each(['DBARK_TEST_HOST', columnEncodingIntegrationGate, 'DBARK_INTEGRATION_ENABLED'])('配置%s漂移后恢复也不能复活', key => {
    const env = config(), initial = env[key], binding = bindColumnEncodingTarget(() => env, 'ram');
    env[key] = 'other'; expect(binding.assertCurrent).toThrow(); env[key] = initial; expect(binding.assertCurrent).toThrow();
  });
});
