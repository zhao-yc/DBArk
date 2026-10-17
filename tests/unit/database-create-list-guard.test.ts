import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const compiled = ts.transpileModule(readFileSync(new URL('../e2e/database-create.spec.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 真实入口在RAM端口执行，禁止加载实际实跑或配置模块。 */
function collect(argv: string[], integration: string, create: string) {
  const reads: string[] = [], loads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy({ DBARK_INTEGRATION_ENABLED: integration, DBARK_DATABASE_CREATE_UI: create }, { get(values, key: string) { reads.push(key); if (!Object.hasOwn(values, key)) throw Error('收集不得读取额外环境'); return values[key as keyof typeof values]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv, env }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } }; loads.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('收集不得导入实际模块');
    if (name === './database-create-live') return { registerDatabaseCreateUiTests: register }; throw Error('禁止导入其它模块');
  } })); return { reads, loads, skip, register };
}
describe('新建库正式UI双门及收集隔离', () => {
  for (const integration of ['0', '1']) for (const create of ['0', '1']) {
    for (const flag of ['--list', '--list=json']) it(`${flag} 两门${integration}/${create}先短路且零配置读取`, () => {
      const value = collect([flag], integration, create); expect(value.reads).toEqual([]); expect(value.loads).toEqual([]); expect(value.register).not.toHaveBeenCalled(); expect(value.skip).toHaveBeenCalledOnce();
    });
    it(`非列表两门${integration}/${create}只有双开才注册RAM端口`, () => {
      const value = collect([], integration, create), active = integration === '1' && create === '1'; expect(value.loads).toEqual(active ? ['./database-create-live'] : []); expect(value.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(value.skip).toHaveBeenCalledTimes(active ? 0 : 1);
    });
  }
});
