import { expect, it } from 'vitest';
import { sqlSyntaxCheckCommand, sqlSyntaxCheckEnvironment } from '../../scripts/sql-syntax-check-ci.mjs';

it('语法检查离线宿主剥离认证、用户目录、模块注入和其它专项开关', () => {
  const parent = { PATH: 'system-path', DBARK_TEST_PASSWORD: 'do-not-forward', DBARK_USER_DATA: 'private-profile', DBARK_OTHER_TEST: '1', MYSQL_PASSWORD: 'secret', PGUSER: 'user', SSH_CONFIG: 'private', SSH_AUTH_SOCK: 'agent', DATABASE_URL: 'private', DB_PASSWORD: 'secret', NODE_OPTIONS: '--require inject', PLAYWRIGHT_TEST_TIMEOUT: '1' };
  const result = sqlSyntaxCheckEnvironment(parent);
  expect(result.env).toEqual({ PATH: 'system-path', DBARK_SQL_SYNTAX_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '0', PLAYWRIGHT_JSON_OUTPUT_NAME: expect.stringMatching(/[\\/]test-results[\\/]sql-syntax-check[\\/]report\.json$/) });
  expect(result.dropped).toEqual(Object.keys(parent).filter(key => key !== 'PATH').sort()); expect(parent.DBARK_TEST_PASSWORD).toBe('do-not-forward');
});
it('固定整例、单worker、零重试与原trace门，不提供执行路径或期限覆盖', () => {
  expect(sqlSyntaxCheckCommand()).toEqual([expect.stringMatching(/[\\/]node_modules[\\/]@playwright[\\/]test[\\/]cli\.js$/), 'test', 'tests/e2e/sql-syntax-check-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/sql-syntax-check']);
});
