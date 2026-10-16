import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const entry = readFileSync(new URL('../e2e/table-truncate.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(entry, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;

/** 执行真实入口的转译结果；require只提供RAM端口，绝不导入live、桌面、观察连接或配置模块。 */
function collect(argv: string[], integration: string, truncate: string) {
  const loaded: string[] = [], environmentReads: string[] = [], skipped = vi.fn(), register = vi.fn();
  const environment = new Proxy({ DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_TRUNCATE_TEST: truncate }, {
    get(values, key: string) { environmentReads.push(key); if (!Object.hasOwn(values, key)) throw Error('入口不得读取额外环境配置：' + key); return values[key as keyof typeof values]; },
  });
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: environment }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip: skipped } };
    loaded.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('收集期间禁止加载实际模块：' + name);
    if (name === './table-truncate-live') return { registerTableTruncateUiTests: register };
    throw Error('不允许实际require：' + name);
  } });
  runInContext(compiled, context); return { loaded, environmentReads, skipped, register };
}

describe('TRUNCATE列表收集先短路（纯RAM，不执行实际模块）', () => {
  for (const flag of ['--list', '--list=json']) {
    it.each(gates)(`${flag} 两门%s/%s不读环境、不加载live，保留原默认关闭身份`, (integration, truncate) => {
      const result = collect([flag], integration, truncate);
      expect(result.environmentReads).toEqual([]); expect(result.loaded).toEqual([]); expect(result.register).not.toHaveBeenCalled();
      expect(result.skipped).toHaveBeenCalledTimes(1); expect(result.skipped).toHaveBeenCalledWith('单表清空正式UI定义默认关闭（员工3实际0）', expect.any(Function));
    });
  }
  it.each(gates)('非收集模式两门%s/%s仍沿原门控，双开才调用RAM注册端口', (integration, truncate) => {
    const result = collect([], integration, truncate), active = integration === '1' && truncate === '1';
    expect(result.loaded).toEqual(active ? ['./table-truncate-live'] : []); expect(result.register).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(result.skipped).toHaveBeenCalledTimes(active ? 0 : 1);
    expect(result.environmentReads.every(key => ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_TRUNCATE_TEST'].includes(key))).toBe(true);
  });
});
