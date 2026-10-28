import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-create-checks.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 真实注册门仅在RAM执行；关闭时任何认证/资源读取或桌面驱动导入都会立即失败。 */
function collect(args: string[], integration: string | undefined, native: string | undefined) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn(), values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_CHECKS_NATIVE: native };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('门关闭时禁止读取资源或认证'); return target[key as keyof typeof target]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; loaded.push(name); if (name === './table-create-checks-live') return { registerTableCreateChecksNative: register }; throw Error('门禁止未知真实导入'); } }));
  return { reads, loaded, skip, register };
}

describe('新建表CHECK原生门默认及列举短路（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])(`${flag}双门%s/%s零环境读取与零真实导入`, (integration, native) => { const f = collect([flag], integration, native); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled(); });
  it.each([[undefined, undefined], ['0', '1'], ['1', '0'], ['1', '1']])('非list双门%s/%s仅双1才注册', (integration, native) => { const f = collect([], integration, native), active = integration === '1' && native === '1'; expect(f.loaded).toEqual(active ? ['./table-create-checks-live'] : []); expect(f.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(f.skip).toHaveBeenCalledTimes(active ? 0 : 1); });
});
