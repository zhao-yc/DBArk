import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-checks.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 只执行真实注册门的RAM边界；关闭时不允许桌面/驱动/资源或额外环境输入。 */
function collect(args: string[], integration: string | undefined, native: string | undefined) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn(), values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CHECKS_NATIVE: native };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('门关闭时禁止读取资源/认证环境'); return target[key as keyof typeof target]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; loaded.push(name); if (name === './table-checks-live') return { registerTableChecksNative: register }; throw Error('注册门禁止未知真实导入'); } }));
  return { reads, loaded, skip, register };
}

describe('CHECK原生定义的默认及列举短路（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])(`${flag}双门%s/%s零环境读取及零实际导入`, (integration, native) => { const f = collect([flag], integration, native); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled(); });
  it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])('非list双门%s/%s仅双开才领注册', (integration, native) => { const f = collect([], integration, native), active = integration === '1' && native === '1'; expect(f.loaded).toEqual(active ? ['./table-checks-live'] : []); expect(f.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(f.skip).toHaveBeenCalledTimes(active ? 0 : 1); });
});
