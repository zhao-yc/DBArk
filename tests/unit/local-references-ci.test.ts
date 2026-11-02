import { expect, it } from 'vitest';
import { localReferencesCommand, localReferencesEnvironment } from '../../scripts/local-references-ci.mjs';

it('离线运行器移除所有注入和认证字段，仅保留独占开关及固定报告位置', () => {
  const parent = { PATH: 'system-path', DBARK_TEST_PASSWORD: 'do-not-forward', DBARK_USER_DATA: 'user', DBARK_EXECUTABLE_PATH: 'installed', MYSQL_PASSWORD: 'secret', PGUSER: 'user', SSH_AUTH_SOCK: 'agent', NODE_OPTIONS: '--require inject', PLAYWRIGHT_TEST_TIMEOUT: '1' };
  const result = localReferencesEnvironment(parent);
  expect(result.env).toEqual({ PATH: 'system-path', DBARK_LOCAL_REFERENCES_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '0', PLAYWRIGHT_JSON_OUTPUT_NAME: expect.stringMatching(/[\\/]test-results[\\/]local-references[\\/]report\.json$/) });
  expect(result.dropped).toEqual(Object.keys(parent).filter(key => key !== 'PATH').sort()); expect(parent.DBARK_TEST_PASSWORD).toBe('do-not-forward');
});
it('固定完整用例和原资源门，不开放过滤、超时或任意路径', () => {
  expect(localReferencesCommand()).toEqual([expect.stringMatching(/[\\/]node_modules[\\/]@playwright[\\/]test[\\/]cli\.js$/), 'test', 'tests/e2e/local-references-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/local-references']);
});
