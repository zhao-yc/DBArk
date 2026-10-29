import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertTableFilteredUpdateMultiUiEnvironment, assertTableFilteredUpdateUiEnvironment, bindTableFilteredUpdateMultiUiEnvironment, tableFilteredUpdateMultiUiFixture, tableFilteredUpdateUiFixture, assertTableFilteredUpdateUiProcess } from '../helpers/tableFilteredUpdateUi';

/** 仅构造合成RAM配置，不读实际认证、路径或数据库。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_filteredupdateui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_TABLE_FILTERED_UPDATE_UI_OWNER: 'dbark-table-filtered-update-ui:' + 'a'.repeat(32), DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST: 'D:/isolated/source.json', DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256: 'b'.repeat(64), DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT: 'D:/isolated/output' };
}

/** 执行真实spec；默认/list若加载认证、helper或live，即由RAM哨兵拒绝。 */
function gate(values: NodeJS.ProcessEnv, args: string[] = [], active = false, listing = false, single = false) {
  const source = readFileSync(new URL(single ? '../e2e/table-filtered-update.spec.ts' : '../e2e/table-filtered-update-multi.spec.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key);
    if (listing || !active && !['DBARK_INTEGRATION_ENABLED', single ? 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST' : 'DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST'].includes(key)) throw Error('多字段默认/list读取了实际来源');
    return target[key];
  } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) {
      modules.push(name); if (name === '@playwright/test') return { test: { skip } };
      if (active && name === '../helpers/tableFilteredUpdateUi') return { bindTableFilteredUpdateMultiUiEnvironment };
      if (active && name === './table-filtered-update-live') return { registerTableFilteredUpdateUiTests: register };
      throw Error('多字段关闭门加载了资源模块');
    },
  });
  return { modules, reads, skip, register };
}

