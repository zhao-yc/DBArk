import { describe, expect, it, vi } from 'vitest';
// 只导入运行器策略，不执行原生命令。
// @ts-expect-error 运行器为独立Node入口，无额外声明文件。
import { relationshipDiagramOfflineEnvironment, relationshipDiagramOfflineCommand, runRelationshipDiagramOffline } from '../../scripts/relationship-diagram-ci.mjs';

describe('关系图离线原生CI固定入口', () => {
  it('移除认证、模块注入和旧开关，只报告字段名，不改写父环境', () => {
    const parent = { PATH: 'runtime', DBARK_TEST_PASSWORD: 'private', DBARK_INTEGRATION_ENABLED: '1', MYSQL_PWD: 'private', NODE_PATH: 'injection', NODE_OPTIONS: 'injection', SSH_AUTH_SOCK: 'private', PLAYWRIGHT_JSON_OUTPUT_NAME: 'old', DISPLAY: ':0' };
    const before = { ...parent }, { env, dropped } = relationshipDiagramOfflineEnvironment(parent); expect(parent).toEqual(before);
    expect(env).toMatchObject({ PATH: 'runtime', DISPLAY: ':0', DBARK_INTEGRATION_ENABLED: '0', DBARK_RELATIONSHIP_NATIVE: '1' });
    expect(Object.values(env)).not.toContain('private'); expect(Object.values(env)).not.toContain('injection'); expect(dropped).toContain('DBARK_TEST_PASSWORD'); expect(env.PLAYWRIGHT_JSON_OUTPUT_NAME).toMatch(/[\\/]test-results[\\/]relationship-diagram[\\/]report.json$/);
  });
  it('固定原spec、worker1、零重试和关闭trace，参数覆盖在执行前拒绝', () => {
    expect(relationshipDiagramOfflineCommand().slice(1)).toEqual(['test', 'tests/e2e/relationship-diagram-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/relationship-diagram']);
    const execute = vi.fn(); expect(() => runRelationshipDiagramOffline(['--timeout=1'], execute, {})).toThrow(); expect(execute).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2])('原退出码%s原样保留且仅执行一次', status => {
    const execute = vi.fn(() => ({ status })); expect(runRelationshipDiagramOffline([], execute, {})).toBe(status); expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0]).toHaveLength(3);
  });
  it('缺少原终态或启动异常不当作通过，也不自动重试', () => {
    const execute = vi.fn(() => ({ status: null, signal: 'SIGTERM' })); expect(() => runRelationshipDiagramOffline([], execute, {})).toThrow('终态'); expect(execute).toHaveBeenCalledOnce();
    const failed = vi.fn(() => ({ error: Error('启动失败') })); expect(() => runRelationshipDiagramOffline([], failed, {})).toThrow('启动失败'); expect(failed).toHaveBeenCalledOnce();
  });
});
