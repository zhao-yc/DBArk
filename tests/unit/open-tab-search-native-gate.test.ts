import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/open-tab-search-offline.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 真实spec在RAM执行到门；关闭时任何额外require或认证环境读取都立即报错。 */
function collect(args: string[], enabled: string | undefined, integration: string | undefined) {
  const reads: string[] = [], imports: string[] = [], skip = vi.fn();
  const values = { DBARK_OPEN_TAB_SEARCH_OFFLINE: enabled, DBARK_INTEGRATION_ENABLED: integration };
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('关闭入口禁止读取其它环境'); return target[key as keyof typeof target]; } });
  const run = () => runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env }, require(name: string) { if (name === '@playwright/test') return { test: { skip } }; imports.push(name); throw Error('RAM已到显式注册边界'); } }));
  return { reads, imports, skip, run };
}

describe('标签查找离线专项入口封闭门（仅RAM）', () => {
  for (const flag of ['--list', '--list=json']) it.each([[undefined, undefined], ['1', '0'], ['1', '1'], ['0', '0']])(`${flag}门%s/%s零环境读取、零额外导入`, (enabled, integration) => { const f = collect([flag], enabled, integration); f.run(); expect(f.reads).toEqual([]); expect(f.imports).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); });
  it.each([[undefined, undefined], ['1', undefined], ['1', '1'], ['0', '0']])('缺少离线双门%s/%s不读取文件、驱动或桌面', (enabled, integration) => { const f = collect([], enabled, integration); f.run(); expect(f.imports).toEqual([]); expect(f.skip).toHaveBeenCalledOnce(); });
  it('只有专项1且实库0到达桌面注册边界，不运行App或读取凭据', () => { const f = collect([], '1', '0'); expect(f.run).toThrow('RAM已到显式注册边界'); expect(f.imports).toEqual(['./desktop-fixture']); expect(f.skip).not.toHaveBeenCalled(); expect(f.reads).toEqual(['DBARK_OPEN_TAB_SEARCH_OFFLINE', 'DBARK_INTEGRATION_ENABLED']); });
});
