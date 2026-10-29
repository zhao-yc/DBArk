import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

/** 运行真实集成文件的默认入口；认证、nonce、真实模块任一越门读取都由哨兵拒绝。 */
function gateFixture(values: Record<string, string | undefined>, args: string[] = [], forbidReads = false) {
  const source = readFileSync(new URL('../integration/import-new-table.test.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], bodies: ((context: unknown) => Promise<void>)[] = [], settings: unknown[] = [];
  const environment = new Proxy(values, { get(target, key: string) {
    reads.push(key);
    if (forbidReads || !['DBARK_INTEGRATION_ENABLED', 'DBARK_IMPORT_NEW_TABLE_TEST'].includes(key)) throw Error('默认或list读取了认证、nonce或目标配置');
    return target[key];
  } });
  const skip = vi.fn(), context = { exports: {}, process: { env: environment, argv: ['node', 'vitest', ...args] }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { afterEach: vi.fn(), describe: { sequential: (_name: string, body: () => void) => body() }, it: (_name: string, options: unknown, body: (context: unknown) => Promise<void>) => { settings.push(options); bodies.push(body); }, vi: { hoisted: (action: () => unknown) => action(), mock: vi.fn() } };
    throw Error('默认或list加载了实库/文件资源模块');
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { modules, reads, settings, skip, async run() { expect(bodies).toHaveLength(1); await bodies[0]({ skip }); } };
}

describe('文件到新表实库默认与list严格关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_IMPORT_NEW_TABLE_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_NEW_TABLE_TEST: 'true' }, { DBARK_INTEGRATION_ENABLED: 'true', DBARK_IMPORT_NEW_TABLE_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '0', DBARK_IMPORT_NEW_TABLE_TEST: '1' }])('没有精确双门不读认证/nonce且不载入Engine：%j', async values => {
    const f = gateFixture(values); await f.run();
    expect(f.skip).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['vitest']); expect(f.settings).toEqual([{ timeout: 120000, retry: 0, repeats: 0 }]);
    expect(f.reads.every(key => ['DBARK_INTEGRATION_ENABLED', 'DBARK_IMPORT_NEW_TABLE_TEST'].includes(key))).toBe(true);
  });
  it.each(['list', '--list', '--list=true', '--list=false'])('%s即使双门齐全也先短路，环境和资源均不读取', async arg => {
    const f = gateFixture({ DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_NEW_TABLE_TEST: '1' }, [arg], true); await f.run();
    expect(f.reads).toEqual([]); expect(f.modules).toEqual(['vitest']); expect(f.skip).toHaveBeenCalledOnce();
  });
});
