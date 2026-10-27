import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/routine-invocation.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 运行真实入口的RAM端口，任何桌面/驱动/文件/认证导入均不能在门关闭时发生。 */
function collect(args: string[], integration: string | undefined, routine: string | undefined) {
  const reads: string[] = [], imports: string[] = [], skip = vi.fn(), register = vi.fn();
  const values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_ROUTINE_INVOCATION_UI: routine };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('默认入口禁止读取凭据或资源环境'); return target[key as keyof typeof target]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; imports.push(name); if (name === './routine-invocation-live') return { registerRoutineInvocationUi: register }; throw Error('默认入口禁止加载真实模块'); } }));
  return { reads, imports, skip, register };
}

describe('例程原生专项默认与列举短路（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])(`${flag}双门%s/%s零环境读取及零真实导入`, (integration, routine) => {
    const f = collect([flag], integration, routine); expect(f.reads).toEqual([]); expect(f.imports).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled();
  });
  it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])('默认双门%s/%s仅同时显式开启才注册RAM端口', (integration, routine) => {
    const f = collect([], integration, routine), enabled = integration === '1' && routine === '1';
    expect(f.imports).toEqual(enabled ? ['./routine-invocation-live'] : []); expect(f.register).toHaveBeenCalledTimes(enabled ? 1 : 0); expect(f.skip).toHaveBeenCalledTimes(enabled ? 0 : 1);
  });
});