describe('多字段正式窗口独立来源及关闭门', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST: 'true' }])('缺精确双门仅声明跳过：%j', values => {
    const result = gate(values); expect(result.skip).toHaveBeenCalledOnce(); expect(result.modules).toEqual(['@playwright/test']);
  });
  it.each(['--list', '--list=true', '--list=false'])('%s先短路，任何环境均不读取', value => {
    const result = gate(environment(), [value], false, true); expect(result.reads).toEqual([]); expect(result.modules).toEqual(['@playwright/test']);
  });
  it('准确新门只注册多字段场景，不能开启原单字段入口', () => {
    const result = gate(environment(), [], true); expect(result.register).toHaveBeenCalledOnce(); expect(result.skip).not.toHaveBeenCalled();
    expect(gate(environment(), [], false, false, true).skip).toHaveBeenCalledOnce();
    const binding = bindTableFilteredUpdateMultiUiEnvironment(() => ({ env: environment(), args: [], platform: 'win32' }));
    expect(binding.mode).toBe('multi'); expect(Object.hasOwn(binding.values, 'DBARK_TABLE_FILTERED_UPDATE_UI_TEST')).toBe(false); binding.assertCurrent();
  });
  it('混合门、错误平台、替代配置及trace均拒绝', () => {
    const env = { ...environment(), DBARK_TABLE_FILTERED_UPDATE_UI_TEST: '1' };
    expect(() => assertTableFilteredUpdateMultiUiEnvironment(env, [], 'win32')).toThrow(); expect(() => assertTableFilteredUpdateUiEnvironment(env, [], 'win32')).toThrow();
    expect(() => assertTableFilteredUpdateMultiUiEnvironment(environment(), [], 'darwin')).toThrow();
    expect(() => assertTableFilteredUpdateMultiUiEnvironment(environment(), ['--trace=on'], 'win32')).toThrow();
    expect(() => assertTableFilteredUpdateMultiUiEnvironment(environment(), ['--config=other.ts'], 'win32')).toThrow();
  });
  it('原配置存在性漂移或门失效后，改回原值也不能复活', () => {
    const env = environment(), binding = bindTableFilteredUpdateMultiUiEnvironment(() => ({ env, args: [], platform: 'win32' }));
    env.DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST = '0'; expect(() => binding.assertCurrent()).toThrow();
    env.DBARK_TABLE_FILTERED_UPDATE_MULTI_UI_TEST = '1'; expect(() => binding.assertCurrent()).toThrow();
  });
  it('四列期望完整覆盖61行、保留另20行，旁列CAS不改其它已提交值', () => {
    const env = environment(), plan = tableFilteredUpdateMultiUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER!), single = tableFilteredUpdateUiFixture(plan.database, plan.marker);
    expect(plan.fillColumns).toEqual(['note', 'amount', 'payload', 'side_note']); expect(plan.assignments[0]).toEqual({ column: 'note', value: null });
    expect(plan.assignments[1]).toEqual({ column: 'amount', value: '987654321098765432.123456' }); expect(plan.assignments[2]).toEqual({ column: 'payload', value: { type: 'binary', base64: 'AP+AJ1w=' } });
    expect(plan.secondAssignments[1].value).toBeNull(); expect(plan.secondAssignments[2].value).toEqual({ type: 'binary', base64: '' });
    expect(plan.expectedAfterFill).toHaveLength(81); expect(plan.expectedAfterFill.slice(61)).toEqual(plan.expectedInitial.slice(61));
    for (let index = 0; index < 61; index++) {
      const filled = plan.expectedAfterFill[index]; expect(filled).toMatchObject({ noteHex: null, amount: '987654321098765432.123456', payloadHex: '00FF80275C', sideHex: Buffer.from("整组中文🚢\n'\\").toString('hex').toUpperCase() });
      expect({ ...filled, noteHex: plan.expectedInitial[index].noteHex, amount: plan.expectedInitial[index].amount, payloadHex: plan.expectedInitial[index].payloadHex, sideHex: plan.expectedInitial[index].sideHex }).toEqual(plan.expectedInitial[index]);
    }
    expect(plan.expectedAfterConflict.slice(1)).toEqual(plan.expectedAfterFill.slice(1)); expect({ ...plan.expectedAfterConflict[0], sideHex: plan.expectedAfterFill[0].sideHex }).toEqual(plan.expectedAfterFill[0]);
    expect(plan.conflict.parameters).toEqual(['Root并发修改', '9007199254740993', "整组中文🚢\n'\\"]); expect(plan.conflict.sql).toContain('SET side_note = ?'); expect(plan.conflict.sql).toContain('AND BINARY side_note = BINARY ?');
    expect(plan.expectedSecondPageIds).not.toContain(plan.conflict.id); expect(plan.creates).toEqual(single.creates); expect(plan.seeds).toEqual(single.seeds);
    expect(single.expectedAfterFill[0].noteHex).not.toBeNull(); expect(single.conflict.sql).toContain('SET note = ?');
  });
});

describe('正式窗口原启动器与主进程关系', () => {
  it('Windows只认准确父子，POSIX只认原PID', () => {
    expect(() => assertTableFilteredUpdateUiProcess({ pid: 11, parent: 10, platform: 'win32' }, 10, 'win32')).not.toThrow();
    expect(() => assertTableFilteredUpdateUiProcess({ pid: 10, parent: 1, platform: 'linux' }, 10, 'linux')).not.toThrow();
  });
  it.each([{ pid: 11, parent: 9, platform: 'win32' }, { pid: 10, parent: 10, platform: 'win32' }, { pid: 11.5, parent: 10, platform: 'win32' }, { pid: 11, parent: 10, platform: 'darwin' }])('拒绝其它父进程或身份：%j', actual => {
    expect(() => assertTableFilteredUpdateUiProcess(actual, 10, 'win32')).toThrow();
  });
  it('没有原句柄或句柄PID无效时不接受实际主进程', () => {
    for (const launcher of [undefined, 0, -1]) expect(() => assertTableFilteredUpdateUiProcess({ pid: 11, parent: 10, platform: 'win32' }, launcher, 'win32')).toThrow();
  });
});
