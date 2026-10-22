import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-create-column-encoding.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 运行真实默认入口；所有require仅为RAM记录端口，禁止启动桌面/驱动/读取凭据或清单。 */
function collect(args: string[], integration: string, encoding: string) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn(), values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_COLUMN_ENCODING_UI: encoding };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('默认入口不得读取额外环境'); return target[key as keyof typeof target]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; loaded.push(name); if (name === './table-create-column-encoding-live') return { registerTableCreateColumnEncodingUiTests: register }; throw Error('默认入口禁止加载实际模块'); } })); return { reads, loaded, skip, register };
}
describe('新表列编码原生定义默认与列举短路（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])(`${flag}双门%s/%s零环境读取、零实际模块加载`, (integration, encoding) => { const value = collect([flag], integration, encoding); expect(value.reads).toEqual([]); expect(value.loaded).toEqual([]); expect(value.register).not.toHaveBeenCalled(); expect(value.skip).toHaveBeenCalledOnce(); });
  it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])('非list双门%s/%s只有双开注册RAM端口', (integration, encoding) => { const value = collect([], integration, encoding), active = integration === '1' && encoding === '1'; expect(value.loaded).toEqual(active ? ['./table-create-column-encoding-live'] : []); expect(value.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(value.skip).toHaveBeenCalledTimes(active ? 0 : 1); });
});
