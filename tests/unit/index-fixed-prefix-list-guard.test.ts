import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as helper from '../helpers/indexFixedPrefixCore';

const source = readFileSync(new URL('../integration/engine-index-fixed-prefix.integration.test.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
/** 转译真实入口，只提供RAM注册和live端口；collect不执行case体，符合真正vitest list生命周期。 */
function collect(argv: string[], integration: string, enabled: string) {
  const reads: string[] = [], loads: string[] = [], cases: { title: string; body: Function }[] = [], hooks: Function[] = [], run = vi.fn(async (_kind, owner: helper.FixedPrefixOwner) => { owner.finish(); });
  const values: Record<string, string> = { DBARK_INTEGRATION_ENABLED: integration, DBARK_INDEX_FIXED_PREFIX_CORE: enabled };
  const environment = new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('认证环境禁止读取：' + key); return target[key]; } });
  const fake = { afterEach: (callback: Function) => hooks.push(callback), it: (title: string, options: { retry: number; repeats: number }, body: Function) => { expect(options).toEqual({ retry: 0, repeats: 0 }); cases.push({ title, body }); }, describe: { sequential: (_title: string, body: Function) => body() } };
  runInContext(compiled, createContext({ exports: {}, process: { argv, env: environment }, require(name: string) {
    if (name === 'vitest') return fake; if (name === 'node:perf_hooks') return { performance: { now: () => 0 } }; if (name === '../helpers/indexFixedPrefixCore') return helper;
    loads.push(name); if (name === './index-fixed-prefix-core-live') return { runFixedPrefixCase: run }; throw Error('禁止真实导入：' + name);
  } }));
  return { reads, loads, cases, hooks, run };
}
describe('固定前缀核心入口的真正Vitest list短路', () => {
  for (const argv of [['node', 'vitest', 'list'], ['node', 'vitest', 'list', '--json'], ['node', 'vitest', 'run']]) it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])(`${argv.join(' ')} 两门%s/%s收集3身份而不读环境或加载live`, (integration, enabled) => {
    const f = collect(argv, integration, enabled); expect(f.cases.map(value => value.title)).toEqual(helper.fixedPrefixCases.map(value => value[1])); expect(f.reads).toEqual([]); expect(f.loads).toEqual([]); expect(f.run).not.toHaveBeenCalled();
  });
  it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])('实际调用case体时两门%s/%s只在双开时触达RAM live', async (integration, enabled) => {
    const f = collect(['node', 'vitest', 'run'], integration, enabled), active = integration === '1' && enabled === '1';
    for (const [index, entry] of f.cases.entries()) { const skip = vi.fn(), context = { task: { id: 't' + index, timeout: 30000, result: { startTime: Date.now() } }, skip }; await entry.body(context); expect(skip).toHaveBeenCalledTimes(active ? 0 : 1); for (const hook of f.hooks) hook(context); }
    expect(f.run).toHaveBeenCalledTimes(active ? 3 : 0); expect(f.loads).toEqual(active ? Array(3).fill('./index-fixed-prefix-core-live') : []); expect(f.reads.every(key => ['DBARK_INTEGRATION_ENABLED', 'DBARK_INDEX_FIXED_PREFIX_CORE'].includes(key))).toBe(true);
  });
});
