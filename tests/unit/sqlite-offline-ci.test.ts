import { describe, expect, it } from 'vitest';

/** 只导入纯环境策略，不启动CLI、桌面、网络、SQLite或认证端口。 */
const { sqliteOfflineEnvironment, sqliteOfflineCommand } = await import(new URL('../../scripts/sqlite-workspace-ci.mjs', import.meta.url).href);
describe('SQLite独立源码CI的原生门与环境隔离', () => {
  it('移除runner及父任务数据库/SSH/注入环境，只向固定源码子进程设置显式离线门', () => {
    const parent = { PATH: '原系统路径', SystemRoot: '系统目录', DISPLAY: ':0', CI: 'true', PGPASSWORD: '合成PG秘密', PGUSER: '预装用户', PGHOST: '不允许的主机', SSH_AUTH_SOCK: '原代理', SSH_AGENT_PID: '原代理PID', DBARK_TEST_PASSWORD: '合成测试秘密', DBARK_EXECUTABLE_PATH: '原客户端', DBARK_USER_DATA: '原用户资料', DBARK_DEV_URL: '原开发页面', DBARK_INTEGRATION_ENABLED: '1', DBARK_SQLITE_WORKSPACE_NATIVE_TEST: '0', MYSQL_HOST: '原库', MARIADB_PORT: '3306', POSTGRES_URL: '原库', DATABASE_URL: '原连接', NODE_OPTIONS: '--require 原模块', NODE_PATH: '原模块路径', ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: '原输出', PLAYWRIGHT_TRACE: 'on' };
    const result = sqliteOfflineEnvironment(parent, 'workspace');
    expect(parent.PGPASSWORD).toBe('合成PG秘密'); expect(result.env).toMatchObject({ PATH: parent.PATH, SystemRoot: parent.SystemRoot, DISPLAY: parent.DISPLAY, CI: 'true', DBARK_INTEGRATION_ENABLED: '0', DBARK_SQLITE_WORKSPACE_NATIVE_TEST: '1' });
    for (const key of Object.keys(parent).filter(key => !['PATH', 'SystemRoot', 'DISPLAY', 'CI', 'DBARK_INTEGRATION_ENABLED', 'DBARK_SQLITE_WORKSPACE_NATIVE_TEST', 'PLAYWRIGHT_JSON_OUTPUT_NAME'].includes(key))) expect(result.env).not.toHaveProperty(key);
    expect(result.env.PLAYWRIGHT_JSON_OUTPUT_NAME.replaceAll('\\', '/')).toMatch(/\/test-results\/sqlite-workspace\/report\.json$/);
    expect(result.dropped).toContain('PGPASSWORD'); expect(JSON.stringify(result)).not.toContain('合成PG秘密');
  });
  it.each([
    ['workspace', 'sqlite-workspace-native.spec.ts', 'sqlite-workspace', 'DBARK_SQLITE_WORKSPACE_NATIVE_TEST'],
    ['table', 'sqlite-table-browse-native.spec.ts', 'sqlite-table-browse', 'DBARK_SQLITE_TABLE_BROWSE_NATIVE_TEST'],
    ['export', 'sqlite-table-export-native.spec.ts', 'sqlite-table-export', 'DBARK_SQLITE_TABLE_EXPORT_NATIVE_TEST']
  ])('%s仅发固定spec、单worker、零重试、trace关闭；不覆盖原120秒或提供认证参数', (kind, spec, output, gate) => {
    const args: string[] = sqliteOfflineCommand(kind); expect(args).toContain('--workers=1'); expect(args).toContain('--retries=0'); expect(args).toContain('--trace=off'); expect(args).toContain('--reporter=list,json');
    expect(args.some(value => /timeout|password|executable-path|grep|repeat-each/.test(value))).toBe(false);
    expect(args).toContain('tests/e2e/' + spec); expect(args).toContain('--output=test-results/' + output);
    const { env } = sqliteOfflineEnvironment({ DBARK_SQLITE_WORKSPACE_NATIVE_TEST: '1', DBARK_SQLITE_TABLE_BROWSE_NATIVE_TEST: '1', DBARK_SQLITE_TABLE_EXPORT_NATIVE_TEST: '1' }, kind); expect(env.DBARK_INTEGRATION_ENABLED).toBe('0'); expect(env[gate]).toBe('1');
    expect(Object.keys(env).filter(key => key.endsWith('_NATIVE_TEST'))).toEqual([gate]);
    expect(env.PLAYWRIGHT_JSON_OUTPUT_NAME.replaceAll('\\', '/')).toContain('/test-results/' + output + '/report.json');
  });
  it('未知类型和路径不能改写固定专项入口', () => { for (const value of ['installed', '../外部', '', '__proto__']) { expect(() => sqliteOfflineCommand(value)).toThrow(); expect(() => sqliteOfflineEnvironment({}, value)).toThrow(); } });
});
