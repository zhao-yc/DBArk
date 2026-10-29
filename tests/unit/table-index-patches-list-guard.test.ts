import { sidebarMenuRegistrationPort, navigationMenuRegistrationPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-index-patches.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;

/** 执行正式入口的真实转译结果；只提供RAM注册端口，禁止导入实际桌面、数据库及配置。 */
function collect(argv: string[], integration: string, indexes: string) {
  const loads: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy({ DBARK_INTEGRATION_ENABLED: integration, DBARK_INDEX_PATCH_UI: indexes }, {
    get(values, key: string) { reads.push(key); if (!Object.hasOwn(values, key)) throw Error('收集入口不得读取额外环境：' + key); return values[key as keyof typeof values]; },
  });
  runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } };
    loads.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('列表收集不得导入实跑模块：' + name);
    if (name === './table-index-patches-live') return { registerTableIndexPatchUiTests: register };
    throw Error('不得导入其它模块：' + name);
  } }));
  return { loads, reads, skip, register };
}

describe('既有索引UI回归的双门和列表短路', () => {
  for (const flag of ['--list', '--list=json']) {
    it.each(gates)(`${flag} 两门%s/%s先短路，不读环境、不加载实跑`, (integration, indexes) => {
      const result = collect([flag], integration, indexes);
      expect(result.reads).toEqual([]); expect(result.loads).toEqual([]); expect(result.register).not.toHaveBeenCalled();
      expect(result.skip).toHaveBeenCalledOnce(); expect(result.skip).toHaveBeenCalledWith('索引差异正式UI默认关闭（含改名准备，实际0）', expect.any(Function));
    });
  }
  it.each(gates)('非列表两门%s/%s仅双开时调用RAM注册，不启动真实依赖', (integration, indexes) => {
    const result = collect([], integration, indexes), active = integration === '1' && indexes === '1';
    expect(result.loads).toEqual(active ? ['./table-index-patches-live'] : []); expect(result.register).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(result.skip).toHaveBeenCalledTimes(active ? 0 : 1);
    expect(result.reads.every(key => ['DBARK_INTEGRATION_ENABLED', 'DBARK_INDEX_PATCH_UI'].includes(key))).toBe(true);
  });

  it('延迟模块保留原七项并补一项并发改名，RAM收集不执行钩子或用例体', () => {
    const live = readFileSync(new URL('../e2e/table-index-patches-live.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(live, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const titles: string[] = [], hooks: Function[] = [], targetCheck = vi.fn();
    const fakeTest = Object.assign((title: string, _body: Function) => { titles.push(title); }, {
      use: vi.fn(), setTimeout: vi.fn(), beforeEach: (body: Function) => hooks.push(body), describe: (_title: string, body: () => void) => body(),
    });
    const env = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384' };
    const exports: { registerTableIndexPatchUiTests?: () => void } = {};
    runInContext(output, createContext({ exports, process: { env }, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRegistrationPort;
    if (name === './navigation-menu') return navigationMenuRegistrationPort;
      if (name === './desktop-fixture') return { test: fakeTest };
      if (name === './live-helpers') return { environment: { ...env } };
      if (name === '../helpers/tableDefaultEncodingTarget') return { assertDefaultEncodingLiveTarget: targetCheck };
      if (name === '../../src/renderer/locales/indexPatches.zh-CN') return { indexPatchZh: {} };
      throw Error('RAM收集不允许实际导入：' + name);
    } }));
    exports.registerTableIndexPatchUiTests!();
    expect(targetCheck).toHaveBeenCalledOnce(); expect(hooks).toHaveLength(1);
    expect(titles).toEqual([
      '对象树和表页两入口、只读预览零 DDL、双击只改名一次',
      '新增复合键支持列引用、清空可选前缀及移动顺序',
      '同目标数据草稿阻止索引入口，草稿内容保留',
      '删除主键与唯一键集中确认，完成后真实表页重新判断只读',
      '真实重复值失败消费一次性预览，不重放并使目标页过期',
      '真实锁阻塞时取消等待服务器终态和清理，原索引不丢失',
      '未保存的索引行输入也参与应用退出草稿保护',
      '改名预览后外部结构变化拒绝旧令牌，保留外部修改与全部数据且不重放',
    ]);
  });
});
