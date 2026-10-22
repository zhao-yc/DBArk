import { describe, expect, it } from 'vitest';
import { bindGeneratedExpressionTarget, generatedExpressionIntegrationGate } from '../helpers/generatedExpressionIntegration';

/** 合成凭据只验证门禁，不读文件、导入Engine或连接网络。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [generatedExpressionIntegrationGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'fixture', DBARK_TEST_PASSWORD: 'synthetic', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

describe('已有生成表达式修改独立实库门', () => {
  it('总开关不能替代本用途，也不能混用新增或编码用途', () => {
    const raw = environment(); delete raw[generatedExpressionIntegrationGate];
    expect(() => bindGeneratedExpressionTarget(() => raw, 'fixture')).toThrow();
    for (const key of ['DBARK_GENERATED_COLUMN_TEST', 'DBARK_DATABASE_DEFAULT_ENCODING_TEST']) {
      const mixed = { ...environment(), [key]: '1' };
      expect(() => bindGeneratedExpressionTarget(() => mixed, 'fixture')).toThrow('同时开启');
    }
  });
  it('配置漂移永久停止，恢复原值也不能复活', () => {
    const raw = environment(), binding = bindGeneratedExpressionTarget(() => raw, 'fixture');
    expect(binding.profile.port).toBe(13384); binding.assertCurrent();
    raw[generatedExpressionIntegrationGate] = '0'; expect(() => binding.assertCurrent()).toThrow('漂移');
    raw[generatedExpressionIntegrationGate] = '1'; expect(() => binding.assertCurrent()).toThrow('漂移');
  });
  it('严格TLS端口、准确身份和凭据仍必须完整显式提供', () => {
    for (const values of [{ DBARK_TEST_PORT: '3306' }, { DBARK_TEST_PORT: '13484' }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { DBARK_TEST_USER: '' }, { NODE_OPTIONS: '--inspect' }]) {
      const raw = { ...environment(), ...values };
      expect(() => bindGeneratedExpressionTarget(() => raw, 'fixture')).toThrow();
    }
  });
});
