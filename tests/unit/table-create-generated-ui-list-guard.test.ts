import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-create-generated.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 运行真实默认入口的转译产物；RAM require端口不能加载认证、桌面或数据库。 */
function collect(args: string[], integration: string, generated: string) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn();
  const values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_GENERATED_UI: generated };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('默认入口不得读取额外配置'); return target[key as keyof typeof target]; } });
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; loaded.push(name); if (name === './table-create-generated-live') return { registerTableCreateGeneratedUiTests: register }; throw Error('禁止加载实际模块：' + name); } });
  runInContext(compiled, context); return { reads, loaded, skip, register };
}
describe('新表生成列专项默认与列举关闭（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])(`${flag}双门%s/%s不读环境不加载实际模块`, (integration, generated) => { const value = collect([flag], integration, generated); expect(value.reads).toEqual([]); expect(value.loaded).toEqual([]); expect(value.register).not.toHaveBeenCalled(); expect(value.skip).toHaveBeenCalledOnce(); });
  it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])('非列举%s/%s仅双开注册RAM实际端口', (integration, generated) => { const value = collect([], integration, generated), active = integration === '1' && generated === '1'; expect(value.loaded).toEqual(active ? ['./table-create-generated-live'] : []); expect(value.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(value.skip).toHaveBeenCalledTimes(active ? 0 : 1); });
});
