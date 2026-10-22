import { describe, expect, it } from 'vitest';
import { bindGeneratedColumnTarget, generatedColumnIntegrationGate } from '../helpers/generatedColumnIntegration';

/** 合成身份和密码只测试独立门，不读取实际配置或访问网络。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [generatedColumnIntegrationGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'fixture', DBARK_TEST_PASSWORD: 'synthetic', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

describe('生成列实库专项独立门', () => {
  it('没有本用途显式门时不能借旧用途或实库总开关放行', () => {
    const env = environment(); delete env[generatedColumnIntegrationGate];
    expect(() => bindGeneratedColumnTarget(() => env, 'fixture')).toThrow();
    env.DBARK_DATABASE_DEFAULT_ENCODING_TEST = '1';
    expect(() => bindGeneratedColumnTarget(() => env, 'fixture')).toThrow('同时开启');
  });
  it('复用准确身份与TLS拒绝，并永久阻止配置ABA恢复', () => {
    const env = environment(), binding = bindGeneratedColumnTarget(() => env, 'fixture');
    expect(binding.profile.port).toBe(13384); binding.assertCurrent();
    env[generatedColumnIntegrationGate] = '0'; expect(() => binding.assertCurrent()).toThrow('漂移');
    env[generatedColumnIntegrationGate] = '1'; expect(() => binding.assertCurrent()).toThrow('漂移');
    env.DBARK_TEST_TLS = '1'; expect(() => bindGeneratedColumnTarget(() => env, 'fixture')).toThrow();
  });
});
