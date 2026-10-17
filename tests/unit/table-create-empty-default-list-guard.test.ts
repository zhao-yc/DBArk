import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-create-empty-default.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 执行正式入口转译结果，RAM require与env代理拒绝认证和桌面模块；不复制入口逻辑。 */
function collect(argv: string[], integration: string, enabled: string) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn();
  const values: Record<string, string> = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI: enabled };
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('不得读取认证配置：' + key); return target[key]; } }) }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } };
    loaded.push(name); if (name === './table-create-empty-default-live' && !argv.some(flag => flag.startsWith('--list'))) return { registerTableCreateEmptyDefaultUiTests: register }; throw Error('禁止导入实际模块：' + name);
  } });
  runInContext(compiled, context); return { reads, loaded, skip, register };
}
describe('空串正式入口默认与list均先短路', () => {
  const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag} 两门%s/%s零认证读取及live导入`, (integration, enabled) => {
    const f = collect([flag], integration, enabled); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]); expect(f.skip).toHaveBeenCalledTimes(1); expect(f.register).not.toHaveBeenCalled();
  });
  it.each(gates)('非list两门%s/%s只有双开才调用RAM注册端口', (integration, enabled) => {
    const f = collect([], integration, enabled), active = integration === '1' && enabled === '1'; expect(f.loaded).toEqual(active ? ['./table-create-empty-default-live'] : []); expect(f.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(f.skip).toHaveBeenCalledTimes(active ? 0 : 1);
  });
});
